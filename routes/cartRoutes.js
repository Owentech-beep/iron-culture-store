import { Router } from "express";
import { requireAuth } from "../middleware/authMiddleware.js";

import {
  showCart,
  addItem,
  updateItem,
  removeItem,
} from "../controllers/cartController.js";

const router = Router();

router.use(requireAuth);

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

router.get("/", showCart);
router.post("/items", addItem);
router.post("/items/:id/update", updateItem);
router.post("/items/:id/remove", removeItem);

export default router;