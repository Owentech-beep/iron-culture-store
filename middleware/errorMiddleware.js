export function notFound(req, res, next) {
  res.status(404).render("error", {
    pageTitle: "Page Not Found | Iron Culture Supplements",
    metaDescription: "The requested page could not be found.",
    activePage: "",
    statusCode: 404,
    message: "The page you are looking for does not exist.",
  });
}

export function errorHandler(error, req, res, next) {
  console.error("Request failed:", {
    method: req.method,
    name: error.name,
    status: error.status ?? error.statusCode ?? 500,
    code:
      typeof error.code === "string" && /^[A-Z0-9_]{1,60}$/.test(error.code)
        ? error.code
        : undefined,
  });

  // Detailed diagnostics remain available during local development.
  if (process.env.NODE_ENV === "development") {
    console.error(error);
  }

  if (res.headersSent) {
    return next(error);
  }

  const requestedStatus = error.status ?? error.statusCode;

  const statusCode =
    Number.isInteger(requestedStatus) &&
    requestedStatus >= 400 &&
    requestedStatus <= 599
      ? requestedStatus
      : 500;

  res.status(statusCode).render("error", {
    pageTitle: "Something Went Wrong | Iron Culture Supplements",
    metaDescription: "We could not complete your request.",
    activePage: "",
    statusCode,
    message:
      statusCode >= 500
        ? "Something went wrong. Please try again later."
        : "We could not complete this request. Check your input and try again.",
  });
}
