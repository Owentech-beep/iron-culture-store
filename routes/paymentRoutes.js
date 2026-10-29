import { Router } from "express";

import { requireAuth } from "../middleware/authMiddleware.js";
import {
  showPayment,
  submitPayment,
  submitSandboxPayment,
  submitOzowPayment,
} from "../controllers/paymentController.js";

const router = Router();

router.use(requireAuth);

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

router.get("/:id/payment", showPayment);
router.post("/:id/payment/payfast", submitPayment);
router.post("/:id/payment/ozow", submitOzowPayment);

// Existing sandbox forms remain restricted to sandbox mode.
router.post("/:id/payment/sandbox", submitSandboxPayment);

export default router;