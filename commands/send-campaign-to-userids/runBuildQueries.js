// Test helper invoked as a subprocess by buildQueries.test.js.
// Reads the records array from argv[2] (JSON), the remotePath from argv[3]
// and the maxTargets from argv[4], then calls buildQueries and writes the
// JSON-encoded queries array to stderr. Production log() output (if any)
// goes to stdout where the caller ignores it, so the two streams stay
// separated.

import buildQueries from "./buildQueries.js";

const records = JSON.parse(process.argv[2]);
const remotePath = process.argv[3] ?? "/test.csv";
const maxTargets = Number(process.argv[4] ?? "10000");

const queries = buildQueries(records, remotePath, maxTargets);
process.stderr.write(JSON.stringify(queries));
