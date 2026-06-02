# sftp-connector e2e + unit test suite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automated tests for `getFilesList.js` (Docker e2e), `sftpWatcher.js` (in-process via a fake sftp client + a small DI seam), `postQuery.js` (HTTPS mock trusted via `NODE_EXTRA_CA_CERTS`), and `parseDataFromCsv.js` (fake `.get`).

**Architecture:** The watcher's *behavior* is unit-tested by driving the real loop with a scripted fake client; the *listing primitive it depends on* (`getFilesList`) is the e2e target against a real `atmoz/sftp` container. `postQuery` and `parseDataFromCsv` are exercised via spawned subprocess helpers (the existing `runBuildBatches.js` pattern) because their config comes from the frozen, env-derived `options`.

**Tech Stack:** Node 20+ `node:test`, `node:child_process` (spawn helpers + `docker`/`ssh-keygen`/`openssl` CLIs), `ssh2-sftp-client`, `axios`, `csv-parse`. No new npm dependencies.

**Source of truth:** `docs/superpowers/specs/2026-06-02-sftp-connector-e2e-tests-design.md`

**IMPORTANT — bug policy (per user):** These tests characterize *existing* production code (`getFilesList`, `postQuery`, `parseDataFromCsv`). If a characterization test FAILS, do **not** bend the test to make it pass. Stop, and surface to the user: a short analysis of the discrepancy and a suggested fix. Only the `sftpWatcher` DI seam (Task 1) is genuinely new production code written test-first.

**Style:** This repo indents with **tabs**. All new `.js` files use tab indentation to match `options.js`, `buildBatches.test.js`, etc.

---

## File structure

```
sftpWatcher.js                       MODIFY: add optional DI bag (client/signal/overrides)
sftpWatcher.test.js                  CREATE: in-process loop tests (fake client)
getFilesList.e2e.test.js             CREATE: Docker e2e for the listing filter
postQuery.test.js                    CREATE: parent test, spawns runPostQuery.js
runPostQuery.js                      CREATE: spawn helper (HTTPS server + postQuery call)
parseDataFromCsv.test.js             CREATE: parent test, spawns runParseCsv.js
runParseCsv.js                       CREATE: spawn helper (CSV env variants)
tests/withDummyOptionsEnv.js         CREATE: preload that sets dummy options env
tests/dockerSftp.js                  CREATE: Docker SFTP harness
tests/tlsCert.js                     CREATE: openssl self-signed cert generation
package.json                         MODIFY: add test:e2e script
README.md                            MODIFY: document running the tests
```

---

## Task 1: `sftpWatcher.js` DI seam + in-process watcher tests

**Files:**
- Create: `tests/withDummyOptionsEnv.js`
- Create: `sftpWatcher.test.js`
- Modify: `sftpWatcher.js`

### - [ ] Step 1: Create the dummy-env preload

`tests/withDummyOptionsEnv.js` sets the minimum env `options.js` requires, only if not already set, so importing `sftpWatcher.js` (which imports `options.js`) does not throw in the in-process test. It MUST be imported before any module that pulls in `options.js`.

```js
// Preload for in-process tests that (transitively) import options.js.
// options.js validates and freezes env at module-load time and throws if the
// minimum vars are missing. Import THIS module before importing anything that
// loads options.js so the import succeeds. Values are dummies — the watcher
// tests inject a fake client and never open a real connection.
process.env.SFTP_HOST ||= "test-host";
process.env.SFTP_PRIVATE_KEY ||= "test-private-key";
process.env.WP_ACCESS_TOKEN ||= "test-token";
```

### - [ ] Step 2: Write the failing watcher test

`sftpWatcher.test.js`. The first import is the preload (ESM evaluates imported modules in source order, depth-first, before the importer's body — so the env is set before `sftpWatcher.js` → `options.js` evaluates).

```js
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
```

### - [ ] Step 3: Run the test to verify it fails

Run: `node --test sftpWatcher.test.js`
Expected: FAIL / hang-then-timeout — current `watchSftpFolder(processFile)` ignores the second argument, so it builds a real `new Client()`, ignores `signal`, and loops forever on the real `LISTING_INTERVAL_MS`. (If it errors first on a real connect, that also counts as failing for the right reason.)

### - [ ] Step 4: Implement the DI seam in `sftpWatcher.js`

Replace the function signature and the loop. Full new file:

```js
// Shared SFTP watcher used by every subcommand.
//
// Connects to the SFTP server (with exponential-backoff retry around the
// initial connect, since ssh2-sftp-client v10+ no longer retries on its own),
// lists the configured folder on a fixed interval, detects new and modified
// files, holds each new file until it has been stable for STALE_FILE_CHECKS
// consecutive polls, then invokes the subcommand-provided processFile
// callback. Subcommands only own the per-file processing — parsing, payload
// assembly, the POST, and response handling.
//
// The second argument is an optional dependency bag used only by tests: a
// fake `client`, an `AbortSignal` to stop the loop, and overrides for the
// poll interval / stale-checks / path. Every field defaults to production
// behaviour (a real Client, no signal => infinite loop, frozen options), so
// production callers keep calling `watchSftpFolder(callback)` unchanged.

import path from "path";
import Client from "ssh2-sftp-client";

import options from "./options.js";
import log from "./log.js";
import getFilesList from "./getFilesList.js";

async function connectWithRetry(sftp, sftpConfig) {
	const maxAttempts = options.SFTP_RETRIES + 1;
	let wait = options.SFTP_RETRY_WAIT_MIN_MS;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return await sftp.connect(sftpConfig);
		} catch (ex) {
			if (attempt === maxAttempts) throw ex;
			log(`SFTP connect attempt ${attempt}/${maxAttempts} failed: ${ex.message}; retrying in ${wait}ms`);
			await new Promise(res => setTimeout(res, wait));
			wait = Math.round(wait * options.SFTP_RETRY_WAIT_FACTOR);
		}
	}
}

// Sleep that resolves early if the signal aborts, so a test loop can stop
// promptly instead of waiting out the full interval.
function sleepInterruptible(ms, signal) {
	if (signal?.aborted) return Promise.resolve();
	return new Promise(resolve => {
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		function onAbort() {
			clearTimeout(timer);
			resolve();
		}
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

export default async function watchSftpFolder(processFile, {
	client = new Client(),
	signal = undefined,
	listingIntervalMs = options.LISTING_INTERVAL_MS,
	staleFileChecks = options.STALE_FILE_CHECKS,
	sftpPath = options.SFTP_PATH,
} = {}) {
	const candidateFiles = {};
	let lastListing = {};

	const sftp = client;
	const sftpConfig = {
		debug: options.SFTP_DEBUG ? console.debug : undefined,
		host: options.SFTP_HOST,
		port: options.SFTP_PORT,
		username: options.SFTP_USER,
		privateKey: options.SFTP_PRIVATE_KEY,
		passphrase: options.SFTP_PASSPHRASE,
	};

	try {
		await connectWithRetry(sftp, sftpConfig);
	} catch (ex) {
		log("Failed to connect after " + (options.SFTP_RETRIES + 1) + " tries, aborting");
	}

	const initialListing = await getFilesList(sftp, sftpConfig, sftpPath);
	log("SFTP connection established");
	log("Initial file list collected");
	lastListing = { ...initialListing };

	function runOnce() {
		return getFilesList(sftp, sftpConfig, sftpPath)
			// ! FILE SELECTION
			.then(newListing => {
				// to check new files
				Object.keys(newListing).forEach(fileName => {
					if (!Object.keys(lastListing).includes(fileName)) {
						candidateFiles[fileName] = 0;

						log("New file detected, monitoring changes:", fileName);
					}
				});

				// to check deleted files
				Object.keys(lastListing).forEach(fileName => {
					if (!Object.keys(newListing).includes(fileName)) {
						delete candidateFiles[fileName];

						log("File deletion detected:", fileName);
					}
				});

				// to check updated files
				Object.keys(candidateFiles).forEach(fileName => {
					if (lastListing[fileName] && newListing[fileName]) {
						if (
							newListing[fileName].modifyTime !==
								lastListing[fileName].modifyTime ||
							newListing[fileName].size !== lastListing[fileName].size
						) {
							candidateFiles[fileName] = 0;
						} else {
							candidateFiles[fileName]++;
						}
					}
				});

				lastListing = { ...newListing };
			})
			// ! FILE PROCESSING
			.then(async () => {
				const staleChecks = Number(staleFileChecks || "1");

				// Determine files to process before starting processing,
				// so that the candidate files don't change under our feet.
				const filesToProcess = Object.keys(candidateFiles).filter(fileName => {
					if (candidateFiles[fileName] === staleChecks) {
						delete candidateFiles[fileName];
						return true;
					}
					return false;
				});

				if (filesToProcess.length > 1) {
					log("Multiple files to process, working sequentially:", filesToProcess.join(', '));
				}

				for (const fileName of filesToProcess) {
					log("Processing file:", fileName);

					const filePath = path.join(sftpPath, path.basename(fileName));

					await processFile(sftp, sftpConfig, filePath, fileName);

					log("File processed:", fileName);
				}
			})
			.catch(error => log(error));
	}

	while (!signal?.aborted) {
		await runOnce();
		if (signal?.aborted) break;
		await sleepInterruptible(listingIntervalMs, signal);
	}
}
```

### - [ ] Step 5: Run the test to verify it passes

Run: `node --test sftpWatcher.test.js`
Expected: PASS — all 7 watcher tests green.

### - [ ] Step 6: Verify production callers are unaffected

Run: `node --test`
Expected: PASS — the existing `update-custom-properties` suite still passes (the new second arg is optional and defaults to production values).

### - [ ] Step 7: Commit

```bash
git add sftpWatcher.js sftpWatcher.test.js tests/withDummyOptionsEnv.js
git commit -m "Add DI seam to sftpWatcher and in-process loop tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `getFilesList.js` Docker e2e

**Files:**
- Create: `tests/dockerSftp.js`
- Create: `getFilesList.e2e.test.js`
- Modify: `package.json` (add `test:e2e` script)

### - [ ] Step 1: Create the Docker SFTP harness

`tests/dockerSftp.js`:

```js
// Docker-backed SFTP harness for e2e tests. Generates an ephemeral keypair,
// boots an atmoz/sftp container, waits for it to accept connections, and
// returns a connected ssh2-sftp-client plus a cleanup function. Shells out to
// the docker / ssh-keygen CLIs (no testcontainers dependency).
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import Client from "ssh2-sftp-client";

// True when the docker daemon is reachable. Used to skip e2e tests gracefully.
export function dockerAvailable() {
	try {
		execFileSync("docker", ["info"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

function freePort() {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address();
			server.close(() => resolve(port));
		});
	});
}

async function connectWithReadiness(sftp, sftpConfig, { attempts = 40, waitMs = 500 } = {}) {
	let lastErr;
	for (let i = 0; i < attempts; i++) {
		try {
			await sftp.connect(sftpConfig);
			return;
		} catch (ex) {
			lastErr = ex;
			await new Promise(res => setTimeout(res, waitMs));
		}
	}
	throw new Error("SFTP container never became ready: " + (lastErr && lastErr.message));
}

// Boots a container and returns { sftp, sftpConfig, remoteDir, uploadHost, cleanup }.
// remoteDir is the path to list; uploadHost is the host directory bind-mounted
// into it, so tests can seed files directly on the host filesystem.
export async function startSftpContainer() {
	const tmp = mkdtempSync(path.join(os.tmpdir(), "sftp-e2e-"));
	const keyPath = path.join(tmp, "id");
	execFileSync("ssh-keygen", ["-t", "ed25519", "-N", "", "-f", keyPath, "-q"]);

	const uploadHost = path.join(tmp, "upload");
	mkdirSync(uploadHost, { mode: 0o755 });

	const port = await freePort();
	const name = "sftp-e2e-" + Math.random().toString(36).slice(2);

	execFileSync("docker", [
		"run", "-d", "--rm", "--name", name,
		"-p", `127.0.0.1:${port}:22`,
		"-v", `${keyPath}.pub:/home/wp/.ssh/keys/id.pub:ro`,
		"-v", `${uploadHost}:/home/wp/upload`,
		"atmoz/sftp", "wp::1001",
	], { stdio: "ignore" });

	const sftpConfig = {
		host: "127.0.0.1",
		port,
		username: "wp",
		privateKey: readFileSync(keyPath),
	};

	const sftp = new Client();
	let cleanedUp = false;
	async function cleanup() {
		if (cleanedUp) return;
		cleanedUp = true;
		try { await sftp.end(); } catch {}
		try { execFileSync("docker", ["rm", "-f", name], { stdio: "ignore" }); } catch {}
		rmSync(tmp, { recursive: true, force: true });
	}

	try {
		await connectWithReadiness(sftp, sftpConfig);
	} catch (ex) {
		await cleanup();
		throw ex;
	}

	return { sftp, sftpConfig, remoteDir: "/upload", uploadHost, name, cleanup };
}
```

### - [ ] Step 2: Write the e2e test

`getFilesList.e2e.test.js`. Note: `getFilesList.js` imports nothing, so no `options` env is required.

```js
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
```

### - [ ] Step 3: Add the `test:e2e` script

Modify `package.json` `scripts` (leave `test` as-is so the unit run stays Docker-free):

```json
"test": "node --test",
"test:e2e": "E2E=1 node --test getFilesList.e2e.test.js"
```

### - [ ] Step 4: Run the e2e test

Run: `npm run test:e2e`
Expected: PASS (pulls `atmoz/sftp` on first run — allow time). If `getFilesList` returns anything other than `["data.csv"]`, that is a production discrepancy — STOP and surface analysis + fix per the bug policy.

### - [ ] Step 5: Confirm it self-skips under the unit runner

Run: `node --test getFilesList.e2e.test.js`
Expected: the test reports as **skipped** (no `E2E`), exit 0 — no container started.

### - [ ] Step 6: Commit

```bash
git add tests/dockerSftp.js getFilesList.e2e.test.js package.json
git commit -m "Add Docker e2e test for getFilesList listing filter

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `postQuery.js` HTTPS mock + retry/backoff matrix

**Files:**
- Create: `tests/tlsCert.js`
- Create: `runPostQuery.js`
- Create: `postQuery.test.js`

### - [ ] Step 1: Create the cert helper

`tests/tlsCert.js`:

```js
// Generates a self-signed TLS cert (valid for 127.0.0.1 + localhost) via the
// openssl CLI into a temp dir. The cert path is handed to NODE_EXTRA_CA_CERTS
// so the child process's axios trusts the mock HTTPS server. No npm deps.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Returns { dir, keyFile, certFile, cleanup }.
export function generateSelfSignedCert() {
	const dir = mkdtempSync(path.join(os.tmpdir(), "sftp-tls-"));
	const keyFile = path.join(dir, "key.pem");
	const certFile = path.join(dir, "cert.pem");
	execFileSync("openssl", [
		"req", "-x509", "-newkey", "rsa:2048", "-nodes",
		"-keyout", keyFile,
		"-out", certFile,
		"-days", "1",
		"-subj", "/CN=127.0.0.1",
		"-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost",
	], { stdio: "ignore" });
	return {
		dir,
		keyFile,
		certFile,
		cleanup() { rmSync(dir, { recursive: true, force: true }); },
	};
}
```

### - [ ] Step 2: Create the postQuery spawn helper

`runPostQuery.js`. Each invocation is a fresh process (so `postQuery`'s process-wide backoff resets) and is launched with `NODE_EXTRA_CA_CERTS` set.

```js
// Spawn helper for postQuery.test.js. Boots a one-shot HTTPS server with a
// scripted response sequence, calls postQuery against it, and writes a JSON
// result to stderr (production log() output goes to stdout, kept separate).
//
// argv[2] = TLS key file, argv[3] = TLS cert file,
// argv[4] = JSON config:
//   {
//     responses: [{ status, headers?, body?, destroy? }, ...],  // served by request index, last repeats
//     query?:  { data, range:{fromRecord,toRecord}, remotePath },
//     prefix?: string,
//     badUrl?: string   // when set, no server starts; postQuery is called against this URL
//   }
import https from "node:https";
import { readFileSync } from "node:fs";
import postQuery from "./postQuery.js";

const keyFile = process.argv[2];
const certFile = process.argv[3];
const config = JSON.parse(process.argv[4]);

const received = [];

function startServer() {
	return new Promise((resolve) => {
		const server = https.createServer(
			{ key: readFileSync(keyFile), cert: readFileSync(certFile) },
			(req, res) => {
				const idx = received.length;
				received.push({ headers: req.headers });
				const spec = config.responses[Math.min(idx, config.responses.length - 1)];
				if (spec.destroy) {
					req.socket.destroy();
					return;
				}
				res.writeHead(spec.status, { "content-type": "application/json", ...(spec.headers || {}) });
				res.end(JSON.stringify(spec.body ?? {}));
			},
		);
		server.listen(0, "127.0.0.1", () => resolve(server));
	});
}

const query = config.query ?? { data: { x: 1 }, range: { fromRecord: 0, toRecord: 1 }, remotePath: "/test.csv" };
const prefix = config.prefix ?? "sftp-test-";

let server;
let url;
if (config.badUrl) {
	url = config.badUrl;
} else {
	server = await startServer();
	url = `https://127.0.0.1:${server.address().port}/v1/test`;
}

const start = Date.now();
const response = await postQuery(url, query, "test.csv", prefix);
const elapsedMs = Date.now() - start;

if (server) await new Promise(res => server.close(res));

process.stderr.write(JSON.stringify({
	attempts: received.length,
	idempotencyKeys: received.map(r => r.headers["x-wonderpush-idempotency-key"]),
	finalStatus: response ? response.status : null,
	elapsedMs,
}));
```

### - [ ] Step 3: Write the postQuery test

`postQuery.test.js`:

```js
// Tests for postQuery.js retry/backoff/idempotency behaviour. Each scenario
// spawns runPostQuery.js in a fresh process (postQuery's backoff state is
// process-wide and intentionally persists across calls) with NODE_EXTRA_CA_CERTS
// pointing at a self-signed cert so its axios trusts our mock HTTPS server.
import { test, before, after } from "node:test";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { generateSelfSignedCert } from "./tests/tlsCert.js";

const baseEnv = {
	WP_ACCESS_TOKEN: "test-token",
	SFTP_HOST: "x",
	SFTP_PRIVATE_KEY: "x",
};

let cert;
before(() => { cert = generateSelfSignedCert(); });
after(() => { cert && cert.cleanup(); });

// Runs one scenario; returns { attempts, idempotencyKeys, finalStatus, elapsedMs }.
function run(config, extraEnv = {}) {
	const r = spawnSync(
		process.execPath,
		["runPostQuery.js", cert.keyFile, cert.certFile, JSON.stringify(config)],
		{
			env: { ...baseEnv, ...extraEnv, NODE_EXTRA_CA_CERTS: cert.certFile },
			encoding: "utf8",
		},
	);
	if (r.status !== 0) {
		throw new Error(`helper exited ${r.status}; stdout=${r.stdout}; stderr=${r.stderr}`);
	}
	return JSON.parse(r.stderr);
}

test("2xx succeeds without retry", () => {
	const res = run({ responses: [{ status: 200, body: { ok: true } }] });
	assert.equal(res.attempts, 1);
	assert.equal(res.finalStatus, 200);
});

test("idempotency key has the documented format", () => {
	const res = run({ responses: [{ status: 200 }] });
	const hash = crypto.createHash("sha1").update("/test.csv").digest("hex").slice(-8);
	const expected = `sftp-test-${hash}0000000000000001` + "00";
	assert.equal(res.idempotencyKeys[0], expected);
});

test("409/12045 is not retried and keeps the same backoff", () => {
	const res = run({ responses: [{ status: 409, body: { error: { code: "12045" } } }] });
	assert.equal(res.attempts, 1);
	assert.equal(res.finalStatus, 409);
});

test("other 4xx is not retried", () => {
	const res = run({ responses: [{ status: 404, body: {} }] });
	assert.equal(res.attempts, 1);
	assert.equal(res.finalStatus, 404);
});

test("plain 5xx is retried with the SAME idempotency key", () => {
	const res = run({ responses: [{ status: 503, body: {} }, { status: 200 }] });
	assert.equal(res.attempts, 2);
	assert.equal(res.finalStatus, 200);
	assert.equal(res.idempotencyKeys[0], res.idempotencyKeys[1]);
});

test("WP-source 5xx (body .error.code) is retried with a BUMPED attempt key", () => {
	const res = run({ responses: [{ status: 500, body: { error: { code: "X" } } }, { status: 200 }] });
	assert.equal(res.attempts, 2);
	assert.equal(res.finalStatus, 200);
	assert.notEqual(res.idempotencyKeys[0], res.idempotencyKeys[1]);
	assert.ok(res.idempotencyKeys[0].endsWith("00"));
	assert.ok(res.idempotencyKeys[1].endsWith("01"));
	// Only the trailing attempt byte differs.
	assert.equal(res.idempotencyKeys[0].slice(0, -2), res.idempotencyKeys[1].slice(0, -2));
});

test("429 is retried and honours Retry-After", () => {
	const res = run({ responses: [{ status: 429, headers: { "retry-after": "1" } }, { status: 200 }] });
	assert.equal(res.attempts, 2);
	assert.equal(res.finalStatus, 200);
	assert.ok(res.elapsedMs >= 900, `expected >= ~1s wait, got ${res.elapsedMs}ms`);
});

test("replayed response below 500 is not retried", () => {
	const res = run({ responses: [{ status: 400, headers: { "x-wonderpush-idempotency-initially-started-at": "2020-01-01T00:00:00Z" } }] });
	assert.equal(res.attempts, 1);
	assert.equal(res.finalStatus, 400);
});

test("replayed 5xx without .error.code is retried with the same key", () => {
	const res = run({ responses: [
		{ status: 500, headers: { "x-wonderpush-idempotency-initially-started-at": "2020-01-01T00:00:00Z" } },
		{ status: 200 },
	] });
	assert.equal(res.attempts, 2);
	assert.equal(res.idempotencyKeys[0], res.idempotencyKeys[1]);
});

test("replayed 5xx with .error.code is retried with a bumped key", () => {
	const res = run({ responses: [
		{ status: 500, headers: { "x-wonderpush-idempotency-initially-started-at": "2020-01-01T00:00:00Z" }, body: { error: { code: "X" } } },
		{ status: 200 },
	] });
	assert.equal(res.attempts, 2);
	assert.ok(res.idempotencyKeys[0].endsWith("00"));
	assert.ok(res.idempotencyKeys[1].endsWith("01"));
});

test("a network error (socket destroyed) is retried up to WP_RETRIES_MAX", () => {
	const res = run({ responses: [{ destroy: true }] }, { WP_RETRIES_MAX: "2" });
	assert.equal(res.attempts, 3); // 1 initial + 2 retries
	assert.equal(res.finalStatus, null);
});

test("retries are capped by WP_RETRIES_MAX", () => {
	const res = run({ responses: [{ status: 500 }] }, { WP_RETRIES_MAX: "2" });
	assert.equal(res.attempts, 3);
	assert.equal(res.finalStatus, 500);
});

test("a request-setup error (no error.request) is not retried", () => {
	const res = run({ badUrl: "htp://127.0.0.1:1/", responses: [{ status: 200 }] });
	// No server is hit; assert it did not enter the >=1s backoff retry path.
	assert.equal(res.finalStatus, null);
	assert.ok(res.elapsedMs < 800, `expected no retry wait, got ${res.elapsedMs}ms`);
});
```

### - [ ] Step 4: Run the postQuery tests

Run: `node --test postQuery.test.js`
Expected: PASS for all scenarios. The 5xx/429/network scenarios each wait ~1s on backoff, so the file takes a handful of seconds. Any assertion failure here is a characterization discrepancy in `postQuery.js` — STOP and surface analysis + fix per the bug policy (do not weaken the assertion).

### - [ ] Step 5: Commit

```bash
git add tests/tlsCert.js runPostQuery.js postQuery.test.js
git commit -m "Add HTTPS-mock tests for postQuery retry/backoff/idempotency

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `parseDataFromCsv.js` parsing variants

**Files:**
- Create: `runParseCsv.js`
- Create: `parseDataFromCsv.test.js`

### - [ ] Step 1: Create the parseDataFromCsv spawn helper

`runParseCsv.js`:

```js
// Spawn helper for parseDataFromCsv.test.js. parseDataFromCsv reads CSV_PARSE_*
// from the frozen options, so each parser-config variant runs in its own
// process with the relevant env set. The CSV content arrives as argv[2]; a fake
// sftp client writes it to the temp file parseDataFromCsv expects. The parsed
// records are written to stderr as JSON (production output goes to stdout).
import { writeFileSync } from "node:fs";
import parseDataFromCsv from "./parseDataFromCsv.js";

const content = process.argv[2];

const fakeSftp = {
	get: async (remotePath, tmpFile) => {
		writeFileSync(tmpFile, content);
	},
};

const records = await parseDataFromCsv(fakeSftp, {}, "/test.csv");
process.stderr.write(JSON.stringify(records));
```

### - [ ] Step 2: Write the parseDataFromCsv test

`parseDataFromCsv.test.js`:

```js
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
```

### - [ ] Step 3: Run the parseDataFromCsv tests

Run: `node --test parseDataFromCsv.test.js`
Expected: PASS. Any failure is a characterization discrepancy — STOP and surface per the bug policy.

### - [ ] Step 4: Commit

```bash
git add runParseCsv.js parseDataFromCsv.test.js
git commit -m "Add CSV parsing tests for parseDataFromCsv

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Full suite run + README

**Files:**
- Modify: `README.md`

### - [ ] Step 1: Run the whole unit suite

Run: `node --test`
Expected: PASS — `update-custom-properties` tests, `sftpWatcher.test.js`, `postQuery.test.js`, `parseDataFromCsv.test.js`, plus the e2e file reporting **skipped** (no `E2E`).

### - [ ] Step 2: Run the e2e suite

Run: `npm run test:e2e`
Expected: PASS (or skipped with a clear message where docker is absent).

### - [ ] Step 3: Document the test commands in README

Add a short subsection under the existing test/usage documentation in `README.md`:

```markdown
### Tests

- `npm test` — unit/integration tests via Node's built-in runner. No Docker required; the SFTP e2e test self-skips.
- `npm run test:e2e` — end-to-end test of the SFTP listing against a throwaway `atmoz/sftp` container. Requires Docker plus the `ssh-keygen` CLI; self-skips if Docker is unavailable.

The `postQuery` tests start a local HTTPS mock and need the `openssl` CLI to generate a self-signed certificate.
```

### - [ ] Step 4: Commit

```bash
git add README.md
git commit -m "Document unit and e2e test commands

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-review notes (addressed)

- **Spec coverage:** new-after-3-listings, changing-size-not-processed, pre-existing/deleted-not-processed, deleted-then-recreated, hidden/special ignored, folders not recursed → Tasks 1 & 2. postQuery full matrix → Task 3. CSV variants (quoted comma, `;` delimiter, explicit columns no header, BOM) → Task 4. Gating + self-skip → Tasks 2 & 5.
- **Naming consistency:** helpers `runPostQuery.js` / `runParseCsv.js`; harness exports `dockerAvailable` / `startSftpContainer`; cert helper exports `generateSelfSignedCert`; preload `tests/withDummyOptionsEnv.js` — referenced identically wherever used.
- **No placeholders:** every step shows real code or a real command + expected output.
```
