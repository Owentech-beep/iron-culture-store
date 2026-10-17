import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { pool } from "../config/database.js";

const imageDirectory = fileURLToPath(
  new URL("../public/images/products/", import.meta.url)
);

export async function uploadMainImage(req, res) {
  if (
    !/^[1-9]\d*$/.test(req.params.id) ||
    Number(req.params.id) > 2147483647
  ) {
    return res.status(400).json({ error: "Invalid product." });
  }

  const productId = Number(req.params.id);

  const productResult = await pool.query(
    "SELECT id FROM products WHERE id = $1",
    [productId]
  );

  if (!productResult.rows[0]) {
    return res.status(404).json({ error: "Product not found." });
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
      error: "The image could not be processed. Use a valid image of up to 25 megapixels.",
    });
  }

  const filename = `${randomUUID()}.webp`;
  const imageUrl = `/images/products/${filename}`;
  const destination = path.join(imageDirectory, filename);

  await mkdir(imageDirectory, { recursive: true });
  await writeFile(destination, output, { flag: "wx" });

  try {
    await pool.query(
      `INSERT INTO product_images (product_id, image_url, position)
       VALUES ($1, $2, 0)
       ON CONFLICT (product_id, position)
       DO UPDATE SET image_url = EXCLUDED.image_url`,
      [productId, imageUrl]
    );
  } catch (error) {
    // Remove the new file if its database record could not be saved.
    await unlink(destination).catch(() => {});
    throw error;
  }

  return res.status(201).json({
    message: "Main image uploaded.",
    imageUrl,
  });
}