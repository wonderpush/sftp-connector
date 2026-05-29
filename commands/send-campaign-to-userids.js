// DEPENDENCIES
import path from "path";
import Client from "ssh2-sftp-client";

// HELPERS
import options from "../options.js";
import commandOptions from "./send-campaign-to-userids.options.js";
import log from "../log.js";
import getFilesList from "../getFilesList.js";
import parseDataFromCsv from "../parseDataFromCsv.js";
import buildQueries from "./send-campaign-to-userids.buildQueries.js";
import postQuery from "../postQuery.js";

let candidateFiles = {};
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

// ssh2-sftp-client v10+ removed its built-in connection retry, so we implement
// the same exponential backoff here to preserve the SFTP_RETRIES* env vars.
async function connectWithRetry() {
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

let sftpChannel = null;
try {
	sftpChannel = await connectWithRetry();
} catch (ex) {
	log("Failed to connect after " + (options.SFTP_RETRIES + 1) + " tries, aborting");
}

getFilesList(sftp, sftpConfig, options.SFTP_PATH).then(async (newListing) => {
	log("SFTP connection established");

	log("Initial file list collected");
	lastListing = { ...newListing };

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

					const records = await parseDataFromCsv(sftp, sftpConfig, filePath);
					const queriesArray = buildQueries(records, filePath, commandOptions.WP_MAXIMUM_DELIVERIES_TARGETS);
					if (queriesArray.length === 0) {
						log("No valid records found in file:", fileName);
					}
					for (const query of queriesArray) {
						await postQuery(commandOptions.WP_ENDPOINT, query, fileName);
					}

					log("File processed:", fileName);
				}
			})
			.catch(error => log(error));
	}
	while (true) {
		await runOnce();
		await new Promise((res) => setTimeout(res, options.LISTING_INTERVAL_MS));
	}
});
