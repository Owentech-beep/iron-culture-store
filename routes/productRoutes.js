import { Router } from "express";
import { getShop } from "../controllers/productController.js";

const router = Router();

router.get("/", getShop);
router.get("/:category", getShop);

export default router;