import { Router } from "express";

import { requireAuth } from "../middleware/authMiddleware.js";
import { showPayment } from "../controllers/paymentController.js";

const router = Router();

router.use(requireAuth);

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

router.get("/:id/payment", showPayment);

export default router;