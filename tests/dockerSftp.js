// Docker-backed SFTP harness for e2e tests. Generates an ephemeral keypair,
// boots an atmoz/sftp container, waits for it to accept connections, and
// returns a connected ssh2-sftp-client plus a cleanup function. Shells out to
// the docker / ssh-keygen CLIs (no testcontainers dependency).
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import Client from "ssh2-sftp-client";

// True when the docker daemon is reachable. Used to skip e2e tests gracefully.
export function dockerAvailable() {
	try {
		execFileSync("docker", ["info"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

function freePort() {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address();
			// Port is released before docker binds it; inherent race, acceptable in this test-only context.
			server.close(() => resolve(port));
		});
	});
}

async function connectWithReadiness(sftp, sftpConfig, { attempts = 40, waitMs = 500 } = {}) {
	let lastErr;
	for (let i = 0; i < attempts; i++) {
		try {
			await sftp.connect(sftpConfig);
			return;
		} catch (ex) {
			lastErr = ex;
			await new Promise(res => setTimeout(res, waitMs));
		}
	}
	throw new Error("SFTP container never became ready: " + (lastErr && lastErr.message));
}

// Boots a container and returns { sftp, sftpConfig, remoteDir, uploadHost, cleanup }.
// remoteDir is the path to list; uploadHost is the host directory bind-mounted
// into it, so tests can seed files directly on the host filesystem.
export async function startSftpContainer() {
	const tmp = mkdtempSync(path.join(os.tmpdir(), "sftp-e2e-"));
	const sftp = new Client();
	let name; // set once the container is launched; until then cleanup skips `docker rm`
	let cleanedUp = false;
	async function cleanup() {
		if (cleanedUp) return;
		cleanedUp = true;
		try { await sftp.end(); } catch {}
		if (name) {
			try { execFileSync("docker", ["rm", "-f", name], { stdio: "ignore" }); } catch {}
		}
		rmSync(tmp, { recursive: true, force: true });
	}

	try {
		const keyPath = path.join(tmp, "id");
		execFileSync("ssh-keygen", ["-t", "ed25519", "-N", "", "-f", keyPath, "-q"]);

		const uploadHost = path.join(tmp, "upload");
		mkdirSync(uploadHost, { mode: 0o755 });

		const port = await freePort();
		name = "sftp-e2e-" + Math.random().toString(36).slice(2);

		execFileSync("docker", [
			"run", "-d", "--rm", "--name", name,
			"-p", `127.0.0.1:${port}:22`,
			"-v", `${keyPath}.pub:/home/wp/.ssh/keys/id.pub:ro`,
			"-v", `${uploadHost}:/home/wp/upload`,
			"atmoz/sftp", "wp::1001",
		], { stdio: "ignore" });

		const sftpConfig = {
			host: "127.0.0.1",
			port,
			username: "wp",
			privateKey: readFileSync(keyPath),
		};

		await connectWithReadiness(sftp, sftpConfig);

		return { sftp, sftpConfig, remoteDir: "/upload", uploadHost, name, cleanup };
	} catch (ex) {
		await cleanup();
		throw ex;
	}
}
