# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

NodeJS program providing one or more SFTP-driven subcommands that integrate with the WonderPush Management API. Two subcommands today, both sharing the SFTP polling and CSV parsing model:

- `send-campaign-to-userids` — `POST /v1/deliveries` per chunk of userIds. The original behaviour.
- `update-custom-properties` — `POST /v1/batch` per chunk, bundling `PATCH /v1/installations/<id>?userId=<userId>` sub-requests that update custom properties from the CSV's extra columns.

ES modules (`"type": "module"`).

## Layout

- `index.js` — tiny dispatcher. Takes the subcommand name as its sole CLI arg, prints usage and exits 1 on missing/unknown, supports `-h`/`--help`. Subcommands are registered in its `COMMANDS` map.
- `commands/<name>/` — one subfolder per subcommand. Its `index.js` is the entry point; the body runs at import time (top-level `await`) and is intentionally tiny — it just calls `watchSftpFolder` from `../../sftpWatcher.js` with a per-file-processing callback. Any subcommand-specific helpers live alongside it in the same folder (e.g. `options.js` for env vars only that subcommand uses, parsed/validated/frozen like the shared root `options.js`; `buildQueries.js` / `buildBatches.js` for turning raw CSV records into the subcommand's API payload — filtering, chunking, payload assembly).
- `Dockerfile.<name>` — one file per subcommand, each producing its own image whose `ENTRYPOINT` invokes `commands/<name>/index.js` directly (bypassing the dispatcher). There is **no** generic `Dockerfile`; `docker build .` without `-f` is intentionally a failure.
- Shared helpers (`options.js`, `log.js`, `getFilesList.js`, `parseDataFromCsv.js`, `postQuery.js`, `sftpWatcher.js`) live at the repo root. The root `options.js` holds only options common to all subcommands; subcommand-specific options live in `commands/<name>/options.js`. Shared helpers must stay subcommand-agnostic: `parseDataFromCsv` only downloads, strips the BOM, and returns the unfiltered parsed records — record filtering and query building are the subcommand's job. `sftpWatcher.js` owns the SFTP connect/retry/listing/staleness loop and invokes the subcommand's per-file callback with `(sftp, sftpConfig, filePath, fileName)`; it knows nothing about CSV parsing, payload shape, or the WonderPush endpoints.

## Commands

- Install: `npm install`
- Run a subcommand: `npm run start:<name>` (e.g. `npm run start:send-campaign-to-userids`). Each `start:<name>` script invokes the command file directly, bypassing the dispatcher.
- Run via dispatcher: `node index.js <name>` (used for the help path / discovery).
- Docker build: `docker build -f Dockerfile.<name> -t wonderpush/sftp-connector-<name> .`
- Docker run: must use `--init` so Node receives signals correctly.
- Env vars required by both subcommands: minimum `WP_ACCESS_TOKEN`, `SFTP_HOST`, `SFTP_PRIVATE_KEY` or `SFTP_PRIVATE_KEY_FILE`. Both subcommands share the same SFTP/CSV-parsing/file-monitoring env vars; per-subcommand env vars live in `commands/<name>/options.js` and are documented in `README.md`.
- Run tests: `npm test` (uses Node's built-in `node:test` runner; no extra deps).

## Tests

Tests are co-located with the subcommand they exercise — `*.test.js` files sit next to the production files inside `commands/<name>/`. Node's `node:test` runner discovers them recursively via its default `**/*.test.js` pattern.

Currently only `update-custom-properties` has tests:

- `commands/update-custom-properties/buildBatches.test.js` exercises `buildBatches.js` end-to-end: spec example, sentinel/empty-cell resolution, per-row column discovery, row-skipping rules, chunking by `maxRequests`.
- `commands/update-custom-properties/optionsValidation.test.js` exercises the startup validation in `options.js`: each scenario loads the module in a subprocess and asserts on the resulting error message.
- `commands/update-custom-properties/runBuildBatches.js` is a helper invoked by `buildBatches.test.js` — not a test itself. Since `commandOptions` is frozen at module-load time, scenarios that vary env-var configuration each spawn a fresh helper process so `options.js` re-evaluates with the right env. Production `log()` output goes to stdout; the helper writes the JSON result to stderr so the two streams stay separated for the test parser.

No linter is configured.

## Architecture — shared loop in `sftpWatcher.js`

Both subcommands share the same SFTP daemon body, factored into `sftpWatcher.js`:

1. Connect once via `ssh2-sftp-client` (`sftp.connect`), wrapped by an exponential backoff driven by `SFTP_RETRIES`, `SFTP_RETRY_WAIT_MIN_MS`, `SFTP_RETRY_WAIT_FACTOR`.
2. Initial `getFilesList` populates `lastListing` so pre-existing files are NOT reprocessed on restart.
3. Loop every `LISTING_INTERVAL_MS`:
   - Diff `newListing` vs `lastListing` to detect added/deleted/modified files. Added files enter `candidateFiles` with a counter at 0.
   - For each candidate, if `modifyTime`/`size` changed since last poll, reset counter to 0; otherwise increment it.
   - Files whose counter reaches `STALE_FILE_CHECKS` are considered stable and processed (sequentially, one at a time).
4. Per stable file, `sftpWatcher.js` calls `await processFile(sftp, sftpConfig, filePath, fileName)`. The subcommand's callback owns parsing, payload assembly, the POST, and response handling.

Configuration in both subcommands comes exclusively from environment variables, parsed and validated at startup into frozen objects: shared options in the root `options.js`, plus subcommand-specific options in `commands/<name>/options.js`. See `README.md` for the full list.

## Architecture — `commands/send-campaign-to-userids/`

The subcommand's `index.js` is a 10-line callback handed to `watchSftpFolder`:

1. `parseDataFromCsv` downloads to a tmp dir, strips UTF-8 BOM, parses with `csv-parse/sync`, and returns the raw records.
2. `commands/send-campaign-to-userids/buildQueries.js` filters out records missing `CSV_COLUMN_USER_ID` or `CSV_COLUMN_CAMPAIGN_ID` and chunks them into queries of `WP_MAXIMUM_DELIVERIES_TARGETS` (default 10000) records each. `campaignId` is taken from the **first record only** — all rows in a file must share it.
3. Each chunk is POSTed by `postQuery.js`.

## Architecture — `commands/update-custom-properties/`

Same `sftpWatcher.js` loop as `send-campaign-to-userids`. Per-file work in the subcommand's callback:

1. Subcommand-specific env vars in `commands/update-custom-properties/options.js`: `WP_BATCH_ENDPOINT`, `WP_MAXIMUM_BATCH_REQUESTS`, `WP_IDEMPOTENCY_KEY_PREFIX` (default `sftp-ucp-`), `CSV_COLUMN_INSTALLATION_ID`, `EMPTY_CELL_BEHAVIOR`, plus three sentinel-set env vars `CELL_VALUE_FOR_{NULL,EMPTY_STRING,SKIP}` (each JSON-encoded as a string or array of strings, parsed into a `Set<string>` at startup, validated to be pairwise disjoint and not to contain `""`).
2. `commands/update-custom-properties/buildBatches.js` turns the raw records into batch queries. For each row: skip if `installation_id` is empty (logged); otherwise build a `PATCH /v1/installations/<id>` sub-request whose `args.userId` is the cell value (`null` if empty) and whose `body.custom` is the per-column resolution of cell values. Column discovery is done per-row from each record's own keys (not from `records[0]`), so it stays correct when columns differ between rows or when `CSV_PARSE_COLUMNS` is configured. If after resolution `custom` has no keys (all cells resolved to SKIP), the row is also skipped and logged. The resolver applies, in order: empty-cell rule (`EMPTY_CELL_BEHAVIOR`), `CELL_VALUE_FOR_SKIP`, `CELL_VALUE_FOR_NULL`, `CELL_VALUE_FOR_EMPTY_STRING`, then literal string. The startup disjointness check makes the order non-load-bearing but explicit. The resulting sub-requests are chunked into batches of `WP_MAXIMUM_BATCH_REQUESTS` (default 100), each becoming a query of the same shape that `postQuery.js` expects (`{ data, range, remotePath }`).
3. Each batch chunk is POSTed by `postQuery.js`. The outer idempotency-key header carries the per-subcommand prefix.
4. After a successful HTTP-2xx batch response, `commands/update-custom-properties/index.js` walks `response.data.responses` and logs any sub-response with `status >= 400`, plus a `{ total, failures }` summary. Per-sub-request errors do **not** trigger retry or backoff — the outer HTTP call succeeded.

### Idempotency (important)

Each POST sends `X-WonderPush-Idempotency-Key: ${prefix}${sha1(remotePath).slice(-8)}-${fromRecordHex8}-${toRecordHex8}`. The prefix is subcommand-specific: `WP_IDEMPOTENCY_KEY_PREFIX` defaults to `sftp-sctu-` for `send-campaign-to-userids` and `sftp-ucp-` for `update-custom-properties`, so the two subcommands cannot collide on the same file path. The server remembers idempotency keys for ~7 days. Consequence documented in README: a file deleted and re-added within 7 days with the same content will NOT replay the action. Changing `WP_IDEMPOTENCY_KEY_PREFIX` is the escape hatch.

### Backoff in `postQuery.js`

A **single process-wide** `currentBackoffSleepMs` / `nextCallNoSoonerThanDate` is shared across all calls (intentionally, kept between invocations). Bounds: `[1000ms, 60000ms]`, growth ratio 2, 10% jitter on failure only.

Response handling rules (read carefully before changing):
- HTTP 409 with body `error.code === "12045"`: original still being processed — do NOT adjust backoff, do NOT retry.
- Response header `x-wonderpush-idempotency-initially-started-at` present on error: server replayed a stored result — do NOT adjust backoff, do NOT retry (retrying won't change anything).
- HTTP 429: backoff up; honor `Retry-After` header by taking `max(backoff, retry-after)`; retry.
- Other 4xx: treat as success-ish for backoff (networking is fine); do NOT retry.
- 5xx: backoff up, retry.
- No response (network error): backoff up, retry.
- Request setup error (no `error.request`): do NOT retry — code bug, retry would just burn CPU.

Retries are bounded by `WP_RETRIES_MAX` (default 2 additional attempts).

## Conventions / gotchas

- Hidden files (`.foo`) and non-regular entries (directories, symlinks) are skipped by `getFilesList`.
- `parseDataFromCsv` writes to `os.tmpdir()` under a `wonderpush-sftp-connector-*` directory and removes it after parsing.
- All CSV_PARSE_* env vars must be **valid JSON** (e.g. delimiter is `","` not `,`).
- Releases are tagged in git and published via GitHub releases. `package.json` is marked `"private": true` to prevent NPM publishing.
