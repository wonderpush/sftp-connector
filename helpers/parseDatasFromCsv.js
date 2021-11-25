// DEPENDENCIES
import Client from "ssh2-sftp-client";
import fs from "fs";
import { parse } from "csv-parse/sync";

// HELPERS
import setLogs from "./setLogs.js";

const parseDatasFromCsv = async (path, queriesArray) => {
	const sftp = new Client();

	const config = {
		host: process.env.FTP_HOST,
		port: process.env.FTP_PORT,
		username: process.env.FTP_USER,
		privateKey: fs.readFileSync(process.env.FTP_PRIVATE_KEY)
	};

	let remotePath = path;

	let tmpPath = "./.tmp.csv";

	await sftp
		.connect(config)
		.then(() => {
			return sftp.get(remotePath, tmpPath);
		})
		.then(() => {
			/* Store tmp file */
			const input = fs.readFileSync(
				tmpPath,
				process.env.CSV_PARSE_ENCODING || "utf8"
			);

			setLogs(input);

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

			// setLogs(JSON.stringify(query));

			/* Slice query*/
			const maxDeliveries =
				Number(process.env.WP_MAXIMUM_DELIVERIES_TARGETS) || 10000;

			const numberOfQueries = Math.round(
				query.targetUserIds.length / maxDeliveries
			);

			// range of the query
			let startIndex = 0;
			let endIndex = maxDeliveries;

			for (let i = 0; i < numberOfQueries; i++) {
				const tmpQuery = {};

				tmpQuery.accessToken = query.accessToken;
				tmpQuery.targetUserIds = query.targetUserIds.slice(
					startIndex,
					endIndex
				);
				
				tmpQuery.campaignId = query.campaignId;

				if (query.notificationParams.length > 0) {
					tmpQuery.notificationParams = query.notificationParams.slice(
						startIndex,
						endIndex
					);
				}

				queriesArray.push(tmpQuery);

				startIndex = endIndex;
				endIndex += maxDeliveries;
			}

		})
		.then(() => sftp.end());
};

export default parseDatasFromCsv;
