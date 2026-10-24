import "dotenv/config";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { v2 as cloudinary } from "cloudinary";

function configureStorage() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error("Cloudinary storage is not configured.");
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });
}

function invalidMedia(message) {
  const error = new Error(message);
  error.status = 400;
  error.publicMessage = message;
  return error;
}

function uploadBuffer(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      options,
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      },
    );

    stream.on("error", reject);
    stream.end(buffer);
  });
}

export async function removeHomeSlideMedia(publicId, type) {
  if (
    typeof publicId !== "string" ||
    !publicId.startsWith("iron-culture/slides/") ||
    !["image", "video"].includes(type)
  ) {
    throw new Error("Invalid slideshow asset.");
  }

  configureStorage();

  await cloudinary.uploader.destroy(publicId, {
    resource_type: type,
    invalidate: true,
  });
}

export async function uploadHomeSlideMedia(file) {
  const isVideo = file.mimetype === "video/mp4";
  const isImage = ["image/jpeg", "image/png", "image/webp"]
    .includes(file.mimetype);

  if (!isVideo && !isImage) {
    throw invalidMedia("Use a JPEG, PNG, WebP image or MP4 video.");
  }

  if (isImage && file.size > 5 * 1024 * 1024) {
    throw invalidMedia("Images must be no larger than 5 MB.");
  }

  if (file.size > 20 * 1024 * 1024) {
    throw invalidMedia("Videos must be no larger than 20 MB.");
  }

  let buffer = file.buffer;

  if (isImage) {
    try {
      const image = sharp(buffer, {
        limitInputPixels: 25000000,
        failOn: "warning",
      });

      const metadata = await image.metadata();

      if (
        !["jpeg", "png", "webp"].includes(metadata.format) ||
        (metadata.pages ?? 1) !== 1
      ) {
        throw new Error("Unsupported image.");
      }

      buffer = await image
        .rotate()
        .resize({
          width: 1600,
          height: 1200,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 85 })
        .toBuffer();
    } catch {
      throw invalidMedia(
        "Use a valid, single-frame image of up to 25 megapixels.",
      );
    }
  }

  configureStorage();

  const type = isVideo ? "video" : "image";
  const publicId = `iron-culture/slides/${randomUUID()}`;

  let result;

  try {
    result = await uploadBuffer(buffer, {
      resource_type: type,
      public_id: publicId,
      overwrite: false,
      timeout: 120000,
      ...(isVideo
        ? {
            allowed_formats: ["mp4"],
            format: "mp4",
            transformation: [
              { width: 1280, crop: "limit" },
              { video_codec: "h264", audio_codec: "aac" },
            ],
          }
        : { format: "webp" }),
    });

    if (
      !result?.secure_url ||
      result.public_id !== publicId ||
      result.resource_type !== type ||
      !(result.width > 0) ||
      !(result.height > 0)
    ) {
      throw invalidMedia("The uploaded file is not valid visual media.");
    }

    if (
      isVideo &&
      (
        !Number.isFinite(result.duration) ||
        result.duration <= 0 ||
        result.duration > 60
      )
    ) {
      throw invalidMedia("Videos must be between 1 and 60 seconds long.");
    }

    return {
      type,
      url: result.secure_url,
      publicId,
    };
  } catch (error) {
    await removeHomeSlideMedia(publicId, type).catch(() => {
      console.error("Could not clean up a failed slideshow upload.");
    });

    throw error;
  }
}