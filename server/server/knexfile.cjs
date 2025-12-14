const path = require("path");
const os = require("os");

const DB_PATH =
  process.env.DB_PATH || path.join(os.homedir(), ".effortless", "sessions.db");
const MIGRATIONS_DIR = path.join(__dirname, "migrations");

/** @type {import('knex').Knex.Config} */
const common = {
  client: "sqlite3",
  connection: { filename: DB_PATH },
  useNullAsDefault: true,
  migrations: { directory: MIGRATIONS_DIR },
  pool: {
    afterCreate: (conn, done) => {
      conn.run("PRAGMA foreign_keys = ON", done);
    },
  },
};

module.exports = {
  development: common,
  production: common,
  test: common,
};
