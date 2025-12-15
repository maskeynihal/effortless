import { Knex, knex } from "knex";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { logger } from "./logger";

const DB_PATH =
  process.env.DB_PATH || path.join(os.homedir(), ".effortless", "sessions.db");
const MIGRATIONS_DIR = path.join(process.cwd(), "migrations");

let knexInstance: Knex | null = null;
let initialized = false;

function ensureDbDir() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getDb(): Knex {
  if (!knexInstance) throw new Error("Database not initialized");
  return knexInstance;
}

/**
 * Initialize the database via knex and run migrations
 */
export async function initializeDatabase(): Promise<void> {
  if (initialized && knexInstance) return;

  ensureDbDir();

  knexInstance = knex({
    client: "sqlite3",
    connection: { filename: DB_PATH },
    useNullAsDefault: true,
    pool: {
      afterCreate: (conn: any, done: any) => {
        conn.run("PRAGMA foreign_keys = ON", done);
      },
    },
  });

  await knexInstance.migrate.latest({ directory: MIGRATIONS_DIR });
  initialized = true;
  logger.info(`[DB] Database initialized at ${DB_PATH}`);
}

/**
 * Save an application (replaces saveSession)
 */
export async function saveApplication(applicationData: {
  sessionId: string;
  host: string;
  username: string;
  port: number;
  sshKeyName?: string;
  githubUsername?: string;
  sshPrivateKey?: string;
  githubToken?: string;
  applicationName: string;
  selectedRepo?: string;
  domain?: string;
  pathname?: string;
}): Promise<{ id: number }> {
  const db = getDb();
  const {
    sessionId,
    host,
    username,
    port,
    sshKeyName,
    githubUsername,
    sshPrivateKey,
    githubToken,
    applicationName,
    selectedRepo,
    domain,
    pathname,
  } = applicationData;

  const result = await db("applications")
    .insert({
      sessionId,
      host,
      username,
      port,
      sshKeyName: sshKeyName || null,
      githubUsername: githubUsername || null,
      sshPrivateKey: sshPrivateKey || null,
      githubToken: githubToken || null,
      applicationName,
      selectedRepo: selectedRepo || null,
      domain: domain || null,
      pathname: pathname || null,
      status: "pending",
    })
    .returning("id")
    .onConflict(["host", "username", "applicationName"])
    .merge();

  logger.info(`Application saved: ${applicationName} (${sessionId})`);

  return result[0];
}

/**
 * Get application by host, username, and name (replaces getSessionByApplication)
 */
export async function getApplicationByName(
  host: string,
  username: string,
  applicationName: string
): Promise<any | null> {
  const db = getDb();
  logger.info(
    `[DB] getApplicationByName called with: host=${host}, username=${username}, applicationName=${applicationName}`
  );
  const row = await db("applications")
    .where({ host, username, applicationName })
    .orderBy("createdAt", "desc")
    .first();

  if (row) {
    logger.info(
      `[DB] Application found: id=${row.id}, applicationName=${row.applicationName}`
    );
    logger.info(
      `[DB] Application details: sshPrivateKey=${
        row.sshPrivateKey ? "present" : "null"
      }, githubToken=${row.githubToken ? "present" : "null"}, selectedRepo=${
        row.selectedRepo || "null"
      }`
    );
  } else {
    logger.warn(
      `[DB] No application found for host=${host}, username=${username}, applicationName=${applicationName}`
    );
  }

  return row || null;
}

/**
 * Add or update an application step
 */
export async function addApplicationStep(
  applicationId: number,
  step: string,
  status: string,
  message?: string
): Promise<void> {
  const db = getDb();
  await db("application_steps")
    .insert({
      applicationId,
      step,
      status,
      message: message || null,
    })
    .onConflict(["applicationId", "step"])
    .merge({
      status,
      message: message || null,
    });
}

/**
 * Get completed steps for an application
 */
export async function getApplicationSteps(
  applicationId: number
): Promise<any[]> {
  const db = getDb();
  return db("application_steps")
    .where({ applicationId })
    .orderBy("createdAt", "asc");
}

/**
 * Update application status
 */
export async function updateApplicationStatus(
  applicationId: number,
  status: "pending" | "in-progress" | "completed" | "failed"
): Promise<void> {
  const db = getDb();
  await db("applications")
    .where({ id: applicationId })
    .update({
      status,
      completedAt: status === "completed" ? db.fn.now() : null,
    });
}

/**
 * LEGACY: updateSessionStatus - redirects to updateApplicationStatus
 */
export async function updateSessionStatus(
  sessionId: string,
  status: "pending" | "in-progress" | "completed" | "failed"
): Promise<void> {
  const db = getDb();
  const app = await db("applications").where({ sessionId }).first();
  if (app) {
    await updateApplicationStatus(app.id, status);
  }
}

/**
 * LEGACY: saveSession - redirects to saveApplication for backward compatibility
 */
export async function saveSession(sessionData: {
  sessionId: string;
  host: string;
  username: string;
  port: number;
  sshKeyName?: string;
  githubUsername?: string;
  sshPrivateKey?: string;
  githubToken?: string;
  applicationName?: string;
  selectedRepo?: string;
}): Promise<void> {
  await saveApplication({
    ...sessionData,
    applicationName: sessionData.applicationName || "unknown",
  });
}

/**
 * LEGACY: getSessionByApplication - redirects to getApplicationByName for backward compatibility
 */
export async function getSessionByApplication(
  host: string,
  username: string,
  applicationName: string
): Promise<any | null> {
  return getApplicationByName(host, username, applicationName);
}

/**
 * LEGACY: addSessionHistory - redirects to addApplicationStep for backward compatibility
 */
export async function addSessionHistory(
  sessionId: string,
  step: string,
  status: string,
  message?: string
): Promise<void> {
  const db = getDb();
  const app = await db("applications").where({ sessionId }).first();
  if (app) {
    await addApplicationStep(app.id, step, status, message);
  }
}

/**
 * LEGACY: getCompletedSteps
 */
export async function getCompletedSteps(sessionId: string): Promise<string[]> {
  const db = getDb();
  const app = await db("applications").where({ sessionId }).first();
  if (!app) return [];
  const rows = await db("application_steps")
    .where({ applicationId: app.id, status: "success" })
    .orderBy("createdAt");
  return rows.map((r: any) => r.step);
}

/**
 * Get unique suggestion values for a field
 */
export async function getSuggestions(
  type: string,
  limit: number = 10
): Promise<string[]> {
  const db = getDb();
  const rows = await db("suggestions")
    .select("value")
    .where({ type })
    .orderBy([
      { column: "usageCount", order: "desc" },
      { column: "lastUsed", order: "desc" },
    ])
    .limit(limit);
  return rows.map((r: any) => r.value);
}

/**
 * Get previous session by host and username (now returns previous application)
 */
export async function getPreviousSession(
  host: string,
  username: string
): Promise<any | null> {
  const db = getDb();
  return db("applications")
    .where({ host, username })
    .orderBy("createdAt", "desc")
    .first();
}

/**
 * Get all previous sessions (for display/history)
 */
export async function getPreviousSessions(limit: number = 10): Promise<any[]> {
  const db = getDb();
  return db("applications")
    .select(
      "host",
      "username",
      "port",
      "sshKeyName",
      "githubUsername",
      "applicationName",
      "status",
      "createdAt",
      "completedAt"
    )
    .orderBy("createdAt", "desc")
    .limit(limit);
}

/**
 * Get all distinct configurations (host, username, port combinations)
 */
export async function getDistinctConfigurations(): Promise<any[]> {
  const db = getDb();
  return db("applications")
    .select("host", "username", "port")
    .count<{ appCount: number }>("applicationName as appCount")
    .max<{ lastUsed: string }>("createdAt as lastUsed")
    .whereNotNull("host")
    .whereNotNull("username")
    .groupBy("host", "username", "port")
    .orderBy("lastUsed", "desc");
}

/**
 * Get all applications for a host/username combination
 */
export async function getApplicationsByHostUser(
  host: string,
  username: string
): Promise<any[]> {
  const db = getDb();
  return db("applications")
    .select(
      "applicationName",
      "selectedRepo",
      "createdAt",
      "status",
      "domain",
      "pathname"
    )
    .where({ host, username })
    .orderBy("createdAt", "desc");
}

/**
 * Add or update a suggestion
 */
export async function addSuggestion(
  type: string,
  value: string
): Promise<void> {
  const db = getDb();
  await db("suggestions")
    .insert({ type, value, usageCount: 1, lastUsed: db.fn.now() })
    .onConflict(["type", "value"])
    .merge({
      usageCount: db.raw("usageCount + 1"),
      lastUsed: db.fn.now(),
    });
}

/**
 * Save database configuration
 */
export async function saveDatabaseConfig(
  sessionId: string,
  host: string,
  username: string,
  port: number,
  applicationName: string,
  dbType: string,
  dbName: string,
  dbUsername: string,
  dbPassword: string,
  dbPort?: number
): Promise<void> {
  const db = getDb();

  // Get the application first
  const app = await db("applications")
    .where({ host, username, applicationName })
    .first();

  if (!app) {
    throw new Error(
      `Application not found: ${applicationName} for ${username}@${host}`
    );
  }

  await db("databases")
    .insert({
      applicationId: app.id,
      host,
      username,
      port,
      applicationName,
      dbType,
      dbName,
      dbUsername,
      dbPassword,
      dbPort: dbPort || null,
      status: "created",
    })
    .onConflict(["host", "username", "applicationName", "dbName"])
    .merge();

  logger.info(`Database config saved for ${dbName}`);
}

/**
 * Get databases for a host/username/applicationName combination
 */
export async function getDatabasesByApplication(
  host: string,
  username: string,
  applicationName: string
): Promise<any[]> {
  const db = getDb();
  const app = await db("applications")
    .where({ host, username, applicationName })
    .first();

  if (!app) {
    return [];
  }

  return db("databases")
    .select(
      "dbType",
      "dbName",
      "dbUsername",
      "dbPassword",
      "dbPort",
      "createdAt",
      "status"
    )
    .where({ applicationId: app.id })
    .orderBy("createdAt", "desc");
}

/**
 * Save application setup configuration
 */
export async function saveApplicationSetup(
  sessionId: string,
  host: string,
  username: string,
  port: number,
  applicationName: string,
  domain: string,
  pathname: string
): Promise<void> {
  const db = getDb();
  await db("applications").where({ host, username, applicationName }).update({
    domain,
    pathname,
    sessionId,
    status: "setup",
  });
}

/**
 * Get application setup configuration
 */
export async function getApplicationSetup(
  host: string,
  username: string,
  applicationName: string
): Promise<any> {
  const db = getDb();
  const row = await db("applications")
    .select(
      "domain",
      "pathname",
      "folderCreated",
      "ownershipSet",
      "createdAt",
      "status"
    )
    .where({ host, username, applicationName })
    .first();
  return row || null;
}

/**
 * Update application setup folder status
 */
export async function updateApplicationSetupStatus(
  host: string,
  username: string,
  applicationName: string,
  folderCreated: number,
  ownershipSet: number
): Promise<void> {
  const db = getDb();
  await db("applications").where({ host, username, applicationName }).update({
    folderCreated,
    ownershipSet,
    status: "completed",
  });

  logger.info(`Application setup status updated for ${applicationName}`);
}

/**
 * Make a user admin on a specific host
 */
export async function makeUserAdmin(
  host: string,
  username: string,
  promotedBy?: string
): Promise<boolean> {
  const db = getDb();
  logger.info(
    `[DB] Promoting ${username}@${host} to admin (promotedBy: ${
      promotedBy || "system"
    })`
  );

  await db("admin_users")
    .insert({
      host,
      username,
      isAdmin: 1,
      promotedBy: promotedBy || null,
      promotedAt: db.fn.now(),
    })
    .onConflict(["host", "username"])
    .merge({
      isAdmin: 1,
      promotedBy: promotedBy || null,
      promotedAt: db.fn.now(),
    });

  logger.info(`[DB] User ${username}@${host} is now admin`);
  return true;
}

/**
 * Check if a user is admin on a specific host
 */
export async function isUserAdmin(
  host: string,
  username: string
): Promise<boolean> {
  const db = getDb();
  const row = await db("admin_users")
    .select("isAdmin")
    .where({ host, username, isAdmin: 1 })
    .first();
  const isAdmin = !!row;
  logger.debug(`[DB] ${username}@${host} isAdmin: ${isAdmin}`);
  return isAdmin;
}

/**
 * Get all admin users
 */
export async function getAdminUsers(): Promise<any[]> {
  const db = getDb();
  const rows = await db("admin_users")
    .select("host", "username", "promotedAt", "promotedBy")
    .where({ isAdmin: 1 })
    .orderBy("promotedAt", "desc");
  logger.info(`[DB] Found ${rows?.length || 0} admin users`);
  return rows || [];
}

/**
 * Remove admin status from a user
 */
export async function removeAdminStatus(
  host: string,
  username: string
): Promise<boolean> {
  const db = getDb();
  logger.info(`[DB] Removing admin status from ${username}@${host}`);
  await db("admin_users").where({ host, username }).update({ isAdmin: 0 });
  logger.info(`[DB] Admin status removed from ${username}@${host}`);
  return true;
}

/**
 * Close the database connection
 */
export async function closeDatabase(): Promise<void> {
  if (!knexInstance) return;
  await knexInstance.destroy();
  knexInstance = null;
  initialized = false;
  logger.debug("Database connection closed");
}
