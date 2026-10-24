import sharp from "sharp";

import { pool } from "../config/database.js";
import {
  uploadProductImage,
  removeProductImage,
} from "../services/productImageStorage.js";

export function uploadMainImage(req, res) {
  return uploadImageAtPosition(req, res, 0);
}

export function uploadSecondImage(req, res) {
  return uploadImageAtPosition(req, res, 1);
}

async function uploadImageAtPosition(req, res, position) {
  if (!/^[1-9]\d*$/.test(req.params.id) || Number(req.params.id) > 2147483647) {
    return res.status(400).json({ error: "Invalid product." });
  }

  const productId = Number(req.params.id);

  const productResult = await pool.query(
    "SELECT id FROM products WHERE id = $1 AND retired_at IS NULL",
    [productId],
  );

  if (!productResult.rows[0]) {
    return res.status(404).json({ error: "Product not found." });
  }

  if (!req.file?.buffer) {
    return res.status(400).json({ error: "Choose an image to upload." });
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
        error: "Use a single-frame JPEG, PNG or WebP image.",
      });
    }

    output = await image
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 85 })
      .toBuffer();
  } catch {
    return res.status(400).json({
      error:
        "The image could not be processed. Use a valid image of up to 25 megapixels.",
    });
  }

  let uploaded;

  try {
    uploaded = await uploadProductImage(output);
  } catch (error) {
    console.error("Cloudinary product image upload failed:", {
      name: error?.name,
      message: error?.message,
      httpCode: error?.http_code,
      code: error?.code,
    });

    return res.status(502).json({
      error: "Image storage is unavailable. Please try again shortly.",
    });
  }

  try {
    await pool.query(
      `INSERT INTO product_images (product_id, image_url, position)
       VALUES ($1, $2, $3)
       ON CONFLICT (product_id, position)
       DO UPDATE SET image_url = EXCLUDED.image_url`,
      [productId, uploaded.imageUrl, position],
    );
  } catch (error) {
    // Remove the new upload if its database record could not be saved.
    await removeProductImage(uploaded.publicId).catch(() => {
      console.error("Could not clean up an unsuccessful image upload.");
    });

    throw error;
  }

  return res.status(201).json({
    message: position === 0 ? "Main image uploaded." : "Second image uploaded.",
    imageUrl: uploaded.imageUrl,
  });
}

export function removeMainImage(req, res) {
  return removeImageAtPosition(req, res, 0);
}

export function removeSecondImage(req, res) {
  return removeImageAtPosition(req, res, 1);
}

async function removeImageAtPosition(req, res, position) {
  const rawId = req.params.id;

  if (!/^[1-9]\d*$/.test(rawId) || Number(rawId) > 2147483647) {
    return res.status(400).json({ error: "Invalid product." });
  }

  const productId = Number(rawId);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const product = await client.query(
      `SELECT id
       FROM products
       WHERE id = $1 AND retired_at IS NULL
       FOR UPDATE`,
      [productId],
    );

    if (!product.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "Product not found or already retired.",
      });
    }

    await client.query(
      `DELETE FROM product_images
       WHERE product_id = $1 AND position = $2`,
      [productId, position],
    );

    await client.query("COMMIT");

    return res.json({
      message: position === 0
        ? "Main image removed."
        : "Second image removed.",
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}