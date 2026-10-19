import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import {
  showRegister,
  showLogin,
  register,
  login,
  logout,
  showAccount,
} from "../controllers/authController.js";
import {
  requireAuth,
  requireGuest,
} from "../middleware/authMiddleware.js";
import {
  passwordResetHeaders,
  showPasswordRecovery,
  submitPasswordRecovery,
  showPasswordReset,
  submitPasswordReset,
} from "../controllers/passwordResetController.js";
const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler(req, res) {
    res.status(429).render("error", {
      pageTitle: "Please Wait | Iron Culture",
      metaDescription: "Too many authentication attempts.",
      activePage: "account",
      statusCode: 429,
      message: "Too many attempts. Please try again in 15 minutes.",
    });
  },
});

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

router.get("/register", requireGuest, showRegister);
router.post("/register", authLimiter, requireGuest, register);

router.get("/login", requireGuest, showLogin);
router.post("/login", authLimiter, requireGuest, login);

router.post("/logout", logout);

router.get("/account", requireAuth, showAccount);
router.get(
  "/forgot-password",
  passwordResetHeaders,
  showPasswordRecovery,
);

router.post(
  "/forgot-password",
  passwordResetHeaders,
  authLimiter,
  submitPasswordRecovery,
);

router.get(
  "/reset-password",
  passwordResetHeaders,
  authLimiter,
  showPasswordReset,
);

router.post(
  "/reset-password",
  passwordResetHeaders,
  authLimiter,
  submitPasswordReset,
);

export default router;