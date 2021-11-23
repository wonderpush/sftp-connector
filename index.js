// DEPENDENCIES

// HELPERS
import getFilesList from "./helpers/getFilesList.js";

let candidatesFiles = {};
let lastListing = {};
let newListing = {};

getFilesList(newListing).then(() => {
	setInterval(() => {
		lastListing = {};
		lastListing = { ...newListing };
		newListing = {};

		getFilesList(newListing).then(async () => {
			// to check deleted files
			Object.keys(lastListing).forEach(fileName => {
				if (Object.keys(newListing).indexOf(fileName) < 0) {
					delete candidatesFiles[fileName];
					console.log("🚨 File removed : ", fileName);
				}
			});

			Object.keys(newListing).forEach(fileName => {
				// to check new files
				if (Object.keys(lastListing).indexOf(fileName) < 0) {
					console.log("✨ New file detected : ", fileName);
					candidatesFiles[fileName] = 1;
				} else {
					// handle edited files
					if (
						newListing[fileName].modifyTime !== lastListing[fileName].modifyTime
					) {
						delete candidatesFiles[fileName];
					}

					// handle non edited files
					if (
						newListing[fileName].modifyTime === lastListing[fileName].modifyTime
					) {
						candidatesFiles[fileName] = candidatesFiles[fileName]
							? candidatesFiles[fileName] + 1
							: 1;
					}
				}
			});
		});
	}, process.env.LISTING_INTERVAL_MS);
});
