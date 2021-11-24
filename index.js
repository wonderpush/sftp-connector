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
		candidatesFiles[fileName] = 1;

		setLogs(logs.FileInfo, fileName);
	});

	setInterval(() => {
		lastListing = { ...newListing };
		newListing = {};

		getFilesList(newListing, process.env.FTP_PATH)
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
			.then(() => {
				Object.keys(candidatesFiles).forEach(fileName => {
					if (candidatesFiles[fileName] > process.env.STALE_FILE_CHECKS) {
						delete candidatesFiles[fileName];

						setLogs(logs.startFileProcessInfo, fileName);

						let query = {};

						parseDatasFromCsv(process.env.FTP_PATH + fileName, query).then(
							() => {
								postQuery(process.env.WP_ENDPOINT, query);
							}
						);
					}
				});
			})
			.catch(error => setLogs(error));
	}, process.env.LISTING_INTERVAL_MS);
});
