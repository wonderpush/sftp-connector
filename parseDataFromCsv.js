// DEPENDENCIES
import Client from "ssh2-sftp-client";
import fs from "fs";
import * as path from "path";
import os from "os";
import { parse } from "csv-parse/sync";
import options from "./options.js";

// HELPERS

const parseDataFromCsv = async (sftpConfig, remotePath) => {
	const sftp = new Client();

	// temporary file
	let tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wonderpush-sftp-connector-"));
	let tmpFile = tmpDir + "/" + remotePath.split("/").pop();

	const queriesArray = [];

	await sftp
		.connect(sftpConfig)
		.then(() => {
			return sftp.get(remotePath, tmpFile);
		})
		.then(() => {
			/* Store tmp file */
			let input = fs.readFileSync(tmpFile);
			/* Skip BOM */
			if (input.toString('utf8', 0, 3).charCodeAt(0) === 65279) {
				input = input.slice(3);
			}

			/* Parsing csv file */
			const records = parse(input, {
				columns: options.CSV_PARSE_COLUMNS,
				comment: options.CSV_PARSE_COMMENT,
				delimiter: options.CSV_PARSE_DELIMITER,
				encoding: options.CSV_PARSE_ENCODING,
				escape: options.CSV_PARSE_ESCAPE,
				quote: options.CSV_PARSE_QUOTE,
				record_delimiter: options.CSV_PARSE_RECORD_DELIMITER,
				skip_empty_lines: options.CSV_PARSE_SKIP_EMPTY_LINES,
			}).filter(record => {
				// Ignoring a malformed record
				return typeof record[options.CSV_COLUMN_USER_ID] === "string"
					&& typeof record[options.CSV_COLUMN_CAMPAIGN_ID] === "string";
			});

			/* Delete temporary directory */
			fs.rmSync(tmpDir, { recursive: true });

			if (records.length === 0) return;

			const notificationParamsColumns = Object.keys(records[0]).filter(
				column => {
					return column !== options.CSV_COLUMN_USER_ID && column !== options.CSV_COLUMN_CAMPAIGN_ID;
				}
			);

			/* Create queries */
			const maxTargets =
				Number(options.WP_MAXIMUM_DELIVERIES_TARGETS) || 10000;

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
					range: {},
					remotePath,
				};

				tmpQuery.data.accessToken = options.WP_ACCESS_TOKEN;
				tmpQuery.data.targetUserIds = queryRecords.map(
					item => item[options.CSV_COLUMN_USER_ID]
				);

				tmpQuery.data.campaignId = records[0][options.CSV_COLUMN_CAMPAIGN_ID];

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
