// ASSETS
import logs from "./assets/logs.js";

// DEPENDENCIES

// HELPERS
import setLogs from "./helpers/setLogs.js";
import getFilesList from "./helpers/getFilesList.js";
import parseDatasFromCsv from "./helpers/parseDatasFromCsv.js";
import postQuery from "./helpers/postQuery.js";

let candidateFiles = {};
let lastListing = {};

getFilesList(process.env.FTP_PATH).then(newListing => {
	setLogs(logs.sshConnectedInfo);

	lastListing = { ...newListing };

	setInterval(() => {
		getFilesList(process.env.FTP_PATH)
			// ! FILE SELECTION
			.then(newListing => {
				// to check new files
				Object.keys(newListing).forEach(fileName => {
					if (!Object.keys(lastListing).includes(fileName)) {
						candidateFiles[fileName] = 0;

						setLogs(logs.newFileInfo, fileName);
					}
				});

				// to check deleted files
				Object.keys(lastListing).forEach(fileName => {
					if (!Object.keys(newListing).includes(fileName)) {
						delete candidateFiles[fileName];

						setLogs(logs.fileDeletedInfo, fileName);
					}
				});

				// to check updated files
				Object.keys(candidateFiles).forEach(fileName => {
					if (lastListing[fileName] && newListing[fileName]) {
						if ( newListing[fileName].modifyTime !== lastListing[fileName].modifyTime || newListing[fileName].size !== lastListing[fileName].size ) {
							candidateFiles[fileName] = 0;
						}

						if ( newListing[fileName].modifyTime === lastListing[fileName].modifyTime && newListing[fileName].size === lastListing[fileName].size ) {
							candidateFiles[fileName]++;
						}
					}
				});

				lastListing = { ...newListing };

			})
			// ! FILE PROCESSING
			.then(() => {
				const staleFileChecks = Number(process.env.STALE_FILE_CHECKS) || 5;

				Object.keys(candidateFiles).forEach(fileName => {
					if (candidateFiles[fileName] === staleFileChecks) {
						setLogs(logs.startFileProcessInfo, fileName);

						parseDatasFromCsv(process.env.FTP_PATH + fileName).then(
							queriesArray => {
								// queriesArray.forEach(query => {
								// 	postQuery(process.env.WP_ENDPOINT, query);

								// 	setLogs(JSON.stringify(query));
								// });

								for (const query of queriesArray) {
									postQuery(process.env.WP_ENDPOINT, query);

									setLogs(JSON.stringify(query));
								}
							}
						);
					}
				});
			})
			.catch(error => setLogs(error));
	}, process.env.LISTING_INTERVAL_MS);
});
