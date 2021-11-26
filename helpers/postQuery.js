// DEPENDENCIES
import axios from "axios";
import log from "./log.js";

const postQuery = async (url, query, file) => {
	/* Initialize timer*/
	let timer = 0;
	const setTimer = setInterval(() => timer++, 1);

	try {
		const response = await axios.post(url, query.data);

		clearInterval(setTimer);

		log({
			file: file,
			range: query.range,
			query: query.data,
			status: response.status,
			time: `${timer} ms`,
			response: response.data
		});
	} catch (error) {
		clearInterval(setTimer);

		error.response
			? log({
					file: file,
					range: query.range,
					query: query.data,
					status: error.response.status,
					time: `${timer} ms`,
					response: error.response.data
			  })
			: log({
					file: file,
					range: query.range,
					query: query.data,
					time: `${timer} ms`,
					error: error.message
			  });
	}
};

export default postQuery;
