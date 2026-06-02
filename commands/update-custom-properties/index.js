// Subcommand entry point. The SFTP connect/retry/listing loop is in the
// shared ../../sftpWatcher.js; this file owns only the per-file processing.

import commandOptions from "./options.js";
import log from "../../log.js";
import parseDataFromCsv from "../../parseDataFromCsv.js";
import buildBatches from "./buildBatches.js";
import postQuery from "../../postQuery.js";
import watchSftpFolder from "../../sftpWatcher.js";

// Inspect the WonderPush /v1/batch response and log any sub-request that did
// not succeed. Per the agreed contract: log and continue, no
// retry, no backoff adjustment. Outer HTTP-level errors are already handled
// inside postQuery and would result in a different response shape.
function logBatchSubResponses(response, fileName, range) {
	const subResponses = response && response.data && Array.isArray(response.data.responses)
		? response.data.responses
		: null;
	if (!subResponses) {
		log("Batch response did not contain a 'responses' array", { file: fileName, range });
		return;
	}
	let failures = 0;
	subResponses.forEach((sub, index) => {
		if (!sub || sub.success !== true) {
			failures++;
			log("Batch sub-request failure", {
				file: fileName,
				range,
				requestIndex: index,
				response: sub,
			});
		}
	});
	log("Batch sub-request summary", {
		file: fileName,
		range,
		total: subResponses.length,
		failures,
	});
}

await watchSftpFolder(async (sftp, sftpConfig, filePath, fileName) => {
	const records = await parseDataFromCsv(sftp, sftpConfig, filePath);
	const queriesArray = buildBatches(records, filePath, commandOptions.WP_MAXIMUM_BATCH_REQUESTS);
	if (queriesArray.length === 0) {
		log("No valid records found in file:", fileName);
	}
	for (const query of queriesArray) {
		const response = await postQuery(
			commandOptions.WP_BATCH_ENDPOINT,
			query,
			fileName,
			commandOptions.WP_IDEMPOTENCY_KEY_PREFIX,
		);
		if (response && response.status >= 200 && response.status < 300) {
			logBatchSubResponses(response, fileName, query.range);
		}
	}
});
