// ASSETS
import logs from "./logs.js";

// DEPENDENCIES
import fs from "fs";
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
	log(logs.sshConnectedInfo);

	lastListing = { ...newListing };

	setInterval(() => {
		getFilesList(sftp, sftpConfig, process.env.FTP_PATH)
			// ! FILE SELECTION
			.then(newListing => {
				// to check new files
				Object.keys(newListing).forEach(fileName => {
					if (!Object.keys(lastListing).includes(fileName)) {
						candidateFiles[fileName] = 0;

						log(logs.newFileInfo, fileName);
					}
				});

				// to check deleted files
				Object.keys(lastListing).forEach(fileName => {
					if (!Object.keys(newListing).includes(fileName)) {
						delete candidateFiles[fileName];

						log(logs.fileDeletedInfo, fileName);
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

				Object.keys(candidateFiles).forEach(async fileName => {
					if (candidateFiles[fileName] === staleFileChecks) {
						delete candidateFiles[fileName];
						log(logs.startFileProcessInfo, fileName);

						const path =
							process.env.FTP_PATH.slice(-1) === "/"
								? process.env.FTP_PATH + fileName.replace(/^.*[\\\/]/, "")
								: process.env.FTP_PATH +
								  "/" +
								  fileName.replace(/^.*[\\\/]/, "");

						await parseDataFromCsv(sftpConfig, path).then(
							async queriesArray => {
								if (queriesArray.length === 0) {
									log(logs.noValidRecordsInfo, fileName);
								}
								for (const query of queriesArray) {
									await postQuery(process.env.WP_ENDPOINT, query, fileName);
								}
							}
						);
					}
				});
			})
			.catch(error => log(error));
	}, process.env.LISTING_INTERVAL_MS);
});
