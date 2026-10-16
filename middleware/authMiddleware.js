import { findUserById } from "../models/User.js";

export async function loadCurrentUser(req, res, next) {
  req.user = null;
  res.locals.currentUser = null;

  const userId = req.session?.userId;

  if (!userId) {
    return next();
  }

  const user = await findUserById(userId);

  if (!user || !user.is_active) {
    delete req.session.userId;
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