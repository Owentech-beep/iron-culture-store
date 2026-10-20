import "dotenv/config";
import { v2 as cloudinary } from "cloudinary";
import { randomUUID } from "node:crypto";

function configureCloudinary() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error("Cloudinary image storage is not configured.");
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });
}

export async function uploadProductImage(buffer, imageKind = "products") {
  if (!["products", "brands"].includes(imageKind)) {
    throw new Error("Unsupported image category.");
  }

  configureCloudinary();

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: "image",
        public_id: `iron-culture/${imageKind}/${randomUUID()}`,
        overwrite: false,
        format: "webp",
        timeout: 60000,
      },
      (error, result) => {
        if (error) return reject(error);

        if (!result?.secure_url || !result?.public_id) {
          return reject(new Error("Image storage returned an invalid response."));
        }

        resolve({
          imageUrl: result.secure_url,
          publicId: result.public_id,
        });
      }
    );

    stream.on("error", reject);
    stream.end(buffer);
  });
}

export async function removeProductImage(publicId) {
  configureCloudinary();

  await cloudinary.uploader.destroy(publicId, {
    resource_type: "image",
    invalidate: true,
  });
}

export function isAllowedProductImageUrl(value) {
  if (!value) return true;
  if (value.length > 1000) return false;

  // Preserve support for images shipped with the application.
  if (
    /^\/images\/[a-zA-Z0-9/_-]+\.(jpg|jpeg|png|webp|avif)$/i.test(value)
  ) {
    return true;
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  if (!cloudName) return false;

  try {
    const url = new URL(value);

    return (
      url.protocol === "https:" &&
      url.hostname === "res.cloudinary.com" &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname.startsWith(`/${cloudName}/image/upload/`) &&
      /\.(jpg|jpeg|png|webp|avif)$/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}