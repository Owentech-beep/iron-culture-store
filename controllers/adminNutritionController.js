import sharp from "sharp";
import { pool } from "../config/database.js";
import {
  uploadProductImage,
} from "../services/productImageStorage.js";

function readId(value) {
  if (!/^[1-9]\d*$/.test(value ?? "")) return null;

  const id = Number(value);

  return Number.isSafeInteger(id) && id <= 2147483647
    ? id
    : null;
}

export async function uploadNutritionImage(req, res) {
  const productId = readId(req.params.id);

  if (!productId) {
    return res.status(400).json({ error: "Invalid product." });
  }

  const product = await pool.query(
    "SELECT id FROM products WHERE id = $1",
    [productId],
  );

  if (!product.rowCount) {
    return res.status(404).json({ error: "Product not found." });
  }

  if (!req.file?.buffer) {
    return res.status(400).json({ error: "Choose a nutrition label." });
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

    // Preserve label text and proportions; never crop the label.
    output = await image
      .rotate()
      .resize({
        width: 2400,
        height: 2400,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ lossless: true })
      .toBuffer();
  } catch {
    return res.status(400).json({
      error: "Use a valid label image of up to 25 megapixels.",
    });
  }

  let uploaded;

  try {
    uploaded = await uploadProductImage(output, "nutrition");
  } catch {
    return res.status(502).json({
      error: "Image storage is unavailable. Please try again.",
    });
  }

  try {
    const result = await pool.query(
      `UPDATE products
       SET nutrition_image_url = $1,
           nutrition_image_public_id = $2
       WHERE id = $3
       RETURNING id`,
      [uploaded.imageUrl, uploaded.publicId, productId],
    );

    if (!result.rowCount) {
      return res.status(404).json({
        error: "The product was removed before the label could be saved.",
      });
    }
  } catch {
    // Retain the uploaded asset if the database outcome is uncertain.
    // Deleting it here could break a successfully committed update.
    console.error("Nutrition label database save could not be confirmed.");

    return res.status(503).json({
      error:
        "Saving could not be confirmed. Refresh the product before retrying.",
    });
  }

  return res.status(201).json({
    message: "Nutrition label uploaded.",
    imageUrl: uploaded.imageUrl,
  });
}

export async function removeNutritionImage(req, res) {
  const productId = readId(req.params.id);

  if (!productId) {
    return res.status(400).json({ error: "Invalid product." });
  }

  const result = await pool.query(
    `UPDATE products
     SET nutrition_image_url = NULL,
         nutrition_image_public_id = NULL
     WHERE id = $1
     RETURNING id`,
    [productId],
  );

  if (!result.rowCount) {
    return res.status(404).json({ error: "Product not found." });
  }

  // Detach from the product. Retain the Cloudinary asset for now.
  return res.json({ message: "Nutrition label removed." });
}