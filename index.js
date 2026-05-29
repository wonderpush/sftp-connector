const COMMANDS = {
	"send-campaign-to-userids": () => import("./commands/send-campaign-to-userids.js"),
};

function usage(stream) {
	stream.write(
		`Usage: node index.js <command>\n\n` +
		`Commands:\n` +
		Object.keys(COMMANDS).map(c => `  ${c}`).join("\n") + "\n"
	);
}

const arg = process.argv[2];

if (arg === "-h" || arg === "--help") {
	usage(process.stdout);
	process.exit(0);
}
if (!arg || !(arg in COMMANDS)) {
	usage(process.stderr);
	process.exit(1);
}

await COMMANDS[arg]();
