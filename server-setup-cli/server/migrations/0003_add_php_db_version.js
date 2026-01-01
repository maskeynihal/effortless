/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  const hasPhpVersion = await knex.schema.hasColumn(
    "applications",
    "phpVersion"
  );
  const hasDbType = await knex.schema.hasColumn("applications", "dbType");

  if (!hasPhpVersion || !hasDbType) {
    await knex.schema.alterTable("applications", (table) => {
      if (!hasPhpVersion) {
        table.string("phpVersion");
      }
      if (!hasDbType) {
        table.string("dbType");
      }
    });
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  const hasPhpVersion = await knex.schema.hasColumn(
    "applications",
    "phpVersion"
  );
  const hasDbType = await knex.schema.hasColumn("applications", "dbType");

  if (hasPhpVersion || hasDbType) {
    await knex.schema.alterTable("applications", (table) => {
      if (hasPhpVersion) {
        table.dropColumn("phpVersion");
      }
      if (hasDbType) {
        table.dropColumn("dbType");
      }
    });
  }
};
