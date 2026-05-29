// Processing specific to the send-campaign-to-userids subcommand: turn the raw
// CSV records returned by the shared parseDataFromCsv helper into POST
// /v1/deliveries queries, chunked into batches of at most maxTargets records.

import options from "../options.js";

const buildQueries = (records, remotePath, maxTargets) => {
	const queriesArray = [];

	/* Ignore malformed records */
	records = records.filter(record => {
		return typeof record[options.CSV_COLUMN_USER_ID] === "string"
			&& typeof record[options.CSV_COLUMN_CAMPAIGN_ID] === "string";
	});

	if (records.length === 0) return queriesArray;

	const notificationParamsColumns = Object.keys(records[0]).filter(
		column => {
			return column !== options.CSV_COLUMN_USER_ID && column !== options.CSV_COLUMN_CAMPAIGN_ID;
		}
	);

	/* Create queries */
	const numberOfQueries = Math.ceil(records.length / maxTargets);

	// range of the query
	let startIndex = 0;
	let endIndex = Math.min(maxTargets, records.length);

	for (let i = 0; i < numberOfQueries; i++) {
		const queryRecords = records.slice(startIndex, endIndex);

		const tmpQuery = {
			data: {
				accessToken: "",
				targetUserIds: [],
				campaignId: "",
				notificationParams: []
			},
			range: {},
			remotePath,
		};

		tmpQuery.data.accessToken = options.WP_ACCESS_TOKEN;
		tmpQuery.data.targetUserIds = queryRecords.map(
			item => item[options.CSV_COLUMN_USER_ID]
		);

		tmpQuery.data.campaignId = records[0][options.CSV_COLUMN_CAMPAIGN_ID];

		if (notificationParamsColumns) {
			tmpQuery.data.notificationParams = queryRecords.map(row => {
				const customParams = {};

				notificationParamsColumns.forEach(parameter => {
					customParams[parameter] = row[parameter];
				});

				return customParams;
			});
		}

		tmpQuery.range = {
			fromRecord: startIndex + 1,
			toRecord: endIndex
		};

		queriesArray.push(tmpQuery);

		startIndex = endIndex;
		endIndex = Math.min(records.length, startIndex + maxTargets);
	}

	return queriesArray;
};

export default buildQueries;
