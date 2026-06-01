// Processing specific to the update-custom-properties subcommand: turn the raw
// CSV records returned by the shared parseDataFromCsv helper into POST
// /v1/batch queries that group PATCH /v1/installations/<id>?userId=<userId>
// sub-requests updating the installation's custom properties.

import options from "../../options.js";
import commandOptions from "./options.js";
import log from "../../log.js";

const SKIP = Symbol("SKIP");

// Resolve one custom-property cell to either SKIP (omit the key from the body)
// or a value (null, "" or the literal string).
function resolveCellValue(rawValue) {
	if (rawValue === "") {
		if (commandOptions.EMPTY_CELL_BEHAVIOR === "skip") return SKIP;
		if (commandOptions.EMPTY_CELL_BEHAVIOR === "null") return null;
		if (commandOptions.EMPTY_CELL_BEHAVIOR === "empty_string") return "";
	}
	if (commandOptions.CELL_VALUE_FOR_SKIP.has(rawValue)) return SKIP;
	if (commandOptions.CELL_VALUE_FOR_NULL.has(rawValue)) return null;
	if (commandOptions.CELL_VALUE_FOR_EMPTY_STRING.has(rawValue)) return "";
	return rawValue;
}

const buildBatches = (records, remotePath, maxRequests) => {
	const queriesArray = [];

	if (records.length === 0) return queriesArray;

	// Build one PATCH sub-request per usable record.
	// Each record carries its own column names (parsed upstream by csv-parse,
	// either from the header line or from CSV_PARSE_COLUMNS). Custom-property
	// columns are every key other than installation_id and user_id.
	const patches = [];
	records.forEach((record, index) => {
		const installationId = record[commandOptions.CSV_COLUMN_INSTALLATION_ID];
		if (typeof installationId !== "string" || installationId === "") {
			log("Skipping row missing installation_id at CSV record index:", index);
			return;
		}
		const userIdRaw = record[options.CSV_COLUMN_USER_ID];
		const userId = (typeof userIdRaw === "string" && userIdRaw !== "") ? userIdRaw : null;

		const custom = {};
		for (const [column, value] of Object.entries(record)) {
			if (column === commandOptions.CSV_COLUMN_INSTALLATION_ID) continue;
			if (column === options.CSV_COLUMN_USER_ID) continue;
			const resolved = resolveCellValue(value);
			if (resolved !== SKIP) {
				custom[column] = resolved;
			}
		}

		if (Object.keys(custom).length === 0) {
			log("Skipping row with no custom properties to update at CSV record index:", index);
			return;
		}

		patches.push({
			method: "PATCH",
			path: `/v1/installations/${installationId}`,
			args: { userId },
			body: { custom },
		});
	});

	if (patches.length === 0) return queriesArray;

	const numberOfQueries = Math.ceil(patches.length / maxRequests);

	let startIndex = 0;
	let endIndex = Math.min(maxRequests, patches.length);

	for (let i = 0; i < numberOfQueries; i++) {
		const chunk = patches.slice(startIndex, endIndex);

		queriesArray.push({
			data: {
				accessToken: options.WP_ACCESS_TOKEN,
				requests: chunk,
			},
			range: {
				fromRecord: startIndex + 1,
				toRecord: endIndex,
			},
			remotePath,
		});

		startIndex = endIndex;
		endIndex = Math.min(patches.length, startIndex + maxRequests);
	}

	return queriesArray;
};

export default buildBatches;
