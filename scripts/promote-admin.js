import "dotenv/config";
import { pool } from "../config/database.js";

const email = process.argv[2]?.trim().toLowerCase();

async function promoteAdmin() {
  try {
    if (!email) {
      console.error(
        "Usage: node scripts/promote-admin.js your-email@example.com"
      );
      process.exitCode = 1;
      return;
    }

    const result = await pool.query(
      `UPDATE users
       SET role = 'admin'
       WHERE email = $1 AND is_active = TRUE
       RETURNING id, name, email, role`,
      [email]
    );

    if (result.rows.length === 0) {
      console.error(
        "No active account found. Register the account first."
      );
      process.exitCode = 1;
      return;
    }

    console.log("Admin access granted:");
    console.table(result.rows);
  } catch (error) {
    console.error("Could not update account:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

promoteAdmin();