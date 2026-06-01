// Tests for the startup validation in commands/update-custom-properties/options.js.
//
// Each scenario loads the options module in a subprocess with the relevant
// env vars and asserts that the process either exits successfully or fails
// with a specific error message. We can't do this in-process because module
// load only happens once per node instance.

import { test } from "node:test";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const OPTIONS_FILE = "commands/update-custom-properties/options.js";

const baseEnv = {
	WP_ACCESS_TOKEN: "t",
	SFTP_HOST: "x",
	SFTP_PRIVATE_KEY: "x",
};

function loadOptions(extraEnv) {
	return spawnSync(process.execPath, [OPTIONS_FILE], {
		env: { ...baseEnv, ...extraEnv },
		encoding: "utf8",
	});
}

function expectLoadError(extraEnv, errMatch) {
	const r = loadOptions(extraEnv);
	assert.notEqual(r.status, 0, `expected load failure but options.js exited 0; stdout=${r.stdout}`);
	const combined = (r.stderr || "") + (r.stdout || "");
	assert.match(combined, errMatch);
}

test("default config loads fine", () => {
	const r = loadOptions({});
	assert.equal(r.status, 0, `expected default load to succeed; stderr=${r.stderr}`);
});

test("rejects bad EMPTY_CELL_BEHAVIOR", () => {
	expectLoadError({ EMPTY_CELL_BEHAVIOR: "bogus" }, /Bad EMPTY_CELL_BEHAVIOR/);
});

test("rejects empty string as a sentinel value", () => {
	expectLoadError({ CELL_VALUE_FOR_NULL: '""' }, /empty string is reserved/);
});

test("rejects overlapping sentinel sets", () => {
	expectLoadError(
		{ CELL_VALUE_FOR_NULL: '"X"', CELL_VALUE_FOR_SKIP: '"X"' },
		/appears in both CELL_VALUE_FOR_NULL and CELL_VALUE_FOR_SKIP/,
	);
});

test("rejects non-string element inside a sentinel array", () => {
	expectLoadError(
		{ CELL_VALUE_FOR_NULL: '["ok", 42]' },
		/expected a string or an array of strings/,
	);
});

test("rejects non-JSON sentinel value", () => {
	expectLoadError(
		{ CELL_VALUE_FOR_NULL: "not-json" },
		/should be JSON-encoded/,
	);
});

test("rejects oversized WP_IDEMPOTENCY_KEY_PREFIX", () => {
	expectLoadError(
		{ WP_IDEMPOTENCY_KEY_PREFIX: "x".repeat(39) },
		/must not exceed 38 characters/,
	);
});

test("rejects WP_IDEMPOTENCY_KEY_PREFIX with invalid characters", () => {
	expectLoadError(
		{ WP_IDEMPOTENCY_KEY_PREFIX: "sftp!ucp" },
		/only alphanumeric characters dashes and underscores are allowed/,
	);
});

test("rejects non-positive WP_MAXIMUM_BATCH_REQUESTS", () => {
	expectLoadError(
		{ WP_MAXIMUM_BATCH_REQUESTS: "0" },
		/Bad WP_MAXIMUM_BATCH_REQUESTS/,
	);
});

test("rejects non-numeric WP_MAXIMUM_BATCH_REQUESTS", () => {
	expectLoadError(
		{ WP_MAXIMUM_BATCH_REQUESTS: "abc" },
		/Bad WP_MAXIMUM_BATCH_REQUESTS/,
	);
});
