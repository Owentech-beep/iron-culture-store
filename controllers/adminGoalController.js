import {
  getAdminGoals,
  saveAdminGoal,
} from "../models/AdminGoal.js";

function problem(res, message, status = 400) {
  return res.status(status).render("error", {
    pageTitle: "Goal Update Failed | Iron Culture",
    metaDescription: "The goal collection could not be updated.",
    activePage: "",
    statusCode: status,
    message,
  });
}

export async function showGoals(req, res) {
  const data = await getAdminGoals();

  return res.render("admin/goals", {
    pageTitle: "Goal Collections | Iron Culture Admin",
    metaDescription: "Manage goal-based product collections.",
    adminPage: "goals",
    saved: req.query.saved === "1",
    ...data,
  });
}

export async function saveGoal(req, res) {
  const slug = req.params.slug;

  if (!/^[a-z]+(?:-[a-z]+)*$/.test(slug) || slug.length > 40) {
    return problem(res, "Invalid goal.");
  }

  const productIds = [];

  for (let index = 1; index <= 4; index += 1) {
    const value = req.body[`product${index}`];

    if (typeof value !== "string") {
      return problem(res, "Refresh the page and submit all four product fields.");
    }

    const raw = value.trim();
    if (!raw) continue;

    if (!/^[1-9]\d*$/.test(raw) || Number(raw) > 2147483647) {
      return problem(res, "Choose valid products.");
    }

    productIds.push(Number(raw));
  }

  if (new Set(productIds).size !== productIds.length) {
    return problem(res, "Choose each product only once per goal.");
  }

  const published = req.body.is_active === "on";

  if (published && productIds.length < 2) {
    return problem(res, "Select at least two products before publishing a collection.");
  }

  try {
    await saveAdminGoal(slug, productIds, published);
  } catch (error) {
    if (error.publicMessage) {
      return problem(res, error.publicMessage, error.status);
    }

    throw error;
  }

  return res.redirect(303, "/admin/goals?saved=1");
}