// Test helper invoked as a subprocess by tests/buildBatches.test.js.
// Reads the records array from argv[2] (JSON), the remotePath from argv[3]
// and the maxRequests from argv[4], then calls buildBatches and writes the
// JSON-encoded queries array to stderr. Production log() output goes to
// stdout where the caller ignores it, so the two streams stay separated.

import buildBatches from "../commands/update-custom-properties/buildBatches.js";

const records = JSON.parse(process.argv[2]);
const remotePath = process.argv[3] ?? "/test.csv";
const maxRequests = Number(process.argv[4] ?? "100");

const queries = buildBatches(records, remotePath, maxRequests);
process.stderr.write(JSON.stringify(queries));
