const log = (...argv) => {
	console.log(new Date().toISOString(), ...argv);
};

export default log;
