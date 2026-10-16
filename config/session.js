import "dotenv/config";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";

import { pool } from "./database.js";

const PgStore = connectPgSimple(session);
const isProduction = process.env.NODE_ENV === "production";

const secret = process.env.SESSION_SECRET;

if (!secret || secret.length < 64) {
  throw new Error(
    "Set SESSION_SECRET in .env using the random-secret command."
  );
}

export const sessionCookieName = "iron.sid";

export const sessionCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: "lax",
  path: "/",
};

export const sessionMiddleware = session({
  name: sessionCookieName,
  secret,

  store: new PgStore({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: false,
  }),

  resave: false,
  saveUninitialized: false,

  cookie: {
    ...sessionCookieOptions,
    maxAge: 1000 * 60 * 60 * 24,
  },
});