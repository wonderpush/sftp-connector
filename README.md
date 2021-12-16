# SFTP deliveries WonderPush connector

**Connect your SFTP to the WonderPush API.**

This programs watches for new CSV files and triggers notification deliveries for your WonderPush project.
It can be used to deliver millions of personalized push notifications to an audience computed by your CRM.

Here is how it works:

1. This program monitors an SFTP server for new CSV files.
2. Once a new CSV file is no longer modified, the program downloads it locally.
3. The downloaded file is read and split into blocks of many lines.
4. Each block results in an API call to the [`POST /v1/deliveries` endpoint](https://docs.wonderpush.com/reference/post-deliveries).

Here is how the CSV file must contain:

* It must have a column representing the userId to send a notification to, named `user_id` by default.
* It must have a column representing the campaignId to use for fetching the content, named `campaign_id` by default.
* Each line of a CSV file must use the same campaignId.
* Any additional columns are treated as notification parameter of the same name, for personalizing the notification.

## Usage

```
npm install

# Prepare your environment with mandatory variables
export WP_ACCESS_TOKEN=…
export SFTP_HOST=…
export SFTP_PRIVATE_KEY_FILE=…

npm run start
```

## Configuration

The program uses environment variables exclusively.

**WonderPush**

* `WP_ACCESS_TOKEN`: **Mandatory.**

  Your WonderPush project's access token.

  Find it in the [_Settings / API credentials_](https://dashboard.wonderpush.com/applications/-/api-credentials) page.

* `WP_ENDPOINT`: _Optional, default: `https://management-api.wonderpush.com/v1/deliveries`._

  The WonderPush Management API endpoint used to trigger notification deliveries.

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

**File monitoring**

* `LISTING_INTERVAL_MS`: _Optional, default: `60000`, one minute._

  The interval at which the SFTP path is checked for new files, or files are checked for modifications.

* `STALE_FILE_CHECKS`: _Optional, default: `1`._

  How many additional checks to perform once a new file is seen, to ensure the file has finished uploading, is free of modifications and ready for processing.

**CSV configuration**

* `CSV_COLUMN_USER_ID`: _Optional, default: `user_id`._

  The name of the CSV column that contains the userId to send a notification to.

* `CSV_COLUMN_CAMPAIGN_ID`: _Optional, default: `campaign_id`._

  The name of the CSV column that contains the campaignId used to send a notification.

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
