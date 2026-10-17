import {
  listCatalogueEntries,
  saveCatalogueEntry,
} from "../models/AdminCatalogue.js";

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function renderProblem(res, message, status = 400) {
  return res.status(status).render("error", {
    pageTitle: "Catalogue Update Failed | Iron Culture",
    metaDescription: "The catalogue update could not be completed.",
    activePage: "",
    statusCode: status,
    message,
  });
}

function validKind(kind) {
  return ["categories", "brands"].includes(kind);
}

export async function showCatalogue(req, res) {
  const { kind } = req.params;

  if (!validKind(kind)) {
    return renderProblem(res, "This section does not exist.", 404);
  }

  const entries = await listCatalogueEntries(kind);
  const title = kind === "categories" ? "Categories" : "Brands";

  res.render("admin/catalogue", {
    pageTitle: `${title} | Iron Culture Admin`,
    metaDescription: `Manage product ${title.toLowerCase()}.`,
    adminPage: kind,
    title,
    kind,
    entries,
  });
}

export async function saveCatalogue(req, res) {
  const { kind } = req.params;

  if (!validKind(kind)) {
    return renderProblem(res, "This section does not exist.", 404);
  }

  let id = null;

  if (req.params.id) {
    if (
      !/^[1-9]\d*$/.test(req.params.id) ||
      Number(req.params.id) > 2147483647
    ) {
      return renderProblem(res, "Invalid record.");
    }

    id = Number(req.params.id);
  }

  const data = {
    name: text(req.body.name),
    slug: text(req.body.slug).toLowerCase(),
    is_demo: req.body.is_demo === "on",
  };

  if (!data.name || data.name.length > 100) {
    return renderProblem(res, "Enter a name of 1–100 characters.");
  }

  if (
    data.slug.length > 120 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.slug)
  ) {
    return renderProblem(
      res,
      "Enter a slug of up to 120 lowercase letters, numbers and single hyphens."
    );
  }

  try {
    const changed = await saveCatalogueEntry(kind, id, data);

    if (!changed) {
      return renderProblem(res, "This record no longer exists.", 404);
    }

    return res.redirect(303, `/admin/catalogue/${kind}`);
  } catch (error) {
    if (error.code === "23505") {
      return renderProblem(
        res,
        "That slug is already in use. Go back and choose another."
      );
    }

    throw error;
  }
}