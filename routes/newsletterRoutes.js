import { Router } from "express";
import { rateLimit } from "express-rate-limit";

import {
  newsletterHeaders,
  subscribeNewsletter,
  showNewsletterConfirmation,
  confirmNewsletter,
  showNewsletterUnsubscribe,
  submitNewsletterUnsubscribe,
} from "../controllers/newsletterController.js";

const router = Router();

router.use(newsletterHeaders);

const subscribeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: "Too many newsletter requests. Try again in 15 minutes.",
});

router.post("/subscribe", subscribeLimiter, subscribeNewsletter);

router.get("/confirm", showNewsletterConfirmation);
router.post("/confirm", confirmNewsletter);

router.get("/unsubscribe", showNewsletterUnsubscribe);
router.post("/unsubscribe", submitNewsletterUnsubscribe);

export default router;