import { findUserById } from "../models/User.js";

export async function loadCurrentUser(req, res, next) {
  req.user = null;
  res.locals.currentUser = null;

  const userId = req.session?.userId;

  if (!userId) {
    return next();
  }

  const user = await findUserById(userId);

  const validSession =
    user &&
    user.is_active &&
    Number.isInteger(req.session.authVersion) &&
    req.session.authVersion === user.auth_version;

  if (!validSession) {
    // Replace the obsolete session, including its CSRF token.
    await new Promise((resolve, reject) => {
      req.session.regenerate((error) => {
        if (error) return reject(error);
        resolve();
      });
    });

    return next();
  }

  req.user = user;
  res.locals.currentUser = user;

  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.redirect("/login");
  }

  next();
}

export function requireGuest(req, res, next) {
  if (req.user) {
    return res.redirect("/account");
  }

  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.redirect("/login");
  }

  if (req.user.role !== "admin") {
    const error = new Error("Admin access required.");
    error.status = 403;
    return next(error);
  }

  next();
}