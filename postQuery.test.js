// Tests for postQuery.js retry/backoff/idempotency behaviour. Each scenario
// spawns runPostQuery.js in a fresh process (postQuery's backoff state is
// process-wide and intentionally persists across calls) with NODE_EXTRA_CA_CERTS
// pointing at a self-signed cert so its axios trusts our mock HTTPS server.
import { test, before, after } from "node:test";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { generateSelfSignedCert } from "./tests/tlsCert.js";

const baseEnv = {
	WP_ACCESS_TOKEN: "test-token",
	SFTP_HOST: "x",
	SFTP_PRIVATE_KEY: "x",
};

let cert;
before(() => { cert = generateSelfSignedCert(); });
after(() => { cert && cert.cleanup(); });

// Runs one scenario; returns { attempts, idempotencyKeys, finalStatus, elapsedMs }.
function run(config, extraEnv = {}) {
	const r = spawnSync(
		process.execPath,
		["runPostQuery.js", cert.keyFile, cert.certFile, JSON.stringify(config)],
		{
			env: { ...baseEnv, ...extraEnv, NODE_EXTRA_CA_CERTS: cert.certFile },
			encoding: "utf8",
			// Safety net: a hung child (e.g. a stuck retry loop) would otherwise
			// stall the whole suite indefinitely. Worst legitimate case is a few
			// retries each capped at WP_TIMEOUT_MS, well under this.
			timeout: 120000,
		},
	);
	if (r.status !== 0) {
		const reason = r.error ? r.error.message : `exit ${r.status}` + (r.signal ? ` (signal ${r.signal})` : "");
		throw new Error(`helper failed: ${reason}; stdout=${r.stdout}; stderr=${r.stderr}`);
	}
	return JSON.parse(r.stderr);
}

test("2xx succeeds without retry", () => {
	const res = run({ responses: [{ status: 200, body: { success: true } }] });
	assert.equal(res.attempts, 1);
	assert.equal(res.finalStatus, 200);
});

test("idempotency key has the documented format", () => {
	const res = run({ responses: [{ status: 200 }] });
	const hash = crypto.createHash("sha1").update("/test.csv").digest("hex").slice(-8);
	const expected = `sftp-test-${hash}0000000000000001` + "00";
	assert.equal(res.idempotencyKeys[0], expected);
});

test("409/12045 is not retried and keeps the same backoff", () => {
	const res = run({ responses: [{ status: 409, body: { error: { status: 409, code: "12045", message: "Request in progress" } } }] });
	assert.equal(res.attempts, 1);
	assert.equal(res.finalStatus, 409);
});

test("other 4xx is not retried", () => {
	const res = run({ responses: [{ status: 404, body: {} }] });
	assert.equal(res.attempts, 1);
	assert.equal(res.finalStatus, 404);
});

test("non WP-source 5xx is retried with the SAME idempotency key", () => {
	const res = run({ responses: [{ status: 503, body: {} }, { status: 200 }] });
	assert.equal(res.attempts, 2);
	assert.equal(res.finalStatus, 200);
	assert.equal(res.idempotencyKeys[0], res.idempotencyKeys[1]);
});

test("429 is retried and honours Retry-After", () => {
	const res = run({ responses: [{ status: 429, headers: { "retry-after": "1" } }, { status: 200 }] });
	assert.equal(res.attempts, 2);
	assert.equal(res.finalStatus, 200);
	assert.ok(res.elapsedMs >= 900, `expected >= ~1s wait, got ${res.elapsedMs}ms`);
});

test("replayed response below 500 is not retried", () => {
	const res = run({ responses: [{ status: 400, headers: { "x-wonderpush-idempotency-initially-started-at": "2020-01-01T00:00:00Z" } }] });
	assert.equal(res.attempts, 1);
	assert.equal(res.finalStatus, 400);
});

test("5xx without .error.code is retried with the same key", () => {
	const res = run({ responses: [
		{ status: 500 },
		{ status: 200 },
	] });
	assert.equal(res.attempts, 2);
	assert.equal(res.idempotencyKeys[0], res.idempotencyKeys[1]);
});

test("5xx with .error.code is retried with a bumped key", () => {
	const res = run({ responses: [
		{ status: 500, body: { error: { status: 500, code: "12009", message: "Service error" } } },
		{ status: 200 },
	] });
	assert.equal(res.attempts, 2);
	assert.ok(res.idempotencyKeys[0].endsWith("00"));
	assert.ok(res.idempotencyKeys[1].endsWith("01"));
	// Only the trailing attempt byte differs; the rest of the key is unchanged.
	assert.equal(res.idempotencyKeys[0].slice(0, -2), res.idempotencyKeys[1].slice(0, -2));
});

test("a network error (socket destroyed) is retried up to WP_RETRIES_MAX", () => {
	const res = run({ responses: [{ destroy: true }] }, { WP_RETRIES_MAX: "2" });
	assert.equal(res.attempts, 3); // 1 initial + 2 retries
	assert.equal(res.finalStatus, null);
});

test("retries are capped by WP_RETRIES_MAX", () => {
	const res = run({ responses: [{ status: 502 }] }, { WP_RETRIES_MAX: "2" });
	assert.equal(res.attempts, 3);
	assert.equal(res.finalStatus, 502);
});

test("a request-setup error (no error.request) is not retried", () => {
	const res = run({ badUrl: "htp://127.0.0.1:1/", responses: [{ status: 200 }] });
	assert.equal(res.finalStatus, null);
	assert.ok(res.elapsedMs < 800, `expected no retry wait, got ${res.elapsedMs}ms`);
});

test("replayed 5xx with .error.code is retried with a bumped key", () => {
	const res = run({ responses: [
		{ destroy: true },
		{ status: 500, body: { error: { status: 500, code: "12009", message: "Service error" } }, headers: { "x-wonderpush-idempotency-initially-started-at": "2020-01-01T00:00:00Z" } },
		{ status: 200 },
	] });
	assert.equal(res.attempts, 3);
	assert.equal(res.finalStatus, 200);
	assert.equal(res.idempotencyKeys[0], res.idempotencyKeys[1]);
	assert.notEqual(res.idempotencyKeys[0], res.idempotencyKeys[2]);
	assert.ok(res.idempotencyKeys[0].endsWith("00"));
	assert.ok(res.idempotencyKeys[2].endsWith("01"));
	// Only the trailing attempt byte differs; the rest of the key is unchanged.
	assert.equal(res.idempotencyKeys[0].slice(0, -2), res.idempotencyKeys[2].slice(0, -2));
});

test("replayed 2xx after a network error is not retried", () => {
	const res = run({ responses: [
		{ destroy: true },
		{ status: 200, headers: { "x-wonderpush-idempotency-initially-started-at": "2020-01-01T00:00:00Z" } },
	] });
	assert.equal(res.attempts, 2);
	assert.equal(res.idempotencyKeys[0], res.idempotencyKeys[1]);
});
