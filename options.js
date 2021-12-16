import fs from "fs";

const FTP_HOST = process.env.FTP_HOST;
if (!FTP_HOST) {
	throw new Error('Missing or bad FTP_HOST environment variable');
}
const FTP_PORT = parseInt(process.env.FTP_PORT || '22');
if (isNaN(FTP_PORT) || FTP_PORT <= 0) {
	throw new Error('Bad FTP_PORT environment variable');
}
const FTP_USER = process.env.FTP_USER || ''; // '' represents anonymous
if (!process.env.FTP_PRIVATE_KEY && !process.env.FTP_PRIVATE_KEY_FILE) {
	throw new Error('Missing FTP_PRIVATE_KEY or FTP_PRIVATE_KEY_FILE environment variable');
}
const FTP_PRIVATE_KEY = process.env.FTP_PRIVATE_KEY || fs.readFileSync(process.env.FTP_PRIVATE_KEY_FILE);
const FTP_PATH = process.env.FTP_PATH || '/';

const LISTING_INTERVAL_MS = parseInt(process.env.LISTING_INTERVAL_MS || '60000');
if (isNaN(LISTING_INTERVAL_MS) || LISTING_INTERVAL_MS <= 0) {
	throw new Error('Bad LISTING_INTERVAL_MS environment variable');
}
const STALE_FILE_CHECKS = parseInt(process.env.STALE_FILE_CHECKS || '1');
if (isNaN(STALE_FILE_CHECKS) || STALE_FILE_CHECKS < 0) {
	throw new Error('Bad STALE_FILE_CHECKS environment variable');
}

function tryJsonParse(json, orThrow) {
	try {
		return JSON.parse(json);
	} catch (ex) {
		if (ex instanceof SyntaxError) {
			ex = orThrow;
		}
		throw ex;
	}
}
const CSV_PARSE_COLUMNS = tryJsonParse(process.env.CSV_PARSE_COLUMNS || 'true', new Error('Bad CSV_PARSE_COLUMNS environment variable, should be JSON-encoded'));
const CSV_PARSE_COMMENT = tryJsonParse(process.env.CSV_PARSE_COMMENT || '""', new Error('Bad CSV_PARSE_COMMENT environment variable, should be JSON-encoded'));
const CSV_PARSE_DELIMITER = tryJsonParse(process.env.CSV_PARSE_DELIMITER || '","', new Error('Bad CSV_PARSE_DELIMITER environment variable, should be JSON-encoded'));
const CSV_PARSE_ENCODING = tryJsonParse(process.env.CSV_PARSE_ENCODING || '"utf8"', new Error('Bad CSV_PARSE_ENCODING environment variable, should be JSON-encoded'));
const CSV_PARSE_ESCAPE = tryJsonParse(process.env.CSV_PARSE_ESCAPE || '"\""', new Error('Bad CSV_PARSE_ESCAPE environment variable, should be JSON-encoded'));
const CSV_PARSE_QUOTE = tryJsonParse(process.env.CSV_PARSE_QUOTE || '"\""', new Error('Bad CSV_PARSE_QUOTE environment variable, should be JSON-encoded'));
const CSV_PARSE_RECORD_DELIMITER = tryJsonParse(process.env.CSV_PARSE_RECORD_DELIMITER || '[]', new Error('Bad CSV_PARSE_RECORD_DELIMITER environment variable, should be JSON-encoded'));
const CSV_PARSE_SKIP_EMPTY_LINES = tryJsonParse(process.env.CSV_PARSE_SKIP_EMPTY_LINES || 'true', new Error('Bad CSV_PARSE_SKIP_EMPTY_LINES environment variable, should be JSON-encoded'));

const CSV_COLUMN_USER_ID = process.env.CSV_COLUMN_USER_ID || 'user_id';
const CSV_COLUMN_CAMPAIGN_ID = process.env.CSV_COLUMN_CAMPAIGN_ID || 'campaign_id';

const WP_ENDPOINT = process.env.WP_ENDPOINT || 'https://management-api.wonderpush.com/v1/deliveries';
const WP_ACCESS_TOKEN = process.env.WP_ACCESS_TOKEN;
if (!WP_ACCESS_TOKEN) {
	throw new Error('Missing or bad WP_ACCESS_TOKEN environment variable');
}
const WP_MAXIMUM_DELIVERIES_TARGETS = parseInt(process.env.WP_MAXIMUM_DELIVERIES_TARGETS || '10000');
if (isNaN(WP_MAXIMUM_DELIVERIES_TARGETS) || WP_MAXIMUM_DELIVERIES_TARGETS <= 0) {
	throw new Error('Bad WP_MAXIMUM_DELIVERIES_TARGETS environment variable');
}

const options = {
	FTP_HOST,
	FTP_PORT,
	FTP_USER,
	FTP_PRIVATE_KEY,
	FTP_PATH,
	LISTING_INTERVAL_MS,
	STALE_FILE_CHECKS,
	CSV_PARSE_COLUMNS,
	CSV_PARSE_COMMENT,
	CSV_PARSE_DELIMITER,
	CSV_PARSE_ENCODING,
	CSV_PARSE_ESCAPE,
	CSV_PARSE_QUOTE,
	CSV_PARSE_RECORD_DELIMITER,
	CSV_PARSE_SKIP_EMPTY_LINES,
	CSV_COLUMN_USER_ID,
	CSV_COLUMN_CAMPAIGN_ID,
	WP_ENDPOINT,
	WP_ACCESS_TOKEN,
	WP_MAXIMUM_DELIVERIES_TARGETS,
};
Object.freeze(options);
export default options;
