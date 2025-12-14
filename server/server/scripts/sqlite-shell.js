#!/usr/bin/env node

const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");

// Match server DB path resolution, but prefer the project-mounted data folder if present
const projectDbPath = path.join(__dirname, "..", "data", "sessions.db");
const dbPath =
  process.env.DB_PATH ||
  (fs.existsSync(projectDbPath)
    ? projectDbPath
    : path.join(os.homedir(), ".effortless", "sessions.db"));

console.log(`Opening SQLite shell at ${dbPath}`);

const sqliteBin = path.join(__dirname, "../node_modules/.bin/sqlite3");
const child = spawn(sqliteBin, [dbPath], {
  stdio: "inherit",
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});

child.on("error", (err) => {
  console.error("Failed to start sqlite3:", err.message);
  process.exit(1);
});
