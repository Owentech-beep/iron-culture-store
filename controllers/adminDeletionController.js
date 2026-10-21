import { deleteAdminEntry } from "../models/AdminDeletion.js";

function renderProblem(res, message, status) {
  return res.status(status).render("error", {
    pageTitle: "Deletion Not Completed | Iron Culture",
    metaDescription: "The catalogue record could not be deleted.",
    activePage: "",
    statusCode: status,
    message,
  });
}

export async function deleteCatalogueRecord(req, res) {
  const { kind, id: rawId } = req.params;

  if (!["products", "brands", "categories"].includes(kind)) {
    return renderProblem(res, "Unknown catalogue section.", 404);
  }

  if (
    !/^[1-9]\d*$/.test(rawId) ||
    Number(rawId) > 2147483647
  ) {
    return renderProblem(res, "Invalid record.", 400);
  }

  if (req.body.confirmation !== "DELETE") {
    return renderProblem(
      res,
      "Type DELETE exactly to confirm permanent deletion.",
      400,
    );
  }

  const expectedSlug = req.body.expectedSlug;

  if (
    typeof expectedSlug !== "string" ||
    !expectedSlug ||
    expectedSlug.length > 160
  ) {
    return renderProblem(
      res,
      "Refresh the page before attempting deletion.",
      400,
    );
  }

  try {
    await deleteAdminEntry(kind, Number(rawId), expectedSlug);
  } catch (error) {
    if (error.publicMessage) {
      return renderProblem(res, error.publicMessage, error.status);
    }

    throw error;
  }

  return res.redirect(
    303,
    kind === "products"
      ? "/admin/products"
      : `/admin/catalogue/${kind}`,
  );
}