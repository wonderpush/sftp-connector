// Spawn helper for postQuery.test.js. Boots a one-shot HTTPS server with a
// scripted response sequence, calls postQuery against it, and writes a JSON
// result to stderr (production log() output goes to stdout, kept separate).
//
// argv[2] = TLS key file, argv[3] = TLS cert file,
// argv[4] = JSON config:
//   {
//     responses: [{ status, headers?, body?, destroy? }, ...],  // served by request index, last repeats
//     query?:  { data, range:{fromRecord,toRecord}, remotePath },
//     prefix?: string,
//     badUrl?: string   // when set, no server starts; postQuery is called against this URL
//   }
import https from "node:https";
import { readFileSync } from "node:fs";
import postQuery from "./postQuery.js";

const keyFile = process.argv[2];
const certFile = process.argv[3];
const config = JSON.parse(process.argv[4]);

const received = [];

function startServer() {
	return new Promise((resolve) => {
		const server = https.createServer(
			{ key: readFileSync(keyFile), cert: readFileSync(certFile) },
			(req, res) => {
				const idx = received.length;
				received.push({ headers: req.headers });
				const spec = config.responses[Math.min(idx, config.responses.length - 1)];
				if (spec.destroy) {
					req.socket.destroy();
					return;
				}
				res.writeHead(spec.status, { "content-type": "application/json", ...(spec.headers || {}) });
				res.end(JSON.stringify(spec.body ?? {}));
			},
		);
		server.listen(0, "127.0.0.1", () => resolve(server));
	});
}

const query = config.query ?? { data: { x: 1 }, range: { fromRecord: 0, toRecord: 1 }, remotePath: "/test.csv" };
const prefix = config.prefix ?? "sftp-test-";

let server;
let url;
if (config.badUrl) {
	url = config.badUrl;
} else {
	server = await startServer();
	url = `https://127.0.0.1:${server.address().port}/v1/test`;
}

const start = Date.now();
const response = await postQuery(url, query, "test.csv", prefix);
const elapsedMs = Date.now() - start;

if (server) await new Promise(res => server.close(res));

process.stderr.write(JSON.stringify({
	attempts: received.length,
	idempotencyKeys: received.map(r => r.headers["x-wonderpush-idempotency-key"]),
	finalStatus: response ? response.status : null,
	elapsedMs,
}));
