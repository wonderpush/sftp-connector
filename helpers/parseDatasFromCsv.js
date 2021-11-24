// DEPENDENCIES
import fs from "fs";
import { parse } from "csv-parse/sync";

const parseDatasFromCsv = path => {
	const input = fs.readFileSync(path, process.env.CSV_PARSE_COLUMS || "utf8");

	const records = parse(input, {
		columns: process.env.CSV_PARSE_COLUMS || true,
		comment: process.env.CSV_PARSE_COMMENT || "",
		delimiter: process.env.CSV_PARSE_DELIMETER || ",",
		encoding: process.env.CSV_PARSE_ENCODING || "utf8",
		escape: process.env.CSV_PARSE_ESCAPE || '"',
		quote: process.env.CSV_PARSE_QUOTE || '"',
		record_delimiter: process.env.CSV_PARSE_RECORD_DELIMITER || [],
		skip_empty_lines: process.env.CSV_PARSE_SKIP_EMPTY_LINES || true
	});

	const notificationParamsColumns = Object.keys(records[0]).filter(column => {
		return (
			column !== "nom" &&
			column !== "prenom" &&
			column !== (process.env.CSV_COLUMN_USER_ID || "user_id") &&
			column !== (process.env.CSV_COLUMN_CAMPAIGN_ID || "campaign_id")
		);
	});

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

	return query;
};

export default parseDatasFromCsv;
