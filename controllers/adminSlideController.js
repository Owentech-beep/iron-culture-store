import {
  listHomeSlides,
  createHomeSlide,
  updateHomeSlide,
  deleteHomeSlide,
} from "../models/HomeSlide.js";

import {
  uploadHomeSlideMedia,
  removeHomeSlideMedia,
} from "../services/homeSlideStorage.js";

function validId(value) {
  return (
    typeof value === "string" &&
    /^[1-9]\d*$/.test(value) &&
    Number(value) <= 2147483647
  );
}

function renderProblem(res, message, status = 400) {
  return res.status(status).render("error", {
    pageTitle: "Slideshow Update Failed | Iron Culture",
    metaDescription: "The slideshow update could not be completed.",
    activePage: "",
    statusCode: status,
    message,
  });
}

export async function showSlides(req, res) {
  const slides = await listHomeSlides();

  res.render("admin/slides", {
    pageTitle: "Homepage Slides | Iron Culture Admin",
    metaDescription: "Manage homepage images and videos.",
    adminPage: "slides",
    slides,
  });
}

export async function uploadSlide(req, res) {
  let media;

  try {
    media = await uploadHomeSlideMedia(req.file);
  } catch (error) {
    console.error("Slideshow upload failed:", {
      name: error.name,
      message: error.message,
    });

    return res.status(error.status === 400 ? 400 : 502).json({
      error:
        error.publicMessage ||
        "The upload could not be completed. Check the file and try again.",
    });
  }

  try {
    await createHomeSlide(media);
  } catch (error) {
    await removeHomeSlideMedia(media.publicId, media.type).catch(() => {
      console.error("Could not clean up an unsaved slideshow asset.");
    });

    throw error;
  }

  return res.status(201).json({
    message: "Slide uploaded. Add its details and publish it below.",
  });
}

export async function saveSlide(req, res) {
  if (!validId(req.params.id)) {
    return renderProblem(res, "Invalid slide.");
  }

  const title =
    typeof req.body.title === "string" ? req.body.title.trim() : "";

  const caption =
    typeof req.body.caption === "string" ? req.body.caption.trim() : "";

  const rawPosition = req.body.position;

  if (!title || title.length > 120 || caption.length > 500) {
    return renderProblem(
      res,
      "Enter a title of 1–120 characters and a caption of up to 500 characters.",
    );
  }

  if (
    typeof rawPosition !== "string" ||
    !/^\d{1,4}$/.test(rawPosition)
  ) {
    return renderProblem(res, "Enter a display order from 0 to 9999.");
  }

  const changed = await updateHomeSlide(Number(req.params.id), {
    title,
    caption,
    position: Number(rawPosition),
    isActive: req.body.is_active === "on",
  });

  if (!changed) {
    return renderProblem(res, "This slide no longer exists.", 404);
  }

  return res.redirect(303, "/admin/slides");
}

export async function removeSlide(req, res) {
  if (!validId(req.params.id)) {
    return renderProblem(res, "Invalid slide.");
  }

  if (req.body.confirmation !== "DELETE") {
    return renderProblem(res, "Type DELETE to remove this slide.");
  }

  const slide = await deleteHomeSlide(Number(req.params.id));

  if (!slide) {
    return renderProblem(res, "This slide no longer exists.", 404);
  }

  // The slide is already removed from the website.
  // Storage cleanup failure must not restore it.
  await removeHomeSlideMedia(
    slide.public_id,
    slide.media_type,
  ).catch((error) => {
    console.error("Removed slide needs Cloudinary cleanup:", {
      publicId: slide.public_id,
      message: error.message,
    });
  });

  return res.redirect(303, "/admin/slides");
}