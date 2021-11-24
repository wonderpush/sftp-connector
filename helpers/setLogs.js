// DEPENDENCIES
import dayjs from "dayjs";

const setLogs = (...argv) => {
	let logs = "";

	argv.forEach(argument => {
		logs += `${argument}`;
	});

	console.log(dayjs().format("YYYY-MM-DD HH:mm:ss"), ":", logs);
};

export default setLogs;
