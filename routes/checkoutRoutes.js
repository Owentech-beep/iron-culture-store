import { Router } from "express";

import { requireAuth } from "../middleware/authMiddleware.js";
import {
  showCheckout,
  reviewCheckout,
  submitCheckout,
} from "../controllers/checkoutController.js";

const router = Router();

router.use(requireAuth);

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

router.get("/", showCheckout);
router.post("/review", reviewCheckout);
router.post("/orders", submitCheckout);

export default router;