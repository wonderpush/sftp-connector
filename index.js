// ASSETS
import logs from "./assets/logs.js";
import fs from "fs";

// DEPENDENCIES

// HELPERS
import setLogs from "./helpers/setLogs.js";
import getFilesList from "./helpers/getFilesList.js";
import parseDatasFromCsv from "./helpers/parseDatasFromCsv.js";
import postQuery from "./helpers/postQuery.js";

let candidatesFiles = {};
let lastListing = {};
let newListing = {};

getFilesList(newListing, process.env.FTP_PATH).then(() => {
	setLogs(logs.sshConnectedInfo);

	Object.keys(newListing).forEach(fileName => {
		candidatesFiles[fileName] = 0;

		setLogs(logs.FileInfo, fileName);
	});

	setInterval(() => {
		lastListing = { ...newListing };
		newListing = {};

		getFilesList(newListing, process.env.FTP_PATH)

			// ! FILE SELECTION
			.then(async () => {
				// to check deleted files
				Object.keys(lastListing).forEach(fileName => {
					if (Object.keys(newListing).indexOf(fileName) < 0) {
						delete candidatesFiles[fileName];

						setLogs(logs.fileDeletedInfo, fileName);
					}
				});

				Object.keys(newListing).forEach(fileName => {
					// to check new files
					if (Object.keys(lastListing).indexOf(fileName) < 0) {
						candidatesFiles[fileName] = 1;

						setLogs(logs.newFileInfo, fileName);
					} else {
						// handle edited files
						if (
							newListing[fileName].modifyTime !==
							lastListing[fileName].modifyTime
						) {
							delete candidatesFiles[fileName];
						}

						// handle non edited files
						if (
							newListing[fileName].modifyTime ===
							lastListing[fileName].modifyTime
						) {
							candidatesFiles[fileName] = candidatesFiles[fileName]
								? candidatesFiles[fileName] + 1
								: 1;
						}
					}
				});
			})
			// ! FILE PROCESSING
			.then(() => {
				const staleFileChecks = Number(process.env.STALE_FILE_CHECKS) || 5;

				Object.keys(candidatesFiles).forEach(fileName => {
					if (candidatesFiles[fileName] === staleFileChecks) {
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
