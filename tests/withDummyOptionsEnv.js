// Preload for in-process tests that (transitively) import options.js.
// options.js validates and freezes env at module-load time and throws if the
// minimum vars are missing. Import THIS module before importing anything that
// loads options.js so the import succeeds. Values are dummies — the watcher
// tests inject a fake client and never open a real connection.
process.env.SFTP_HOST ||= "test-host";
process.env.SFTP_PRIVATE_KEY ||= "test-private-key";
process.env.WP_ACCESS_TOKEN ||= "test-token";
