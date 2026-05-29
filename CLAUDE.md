# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

NodeJS daemon that watches an SFTP folder for new CSV files and triggers push notification deliveries via the WonderPush Management API (`POST /v1/deliveries`). ES modules (`"type": "module"`).

## Commands

- Install: `npm install`
- Run: `npm run start` (requires env vars; minimum: `WP_ACCESS_TOKEN`, `SFTP_HOST`, `SFTP_PRIVATE_KEY` or `SFTP_PRIVATE_KEY_FILE`)
- Docker build: `docker build . -t wonderpush/sftp-connector`
- Docker run: must use `--init` so Node receives signals correctly

No test suite, no linter configured.

## Architecture

All configuration comes exclusively from environment variables, parsed and validated in `options.js` at startup (frozen object). See `README.md` for the full list.

Single long-running loop in `index.js`:

1. Connect once via `ssh2-sftp-client` (`sftp.connect`), wrapped in `index.js` by an exponential backoff driven by `SFTP_RETRIES`, `SFTP_RETRY_WAIT_MIN_MS`, `SFTP_RETRY_WAIT_FACTOR`.
2. Initial `getFilesList` populates `lastListing` so pre-existing files are NOT reprocessed on restart.
3. Loop every `LISTING_INTERVAL_MS`:
   - Diff `newListing` vs `lastListing` to detect added/deleted/modified files. Added files enter `candidateFiles` with a counter at 0.
   - For each candidate, if `modifyTime`/`size` changed since last poll, reset counter to 0; otherwise increment it.
   - Files whose counter reaches `STALE_FILE_CHECKS` are considered stable and processed (sequentially, one at a time).
4. Per file: `parseDataFromCsv` downloads to a tmp dir, strips UTF-8 BOM, parses with `csv-parse/sync`, filters out records missing `CSV_COLUMN_USER_ID` or `CSV_COLUMN_CAMPAIGN_ID`, then chunks into queries of `WP_MAXIMUM_DELIVERIES_TARGETS` (default 10000) records each. `campaignId` is taken from the **first record only** — all rows in a file must share it.
5. Each chunk is POSTed by `postQuery.js`.

### Idempotency (important)

Each POST sends `X-WonderPush-Idempotency-Key: ${WP_IDEMPOTENCY_KEY_PREFIX}${sha1(remotePath).slice(-8)}-${fromRecordHex8}-${toRecordHex8}`. The server remembers idempotency keys for ~7 days. Consequence documented in README: a file deleted and re-added within 7 days with the same content will NOT redeliver. Changing `WP_IDEMPOTENCY_KEY_PREFIX` is the escape hatch.

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
