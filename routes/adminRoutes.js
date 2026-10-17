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
} from "../controllers/adminOrderController.js";
import {
  showCustomers,
  showCustomer,
} from "../controllers/adminCustomerController.js";

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

export default router;
