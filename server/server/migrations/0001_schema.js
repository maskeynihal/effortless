const path = require("path");

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  // Check if tables already exist before creating (makes migration idempotent)
  const hasApplications = await knex.schema.hasTable("applications");
  
  if (!hasApplications) {
    // Create the consolidated 'applications' table (renamed from application_setup, merging sessions data)
    await knex.schema.createTable("applications", (table) => {
      table.increments("id").primary();
      table.string("sessionId").unique(); // kept for backward compatibility
      table.string("host").notNullable();
      table.string("username").notNullable();
      table.integer("port").defaultTo(22);
      table.string("sshKeyName");
      table.string("githubUsername");
      table.text("sshPrivateKey");
      table.text("githubToken");
      table.string("applicationName").notNullable();
      table.string("selectedRepo");
      table.string("domain");
      table.string("pathname");
      table.integer("folderCreated").defaultTo(0);
      table.integer("ownershipSet").defaultTo(0);
      table.string("status").defaultTo("pending");
      table.integer("isAdmin").defaultTo(0);
      table.timestamp("createdAt").defaultTo(knex.fn.now());
      table.timestamp("completedAt");
      table.text("notes");
      table.unique(["host", "username", "applicationName"]);
    });
  }

  const hasApplicationSteps = await knex.schema.hasTable("application_steps");
  if (!hasApplicationSteps) {
    // Create application_steps table to track which steps are completed for each application
    await knex.schema.createTable("application_steps", (table) => {
    table.increments("id").primary();
    table.integer("applicationId").notNullable();
    table.string("step").notNullable();
    table.string("status").notNullable();
    table.text("message");
    table.timestamp("createdAt").defaultTo(knex.fn.now());
    table
      .foreign("applicationId")
      .references("id")
      .inTable("applications")
      .onDelete("CASCADE");
    table.unique(["applicationId", "step"]);
  });
  }

  const hasAdminUsers = await knex.schema.hasTable("admin_users");
  if (!hasAdminUsers) {
    // Create admin_users table
    await knex.schema.createTable("admin_users", (table) => {
      table.increments("id").primary();
      table.string("host").notNullable();
      table.string("username").notNullable();
      table.integer("isAdmin").defaultTo(1);
      table.timestamp("promotedAt").defaultTo(knex.fn.now());
      table.string("promotedBy");
      table.unique(["host", "username"]);
    });
  }

  const hasSuggestions = await knex.schema.hasTable("suggestions");
  if (!hasSuggestions) {
    // Create suggestions table
    await knex.schema.createTable("suggestions", (table) => {
      table.increments("id").primary();
      table.string("type").notNullable();
      table.string("value").notNullable();
      table.integer("usageCount").defaultTo(1);
      table.timestamp("lastUsed").defaultTo(knex.fn.now());
      table.unique(["type", "value"]);
    });
  }

  const hasDatabases = await knex.schema.hasTable("databases");
  if (!hasDatabases) {
    // Create databases table
    await knex.schema.createTable("databases", (table) => {
    table.increments("id").primary();
    table.integer("applicationId").notNullable();
    table.string("host").notNullable();
    table.string("username").notNullable();
    table.integer("port").defaultTo(22);
    table.string("applicationName").notNullable();
    table.string("dbType").notNullable();
    table.string("dbName").notNullable();
    table.string("dbUsername").notNullable();
    table.string("dbPassword").notNullable();
    table.integer("dbPort");
    table.string("status").defaultTo("created");
    table.timestamp("createdAt").defaultTo(knex.fn.now());
    table.unique(["host", "username", "applicationName", "dbName"]);
    table
      .foreign("applicationId")
      .references("id")
      .inTable("applications")
      .onDelete("CASCADE");
    });
  }

  // Create partial unique index for applications
  await knex.schema.raw(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_unique_app ON applications(host, username, applicationName)"
  );
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("databases");
  await knex.schema.dropTableIfExists("application_steps");
  await knex.schema.dropTableIfExists("suggestions");
  await knex.schema.dropTableIfExists("admin_users");
  await knex.schema.dropTableIfExists("applications");
};
