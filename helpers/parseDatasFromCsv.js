// DEPENDENCIES
import Client from "ssh2-sftp-client";
import fs from "fs";
import { parse } from "csv-parse/sync";

// HELPERS
import setLogs from "./setLogs.js";

const parseDatasFromCsv = async (path, query) => {
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
			const input = fs.readFileSync(
				tmpPath,
				process.env.CSV_PARSE_ENCODING || "utf8"
			);

			setLogs(input);

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
						column !== "nom" &&
						column !== "prenom" &&
						column !== (process.env.CSV_COLUMN_USER_ID || "user_id") &&
						column !== (process.env.CSV_COLUMN_CAMPAIGN_ID || "campaign_id")
					);
				}
			);

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

			setLogs(JSON.stringify(query));
		})
		.then(() => sftp.end());
};

export default parseDatasFromCsv;
