// Tests for parseDataFromCsv.js across a few classic CSV shapes. CSV_PARSE_*
// come from the frozen options, so each variant spawns runParseCsv.js with the
// matching env. A fake sftp client supplies the CSV content, so no real SFTP
// server is involved.
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const baseEnv = {
	WP_ACCESS_TOKEN: "test-token",
	SFTP_HOST: "x",
	SFTP_PRIVATE_KEY: "x",
};

function parse(content, extraEnv = {}) {
	const r = spawnSync(
		process.execPath,
		["runParseCsv.js", content],
		{ env: { ...baseEnv, ...extraEnv }, encoding: "utf8" },
	);
	if (r.status !== 0) {
		throw new Error(`helper exited ${r.status}; stdout=${r.stdout}; stderr=${r.stderr}`);
	}
	return JSON.parse(r.stderr);
}

test("a quoted field containing a comma is kept intact", () => {
	const records = parse('name,note\n"alice","x,y"\n');
	assert.deepEqual(records, [{ name: "alice", note: "x,y" }]);
});

test("semicolon delimiter splits unquoted fields", () => {
	const records = parse("name;note\nalice;bob\n", { CSV_PARSE_DELIMITER: '";"' });
	assert.deepEqual(records, [{ name: "alice", note: "bob" }]);
});

test("explicit CSV_PARSE_COLUMNS keys rows with no header present", () => {
	const records = parse("1,foo\n2,bar\n", { CSV_PARSE_COLUMNS: '["id","val"]' });
	assert.deepEqual(records, [
		{ id: "1", val: "foo" },
		{ id: "2", val: "bar" },
	]);
});

test("a UTF-8 BOM is stripped before parsing", () => {
	const records = parse("﻿name\nalice\n");
	assert.deepEqual(records, [{ name: "alice" }]);
});

test("CRLF line endings are handled (default record-delimiter auto-detection)", () => {
	const records = parse("name,note\r\nalice,bob\r\n");
	assert.deepEqual(records, [{ name: "alice", note: "bob" }]);
});
