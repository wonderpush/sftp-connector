// ASSETS
import logs from "./assets/logs.js";
import fs from "fs";

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
				// to check deleted files
				Object.keys(lastListing).forEach(fileName => {
					if (Object.keys(newListing).indexOf(fileName) < 0) {
						delete candidateFiles[fileName];

						setLogs(logs.fileDeletedInfo, fileName);
					}
				});

				Object.keys(newListing).forEach(fileName => {
					// to check new files
					if (Object.keys(lastListing).indexOf(fileName) < 0) {
						candidateFiles[fileName] = 1;

						setLogs(logs.newFileInfo, fileName);
					} else {
						// handle edited files
						if (
							newListing[fileName].modifyTime !==
							lastListing[fileName].modifyTime
						) {
							delete candidateFiles[fileName];
						}

						// handle non edited files
						if (
							newListing[fileName].modifyTime ===
							lastListing[fileName].modifyTime
						) {
							candidateFiles[fileName] = candidateFiles[fileName]
								? candidateFiles[fileName] + 1
								: 1;
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

						let queriesArray = [];

						parseDatasFromCsv(
							process.env.FTP_PATH + fileName,
							queriesArray
						).then(() => {
							queriesArray.forEach(async query => {
								await postQuery(process.env.WP_ENDPOINT, query);

								setLogs(JSON.stringify(query));
							});
						});
					}
				});
			})
			.catch(error => setLogs(error));
	}, process.env.LISTING_INTERVAL_MS);
});
