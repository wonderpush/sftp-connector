// DEPENDENCIES
import path from "path";
import Client from "ssh2-sftp-client";

// HELPERS
import options from "./options.js";
import log from "./log.js";
import getFilesList from "./getFilesList.js";
import parseDataFromCsv from "./parseDataFromCsv.js";
import postQuery from "./postQuery.js";

let candidateFiles = {};
let lastListing = {};

const sftp = new Client();
const sftpConfig = {
	host: options.FTP_HOST,
	port: options.FTP_PORT,
	username: options.FTP_USER,
	privateKey: options.FTP_PRIVATE_KEY,
};

getFilesList(sftp, sftpConfig, options.FTP_PATH).then(newListing => {
	log("SFTP connection established");

	log("Initial file list collected");
	lastListing = { ...newListing };

	setInterval(() => {
		getFilesList(sftp, sftpConfig, options.FTP_PATH)
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
				const staleFileChecks = Number(options.STALE_FILE_CHECKS || '1');

				// Determine files to process before starting processing,
				// so that the candidate files don't change under our feet.
				const filesToProcess = Object.keys(candidateFiles).filter(fileName => {
					if (candidateFiles[fileName] === staleFileChecks) {
						delete candidateFiles[fileName];
						return true;
					}
					return false;
				});

				if (filesToProcess.length > 1) {
					log("Multiple files to process, working sequentially:", filesToProcess.join(', '));
				}

				for (const fileName of filesToProcess) {
					log("Processing file:", fileName);

					const filePath = path.join(options.FTP_PATH, path.basename(fileName));

					await parseDataFromCsv(sftpConfig, filePath).then(
						async queriesArray => {
							if (queriesArray.length === 0) {
								log("No valid records found in file:", fileName);
							}
							for (const query of queriesArray) {
								await postQuery(options.WP_ENDPOINT, query, fileName);
							}
						}
					);

					log("File processed:", fileName);
				}
			})
			.catch(error => log(error));
	}, options.LISTING_INTERVAL_MS);
});
