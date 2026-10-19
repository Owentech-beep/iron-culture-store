import {
  isPasswordResetTokenValid,
  resetPasswordWithToken,
} from "../models/PasswordReset.js";

import {
  getPasswordResetConfig,
  requestPasswordReset,
} from "../services/passwordResetService.js";

import {
  sessionCookieName,
  sessionCookieOptions,
} from "../config/session.js";

function renderRecovery(res, options = {}) {
  return res.status(options.status ?? 200).render("password-recovery", {
    submitted: options.submitted ?? false,
  });
}

function renderReset(res, options = {}) {
  return res.status(options.status ?? 200).render("reset-password", {
    token: options.token ?? "",
    valid: options.valid ?? false,
    completed: options.completed ?? false,
    errors: options.errors ?? [],
  });
}

// Apply to every recovery route, before its handler.
export function passwordResetHeaders(req, res, next) {
  res.set("Cache-Control", "no-store");
  res.set("Referrer-Policy", "no-referrer");
  res.set("X-Robots-Tag", "noindex, nofollow");

  try {
    // getEmailConfig also restricts this to development/test mode.
    getPasswordResetConfig();
    next();
  } catch {
    res.status(503).type("text/plain").send(
      "Password recovery is temporarily unavailable.",
    );
  }
}

export function showPasswordRecovery(req, res) {
  return renderRecovery(res);
}

export async function submitPasswordRecovery(req, res) {
  const email =
    typeof req.body.email === "string"
      ? req.body.email.trim().toLowerCase()
      : "";

  const validEmail =
    email.length <= 254 &&
    /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email);

  try {
    if (validEmail) {
      await requestPasswordReset(email);
    }
  } catch {
    console.error(
      "Password reset request could not complete. Check configuration and provider logs.",
    );
  }

  // Same visible result for unknown, restricted and existing addresses.
  return renderRecovery(res, { submitted: true });
}

export async function showPasswordReset(req, res) {
  const token =
    typeof req.query.token === "string" ? req.query.token : "";

  const valid = await isPasswordResetTokenValid(token);

  return renderReset(res, {
    token: valid ? token : "",
    valid,
    status: valid ? 200 : 400,
  });
}

export async function submitPasswordReset(req, res) {
  const token =
    typeof req.body.token === "string" ? req.body.token : "";
  const password =
    typeof req.body.password === "string" ? req.body.password : "";
  const confirmation =
    typeof req.body.confirmPassword === "string"
      ? req.body.confirmPassword
      : "";

  const valid = await isPasswordResetTokenValid(token);

  if (!valid) {
    return renderReset(res, { status: 400 });
  }

  const errors = [];

  if (
    password.length < 15 ||
    Buffer.byteLength(password, "utf8") > 72
  ) {
    errors.push(
      "Use at least 15 characters, within 72 UTF-8 bytes.",
    );
  }

  if (password !== confirmation) {
    errors.push("Your passwords do not match.");
  }

  if (errors.length) {
    return renderReset(res, {
      token,
      valid: true,
      errors,
      status: 400,
    });
  }

  try {
    await resetPasswordWithToken(token, password);
  } catch (error) {
    if (error.status === 400) {
      return renderReset(res, { status: 400 });
    }

    throw error;
  }

  // Do not automatically sign in after a password reset.
  await new Promise((resolve, reject) => {
    req.session.destroy((error) => {
      if (error) return reject(error);
      resolve();
    });
  });

  res.clearCookie(sessionCookieName, sessionCookieOptions);

  return renderReset(res, { completed: true });
}