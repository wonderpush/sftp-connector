// DEPENDENCIES
import axios from "axios";
import setLogs from "./setLogs.js";

const postQuery = async (url, query) => {
	try {
		const response = await axios.post(url, query);

		setLogs(JSON.stringify(response.data));

		if (response.data.success) {
			return true;
		}
		
	} catch (error) {
		setLogs(JSON.stringify(error.message));

		return false;
	}
};

export default postQuery;
