/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn(
    "applications",
    "privateKeySecretName"
  );
  if (!hasColumn) {
    await knex.schema.alterTable("applications", (table) => {
      table.string("privateKeySecretName");
    });
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  const hasColumn = await knex.schema.hasColumn(
    "applications",
    "privateKeySecretName"
  );
  if (hasColumn) {
    await knex.schema.alterTable("applications", (table) => {
      table.dropColumn("privateKeySecretName");
    });
  }
};
