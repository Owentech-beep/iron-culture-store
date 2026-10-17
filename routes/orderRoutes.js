import { Router } from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import {
  showOrders,
  showOrder,
  acceptQuote,
} from "../controllers/orderController.js";

const router = Router();

router.use(requireAuth);

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

router.get("/", showOrders);
router.get("/:id", showOrder);
router.post("/:id/accept-delivery-quote", acceptQuote);

export default router;