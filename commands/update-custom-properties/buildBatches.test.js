// Tests for ./buildBatches.js.
//
// buildBatches reads its configuration from commandOptions, which is frozen
// at module load time. To exercise different EMPTY_CELL_BEHAVIOR / sentinel
// configurations within the same test run we invoke a helper subprocess
// (./runBuildBatches.js) per scenario, set the relevant env vars on the
// child, and parse the JSON result from its stderr.

import { test } from "node:test";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import path from "node:path";

const HELPER = path.join("commands", "update-custom-properties", "runBuildBatches.js");

const baseEnv = {
	WP_ACCESS_TOKEN: "test-token",
	SFTP_HOST: "x",
	SFTP_PRIVATE_KEY: "x",
};

function runBuild(extraEnv, records, remotePath = "/test.csv", maxRequests = 100) {
	const r = spawnSync(
		process.execPath,
		[HELPER, JSON.stringify(records), remotePath, String(maxRequests)],
		{ env: { ...baseEnv, ...extraEnv }, encoding: "utf8" },
	);
	if (r.status !== 0) {
		throw new Error(`helper exited with status ${r.status}; stdout=${r.stdout}; stderr=${r.stderr}`);
	}
	return JSON.parse(r.stderr);
}

test("spec example produces the expected batch", () => {
	const records = [
		{
			installation_id: "0b9c2625dc21ef05f6ad4ddf47c5f203837aa32c",
			user_id: "",
			string_foo: "foo",
			int_bar: 42,
		},
		{
			installation_id: "9395988394d4568df3c54c2645ddb1d0753a0c20",
			user_id: "email@example.com",
			string_foo: "bar",
			int_bar: 314,
		},
	];
	const queries = runBuild({}, records, "/tmp/example.csv");
	assert.equal(queries.length, 1);
	const q = queries[0];
	assert.equal(q.data.accessToken, "test-token");
	assert.deepEqual(q.range, { fromRecord: 1, toRecord: 2 });
	assert.deepEqual(q.data.requests, [
		{
			method: "PATCH",
			path: "/v1/installations/0b9c2625dc21ef05f6ad4ddf47c5f203837aa32c",
			args: { userId: null },
			body: {
				custom: {
					string_foo: "foo",
					int_bar: 42,
				},
			},
		},
		{
			method: "PATCH",
			path: "/v1/installations/9395988394d4568df3c54c2645ddb1d0753a0c20",
			args: { userId: "email@example.com" },
			body: {
				custom: {
					string_foo: "bar",
					int_bar: 314,
				},
			},
		},
	]);
});

test("empty-cell behaviour and sentinel resolution", () => {
	const queries = runBuild(
		{
			EMPTY_CELL_BEHAVIOR: "null",
			CELL_VALUE_FOR_SKIP: '"__SKIP__"',
			CELL_VALUE_FOR_EMPTY_STRING: '["__EMPTY__", "__BLANK__"]',
			CELL_VALUE_FOR_NULL: '"__NULL__"',
		},
		[{
			installation_id: "inst1",
			user_id: "u1",
			prop_empty: "",
			prop_skip: "__SKIP__",
			prop_blank1: "__EMPTY__",
			prop_blank2: "__BLANK__",
			prop_null: "__NULL__",
			prop_literal: "hello",
			// Literal "NULL" is NOT a sentinel (only "__NULL__" is) so it
			// must round-trip as the string "NULL".
			prop_literal_null: "NULL",
		}],
	);
	assert.deepEqual(queries[0].data.requests[0].body.custom, {
		prop_empty: null,
		prop_blank1: "",
		prop_blank2: "",
		prop_null: null,
		prop_literal: "hello",
		prop_literal_null: "NULL",
	});
});

test("default EMPTY_CELL_BEHAVIOR is skip and no sentinels are recognised", () => {
	const queries = runBuild({}, [{
		installation_id: "inst",
		user_id: "u",
		prop_empty: "",
		prop_null_literal: "NULL",
		prop_normal: "value",
	}]);
	assert.deepEqual(queries[0].data.requests[0].body.custom, {
		prop_null_literal: "NULL",
		prop_normal: "value",
	});
});

test("rows missing installation_id are skipped", () => {
	const queries = runBuild({}, [
		{ installation_id: "", user_id: "u1", prop: "a" },
		{ installation_id: "inst", user_id: "u2", prop: "b" },
	]);
	assert.equal(queries[0].data.requests.length, 1);
	assert.equal(queries[0].data.requests[0].path, "/v1/installations/inst");
});

test("rows with no custom properties after resolution are skipped", () => {
	const queries = runBuild({ EMPTY_CELL_BEHAVIOR: "skip" }, [
		{ installation_id: "i1", user_id: "u1", propA: "" },
		{ installation_id: "i2", user_id: "u2", propA: "value" },
		{ installation_id: "i3", user_id: "u3", propA: "", propB: "" },
	]);
	assert.equal(queries[0].data.requests.length, 1);
	assert.equal(queries[0].data.requests[0].path, "/v1/installations/i2");
});

test("per-row column keys: rows with disjoint columns each get their own properties", () => {
	const queries = runBuild({}, [
		{ installation_id: "i1", user_id: "", propA: "a" },
		{ installation_id: "i2", user_id: "", propB: "b" },
	]);
	assert.deepEqual(queries[0].data.requests[0].body.custom, { propA: "a" });
	assert.deepEqual(queries[0].data.requests[1].body.custom, { propB: "b" });
});

test("user_id empty maps to null; non-empty passes through", () => {
	const queries = runBuild({}, [
		{ installation_id: "i1", user_id: "", prop: "a" },
		{ installation_id: "i2", user_id: "alice@example.com", prop: "b" },
	]);
	assert.equal(queries[0].data.requests[0].args.userId, null);
	assert.equal(queries[0].data.requests[1].args.userId, "alice@example.com");
});

test("chunks into batches of maxRequests with proper ranges", () => {
	const records = [];
	for (let i = 1; i <= 5; i++) {
		records.push({ installation_id: `i${i}`, user_id: "", prop: String(i) });
	}
	const queries = runBuild({}, records, "/test.csv", 2);
	assert.equal(queries.length, 3);
	assert.equal(queries[0].data.requests.length, 2);
	assert.equal(queries[1].data.requests.length, 2);
	assert.equal(queries[2].data.requests.length, 1);
	assert.deepEqual(queries[0].range, { fromRecord: 1, toRecord: 2 });
	assert.deepEqual(queries[1].range, { fromRecord: 3, toRecord: 4 });
	assert.deepEqual(queries[2].range, { fromRecord: 5, toRecord: 5 });
});

test("empty input yields no queries", () => {
	const queries = runBuild({}, []);
	assert.deepEqual(queries, []);
});

test("when every row is skipped, no queries are produced", () => {
	const queries = runBuild({}, [
		{ installation_id: "", user_id: "" },
	]);
	assert.deepEqual(queries, []);
});
