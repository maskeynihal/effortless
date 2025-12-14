#!/usr/bin/env node

const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");
const path = require("path");
const os = require("os");

const DB_PATH =
  process.env.DB_PATH || path.join(os.homedir(), ".effortless", "sessions.db");

// Check if SQL file or command is provided
const sqlInput = process.argv[2];

if (!sqlInput) {
  console.error("Usage:");
  console.error('  npm run db:exec -- "SELECT * FROM applications"');
  console.error("  npm run db:exec -- path/to/script.sql");
  process.exit(1);
}

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error("Failed to connect to database:", err.message);
    process.exit(1);
  }
});

let sql;

// Check if it's a file path or direct SQL
if (fs.existsSync(sqlInput)) {
  console.log(`Executing SQL file: ${sqlInput}`);
  sql = fs.readFileSync(sqlInput, "utf8");
} else {
  console.log("Executing SQL command...");
  sql = sqlInput;
}

// Execute the SQL
db.exec(sql, (err) => {
  if (err) {
    console.error("SQL execution error:", err.message);
    db.close();
    process.exit(1);
  }

  // If it's a SELECT query, run it again with all() to get results
  if (sql.trim().toUpperCase().startsWith("SELECT")) {
    db.all(sql, [], (err, rows) => {
      if (err) {
        console.error("Query error:", err.message);
      } else {
        console.log("\nResults:");
        console.table(rows);
      }
      db.close();
    });
  } else {
    console.log("✓ SQL executed successfully");
    db.close();
  }
});
