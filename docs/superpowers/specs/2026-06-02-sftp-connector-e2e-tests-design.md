# Design: e2e + unit tests for sftp-connector

Date: 2026-06-02
Status: Approved (design), pending implementation plan

## Goal

Add an automated test suite covering the connector's currently-untested shared
helpers: the SFTP listing primitive (`getFilesList.js`), the watch loop and its
new/deleted/stale/recreated state machine (`sftpWatcher.js`), the WonderPush POST
retry/backoff logic (`postQuery.js`), and CSV parsing (`parseDataFromCsv.js`).

Tests follow the existing repo conventions (CLAUDE.md): co-located `*.test.js`,
Node's built-in `node:test` runner, **no extra npm dependencies**, and a spawn
helper for any scenario that must vary the frozen env-derived `options`.

## Scope split: e2e vs in-process

- **e2e (Docker, real SFTP)** — exercises `getFilesList.js` only: the real
  `sftp.list` call plus the hidden / non-regular filtering. This is where
  "hidden and special files are ignored" and "folders are not recursed into" are
  proven against a real server.
- **in-process (fake sftp client)** — exercises the `sftpWatcher.js` loop and
  state machine by driving the *real* loop with a scripted `client.list()`.
  Fast, deterministic, no Docker. This is where the new/deleted/stale/recreated
  behaviors are proven.
- **in-process (HTTPS mock)** — `postQuery.js`.
- **in-process (fake `.get`)** — `parseDataFromCsv.js`.

The watcher's *behavior* is unit-tested via injection; the *listing primitive it
depends on* is the e2e target. The two halves meet at `getFilesList`.

## Decisions (resolved during brainstorming)

1. **Watcher testability** — inject a fake sftp client and drive the real loop
   in-process (not a separately-extracted pure step function).
2. **postQuery mock server** — HTTPS with a self-signed cert trusted via
   `NODE_EXTRA_CA_CERTS`.
3. **e2e gating** — separate `npm run test:e2e` script; e2e files self-skip when
   Docker is unavailable, so `npm test` and Docker-less CI never spin containers.
4. **SFTP auth material** — ephemeral keypair generated per run; nothing secret
   committed.

Assumed-present external CLIs (verified on the dev machine): `openssl`,
`docker`, `ssh-keygen`. No new npm deps.

## Component 1 — `sftpWatcher.js` DI seam (production refactor)

`watchSftpFolder(processFile)` today hard-codes `new Client()`, reads the frozen
`options` directly, and runs a bare `while (true)`. Widen the signature with an
**optional, fully back-compatible** options bag. Production callers in
`commands/*/index.js` remain `watchSftpFolder(callback)` unchanged.

```js
watchSftpFolder(processFile, {
  client            = new Client(),            // inject a fake in tests
  signal,                                      // AbortSignal to stop the loop
  listingIntervalMs = options.LISTING_INTERVAL_MS,
  staleFileChecks   = options.STALE_FILE_CHECKS,
  sftpPath          = options.SFTP_PATH,
} = {})
```

Changes:

- Loop condition becomes `while (!signal?.aborted)`.
- The inter-iteration sleep becomes **interruptible**: it resolves immediately
  when `signal` aborts (so tests don't wait real intervals; use
  `listingIntervalMs: 0`).
- `runOnce` reads `staleFileChecks` / `sftpPath` from the bag instead of
  `options` directly. The closure variables `candidateFiles` / `lastListing`
  stay internal — they are the live state machine and are NOT exposed.
- Production behavior is unchanged because every bag field defaults to the
  corresponding frozen `options` value, and the `signal` defaults to undefined
  (so `while (!undefined?.aborted)` loops forever as before).

This is the minimum seam that lets a test drive the real loop with a fake
client; the config overrides exist so a single in-process test file can cover
`STALE_FILE_CHECKS = 1` (and other values) without per-scenario subprocesses.
Configuration still comes exclusively from env vars in production; these
parameters are documented test-only seams.

### Fake client contract (in-process)

The fake exposes the subset of `ssh2-sftp-client` that the watcher path uses:

- `connect(config)` — resolves (no-op).
- `list(path)` — returns the next scripted listing as **raw ssh2-style entries**
  (`{ type: '-', name, size, modifyTime }`), so the *real* `getFilesList`
  filtering runs in-process. After serving the final scripted listing it flips
  the test's `AbortController`, so the loop exits once that iteration's
  processing completes.
- `get` / `end` as needed by the processFile callback (tests use a trivial
  callback that records which `fileName`s it receives, so `get` is usually
  unused).

The test's `processFile` is a recorder: `(sftp, cfg, filePath, fileName) =>
processed.push(fileName)`.

### Watcher test matrix (`sftpWatcher.test.js`, in-process)

Recall the loop seeds `lastListing` from an **initial** `getFilesList` before
the first loop iteration. So scripted `list()` call #1 is the seed.

- **New file picked up after 3 listings** (`staleFileChecks: 1`):
  `[ {} , {f@v1}, {f@v1} ]` → `f` absent at seed, becomes candidate (counter 0)
  on listing #2, unchanged on listing #3 (counter reaches 1 == staleFileChecks)
  → `processed === ['f']` exactly once.
- **Continuously changing size is never processed**: seed `{}`, then several
  listings where `f`'s `size` changes each poll → counter keeps resetting →
  `processed === []`. Then hold size steady for `staleFileChecks` more polls →
  it finally processes.
- **Pre-existing files are not processed**: seed listing already contains `f`
  → `f` never enters `candidateFiles` → `processed === []`.
- **Deleted files are not processed**: `f` appears as a candidate, then
  disappears before stabilizing → removed from candidates → `processed === []`.
- **Deleted then recreated identically gets processed**: `f` present at seed,
  removed on a later listing, then re-added and held steady for
  `staleFileChecks` polls → because it was absent from `lastListing` when
  re-added, it re-enters candidates and processes → `processed === ['f']`.
- (Filtering of hidden/dir/symlink entries is covered e2e in Component 2, but a
  cheap in-process assertion that `getFilesList` drops a `.hidden` raw entry can
  also live here since the fake returns raw entries.)

## Component 2 — `getFilesList.js` e2e (`getFilesList.e2e.test.js`, Docker)

Shared harness `tests/dockerSftp.js` (shells out to the `docker` CLI; no
testcontainers dependency):

1. `ssh-keygen -t ed25519 -N '' -f <tmp>/id` → ephemeral keypair.
2. `docker run -d --rm -p <random>:22 -v <tmp>/id.pub:/home/wp/.ssh/keys/id.pub:ro
   -v <tmp>/upload:/home/wp/upload atmoz/sftp wp::1001`.
3. Wait for readiness (poll connect until success, bounded timeout).
4. Connect a real `ssh2-sftp-client` with `SFTP_PRIVATE_KEY_FILE=<tmp>/id`.

Per CLAUDE.md / user instruction, **containers spin up and down per test** so
cases stay isolated. Each test seeds the `upload` dir with a mix and asserts:

- a regular non-hidden file → **included**;
- a `.hidden` file → **excluded**;
- a subdirectory (containing a file) → **excluded**, and its child is **not**
  recursed into / not listed;
- a symlink → **excluded**.

Assert `getFilesList(sftp, cfg, '/upload')` returns exactly the set of regular
non-hidden file names. Teardown (`after`): `docker rm -f` + remove tmp dir.

**Gating**: file self-skips (`t.skip`) when `process.env.E2E` is unset OR when
`docker` is not on `PATH`.

## Component 3 — `postQuery.js` (`postQuery.test.js`, HTTPS mock, spawned)

Two forces require a child process per scenario group:

- `NODE_EXTRA_CA_CERTS` must be set **before** Node starts.
- `postQuery`'s backoff (`currentBackoffSleepMs`, `nextCallNoSoonerThanDate`) is
  **process-wide** and intentionally persists across calls — isolating
  scenarios in fresh processes keeps them independent.

Setup generates a self-signed cert (CN/SAN `127.0.0.1` + `localhost`) via
`openssl` into a tmp dir once. `runPostQuery.js` (spawn helper, mirrors
`commands/update-custom-properties/runBuildBatches.js`) is launched with
`NODE_EXTRA_CA_CERTS=<cert>` plus the required `options` env (`SFTP_HOST`,
`SFTP_PRIVATE_KEY`, `WP_ACCESS_TOKEN`, etc.). The child:

1. boots a one-shot HTTPS server on port 0 with a scripted response sequence;
2. calls `postQuery(url, query, file, prefix)`;
3. records every request the server received (status served, headers — notably
   `X-WonderPush-Idempotency-Key`) and the final returned response;
4. writes the JSON result to **stderr** (stdout stays free for production
   `log()` output), then exits.

The parent test asserts on: number of attempts made, the idempotency keys seen,
and the returned status.

### Response-handling matrix

- **2xx** → success, no retry.
- **409 with body `error.code === "12045"`** → no retry, backoff unchanged.
- **Replay header `x-wonderpush-idempotency-initially-started-at` present**:
  - replayed status `< 500` → no retry;
  - replayed status `>= 500` → retry;
  - replayed status `>= 500` with body `.error.code` → retry **with bumped
    attempt counter** (idempotency key's trailing `attemptHex2` changes).
- **429** → retry; `Retry-After` header honored (`nextCallNoSoonerThanDate` >=
  now + retry-after).
- **Plain 5xx, no `.error.code`** → retry, **same** idempotency key.
- **5xx with `.error.code`** → retry, **bumped** attempt counter (key changes).
- **Other 4xx** → no retry.
- **Network error (no response)** → retry.
- **Retries capped** at `WP_RETRIES_MAX` (default 2 → at most 3 attempts).
- **Idempotency-key format**:
  `prefix + sha1(remotePath).slice(-8) + fromRecordHex8 + toRecordHex8 +
  attemptHex2`.

## Component 4 — `parseDataFromCsv.js` (`parseDataFromCsv.test.js`)

Fake client: `{ get: async (remote, tmp) => fs.writeFileSync(tmp, fixtureBuffer) }`.
Because `CSV_PARSE_*` are frozen at module load, the delimiter/columns variants
run via a small spawn helper (`runParseCsv.js`, same pattern). Cases:

- quoted field containing a comma (default delimiter) → field kept intact;
- unquoted fields with `;` delimiter (`CSV_PARSE_DELIMITER='";"'`);
- `CSV_PARSE_COLUMNS` as an explicit array with the header row omitted from the
  data → records keyed by the provided column names;
- UTF-8 BOM stripping (3-byte prefix removed before parse).

## Layout & gating summary

Co-located per CLAUDE.md (root-level shared helpers → root-level tests):

```
sftpWatcher.test.js          in-process, fake client
postQuery.test.js            spawns runPostQuery.js (HTTPS mock)
parseDataFromCsv.test.js     spawns runParseCsv.js
getFilesList.e2e.test.js     Docker; self-skips without E2E + docker
runPostQuery.js              spawn helper (HTTPS server + postQuery call)
runParseCsv.js               spawn helper (CSV env variants)
tests/dockerSftp.js          shared Docker SFTP harness
tests/httpsMock.js           cert generation + HTTPS server helper
```

`package.json` scripts:

```json
"test":     "node --test",
"test:e2e": "E2E=1 node --test getFilesList.e2e.test.js"
```

- `npm test` runs the unit set only (e2e file self-skips: no `E2E`).
- `npm run test:e2e` runs the Docker test; if `docker` is missing it still
  self-skips with a clear message rather than failing.

## Out of scope

- Subcommand-specific payload builders (`buildQueries.js`, `buildBatches.js`) —
  `update-custom-properties` already has tests; `send-campaign-to-userids`
  builder tests are a separate effort.
- The `connectWithRetry` backoff timing in `sftpWatcher.js` (covered indirectly;
  not a dedicated scenario here).
- Any CI wiring (GitHub Actions) — separate task.
