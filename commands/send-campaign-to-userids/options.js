// Options specific to the send-campaign-to-userids subcommand.
// Shared options live in ../../options.js.

const WP_ENDPOINT = process.env.WP_ENDPOINT || 'https://management-api.wonderpush.com/v1/deliveries';
const WP_MAXIMUM_DELIVERIES_TARGETS = parseInt(process.env.WP_MAXIMUM_DELIVERIES_TARGETS || '10000');
if (isNaN(WP_MAXIMUM_DELIVERIES_TARGETS) || WP_MAXIMUM_DELIVERIES_TARGETS <= 0) {
	throw new Error('Bad WP_MAXIMUM_DELIVERIES_TARGETS environment variable');
}

const commandOptions = {
	WP_ENDPOINT,
	WP_MAXIMUM_DELIVERIES_TARGETS,
};
Object.freeze(commandOptions);
export default commandOptions;
