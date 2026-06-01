// DEPENDENCIES
import axios from "axios";
import log from "./log.js";
import options from './options.js';
import crypto from 'crypto';

const BACKOFF_SLEEP_MS_MIN = 1000;
const BACKOFF_SLEEP_MS_MAX = 60000;
const BACKOFF_SLEEP_GROWTH_RATIO = 2;
const BACKOFF_SLEEP_JITTER_RATIO = 0.1;
let currentBackoffSleepMs = 0; // the backoff is kept between invocations of postQuery() on purpose
let nextCallNoSoonerThanDate = 0;
function adjustBackoffOnSuccess() {
	log('adjustBackoffOnSuccess <-', currentBackoffSleepMs);
	// Reduce the delay
	currentBackoffSleepMs /= BACKOFF_SLEEP_GROWTH_RATIO;
	currentBackoffSleepMs = Math.round(currentBackoffSleepMs);
	// No jitter in the recovery path
	nextCallNoSoonerThanDate = new Date().getTime() + currentBackoffSleepMs;
	log('adjustBackoffOnSuccess ->', currentBackoffSleepMs);
}
function adjustBackoffOnFailure() {
	log('adjustBackoffOnFailure <-', currentBackoffSleepMs);
	// Increase the delay…
	currentBackoffSleepMs = Math.min(
		BACKOFF_SLEEP_MS_MAX,
		Math.max(
			BACKOFF_SLEEP_MS_MIN,
			currentBackoffSleepMs * BACKOFF_SLEEP_GROWTH_RATIO,
		),
	);
	// …then apply jitter, to avoid settling on a too regular rate
	currentBackoffSleepMs *= 1 + BACKOFF_SLEEP_JITTER_RATIO * Math.random();
	nextCallNoSoonerThanDate = new Date().getTime() + currentBackoffSleepMs;
	log('adjustBackoffOnFailure ->', currentBackoffSleepMs);
}

const doNotWait = Promise.resolve();
function sleep(ms) {
	if (ms <= 0) return doNotWait;
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

const postQuery = async (url, query, file, idempotencyKeyPrefix) => {
	const remotePathHash = crypto.createHash('sha1').update(query.remotePath).digest('hex').substr(-8);
	const rangeFromHex = query.range.fromRecord.toString(16).padStart(8, '0');
	const rangeToHex = query.range.toRecord.toString(16).padStart(8, '0');
	const idempotencyKeyBase = `${idempotencyKeyPrefix}${remotePathHash}${rangeFromHex}${rangeToHex}`;

	let lastResponse = undefined;
	let attempt = 0;
	for (let tries = 0; tries <= options.WP_RETRIES_MAX; tries++) {
		let retry = false;
		await sleep(nextCallNoSoonerThanDate - new Date().getTime());
		const start = new Date().getTime();
		const attemptHex = attempt.toString(16).padStart(2, '0');
		const idempotencyKey = `${idempotencyKeyBase}${attemptHex}`;
		try {
			log({ url, data: query.data, idempotencyKey });
			const response = await axios.post(url, query.data, {
				timeout: options.WP_TIMEOUT_MS,
				headers: {
					'X-WonderPush-Idempotency-Key': idempotencyKey,
				}
			});

			const duration = new Date().getTime() - start;
			adjustBackoffOnSuccess();

			log({
				file: file,
				range: query.range,
				query: query.data,
				status: response.status,
				time: duration,
				response: response.data,
				headers: response.headers,
			});
			lastResponse = response;
		} catch (error) {
			lastResponse = error.response;
			const duration = new Date().getTime() - start;
			error.response
				? log({
					file: file,
					range: query.range,
					query: query.data,
					status: error.response.status,
					time: duration,
					response: error.response.data,
					headers: error.response.headers,
				})
				: log({
					file: file,
					range: query.range,
					query: query.data,
					time: duration,
					error: error.message,
				});

			if (error.response) {
				// The request was made and the server responded with a status code outside the 2xx range.
				// We treat the response by status as if it were fresh; if it's actually a replay from the
				// server's idempotency store (`x-wonderpush-idempotency-initially-started-at` set), we skip
				// the backoff adjustments because the original failure already adjusted them, and the fact
				// that we now got an answer reflects networking conditions, not server health.
				// (429 is not gated by isReplayedResponse: rate-limiting kicks in before idempotency on the
				// server, so 429 responses are never replayed.)
				const isReplayedResponse = error.response.headers['x-wonderpush-idempotency-initially-started-at'];
				if (error.response.status === 409 && error.response.data && error.response.data.error && error.response.data.error.code === "12045") {
					// Original request was well received and is still being processed
					// Do not adjust backoff to avoid speeding up a possible recovery too quickly
				} else if (error.response.status === 429) {
					// Rate limiting
					// Backoff in case of multiple concurrent programs trying to respect the rate limit,
					// we may not be the only one making requests.
					adjustBackoffOnFailure();
					const waitForSec = parseInt(error.response.headers['retry-after']);
					if (!isNaN(waitForSec)) {
						// Wait for the longer between the backoff and the given delay
						nextCallNoSoonerThanDate = Math.max(nextCallNoSoonerThanDate, new Date().getTime() + waitForSec * 1000);
					}
					retry = true;
				} else if (error.response.status >= 500) {
					// 5xx denote a server error, back off to let server heal.
					if (!isReplayedResponse) adjustBackoffOnFailure();
					retry = true;
					if (error.response.data && error.response.data.error && error.response.data.error.code) {
						// The 5xx came from the WonderPush server itself (identified by the `.error.code` body):
						// retrying with the same idempotency key would just replay the stored failure, so bump the
						// attempt counter to force the server to treat the next try as a fresh request.
						// Upstream/gateway 5xx (no `.error.code`) keep the same key so the server's idempotency
						// protection still applies if it has already processed the original request.
						attempt++;
					}
				} else if (error.response.status >= 400 && error.response.status < 500) {
					// 4xx denote a client error, so at least we know that networking conditions are better and the server is no worse.
					if (!isReplayedResponse) adjustBackoffOnSuccess();
				}
			} else if (!error.request) {
				// Something happened in setting up the request that triggered an Error
				// NOTE: Retrying will likely experience the same code issue and waste CPU time.
			} else {
				// The request was made but no response was received. Either the network or the server conditions are bad.
				adjustBackoffOnFailure();
				retry = true;
			}
		}

		if (!retry) break;
	}
	return lastResponse;
};

export default postQuery;
