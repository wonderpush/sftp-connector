// Options specific to the send-campaign-to-userids subcommand.
// Shared options live in ../../options.js.

const WP_ENDPOINT = process.env.WP_ENDPOINT || 'https://management-api.wonderpush.com/v1/deliveries';
const WP_MAXIMUM_DELIVERIES_TARGETS = parseInt(process.env.WP_MAXIMUM_DELIVERIES_TARGETS || '10000');
if (isNaN(WP_MAXIMUM_DELIVERIES_TARGETS) || WP_MAXIMUM_DELIVERIES_TARGETS <= 0) {
	throw new Error('Bad WP_MAXIMUM_DELIVERIES_TARGETS environment variable');
}
const WP_IDEMPOTENCY_KEY_PREFIX = process.env.WP_IDEMPOTENCY_KEY_PREFIX || 'sftp-sctu-';
if (WP_IDEMPOTENCY_KEY_PREFIX.length > 38) {
	throw new Error('Bad WP_IDEMPOTENCY_KEY_PREFIX environment variable, must not exceed 38 characters');
} else if (WP_IDEMPOTENCY_KEY_PREFIX.match(/^[-_a-zA-Z0-9]*$/) === null) {
	throw new Error('Bad WP_IDEMPOTENCY_KEY_PREFIX environment variable, only alphanumeric characters dashes and underscores are allowed');
}

const commandOptions = {
	WP_ENDPOINT,
	WP_MAXIMUM_DELIVERIES_TARGETS,
	WP_IDEMPOTENCY_KEY_PREFIX,
};
Object.freeze(commandOptions);
export default commandOptions;
