const getFilesList = async (sftp, sftpConfig, path) => {
	const newListing = {};

	await sftp.list(path || "/")
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
		});

	return newListing;
};

export default getFilesList;
