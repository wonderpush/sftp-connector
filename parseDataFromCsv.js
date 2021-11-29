// DEPENDENCIES
import Client from "ssh2-sftp-client";
import fs from "fs";
import * as path from "path";
import os from "os";
import { parse } from "csv-parse/sync";

// HELPERS

const userIdLabel = process.env.CSV_COLUMN_USER_ID || "user_id";
const campaignIdLabel =
	process.env.CSV_COLUMN_CAMPAIGN_ID || "campaign_id";

const parseDataFromCsv = async (sftpConfig, remotePath) => {
	const sftp = new Client();

	// temporary file
	let tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wonderpush-sftp-deliveries-"));
	let tmpFile = tmpDir + "/" + remotePath.split("/").pop();

	const queriesArray = [];

	await sftp
		.connect(sftpConfig)
		.then(() => {
			return sftp.get(remotePath, tmpFile);
		})
		.then(() => {
			/* Store tmp file */
			const input = fs.readFileSync(tmpFile);

			/* Parsing csv file */
			const records = parse(input, {
				columns: JSON.parse(process.env.CSV_PARSE_COLUMNS || "true"),
				comment: process.env.CSV_PARSE_COMMENT || "",
				delimiter: process.env.CSV_PARSE_DELIMETER || ",",
				encoding: process.env.CSV_PARSE_ENCODING || "utf8",
				escape: process.env.CSV_PARSE_ESCAPE || '"',
				quote: process.env.CSV_PARSE_QUOTE || '"',
				record_delimiter:
					JSON.parse(process.env.CSV_PARSE_RECORD_DELIMITER || "[]"),
				skip_empty_lines:
					JSON.parse(process.env.CSV_PARSE_SKIP_EMPTY_LINES || "true"),
			}).filter(record => {
				// Ignoring a malformed record
				return typeof record[userIdLabel] === "string"
					&& typeof record[campaignIdLabel] === "string";
			});

			/* Delete temporary directory */
			fs.rmdirSync(tmpDir, { recursive: true });

			if (records.length === 0) return;

			const notificationParamsColumns = Object.keys(records[0]).filter(
				column => {
					return column !== userIdLabel && column !== campaignIdLabel;
				}
			);

			/* Create queries */
			const maxTargets =
				Number(process.env.WP_MAXIMUM_DELIVERIES_TARGETS) || 10000;

			const numberOfQueries = Math.ceil(records.length / maxTargets);

			// range of the query
			let startIndex = 0;
			let endIndex = Math.min(maxTargets, records.length);

			for (let i = 0; i < numberOfQueries; i++) {
				const queryRecords = records.slice(startIndex, endIndex);
				
				const tmpQuery = {
					data: {
						accessToken: "",
						targetUserIds: [],
						campaignId: "",
						notificationParams: []
					},
					range: {}
				};

				tmpQuery.data.accessToken = process.env.WP_ACCESS_TOKEN;
				tmpQuery.data.targetUserIds = queryRecords.map(
					item => item[userIdLabel]
				);

				tmpQuery.data.campaignId = records[0][campaignIdLabel];

				if (notificationParamsColumns) {
					tmpQuery.data.notificationParams = queryRecords.map(row => {
						const customParams = {};

						notificationParamsColumns.forEach(parameter => {
							customParams[parameter] = row[parameter];
						});

						return customParams;
					});
				}

				tmpQuery.range = {
					fromRecord: startIndex + 1,
					toRecord: endIndex
				};

				queriesArray.push(tmpQuery);

				startIndex = endIndex;
				endIndex = Math.min(records.length, startIndex + maxTargets);
			}
		})
		.then(() => sftp.end());

	return queriesArray;
};

export default parseDataFromCsv;
