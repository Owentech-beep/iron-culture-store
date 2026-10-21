import { pool } from "../config/database.js";
import { createSlug } from "../services/slugService.js";

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
     ${kind === "brands" ? ", is_demo, logo_url" : ""}
     FROM ${table}
     ORDER BY name`
  );

  return rows;
}

export async function saveCatalogueEntry(kind, id, data) {
  const table = getTable(kind);

  if (id) {
    // Preserve the existing slug when renaming an entry.
    const result = kind === "brands"
      ? await pool.query(
          `UPDATE brands
           SET name = $1, is_demo = $2
           WHERE id = $3
           RETURNING id`,
          [data.name, data.is_demo, id],
        )
      : await pool.query(
          `UPDATE ${table}
           SET name = $1
           WHERE id = $2
           RETURNING id`,
          [data.name, id],
        );

    return result.rowCount;
  }

  const slug = createSlug(data.name, 120);

  const result = kind === "brands"
    ? await pool.query(
        `INSERT INTO brands (name, slug, is_demo)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [data.name, slug, data.is_demo],
      )
    : await pool.query(
        `INSERT INTO ${table} (name, slug)
         VALUES ($1, $2)
         RETURNING id`,
        [data.name, slug],
      );

  return result.rowCount;
}