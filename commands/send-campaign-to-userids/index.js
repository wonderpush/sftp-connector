// Subcommand entry point. The SFTP connect/retry/listing loop is in the
// shared ../../sftpWatcher.js; this file owns only the per-file processing.

import commandOptions from "./options.js";
import log from "../../log.js";
import parseDataFromCsv from "../../parseDataFromCsv.js";
import buildQueries from "./buildQueries.js";
import postQuery from "../../postQuery.js";
import watchSftpFolder from "../../sftpWatcher.js";

await watchSftpFolder(async (sftp, sftpConfig, filePath, fileName) => {
	const records = await parseDataFromCsv(sftp, sftpConfig, filePath);
	const queriesArray = buildQueries(records, filePath, commandOptions.WP_MAXIMUM_DELIVERIES_TARGETS);
	if (queriesArray.length === 0) {
		log("No valid records found in file:", fileName);
	}
	for (const query of queriesArray) {
		await postQuery(commandOptions.WP_ENDPOINT, query, fileName, commandOptions.WP_IDEMPOTENCY_KEY_PREFIX);
	}
});
