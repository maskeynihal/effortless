#!/usr/bin/env node

const sqlite3 = require("sqlite3").verbose();
const inquirer = require("inquirer");
const fs = require("fs");
const path = require("path");
const os = require("os");

const DB_PATH =
  process.env.DB_PATH || path.join(os.homedir(), ".effortless", "sessions.db");

let db;

async function connectDatabase() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        reject(err);
      } else {
        console.log(`\n✓ Connected to database: ${DB_PATH}\n`);
        resolve();
      }
    });
  });
}

async function getTables() {
  return new Promise((resolve, reject) => {
    db.all(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      [],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map((r) => r.name));
      }
    );
  });
}

async function getTableSchema(tableName) {
  return new Promise((resolve, reject) => {
    db.all(`PRAGMA table_info(${tableName})`, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function executeQuery(sql) {
  return new Promise((resolve, reject) => {
    const isSelect = sql.trim().toUpperCase().startsWith("SELECT");

    if (isSelect) {
      db.all(sql, [], (err, rows) => {
        if (err) reject(err);
        else resolve({ rows, changes: 0 });
      });
    } else {
      db.run(sql, function (err) {
        if (err) reject(err);
        else resolve({ rows: [], changes: this.changes });
      });
    }
  });
}

async function insertData() {
  const tables = await getTables();

  const { tableName } = await inquirer.prompt([
    {
      type: "list",
      name: "tableName",
      message: "Select table to insert into:",
      choices: tables,
    },
  ]);

  const schema = await getTableSchema(tableName);
  const columns = schema.filter(
    (col) =>
      col.name !== "id" && col.name !== "createdAt" && col.name !== "updatedAt"
  );

  console.log(`\nTable: ${tableName}`);
  console.log("Columns:");
  columns.forEach((col) => {
    const required = col.notnull ? " (required)" : " (optional)";
    console.log(`  - ${col.name}: ${col.type}${required}`);
  });

  const values = {};
  for (const col of columns) {
    const { value } = await inquirer.prompt([
      {
        type: "input",
        name: "value",
        message: `${col.name} (${col.type}):`,
        default: col.dflt_value,
        validate: (input) => {
          if (col.notnull && !input && !col.dflt_value) {
            return "This field is required";
          }
          return true;
        },
      },
    ]);

    if (value) {
      values[col.name] = value;
    }
  }

  const columnNames = Object.keys(values).join(", ");
  const placeholders = Object.keys(values)
    .map(() => "?")
    .join(", ");
  const sql = `INSERT INTO ${tableName} (${columnNames}) VALUES (${placeholders})`;

  return new Promise((resolve, reject) => {
    db.run(sql, Object.values(values), function (err) {
      if (err) {
        reject(err);
      } else {
        console.log(`\n✓ Inserted row with ID: ${this.lastID}`);
        resolve();
      }
    });
  });
}

async function queryData() {
  const { queryType } = await inquirer.prompt([
    {
      type: "list",
      name: "queryType",
      message: "Select query type:",
      choices: [
        { name: "View all records from a table", value: "viewAll" },
        { name: "Custom SQL query", value: "custom" },
        { name: "Execute SQL file", value: "file" },
      ],
    },
  ]);

  if (queryType === "viewAll") {
    const tables = await getTables();
    const { tableName } = await inquirer.prompt([
      {
        type: "list",
        name: "tableName",
        message: "Select table:",
        choices: tables,
      },
    ]);

    const { limit } = await inquirer.prompt([
      {
        type: "input",
        name: "limit",
        message: "Limit (leave empty for all):",
        default: "10",
      },
    ]);

    const sql = `SELECT * FROM ${tableName}${limit ? ` LIMIT ${limit}` : ""}`;
    const result = await executeQuery(sql);

    console.log(`\nQuery: ${sql}`);
    console.log(`\nResults (${result.rows.length} rows):`);
    console.table(result.rows);
  } else if (queryType === "custom") {
    const { sql } = await inquirer.prompt([
      {
        type: "input",
        name: "sql",
        message: "Enter SQL query:",
      },
    ]);

    const result = await executeQuery(sql);

    if (result.rows.length > 0) {
      console.log(`\nResults (${result.rows.length} rows):`);
      console.table(result.rows);
    } else {
      console.log(`\n✓ Query executed. ${result.changes} rows affected.`);
    }
  } else if (queryType === "file") {
    const { filePath } = await inquirer.prompt([
      {
        type: "input",
        name: "filePath",
        message: "Enter SQL file path:",
      },
    ]);

    const sql = fs.readFileSync(filePath, "utf8");
    const result = await executeQuery(sql);

    if (result.rows.length > 0) {
      console.log(`\nResults (${result.rows.length} rows):`);
      console.table(result.rows);
    } else {
      console.log(`\n✓ SQL file executed. ${result.changes} rows affected.`);
    }
  }
}

async function viewSchema() {
  const tables = await getTables();
  const { tableName } = await inquirer.prompt([
    {
      type: "list",
      name: "tableName",
      message: "Select table to view schema:",
      choices: tables,
    },
  ]);

  const schema = await getTableSchema(tableName);

  console.log(`\nTable: ${tableName}`);
  console.log("\nColumns:");
  console.table(
    schema.map((col) => ({
      Name: col.name,
      Type: col.type,
      NotNull: col.notnull ? "YES" : "NO",
      Default: col.dflt_value || "NULL",
      PrimaryKey: col.pk ? "YES" : "NO",
    }))
  );
}

async function mainMenu() {
  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: "What would you like to do?",
      choices: [
        { name: "📝 Insert data", value: "insert" },
        { name: "🔍 Query data", value: "query" },
        { name: "📋 View table schema", value: "schema" },
        { name: "📊 List all tables", value: "tables" },
        { name: "🚪 Exit", value: "exit" },
      ],
    },
  ]);

  switch (action) {
    case "insert":
      await insertData();
      break;
    case "query":
      await queryData();
      break;
    case "schema":
      await viewSchema();
      break;
    case "tables":
      const tables = await getTables();
      console.log("\nTables:");
      tables.forEach((t) => console.log(`  - ${t}`));
      break;
    case "exit":
      console.log("\nGoodbye!\n");
      db.close();
      process.exit(0);
  }

  // Continue loop
  await mainMenu();
}

async function main() {
  try {
    await connectDatabase();
    await mainMenu();
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    if (db) db.close();
    process.exit(1);
  }
}

main();
