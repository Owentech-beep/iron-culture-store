import { Router } from "express";
import { pool } from "../config/database.js";

const router = Router();
const siteOrigin = "https://ironculturesubs.co.za";

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&apos;",
  })[character]);
}

router.get("/robots.txt", (req, res) => {
  res.type("text/plain").send([
    "User-agent: *",
    "Allow: /",
    "",
    `Sitemap: ${siteOrigin}/sitemap.xml`,
    "",
  ].join("\n"));
});

router.get("/sitemap.xml", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT cp.slug
       FROM catalogue_products cp
       JOIN products p ON p.id = cp.id
       WHERE cp.is_active
         AND NOT cp.is_demo
         AND p.retired_at IS NULL
         AND cp.effective_price IS NOT NULL
       ORDER BY cp.id`,
    );

    const urls = [
      `${siteOrigin}/`,
      `${siteOrigin}/shop`,
      ...rows.map(
        (product) =>
          `${siteOrigin}/product/${encodeURIComponent(product.slug)}`,
      ),
    ];

    const entries = urls
      .map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`)
      .join("\n");

    res
      .set("Cache-Control", "public, max-age=300")
      .type("application/xml")
      .send(
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        entries +
        "\n</urlset>\n",
      );
  } catch (error) {
    console.error("Sitemap generation failed:", {
      name: error.name,
      code: error.code,
    });

    res
      .status(503)
      .set("Cache-Control", "no-store")
      .type("text/plain")
      .send("Sitemap temporarily unavailable.");
  }
});

export default router;