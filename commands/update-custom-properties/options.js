// Options specific to the update-custom-properties subcommand.
// Shared options live in ../../options.js.

function tryJsonParse(json, orThrow) {
	try {
		return JSON.parse(json);
	} catch (ex) {
		if (ex instanceof SyntaxError) {
			ex = orThrow;
		}
		throw ex;
	}
}

function parseSentinelSet(envName) {
	const raw = process.env[envName];
	if (raw === undefined || raw === '') return new Set();
	const parsed = tryJsonParse(raw, new Error(`Bad ${envName} environment variable, should be JSON-encoded`));
	const values = Array.isArray(parsed) ? parsed : [parsed];
	for (const v of values) {
		if (typeof v !== 'string') {
			throw new Error(`Bad ${envName} environment variable, expected a string or an array of strings`);
		}
		if (v === '') {
			throw new Error(`Bad ${envName} environment variable, the empty string is reserved for the EMPTY_CELL_BEHAVIOR rule and cannot be used as a sentinel`);
		}
	}
	return new Set(values);
}

const WP_BATCH_ENDPOINT = process.env.WP_BATCH_ENDPOINT || 'https://management-api.wonderpush.com/v1/batch';
const WP_MAXIMUM_BATCH_REQUESTS = parseInt(process.env.WP_MAXIMUM_BATCH_REQUESTS || '100');
if (isNaN(WP_MAXIMUM_BATCH_REQUESTS) || WP_MAXIMUM_BATCH_REQUESTS <= 0) {
	throw new Error('Bad WP_MAXIMUM_BATCH_REQUESTS environment variable');
}
const WP_IDEMPOTENCY_KEY_PREFIX = process.env.WP_IDEMPOTENCY_KEY_PREFIX || 'sftp-ucp-';
if (WP_IDEMPOTENCY_KEY_PREFIX.length > 38) {
	throw new Error('Bad WP_IDEMPOTENCY_KEY_PREFIX environment variable, must not exceed 38 characters');
} else if (WP_IDEMPOTENCY_KEY_PREFIX.match(/^[-_a-zA-Z0-9]*$/) === null) {
	throw new Error('Bad WP_IDEMPOTENCY_KEY_PREFIX environment variable, only alphanumeric characters dashes and underscores are allowed');
}

const CSV_COLUMN_INSTALLATION_ID = process.env.CSV_COLUMN_INSTALLATION_ID || 'installation_id';

const EMPTY_CELL_BEHAVIOR = process.env.EMPTY_CELL_BEHAVIOR || 'skip';
if (!['skip', 'null', 'empty_string'].includes(EMPTY_CELL_BEHAVIOR)) {
	throw new Error('Bad EMPTY_CELL_BEHAVIOR environment variable, expected one of "skip", "null", "empty_string"');
}

const CELL_VALUE_FOR_NULL = parseSentinelSet('CELL_VALUE_FOR_NULL');
const CELL_VALUE_FOR_EMPTY_STRING = parseSentinelSet('CELL_VALUE_FOR_EMPTY_STRING');
const CELL_VALUE_FOR_SKIP = parseSentinelSet('CELL_VALUE_FOR_SKIP');

// Sentinel sets must be pairwise disjoint so a given CSV cell value has a single, unambiguous meaning.
const sentinelPairs = [
	['CELL_VALUE_FOR_NULL', CELL_VALUE_FOR_NULL, 'CELL_VALUE_FOR_EMPTY_STRING', CELL_VALUE_FOR_EMPTY_STRING],
	['CELL_VALUE_FOR_NULL', CELL_VALUE_FOR_NULL, 'CELL_VALUE_FOR_SKIP', CELL_VALUE_FOR_SKIP],
	['CELL_VALUE_FOR_EMPTY_STRING', CELL_VALUE_FOR_EMPTY_STRING, 'CELL_VALUE_FOR_SKIP', CELL_VALUE_FOR_SKIP],
];
for (const [nameA, setA, nameB, setB] of sentinelPairs) {
	for (const v of setA) {
		if (setB.has(v)) {
			throw new Error(`Bad sentinel configuration: value ${JSON.stringify(v)} appears in both ${nameA} and ${nameB}`);
		}
	}
}

const commandOptions = {
	WP_BATCH_ENDPOINT,
	WP_MAXIMUM_BATCH_REQUESTS,
	WP_IDEMPOTENCY_KEY_PREFIX,
	CSV_COLUMN_INSTALLATION_ID,
	EMPTY_CELL_BEHAVIOR,
	CELL_VALUE_FOR_NULL,
	CELL_VALUE_FOR_EMPTY_STRING,
	CELL_VALUE_FOR_SKIP,
};
Object.freeze(commandOptions);
export default commandOptions;
