import { randomBytes, timingSafeEqual } from "node:crypto";

export function csrfProtection(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = randomBytes(32).toString("hex");
  }

  res.locals.csrfToken = req.session.csrfToken;

  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  const submitted =
    req.body?._csrf ?? req.get("x-csrf-token");

  const expected = req.session.csrfToken;

  if (
    typeof submitted !== "string" ||
    submitted.length !== expected.length
  ) {
    return rejectRequest(next);
  }

  const submittedBuffer = Buffer.from(submitted);
  const expectedBuffer = Buffer.from(expected);

  if (
    submittedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(submittedBuffer, expectedBuffer)
  ) {
    return rejectRequest(next);
  }

  next();
}

function rejectRequest(next) {
  const error = new Error("Invalid form security token.");
  error.status = 403;
  next(error);
}