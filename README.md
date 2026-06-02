# SFTP WonderPush connector

[WonderPush](https://www.wonderpush.com) is a fast and affordable push notifications service. [Get started in minutes](https://dashboard.wonderpush.com/account/signup).

**Connect your SFTP to the WonderPush API.**

This program watches for new CSV files on an SFTP folder and, depending on
the subcommand selected at deployment time, either triggers WonderPush
notification deliveries or updates installation custom properties.

Here is how it works, regardless of the subcommand:

1. This program monitors an SFTP server for new files in a given folder.
2. It starts by listing all existing files to avoid processing them again in the case the program is restarted.
3. Once a new file is no longer modified, the program downloads it locally.
4. The downloaded file is read as a CSV and split into blocks of many records.
5. Each block results in an API call to a WonderPush Management API endpoint, picked by the subcommand.
6. When a file is deleted, the program forgets it. If an existing file is modified, the program ignores it.
7. Due to the way the network calls are made idempotent for making retries safe against duplicate work,
   if a previously existing file is deleted and re-added within 7 days, the corresponding action will not be re-performed despite
   new network calls being made, especially if the file was restored with its previous content.

The expected CSV layout depends on the subcommand. See the per-subcommand
sections of the [Configuration](#configuration) chapter below.

## Usage

First, you'll have to clone this repository:

```
git clone https://github.com/wonderpush/sftp-connector.git
cd sftp-connector
git checkout latest
```

### Subcommands

The program is organized as a set of subcommands; each subcommand is a
distinct mode of operation with its own daemon loop, its own npm script,
and its own Docker image.

| Subcommand | Description |
| --- | --- |
| `send-campaign-to-userids` | Watches the SFTP folder for CSV files and triggers WonderPush deliveries (the historical behaviour). |
| `update-custom-properties` | Watches the SFTP folder for CSV files and updates the WonderPush custom properties of the installations referenced in each row. |

Run `node index.js -h` to list available subcommands.

To add a new subcommand `<name>`:

1. Create a `commands/<name>/` folder with an `index.js` that calls `watchSftpFolder` (from `../../sftpWatcher.js`) with a callback `async (sftp, sftpConfig, filePath, fileName) => { … }` doing the per-file work. The shared watcher handles the SFTP connect/retry/listing/staleness loop; the callback owns parsing, payload assembly, the POST, and response handling.
2. Register it in the `COMMANDS` map in `index.js`.
3. Add a `start:<name>` script to `package.json`.
4. Add a `Dockerfile.<name>` whose `ENTRYPOINT` invokes `commands/<name>/index.js`.
5. Keep any subcommand-specific helpers inside `commands/<name>/` (e.g. an `options.js` for environment variables only that subcommand uses); options shared by every subcommand belong in the top-level `options.js`.

### Run using the command line

```
# Install the dependencies
npm install

# Prepare your environment with mandatory variables
export WP_ACCESS_TOKEN=…
export SFTP_HOST=…
export SFTP_PRIVATE_KEY_FILE=…

# Choose the subcommand to run:
#cmd=send-campaign-to-userids
#cmd=update-custom-properties

# Run the subcommand
npm run start:$cmd
```

### Run using Docker

Each subcommand has its own Dockerfile and produces its own image. There
is no generic `Dockerfile`, so `docker build .` will fail unless you
specify a subcommand-specific one with `-f`.

```
# Choose the subcommand to run:
#cmd=send-campaign-to-userids
#cmd=update-custom-properties

# Build the image for the subcommand
docker build -f Dockerfile.$cmd -t wonderpush/sftp-connector-$cmd .

# Run the image
docker run -ti --init --env WP_ACCESS_TOKEN=… --env SFTP_HOST=… --env SFTP_PRIVATE_KEY="$(cat …)" wonderpush/sftp-connector-$cmd
```

The `--init` option is necessary for NodeJS to handle interrupt signals and quit properly.

### Tests

- `npm test` — unit/integration tests via Node's built-in runner (`node --test`). No Docker required; the SFTP end-to-end test self-skips when `E2E` is unset.
- `npm run test:e2e` — end-to-end test of the SFTP listing against a throwaway `atmoz/sftp` container. Requires Docker and the `ssh-keygen` CLI; self-skips if Docker is unavailable.

The `postQuery` tests start a local HTTPS mock and require the `openssl` CLI to generate a self-signed certificate. None of these tests contact the real WonderPush API.

## Configuration

The program uses environment variables exclusively.

**WonderPush — shared by every subcommand**

* `WP_ACCESS_TOKEN`: **Mandatory.**

  Your WonderPush project's access token.

  Find it in the [_Settings / API credentials_](https://dashboard.wonderpush.com/applications/-/api-credentials) page.

* `WP_RETRIES_MAX`: _Optional, default: `2`._

  How many times to retry a failed network call.

* `WP_TIMEOUT_MS`: _Optional, default: `30000`._

  How long to wait for a network call's response.

* `WP_IDEMPOTENCY_KEY_PREFIX`: _Optional, default depends on subcommand._

  The prefix of the [idempotency keys](https://docs.wonderpush.com/reference/idempotency-keys) sent with each call.
  This permits safely retrying failed network calls, ensuring that no action is performed twice because of a retry.

  Only strings consisting of up to 38 alphanumeric characters, dashes or underscores are accepted.

**WonderPush — `send-campaign-to-userids` subcommand**

* `WP_ENDPOINT`: _Optional, default: `https://management-api.wonderpush.com/v1/deliveries`._

  The WonderPush Management API endpoint used to trigger notification deliveries.

* `WP_MAXIMUM_DELIVERIES_TARGETS`: _Optional, default: `10000`._

  The maximum number of target userIds per `POST /v1/deliveries` call.
  Larger files are split into multiple sequential calls.

* `WP_IDEMPOTENCY_KEY_PREFIX`: _Optional, default: `sftp-sctu-`._

  See the semantics described above.

**WonderPush — `update-custom-properties` subcommand**

* `WP_BATCH_ENDPOINT`: _Optional, default: `https://management-api.wonderpush.com/v1/batch`._

  The WonderPush Management API endpoint used to issue batched custom-property updates.

* `WP_MAXIMUM_BATCH_REQUESTS`: _Optional, default: `100`._

  The maximum number of `PATCH /v1/installations/<id>` sub-requests bundled inside each outer `POST /v1/batch` call.
  Files with more rows are split into multiple sequential batch calls.

* `WP_IDEMPOTENCY_KEY_PREFIX`: _Optional, default: `sftp-ucp-`._

  See the semantics described above.

**SFTP connection**

* `SFTP_HOST`: **Mandatory.**

  The SFTP host to connect to.

* `SFTP_PORT`: _Optional, default: `22`._

  The SFTP port to connect to.

* `SFTP_USER`: _Optional, default is empty (anonymous)._

  The user to use during SFTP authentication.

* `SFTP_PRIVATE_KEY`: **Mandatory, unless** _when `SFTP_PRIVATE_KEY_FILE` is given._

  The SSH private key to use during SFTP authentication.
  This variable must contain the private key value directly.

  Takes precedence over `SFTP_PRIVATE_KEY_FILE`.

* `SFTP_PRIVATE_KEY_FILE`: **Mandatory, unless** _when `SFTP_PRIVATE_KEY` is given._

  The SSH private key to use during SFTP authentication.
  This variable must contain the path to the private key file.

  Used as only if `SFTP_PRIVATE_KEY` is omitted.

* `SFTP_PASSPHRASE`: _Optional, default is none._

  The passphrase of the SSH private key to use during SFTP authentication.

* `SFTP_PATH`: _Optional, default: `/`._

  The path to monitor for new files.

* `SFTP_RETRIES`: _Optional, default: `1`._

  How many retries to perform during the initial SFTP connection.
  Specifying 0 means that after the initial attempt, 0 retries will be done.

* `SFTP_RETRY_WAIT_MIN_MS`: _Optional, default: `1000`._

  How long to wait between each retries at minimum.

* `SFTP_RETRY_WAIT_FACTOR`: _Optional, default: `2`._

  The exponential backoff factor to use when waiting before retrying.

* `SFTP_DEBUG`: _Optional, default: `false`._

  Use `true` to output debugging logs from the SFTP library.

**File monitoring**

* `LISTING_INTERVAL_MS`: _Optional, default: `60000`, one minute._

  The interval at which the SFTP path is checked for new files, or files are checked for modifications.

* `STALE_FILE_CHECKS`: _Optional, default: `1`._

  How many additional checks to perform once a new file is seen, to ensure the file has finished uploading, is free of modifications and ready for processing.

**CSV parsing**

* `CSV_PARSE_COLUMNS`: _Optional, default: `true`._
  **Must be valid JSON.**

  How to parse CSV columns.
  Use `true` to use the first line of the file as a header line.
  Use an array to explicitly specify the column names. The first line of the file is not treated as a header.

  See: https://csv.js.org/parse/options/columns/

* `CSV_PARSE_COMMENT`: _Optional, default: `""`._
  **Must be valid JSON.**

  You can set it to `"#"` for instance to allow comments in the CSV file to start with a `#`.
  Using an empty JSON string `""` disables comment support.

  See: https://csv.js.org/parse/options/comment/

* `CSV_PARSE_DELIMITER`: _Optional, default: `","`._
  **Must be valid JSON.**

  The delimiter used to separate CSV columns.
  Some dialects may use tabs (`"\t"`) or semi-colons (`";"`), you can set this option accordingly.
  You can give an array of different delimiters.

  See: https://csv.js.org/parse/options/delimiter/

* `CSV_PARSE_ENCODING`: _Optional, default: `"utf8"`._
  **Must be valid JSON.**

  The encoding used when reading CSV files.

  See: https://csv.js.org/parse/options/encoding/

* `CSV_PARSE_QUOTE`: _Optional, default: `"\""`._
  **Must be valid JSON.**

  The character used to detect quoted string values in CSV.

  See: https://csv.js.org/parse/options/quote/

* `CSV_PARSE_ESCAPE`: _Optional, default: `"\""`._
  **Must be valid JSON.**

  The character used to escape a quoting characters inside a quoted string value.

  See: https://csv.js.org/parse/options/escape/

* `CSV_PARSE_RECORD_DELIMITER`: _Optional, default: `[]`._
  **Must be valid JSON.**

  Which newline delimiters are used in the CSV file.
  Files generated on Windows typically uses `"\r\n"`, Linux `"\n"` and Mac OS `"\r"`.
  Use `[]` to automatically detect.

  See: https://csv.js.org/parse/options/record_delimiter/

* `CSV_PARSE_SKIP_EMPTY_LINES`: _Optional, default: `true`._
  **Must be valid JSON.**

  Whether to skip empty lines in the CSV file or to treat them as a valid record.

  See: https://csv.js.org/parse/options/skip_empty_lines/

**CSV layout — `send-campaign-to-userids` subcommand**

The CSV must contain:

* A column representing the userId to send a notification to (see `CSV_COLUMN_USER_ID`).
* A column representing the campaignId to use for fetching the content (see `CSV_COLUMN_CAMPAIGN_ID`).
* Each record within a file must use the same campaignId. In practice, only the campaignId of the first record is read.
* Any additional columns are treated as notification parameters of the same name, for personalizing the notification.

Each block of records results in an API call to the [`POST /v1/deliveries` endpoint](https://docs.wonderpush.com/reference/post-deliveries).

* `CSV_COLUMN_USER_ID`: _Optional, default: `user_id`._

  The name of the CSV column that contains the userId associated with the row.

* `CSV_COLUMN_CAMPAIGN_ID`: _Optional, default: `campaign_id`._

  The name of the CSV column that contains the campaignId used to send a notification.

**CSV layout — `update-custom-properties` subcommand**

The CSV must contain:

* A column representing the installationId to update (see `CSV_COLUMN_INSTALLATION_ID`). Rows missing this value are skipped and logged.
* A column representing the userId associated with the installation (see `CSV_COLUMN_USER_ID`). An empty cell means `userId: null` in the request — the installation is updated regardless of which user it is currently bound to.
* Any additional columns are treated as custom-property names; the cell value becomes the property value in the resulting `PATCH /v1/installations/<id>` sub-request.

Each block of records results in an API call to the [`POST /v1/batch` endpoint](https://docs.wonderpush.com/reference/post-batch) bundling many `PATCH /v1/installations/<id>?userId=<userId>` sub-requests.

* `CSV_COLUMN_USER_ID`: _Optional, default: `user_id`._

  The name of the CSV column that contains the userId associated with the row.

* `CSV_COLUMN_INSTALLATION_ID`: _Optional, default: `installation_id`._

  The name of the CSV column that contains the installationId to update.

* `EMPTY_CELL_BEHAVIOR`: _Optional, default: `skip`._

  How an empty cell in a custom-property column is interpreted.
  One of `skip` (the property key is omitted from the request body — no change on WonderPush), `null` (the property key is sent with a `null` value, clearing it on WonderPush), or `empty_string` (the property key is sent with `""`).

  This option only applies to custom-property columns. The `user_id` column always treats an empty cell as `null`.

* `CELL_VALUE_FOR_NULL`: _Optional, default: unset._
  **Must be valid JSON when set.**

  When set, configures one or more sentinel cell values that map to a `null` property value in the request body (clearing the property on WonderPush). Accepts either a single JSON string (`"NULL"`) or a JSON array of strings (`["NULL", "<null>"]`).

  Matching is case-sensitive and applies only to custom-property cells (not `installation_id` nor `user_id`). The empty string is not allowed (it is reserved for the `EMPTY_CELL_BEHAVIOR` rule).

* `CELL_VALUE_FOR_EMPTY_STRING`: _Optional, default: unset._
  **Must be valid JSON when set.**

  Same shape and rules as `CELL_VALUE_FOR_NULL`, but for sentinel values mapping to the empty string `""` in the request body.

* `CELL_VALUE_FOR_SKIP`: _Optional, default: unset._
  **Must be valid JSON when set.**

  Same shape and rules as `CELL_VALUE_FOR_NULL`, but for sentinel values mapping to "omit this property from the request body".

  The three sentinel sets (`CELL_VALUE_FOR_NULL`, `CELL_VALUE_FOR_EMPTY_STRING`, `CELL_VALUE_FOR_SKIP`) must be pairwise disjoint — the program fails to start if the same cell value appears in two of them.

  Picking sentinels is the operator's responsibility, since unusual literal cell values may otherwise be ambiguous. For example, in a dataset that may legitimately contain the string `"NULL"` (e.g. as a last name), do not pick `"NULL"` as a sentinel — use something the data is guaranteed not to contain, such as `"<<NULL>>"` or `" __NULL__ "`.

## Changelog and releases

See the [**releases page**](https://github.com/wonderpush/sftp-connector/releases) on GitHub.

Follow our [**announcements**](https://discuss.wonderpush.com/c/announcements) on our documentation.

## Support

Contact support using the **live chat** on your [dashboard](https://dashboard.wonderpush.com/).

Ask for help on [**StackOverflow**](https://stackoverflow.com/questions/tagged/wonderpush).

Report a bug, file a feature request or send a pull request in the [**issue tracker**](https://github.com/wonderpush/sftp-connector/issues).
