// DEPENDENCIES
import axios from "axios";
import setLogs from "./setLogs.js";

const postQuery = async (url, query) => {
	try {
		const response = await axios.post(url, query);
		setLogs(response);
	} catch (error) {
		setLogs(JSON.stringify(error.message));
	}
};

export default postQuery;
