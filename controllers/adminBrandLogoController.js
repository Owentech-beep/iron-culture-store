import sharp from "sharp";

import { pool } from "../config/database.js";
import { uploadProductImage } from "../services/productImageStorage.js";

export async function uploadBrandLogo(req, res) {
  const rawId = req.params.id;

  if (
    !/^[1-9]\d*$/.test(rawId) ||
    Number(rawId) > 2147483647
  ) {
    return res.status(400).json({ error: "Invalid brand." });
  }

  const brandId = Number(rawId);

  const { rows: brands } = await pool.query(
    "SELECT id FROM brands WHERE id = $1",
    [brandId],
  );

  if (!brands.length) {
    return res.status(404).json({ error: "Brand not found." });
  }

  if (!req.file?.buffer) {
    return res.status(400).json({
      error: "Choose a logo to upload.",
    });
  }

  let output;

  try {
    const image = sharp(req.file.buffer, {
      limitInputPixels: 25000000,
      failOn: "warning",
    });

    const metadata = await image.metadata();

    if (
      !["jpeg", "png", "webp"].includes(metadata.format) ||
      (metadata.pages ?? 1) !== 1
    ) {
      return res.status(400).json({
        error: "Use a single-frame JPEG, PNG or WebP logo.",
      });
    }

    output = await image
      .rotate()
      .resize({
        width: 1000,
        height: 600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 90 })
      .toBuffer();
  } catch {
    return res.status(400).json({
      error: "The logo could not be processed. Maximum image size: 25 megapixels.",
    });
  }

  let uploaded;

  try {
    uploaded = await uploadProductImage(output, "brands");
  } catch {
    console.error("Cloudinary brand logo upload failed.");

    return res.status(502).json({
      error: "Image storage is unavailable. Please try again shortly.",
    });
  }

  try {
    const result = await pool.query(
      `UPDATE brands
       SET logo_url = $1,
           logo_public_id = $2
       WHERE id = $3
       RETURNING id`,
      [uploaded.imageUrl, uploaded.publicId, brandId],
    );

    if (!result.rowCount) {
      return res.status(404).json({
        error: "The brand no longer exists. Refresh the catalogue.",
      });
    }
  } catch {
    // Retain the uploaded asset: a connection error could leave the
    // database update's outcome uncertain.
    console.error("Brand logo database update could not be confirmed.");

    return res.status(500).json({
      error: "The logo update could not be confirmed. Refresh before retrying.",
    });
  }

  return res.status(200).json({
    message: "Brand logo saved.",
    imageUrl: uploaded.imageUrl,
  });
}