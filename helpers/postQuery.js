// DEPENDENCIES
import axios from "axios";
import log from "./log.js";

const postQuery = async (url, query, file) => {
	/* Initialize timer*/
	let timer = new Date().getTime();

	try {
		const response = await axios.post(url, query.data);

		timer = new Date().getTime() - timer;

		log({
			file: file,
			range: query.range,
			query: query.data,
			status: response.status,
			time: `${timer} ms`,
			response: response.data
		});
	} catch (error) {
		timer = new Date().getTime() - timer;

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
