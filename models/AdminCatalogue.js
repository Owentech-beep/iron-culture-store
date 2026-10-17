import { pool } from "../config/database.js";

// Table names come only from this fixed list, never directly from input.
const tables = {
  categories: "categories",
  brands: "brands",
};

function getTable(kind) {
  const table = Object.hasOwn(tables, kind) ? tables[kind] : null;

  if (!table) {
    const error = new Error("Unknown catalogue section.");
    error.status = 404;
    throw error;
  }

  return table;
}

export async function listCatalogueEntries(kind) {
  const table = getTable(kind);

  const { rows } = await pool.query(
    `SELECT id, name, slug
     ${kind === "brands" ? ", is_demo" : ""}
     FROM ${table}
     ORDER BY name`
  );

  return rows;
}

export async function saveCatalogueEntry(kind, id, data) {
  const table = getTable(kind);

  if (kind === "brands") {
    if (id) {
      const result = await pool.query(
        `UPDATE brands
         SET name = $1, slug = $2, is_demo = $3
         WHERE id = $4
         RETURNING id`,
        [data.name, data.slug, data.is_demo, id]
      );

      return result.rowCount;
    }

    await pool.query(
      `INSERT INTO brands (name, slug, is_demo)
       VALUES ($1, $2, $3)`,
      [data.name, data.slug, data.is_demo]
    );

    return 1;
  }

  if (id) {
    const result = await pool.query(
      `UPDATE ${table}
       SET name = $1, slug = $2
       WHERE id = $3
       RETURNING id`,
      [data.name, data.slug, id]
    );

    return result.rowCount;
  }

  await pool.query(
    `INSERT INTO ${table} (name, slug)
     VALUES ($1, $2)`,
    [data.name, data.slug]
  );

  return 1;
}