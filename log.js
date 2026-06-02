import { formatWithOptions } from "node:util";

// depth/maxArrayLength null so nested payloads (batch requests, sub-responses)
// and long arrays print in full instead of collapsing to [Object] / "… N more items".
const log = (...argv) => {
	console.log(formatWithOptions({ depth: null, maxArrayLength: null }, new Date().toISOString(), ...argv));
};

export default log;
