import { Router } from "express";
import { requireAuth, requireAdmin } from "../middleware/authMiddleware.js";
import { showDashboard } from "../controllers/adminController.js";
import {
  showProducts,
  showNewProduct,
  showEditProduct,
  saveProduct,
  archiveProduct,
  addVariant,
  showInventory,
  saveStock,
} from "../controllers/adminProductController.js";
import {
  showCatalogue,
  saveCatalogue,
} from "../controllers/adminCatalogueController.js";
import { receiveProductImage } from "../middleware/imageUploadMiddleware.js";
import { uploadMainImage } from "../controllers/adminImageController.js";
import {
  showAdminOrders,
  showAdminOrder,
  submitDeliveryQuote,
  submitOrderStatus,
  submitSandboxRecovery,
  submitReconciliationResolution,
} from "../controllers/adminOrderController.js";
import {
  showCustomers,
  showCustomer,
} from "../controllers/adminCustomerController.js";
import { receiveBrandLogo } from "../middleware/brandLogoUploadMiddleware.js";
import { uploadBrandLogo } from "../controllers/adminBrandLogoController.js";
import {
  deleteCatalogueRecord,
} from "../controllers/adminDeletionController.js";
import {
  uploadNutritionImage,
  removeNutritionImage,
} from "../controllers/adminNutritionController.js";

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  res.set("X-Robots-Tag", "noindex, nofollow");
  next();
});

router.get("/", showDashboard);
router.get("/products", showProducts);
router.get("/products/new", showNewProduct);
router.post("/products", saveProduct);

router.get("/products/:id/edit", showEditProduct);
router.post("/products/:id", saveProduct);
router.post("/products/:id/archive", archiveProduct);
router.post("/products/:id/variants", addVariant);

router.get("/inventory", showInventory);
router.post("/inventory/:id", saveStock);
router.get("/catalogue/:kind", showCatalogue);
router.post("/catalogue/:kind", saveCatalogue);
router.post("/catalogue/:kind/:id", saveCatalogue);

router.post("/products/:id/image", receiveProductImage, uploadMainImage);
router.get("/orders", showAdminOrders);
router.get("/orders/:id", showAdminOrder);
router.get("/customers", showCustomers);
router.get("/customers/:id", showCustomer);
router.post("/orders/:id/delivery-quote", submitDeliveryQuote);
router.post("/orders/:id/status", submitOrderStatus);
router.post(
  "/orders/:id/payments/:paymentId/close-sandbox",
  submitSandboxRecovery
);
router.post(
  "/orders/:id/reconciliation/:alertId/resolve",
  submitReconciliationResolution
);
router.post(
  "/catalogue/brands/:id/logo",
  receiveBrandLogo,
  uploadBrandLogo,
);
router.post("/cleanup/:kind/:id", deleteCatalogueRecord);
router.post(
  "/products/:id/nutrition-image",
  receiveProductImage,
  uploadNutritionImage,
);

router.post(
  "/products/:id/nutrition-image/remove",
  removeNutritionImage,
);

export default router;
