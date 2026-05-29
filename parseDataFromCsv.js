// DEPENDENCIES
import fs from "fs";
import * as path from "path";
import os from "os";
import { parse } from "csv-parse/sync";
import options from "./options.js";

// HELPERS

const parseDataFromCsv = async (sftp, sftpConfig, remotePath) => {
	// temporary file
	let tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wonderpush-sftp-connector-"));
	let tmpFile = tmpDir + "/" + remotePath.split("/").pop();

	let records = [];

	await sftp.get(remotePath, tmpFile)
		.then(() => {
			/* Store tmp file */
			let input = fs.readFileSync(tmpFile);
			/* Skip BOM */
			if (input.toString('utf8', 0, 3).charCodeAt(0) === 65279) {
				input = input.slice(3);
			}

			/* Parsing csv file */
			records = parse(input, {
				columns: options.CSV_PARSE_COLUMNS,
				comment: options.CSV_PARSE_COMMENT,
				delimiter: options.CSV_PARSE_DELIMITER,
				encoding: options.CSV_PARSE_ENCODING,
				escape: options.CSV_PARSE_ESCAPE,
				quote: options.CSV_PARSE_QUOTE,
				record_delimiter: options.CSV_PARSE_RECORD_DELIMITER,
				skip_empty_lines: options.CSV_PARSE_SKIP_EMPTY_LINES,
			});

			/* Delete temporary directory */
			fs.rmSync(tmpDir, { recursive: true });
		});

	return records;
};

export default parseDataFromCsv;
