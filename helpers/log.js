// DEPENDENCIES
import dayjs from "dayjs";

const log = (...argv) => {
	console.log(dayjs().format("YYYY-MM-DD HH:mm:ss"), "\n", ...argv);
};

export default log;
