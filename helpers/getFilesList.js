// DEPENDENCIES
import Client from "ssh2-sftp-client";
import fs from "fs";

const sftp = new Client();

const config = {
	host: process.env.FTP_HOST,
	port: process.env.FTP_PORT,
	username: process.env.FTP_USER,
	privateKey: fs.readFileSync(process.env.FTP_PRIVATE_KEY)
};

const getFilesList = async (list, path) => {
	await sftp
		.connect(config)
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
				
				if (file.type === "-" && file.name.slice(0, 1) !== ".") { // to exclude directories, links and hidden files
					list[file.name] = {
						size: file.size,
						modifyTime: file.modifyTime
					};
				}
			});
		})
		.then(() => sftp.end());
};

export default getFilesList;
