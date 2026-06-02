// e2e test for getFilesList against a real atmoz/sftp container.
// Self-skips unless E2E=1 and docker is available. A fresh container is spun
// up and torn down per test so cases stay isolated.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import path from "node:path";
import getFilesList from "./getFilesList.js";
import { dockerAvailable, startSftpContainer } from "./tests/dockerSftp.js";

const enabled = !!process.env.E2E && dockerAvailable();
const skip = enabled ? false : "set E2E=1 and ensure docker is available";

test("getFilesList returns only regular, non-hidden files", { skip }, async () => {
	const ctx = await startSftpContainer();
	try {
		writeFileSync(path.join(ctx.uploadHost, "data.csv"), "user_id\nalice\n");
		writeFileSync(path.join(ctx.uploadHost, ".hidden.csv"), "secret\n");
		mkdirSync(path.join(ctx.uploadHost, "subdir"), { mode: 0o755 });
		writeFileSync(path.join(ctx.uploadHost, "subdir", "child.csv"), "nested\n");
		symlinkSync("data.csv", path.join(ctx.uploadHost, "link.csv"));

		const listing = await getFilesList(ctx.sftp, ctx.sftpConfig, ctx.remoteDir);

		// Only the regular, non-hidden file. The hidden file, the directory,
		// the directory's child (no recursion), and the symlink are all excluded.
		assert.deepEqual(Object.keys(listing).sort(), ["data.csv"]);
		assert.equal(listing["data.csv"].size, 14); // "user_id\nalice\n"
		assert.equal(typeof listing["data.csv"].modifyTime, "number");
	} finally {
		await ctx.cleanup();
	}
});
