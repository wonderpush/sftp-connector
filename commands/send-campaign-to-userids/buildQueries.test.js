// Tests for ./buildQueries.js.
//
// buildQueries reads CSV_COLUMN_USER_ID, CSV_COLUMN_CAMPAIGN_ID and
// WP_ACCESS_TOKEN from the shared root options.js, which is frozen at module
// load time. To exercise different env-var configurations we invoke a helper
// subprocess (./runBuildQueries.js) per scenario, set the relevant env vars
// on the child, and parse the JSON result from its stderr.

import { test } from "node:test";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import path from "node:path";

const HELPER = path.join("commands", "send-campaign-to-userids", "runBuildQueries.js");

const baseEnv = {
	WP_ACCESS_TOKEN: "test-token",
	SFTP_HOST: "x",
	SFTP_PRIVATE_KEY: "x",
};

function runBuild(extraEnv, records, remotePath = "/test.csv", maxTargets = 10000) {
	const r = spawnSync(
		process.execPath,
		[HELPER, JSON.stringify(records), remotePath, String(maxTargets)],
		{ env: { ...baseEnv, ...extraEnv }, encoding: "utf8" },
	);
	if (r.status !== 0) {
		throw new Error(`helper exited with status ${r.status}; stdout=${r.stdout}; stderr=${r.stderr}`);
	}
	return JSON.parse(r.stderr);
}

test("builds a basic delivery query with target user ids and notification params", () => {
	const records = [
		{ user_id: "u1", campaign_id: "c1", firstName: "Alice", city: "Paris" },
		{ user_id: "u2", campaign_id: "c1", firstName: "Bob", city: "Lyon" },
	];
	const queries = runBuild({}, records, "/tmp/example.csv");
	assert.equal(queries.length, 1);
	const q = queries[0];
	assert.equal(q.remotePath, "/tmp/example.csv");
	assert.deepEqual(q.range, { fromRecord: 1, toRecord: 2 });
	assert.equal(q.data.accessToken, "test-token");
	assert.equal(q.data.campaignId, "c1");
	assert.deepEqual(q.data.targetUserIds, ["u1", "u2"]);
	assert.deepEqual(q.data.notificationParams, [
		{ firstName: "Alice", city: "Paris" },
		{ firstName: "Bob", city: "Lyon" },
	]);
});

test("accessToken is taken from WP_ACCESS_TOKEN", () => {
	const queries = runBuild(
		{ WP_ACCESS_TOKEN: "my-secret-token" },
		[{ user_id: "u1", campaign_id: "c1" }],
	);
	assert.equal(queries[0].data.accessToken, "my-secret-token");
});

test("campaignId is taken from the first record only — heterogeneous campaign_id rows resolve to the first row's value", () => {
	const queries = runBuild({}, [
		{ user_id: "u1", campaign_id: "c-first" },
		{ user_id: "u2", campaign_id: "c-DIFFERENT" },
		{ user_id: "u3", campaign_id: "c-yet-different" },
	]);
	assert.equal(queries[0].data.campaignId, "c-first");
	assert.deepEqual(queries[0].data.targetUserIds, ["u1", "u2", "u3"]);
});

test("filters out records whose user_id is missing", () => {
	const queries = runBuild({}, [
		{ campaign_id: "c1" },                          // no user_id key at all
		{ user_id: 123, campaign_id: "c1" },            // user_id not a string
		{ user_id: "u2", campaign_id: "c1" },           // kept
	]);
	assert.deepEqual(queries[0].data.targetUserIds, ["u2"]);
});

test("filters out records whose campaign_id is missing", () => {
	const queries = runBuild({}, [
		{ user_id: "u1" },                              // no campaign_id
		{ user_id: "u2", campaign_id: null },           // campaign_id not a string
		{ user_id: "u3", campaign_id: "c1" },           // kept
	]);
	assert.equal(queries[0].data.campaignId, "c1");
	assert.deepEqual(queries[0].data.targetUserIds, ["u3"]);
});

test("chunks records into batches of maxTargets with proper ranges", () => {
	const records = [];
	for (let i = 1; i <= 5; i++) records.push({ user_id: `u${i}`, campaign_id: "c1" });
	const queries = runBuild({}, records, "/test.csv", 2);
	assert.equal(queries.length, 3);
	assert.deepEqual(queries[0].data.targetUserIds, ["u1", "u2"]);
	assert.deepEqual(queries[1].data.targetUserIds, ["u3", "u4"]);
	assert.deepEqual(queries[2].data.targetUserIds, ["u5"]);
	assert.deepEqual(queries[0].range, { fromRecord: 1, toRecord: 2 });
	assert.deepEqual(queries[1].range, { fromRecord: 3, toRecord: 4 });
	assert.deepEqual(queries[2].range, { fromRecord: 5, toRecord: 5 });
});

test("notification params include every column other than user_id and campaign_id", () => {
	const queries = runBuild({}, [
		{ user_id: "u1", campaign_id: "c1", a: "1", b: "2", c: "3" },
	]);
	assert.deepEqual(queries[0].data.notificationParams, [{ a: "1", b: "2", c: "3" }]);
});

test("respects custom CSV_COLUMN_USER_ID and CSV_COLUMN_CAMPAIGN_ID env vars", () => {
	const queries = runBuild(
		{ CSV_COLUMN_USER_ID: "uid", CSV_COLUMN_CAMPAIGN_ID: "cid" },
		[
			{ uid: "u1", cid: "c1", extra: "x" },
			{ uid: "u2", cid: "c1", extra: "y" },
		],
	);
	assert.equal(queries[0].data.campaignId, "c1");
	assert.deepEqual(queries[0].data.targetUserIds, ["u1", "u2"]);
	assert.deepEqual(queries[0].data.notificationParams, [{ extra: "x" }, { extra: "y" }]);
});

test("empty input yields no queries", () => {
	const queries = runBuild({}, []);
	assert.deepEqual(queries, []);
});

test("when every record is malformed, no queries are produced", () => {
	const queries = runBuild({}, [
		{ user_id: "u1" },                  // no campaign_id
		{ campaign_id: "c1" },              // no user_id
		{ user_id: 1, campaign_id: 2 },     // wrong types
	]);
	assert.deepEqual(queries, []);
});
