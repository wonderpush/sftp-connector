// Spawn helper for parseDataFromCsv.test.js. parseDataFromCsv reads CSV_PARSE_*
// from the frozen options, so each parser-config variant runs in its own
// process with the relevant env set. The CSV content arrives as argv[2]; a fake
// sftp client writes it to the temp file parseDataFromCsv expects. The parsed
// records are written to stderr as JSON (production output goes to stdout).
import { writeFileSync } from "node:fs";
import parseDataFromCsv from "./parseDataFromCsv.js";

const content = process.argv[2];

const fakeSftp = {
	get: async (remotePath, tmpFile) => {
		writeFileSync(tmpFile, content);
	},
};

const records = await parseDataFromCsv(fakeSftp, {}, "/test.csv");
process.stderr.write(JSON.stringify(records));
