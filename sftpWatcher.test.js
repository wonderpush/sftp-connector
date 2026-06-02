// In-process tests for the sftpWatcher loop + new/deleted/stale/recreated
// state machine. We drive the REAL loop with a fake sftp client whose list()
// returns scripted raw ssh2-style entries, so getFilesList's filtering runs
// in-process too. The fake aborts the loop after serving the last listing.
import "./tests/withDummyOptionsEnv.js";

import { test } from "node:test";
import assert from "node:assert/strict";
import watchSftpFolder from "./sftpWatcher.js";

// Build a raw ssh2-sftp-client list() entry. type '-' = regular file.
function entry(name, size, modifyTime, type = "-") {
	return { name, size, modifyTime, type };
}

// A fake client serving one scripted listing per list() call. The first call
// is consumed by the watcher's initial seed listing; subsequent calls are the
// loop iterations. After serving the final scripted listing it aborts, so the
// loop exits once that iteration's processing completes.
function fakeClient(scriptedListings, controller) {
	let i = 0;
	return {
		async connect() {},
		async end() {},
		async list() {
			const idx = Math.min(i, scriptedListings.length - 1);
			const listing = scriptedListings[idx];
			i++;
			if (i >= scriptedListings.length) controller.abort();
			return listing;
		},
	};
}

// Run the real loop to completion and return the file names handed to
// processFile, in order. scriptedListings[0] is the initial seed.
async function runWatch(scriptedListings, { staleFileChecks = 1 } = {}) {
	const controller = new AbortController();
	const client = fakeClient(scriptedListings, controller);
	const processed = [];
	await watchSftpFolder(
		async (sftp, sftpConfig, filePath, fileName) => {
			processed.push(fileName);
		},
		{
			client,
			signal: controller.signal,
			listingIntervalMs: 0,
			staleFileChecks,
			sftpPath: "/",
		},
	);
	return processed;
}

test("new file is processed after it stays stable for STALE_FILE_CHECKS polls", async () => {
	// seed: absent | poll1: appears (counter 0) | poll2: unchanged (counter 1 == staleChecks) -> processed
	const processed = await runWatch([
		[],
		[entry("f.csv", 10, 1000)],
		[entry("f.csv", 10, 1000)],
	]);
	assert.deepEqual(processed, ["f.csv"]);
});

test("a file whose size keeps changing is not processed", async () => {
	const processed = await runWatch([
		[],
		[entry("f.csv", 10, 1000)],
		[entry("f.csv", 20, 1000)],
		[entry("f.csv", 30, 1000)],
	]);
	assert.deepEqual(processed, []);
});

test("a file is processed once its size finally stabilizes", async () => {
	const processed = await runWatch([
		[],
		[entry("f.csv", 10, 1000)],
		[entry("f.csv", 20, 1000)],
		[entry("f.csv", 30, 1000)],
		[entry("f.csv", 30, 1000)],
	]);
	assert.deepEqual(processed, ["f.csv"]);
});

test("a file already present at startup is never processed", async () => {
	const processed = await runWatch([
		[entry("f.csv", 10, 1000)],
		[entry("f.csv", 10, 1000)],
		[entry("f.csv", 10, 1000)],
	]);
	assert.deepEqual(processed, []);
});

test("a file deleted before stabilizing is not processed", async () => {
	const processed = await runWatch([
		[],
		[entry("f.csv", 10, 1000)],
		[],
	]);
	assert.deepEqual(processed, []);
});

test("a pre-existing file deleted then recreated identically is processed", async () => {
	const processed = await runWatch([
		[entry("f.csv", 10, 1000)],
		[],
		[entry("f.csv", 10, 1000)],
		[entry("f.csv", 10, 1000)],
	]);
	assert.deepEqual(processed, ["f.csv"]);
});

test("hidden files in the listing are filtered out and never processed", async () => {
	const processed = await runWatch([
		[],
		[entry(".secret.csv", 10, 1000), entry("f.csv", 10, 1000)],
		[entry(".secret.csv", 10, 1000), entry("f.csv", 10, 1000)],
	]);
	assert.deepEqual(processed, ["f.csv"]);
});

test("STALE_FILE_CHECKS=0 processes a file on its first sighting", async () => {
	const processed = await runWatch([
		[],
		[entry("f.csv", 10, 1000)],
	], { staleFileChecks: 0 });
	assert.deepEqual(processed, ["f.csv"]);
});

test("STALE_FILE_CHECKS=0 processes a changing file only on its first sighting", async () => {
	const processed = await runWatch([
		[],
		[entry("f.csv", 10, 1000)],
		[entry("f.csv", 20, 1000)],
		[entry("f.csv", 30, 1000)],
	], { staleFileChecks: 0 });
	assert.deepEqual(processed, ["f.csv"]);
});

test("STALE_FILE_CHECKS=2 requires two stable polls before processing", async () => {
	let processed = await runWatch([
		[],
		[entry("f.csv", 10, 1000)], // counter 0
		[entry("f.csv", 10, 1000)], // counter 1 (not yet)
	], { staleFileChecks: 2 });
	assert.deepEqual(processed, []);

	processed = await runWatch([
		[],
		[entry("f.csv", 10, 1000)], // counter 0
		[entry("f.csv", 10, 1000)], // counter 1 (not yet)
		[entry("f.csv", 10, 1000)], // counter 2 == staleChecks -> processed
	], { staleFileChecks: 2 });
	assert.deepEqual(processed, ["f.csv"]);
});
