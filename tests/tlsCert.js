// Generates a self-signed TLS cert (valid for 127.0.0.1 + localhost) via the
// openssl CLI into a temp dir. The cert path is handed to NODE_EXTRA_CA_CERTS
// so the child process's axios trusts the mock HTTPS server. No npm deps.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Returns { dir, keyFile, certFile, cleanup }.
export function generateSelfSignedCert() {
	const dir = mkdtempSync(path.join(os.tmpdir(), "sftp-tls-"));
	const keyFile = path.join(dir, "key.pem");
	const certFile = path.join(dir, "cert.pem");
	execFileSync("openssl", [
		"req", "-x509", "-newkey", "rsa:2048", "-nodes",
		"-keyout", keyFile,
		"-out", certFile,
		"-days", "1",
		"-subj", "/CN=127.0.0.1",
		"-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost",
	], { stdio: "ignore" });
	return {
		dir,
		keyFile,
		certFile,
		cleanup() { rmSync(dir, { recursive: true, force: true }); },
	};
}
