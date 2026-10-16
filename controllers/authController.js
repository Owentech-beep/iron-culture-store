import bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";

import {
  createUser,
  findUserByEmail,
} from "../models/User.js";

import {
  sessionCookieName,
  sessionCookieOptions,
} from "../config/session.js";

// Used when an email does not exist so login still performs bcrypt work.
const dummyHashPromise = bcrypt.hash(
  randomBytes(32).toString("hex"),
  12
);

function readString(value) {
  return typeof value === "string" ? value : "";
}

function renderAuth(res, mode, options = {}) {
  const isRegister = mode === "register";

  return res.status(options.status ?? 200).render("auth", {
    pageTitle: `${isRegister ? "Register" : "Login"} | Iron Culture`,
    metaDescription: "Access your Iron Culture customer account.",
    activePage: "account",
    mode,
    errors: options.errors ?? [],
    values: options.values ?? { name: "", email: "" },
  });
}

async function startUserSession(req, userId) {
  await new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) return reject(error);
      resolve();
    });
  });

  req.session.userId = userId;

  await new Promise((resolve, reject) => {
    req.session.save((error) => {
      if (error) return reject(error);
      resolve();
    });
  });
}

export function showRegister(req, res) {
  return renderAuth(res, "register");
}

export function showLogin(req, res) {
  return renderAuth(res, "login");
}

export async function register(req, res) {
  const name = readString(req.body.name).trim();
  const email = readString(req.body.email).trim().toLowerCase();
  const password = readString(req.body.password);
  const confirmation = readString(req.body.confirmPassword);

  const errors = [];

  if (name.length < 2 || name.length > 100) {
    errors.push("Enter a name between 2 and 100 characters.");
  }

  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    errors.push("Enter a valid email address.");
  }

  if (
    password.length < 15 ||
    Buffer.byteLength(password, "utf8") > 72
  ) {
    errors.push(
      "Use at least 15 characters. The password must fit within 72 UTF-8 bytes."
    );
  }

  if (password !== confirmation) {
    errors.push("Your passwords do not match.");
  }

  if (errors.length > 0) {
    return renderAuth(res, "register", {
      status: 400,
      errors,
      values: { name, email },
    });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  let user;

  try {
    user = await createUser({ name, email, passwordHash });
  } catch (error) {
    if (error.code === "23505") {
      return renderAuth(res, "register", {
        status: 400,
        errors: [
          "Unable to create an account with those details. Try logging in if you already registered.",
        ],
        values: { name, email },
      });
    }

    throw error;
  }

  await startUserSession(req, user.id);
  return res.redirect(303, "/account");
}

export async function login(req, res) {
  const email = readString(req.body.email).trim().toLowerCase();
  const password = readString(req.body.password);

  const validInput =
    email.length > 0 &&
    email.length <= 254 &&
    password.length > 0 &&
    Buffer.byteLength(password, "utf8") <= 72;

  const user = validInput
    ? await findUserByEmail(email)
    : null;

  const hash = user?.password_hash ?? await dummyHashPromise;

  const matches = await bcrypt.compare(
    validInput ? password : "",
    hash
  );

  if (!user || !matches || !user.is_active) {
    return renderAuth(res, "login", {
      status: 401,
      errors: ["Email or password is incorrect."],
      values: { name: "", email: email.slice(0, 254) },
    });
  }

  await startUserSession(req, user.id);
  return res.redirect(303, "/account");
}

export async function logout(req, res) {
  await new Promise((resolve, reject) => {
    req.session.destroy((error) => {
      if (error) return reject(error);
      resolve();
    });
  });

  res.clearCookie(sessionCookieName, sessionCookieOptions);
  return res.redirect(303, "/login");
}

export function showAccount(req, res) {
  res.render("account", {
    pageTitle: "My Account | Iron Culture",
    metaDescription: "Your Iron Culture account.",
    activePage: "account",
  });
}

export function showForgotPassword(req, res) {
  res.render("forgot-password", {
    pageTitle: "Password Recovery | Iron Culture",
    metaDescription: "Iron Culture account recovery.",
    activePage: "account",
  });
}