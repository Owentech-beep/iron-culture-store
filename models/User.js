import { pool } from "../config/database.js";

export async function findUserByEmail(email) {
  const { rows } = await pool.query(
    `SELECT id, name, email, password_hash, role, is_active
     FROM users
     WHERE email = $1`,
    [email]
  );

  return rows[0] ?? null;
}

export async function findUserById(id) {
  const { rows } = await pool.query(
    `SELECT id, name, email, role, is_active, created_at
     FROM users
     WHERE id = $1`,
    [id]
  );

  return rows[0] ?? null;
}

export async function createUser({ name, email, passwordHash }) {
  const { rows } = await pool.query(
    `INSERT INTO users (name, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, name, email, role`,
    [name, email, passwordHash]
  );

  return rows[0];
}