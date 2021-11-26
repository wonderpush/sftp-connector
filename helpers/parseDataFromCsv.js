// DEPENDENCIES
import Client from "ssh2-sftp-client";
import fs from "fs";
import * as path from "path";
import os from "os";
import { parse } from "csv-parse/sync";

// HELPERS

const parseDataFromCsv = async (sftpConfig, remotePath) => {
	const sftp = new Client();

	// temporary file
	let tmpDir = fs.mkdtempSync(path.join(os.tmpdir()));
	let tmpFile = tmpDir + "/" + remotePath.split("/").pop();

	const queriesArray = [];

	await sftp
		.connect(sftpConfig)
		.then(() => {
			return sftp.get(remotePath, tmpFile);
		})
		.then(() => {
			/* Store tmp file */
			const input = fs.readFileSync(
				tmpFile,
				process.env.CSV_PARSE_ENCODING || "utf8"
			);

			/* Parsing csv file */
			const records = parse(input, {
				columns: process.env.CSV_PARSE_COLUMNS === "true" || true,
				comment: process.env.CSV_PARSE_COMMENT || "",
				delimiter: process.env.CSV_PARSE_DELIMETER || ",",
				encoding: process.env.CSV_PARSE_ENCODING || "utf8",
				escape: process.env.CSV_PARSE_ESCAPE || '"',
				quote: process.env.CSV_PARSE_QUOTE || '"',
				record_delimiter: [],
				skip_empty_lines:
					process.env.CSV_PARSE_SKIP_EMPTY_LINES === "true" || true
			});

			/* Delete temporary directory */
			fs.rmdirSync(tmpDir, { recursive: true });

			const notificationParamsColumns = Object.keys(records[0]).filter(
				column => {
					return (
						column !== (process.env.CSV_COLUMN_USER_ID || "user_id") &&
						column !== (process.env.CSV_COLUMN_CAMPAIGN_ID || "campaign_id")
					);
				}
			);

			/* Create query */
			const query = {};

			query.accessToken = process.env.WP_ACCESS_TOKEN;

			query.targetUserIds = records.map(
				item => item[process.env.CSV_COLUMN_USER_ID || "user_id"]
			);
			query.campaignId =
				records[0][process.env.CSV_COLUMN_CAMPAIGN_ID || "campaign_id"];

			if (notificationParamsColumns.length > 0) {
				query.notificationParams = records.map(row => {
					const customParams = {};

					notificationParamsColumns.forEach(parameter => {
						customParams[parameter] = row[parameter];
					});

					return customParams;
				});
			}

			/* Slice query*/
			const maxDeliveries =
				Number(process.env.WP_MAXIMUM_DELIVERIES_TARGETS) || 10000;

			const numberOfQueries = Math.ceil(
				query.targetUserIds.length / maxDeliveries
			);

			// range of the query
			let startIndex = 0;
			let endIndex = maxDeliveries;

			for (let i = 0; i < numberOfQueries; i++) {
				const tmpQuery = { data: {}, range: {} };

				tmpQuery.data.accessToken = query.accessToken;
				tmpQuery.data.targetUserIds = query.targetUserIds.slice(
					startIndex,
					endIndex
				);

				tmpQuery.data.campaignId = query.campaignId;

				if (query.notificationParams.length > 0) {
					tmpQuery.data.notificationParams = query.notificationParams.slice(
						startIndex,
						endIndex
					);
				}

				tmpQuery.range = {
					fromLine: startIndex + 1,
					toLine: Math.min(endIndex, query.notificationParams.length)
				};

				queriesArray.push(tmpQuery);

				startIndex = endIndex;
				endIndex += maxDeliveries;
			}
		})
		.then(() => sftp.end());

	return queriesArray;
};

export default parseDataFromCsv;
