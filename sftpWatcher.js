// Shared SFTP watcher used by every subcommand.
//
// Connects to the SFTP server (with exponential-backoff retry around the
// initial connect, since ssh2-sftp-client v10+ no longer retries on its own),
// lists the configured folder on a fixed interval, detects new and modified
// files, holds each new file until it has been stable for STALE_FILE_CHECKS
// consecutive polls, then invokes the subcommand-provided processFile
// callback. Subcommands only own the per-file processing — parsing, payload
// assembly, the POST, and response handling.

import path from "path";
import Client from "ssh2-sftp-client";

import options from "./options.js";
import log from "./log.js";
import getFilesList from "./getFilesList.js";

async function connectWithRetry(sftp, sftpConfig) {
	const maxAttempts = options.SFTP_RETRIES + 1;
	let wait = options.SFTP_RETRY_WAIT_MIN_MS;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return await sftp.connect(sftpConfig);
		} catch (ex) {
			if (attempt === maxAttempts) throw ex;
			log(`SFTP connect attempt ${attempt}/${maxAttempts} failed: ${ex.message}; retrying in ${wait}ms`);
			await new Promise(res => setTimeout(res, wait));
			wait = Math.round(wait * options.SFTP_RETRY_WAIT_FACTOR);
		}
	}
}

export default async function watchSftpFolder(processFile) {
	const candidateFiles = {};
	let lastListing = {};

	const sftp = new Client();
	const sftpConfig = {
		debug: options.SFTP_DEBUG ? console.debug : undefined,
		host: options.SFTP_HOST,
		port: options.SFTP_PORT,
		username: options.SFTP_USER,
		privateKey: options.SFTP_PRIVATE_KEY,
		passphrase: options.SFTP_PASSPHRASE,
	};

	try {
		await connectWithRetry(sftp, sftpConfig);
	} catch (ex) {
		log("Failed to connect after " + (options.SFTP_RETRIES + 1) + " tries, aborting");
	}

	const initialListing = await getFilesList(sftp, sftpConfig, options.SFTP_PATH);
	log("SFTP connection established");
	log("Initial file list collected");
	lastListing = { ...initialListing };

	function runOnce() {
		return getFilesList(sftp, sftpConfig, options.SFTP_PATH)
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

					const filePath = path.join(options.SFTP_PATH, path.basename(fileName));

					await processFile(sftp, sftpConfig, filePath, fileName);

					log("File processed:", fileName);
				}
			})
			.catch(error => log(error));
	}

	while (true) {
		await runOnce();
		await new Promise((res) => setTimeout(res, options.LISTING_INTERVAL_MS));
	}
}
