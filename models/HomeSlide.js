import { pool } from "../config/database.js";

export async function listHomeSlides(publishedOnly = false) {
  const { rows } = await pool.query(
    `SELECT *
     FROM home_slides
     WHERE ($1::BOOLEAN = FALSE OR is_active = TRUE)
     ORDER BY position, id`,
    [publishedOnly],
  );

  return rows;
}

export async function createHomeSlide(media) {
  const { rows } = await pool.query(
    `INSERT INTO home_slides (
       media_type,
       media_url,
       public_id
     )
     VALUES ($1, $2, $3)
     RETURNING id`,
    [media.type, media.url, media.publicId],
  );

  return rows[0].id;
}

export async function updateHomeSlide(id, data) {
  const result = await pool.query(
    `UPDATE home_slides
     SET title = $2,
         caption = $3,
         position = $4,
         is_active = $5
     WHERE id = $1`,
    [
      id,
      data.title,
      data.caption,
      data.position,
      data.isActive,
    ],
  );

  return result.rowCount === 1;
}

export async function deleteHomeSlide(id) {
  const { rows } = await pool.query(
    `DELETE FROM home_slides
     WHERE id = $1
     RETURNING public_id, media_type`,
    [id],
  );

  return rows[0] ?? null;
}