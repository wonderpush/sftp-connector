// DEPENDENCIES
import Client from "ssh2-sftp-client";

// const sftp = new Client();

const getFilesList = async (sftp, sftpConfig, path) => {
	const newListing = {};

	await sftp
		.connect(sftpConfig)
		.then(() => {
			return sftp.list(path || "/");
		})
		.then(async data => {

			await data.forEach(file => {
				/*
					File's type :
						d : directory
						l : link
						- : file
				*/

				if (file.type === "-" && file.name.slice(0, 1) !== ".") {
					// to exclude directories, links and hidden files
					newListing[file.name] = {
						size: file.size,
						modifyTime: file.modifyTime
					};
				}
			});

			sftp.end();

		});

	return newListing;
};

export default getFilesList;
