// DEPENDENCIES
import fs from "fs";
import path from "path";
import Client from "ssh2-sftp-client";

// HELPERS
import log from "./log.js";
import getFilesList from "./getFilesList.js";
import parseDataFromCsv from "./parseDataFromCsv.js";
import postQuery from "./postQuery.js";

let candidateFiles = {};
let lastListing = {};

const sftp = new Client();
const sftpConfig = {
	host: process.env.FTP_HOST,
	port: process.env.FTP_PORT,
	username: process.env.FTP_USER,
	privateKey: fs.readFileSync(process.env.FTP_PRIVATE_KEY)
};

getFilesList(sftp, sftpConfig, process.env.FTP_PATH).then(newListing => {
	log("SFTP connection established");

	lastListing = { ...newListing };

	setInterval(() => {
		getFilesList(sftp, sftpConfig, process.env.FTP_PATH)
			// ! FILE SELECTION
			.then(newListing => {
				// to check new files
				Object.keys(newListing).forEach(fileName => {
					if (!Object.keys(lastListing).includes(fileName)) {
						candidateFiles[fileName] = 0;

						log("New file detected, monitoring changes:", fileName);
					}
				});

				// to check deleted files
				Object.keys(lastListing).forEach(fileName => {
					if (!Object.keys(newListing).includes(fileName)) {
						delete candidateFiles[fileName];

						log("File deletion detected:", fileName);
					}
				});

				// to check updated files
				Object.keys(candidateFiles).forEach(fileName => {
					if (lastListing[fileName] && newListing[fileName]) {
						if (
							newListing[fileName].modifyTime !==
								lastListing[fileName].modifyTime ||
							newListing[fileName].size !== lastListing[fileName].size
						) {
							candidateFiles[fileName] = 0;
						} else {
							candidateFiles[fileName]++;
						}
					}
				});

				lastListing = { ...newListing };
			})
			// ! FILE PROCESSING
			.then(async () => {
				const staleFileChecks = Number(process.env.STALE_FILE_CHECKS || '1');

				for (const fileName of Object.keys(candidateFiles)) {
					if (candidateFiles[fileName] === staleFileChecks) {
						delete candidateFiles[fileName];
						log("Processing file:", fileName);

						const filePath = path.join(process.env.FTP_PATH, path.basename(fileName));

						await parseDataFromCsv(sftpConfig, filePath).then(
							async queriesArray => {
								if (queriesArray.length === 0) {
									log("No valid records found in file:", fileName);
								}
								for (const query of queriesArray) {
									await postQuery(process.env.WP_ENDPOINT, query, fileName);
								}
							}
						);

						log("File processed:", fileName);
					}
				}
			})
			.catch(error => log(error));
	}, process.env.LISTING_INTERVAL_MS);
});
