import {
  listAdminProducts,
  getProductOptions,
  getAdminProduct,
  saveAdminProduct,
  archiveAdminProduct,
  addAdminVariant,
  listAdminInventory,
  updateAdminStock,
} from "../models/AdminProduct.js";
import { isAllowedProductImageUrl } from "../services/productImageStorage.js";
import { createSlug } from "../services/slugService.js";

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function positiveId(value) {
  const raw = text(value);

  if (!/^[1-9]\d*$/.test(raw)) return null;

  const number = Number(raw);

  return Number.isSafeInteger(number) && number <= 2147483647 ? number : null;
}

function stockNumber(value) {
  const raw = text(value);

  if (!/^\d{1,7}$/.test(raw)) return null;
  return Number(raw);
}

function priceCents(value) {
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(value)) return null;

  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

function formatMoney(value) {
  if (value === null || value === undefined) {
    return "Add priced options";
  }

  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
  }).format(Number(value));
}

function readProduct(body) {
  const data = {
    name: text(body.name),
    category_id: positiveId(body.category_id),
    brand_id: positiveId(body.brand_id),
    short_description: text(body.short_description),
    description: text(body.description),
    ingredients: text(body.ingredients),
    allergens: text(body.allergens),
    image_url: text(body.image_url),
    is_active: body.is_active === "on",
    is_featured: body.is_featured === "on",
    is_demo: body.is_demo === "on",
  };

  const errors = [];

  if (data.name.length < 2 || data.name.length > 180) {
    errors.push("Product name must contain 2–180 characters.");
  }
  if (!data.category_id || !data.brand_id) {
    errors.push("Choose a category and a brand.");
  }

  for (const key of [
    "short_description",
    "description",
    "ingredients",
    "allergens",
  ]) {
    if (data[key].length > 5000) {
      errors.push(
        `${key.replaceAll("_", " ")} must be under 5,000 characters.`,
      );
    }
  }

  if (
    data.image_url &&
    (data.image_url.length > 300 ||
      !/^\/images\/[a-zA-Z0-9/_-]+\.(jpg|jpeg|png|webp|avif)$/i.test(
        data.image_url,
      ))
  ) {
    if (!isAllowedProductImageUrl(data.image_url)) {
      errors.push(
        "Use a local /images/ path or an image uploaded to this store's Cloudinary account.",
      );
    }
  }

  return { data, errors };
}

async function renderForm(res, values, errors = [], status = 200) {
  const options = await getProductOptions();

  res.status(status).render("admin/product-form", {
    pageTitle: `${values.id ? "Edit" : "Add"} Product | Iron Culture`,
    metaDescription: "Manage an Iron Culture product.",
    adminPage: "products",
    values,
    errors,
    ...options,
  });
}

function showAdminError(res, message, status = 409) {
  return res.status(status).render("error", {
    pageTitle: "Update Failed | Iron Culture",
    metaDescription: "The requested update could not be completed.",
    activePage: "",
    statusCode: status,
    message,
  });
}

export async function showProducts(req, res) {
  const search = text(req.query.q).slice(0, 100);
  const requestedPage = positiveId(req.query.page) ?? 1;

  const result = await listAdminProducts(search, requestedPage);

  res.render("admin/products", {
    pageTitle: "Products | Iron Culture Admin",
    metaDescription: "Manage store products.",
    adminPage: "products",
    search,
    ...result,
    formatMoney,
  });
}

export async function showNewProduct(req, res) {
  return renderForm(res, {
    is_active: false,
    is_featured: false,
    is_demo: false,
    variants: [],
  });
}

export async function showEditProduct(req, res) {
  const id = positiveId(req.params.id);
  const product = id ? await getAdminProduct(id) : null;

  if (!product) {
    return showAdminError(res, "Product not found.", 404);
  }

  return renderForm(res, product);
}

export async function saveProduct(req, res) {
  const id = req.params.id ? positiveId(req.params.id) : null;

  if (req.params.id && !id) {
    return showAdminError(res, "Invalid product.", 400);
  }

  const existing = id ? await getAdminProduct(id) : null;

  if (id && !existing) {
    return showAdminError(res, "Product not found.", 404);
  }

  const { data, errors } = readProduct(req.body);
  // Names may change; established product URLs stay the same.
  data.slug = existing?.slug ?? createSlug(data.name, 160);

  const values = {
    ...data,
    id,
    variants: existing?.variants ?? [],
  };

  if (errors.length) {
    return renderForm(res, values, errors, 400);
  }

  try {
    const productId = await saveAdminProduct(id, data);
    return res.redirect(303, `/admin/products/${productId}/edit`);
  } catch (error) {
    if (error.code === "23505") {
      return renderForm(
        res,
        values,
        [
          "A product with these details already exists. Refresh and check the product list.",
        ],
        400,
      );
    }

    if (error.code === "23503") {
      return renderForm(
        res,
        values,
        ["The selected category or brand no longer exists."],
        400,
      );
    }

    if (error.status === 409 && error.publicMessage) {
      return renderForm(res, values, [error.publicMessage], 409);
    }

    throw error;
  }
}

export async function archiveProduct(req, res) {
  const id = positiveId(req.params.id);

  if (!id) {
    return showAdminError(res, "Invalid product.", 400);
  }

  await archiveAdminProduct(id);
  return res.redirect(303, "/admin/products");
}

export async function addVariant(req, res) {
  const id = positiveId(req.params.id);
  const product = id ? await getAdminProduct(id) : null;

  if (!product) {
    return showAdminError(res, "Product not found.", 404);
  }

  const size = text(req.body.size).replace(/\s+/g, " ");
  const flavour = text(req.body.flavour).replace(/\s+/g, " ") || "Unflavoured";
  const price = text(req.body.price);
  const salePrice = text(req.body.sale_price);

  const errors = [];
  const regularCents = priceCents(price);
  const saleCents = salePrice ? priceCents(salePrice) : null;

  if (!size || size.length > 80) {
    errors.push(
      "Enter a size of up to 80 characters, such as 1 kg or 60 capsules.",
    );
  }

  if (flavour.length > 100) {
    errors.push("Flavour must contain no more than 100 characters.");
  }

  if (regularCents === null || regularCents <= 0) {
    errors.push("Enter an option price greater than zero.");
  }

  if (
    salePrice &&
    (saleCents === null ||
      saleCents <= 0 ||
      regularCents === null ||
      saleCents >= regularCents)
  ) {
    errors.push(
      "The option sale price must be greater than zero and below its regular price.",
    );
  }

  if (errors.length) {
    return renderForm(res, product, errors, 400);
  }

  try {
    await addAdminVariant(id, {
      size,
      flavour,
      price,
      salePrice,
    });

    return res.redirect(303, `/admin/products/${id}/edit`);
  } catch (error) {
    if (error.code === "23505") {
      return renderForm(
        res,
        product,
        ["This size and flavour combination already exists."],
        400,
      );
    }

    throw error;
  }
}

export async function showInventory(req, res) {
  const search = text(req.query.q).slice(0, 100);
  const items = await listAdminInventory(search);

  res.render("admin/inventory", {
    pageTitle: "Inventory | Iron Culture Admin",
    metaDescription: "Manage stock by product option.",
    adminPage: "inventory",
    search,
    items,
  });
}

export async function saveStock(req, res) {
  const id = positiveId(req.params.id);
  const quantity = stockNumber(req.body.quantity);
  const previousQuantity = stockNumber(req.body.previousQuantity);
  const threshold = stockNumber(req.body.threshold);

  if (
    !id ||
    quantity === null ||
    previousQuantity === null ||
    threshold === null
  ) {
    return showAdminError(
      res,
      "Enter whole numbers from 0 to 9,999,999 for stock and threshold.",
      400,
    );
  }

  const updated = await updateAdminStock(
    id,
    quantity,
    previousQuantity,
    threshold,
  );

  if (!updated) {
    return showAdminError(
      res,
      "Stock could not be saved. The quantity may have changed, the option may no longer exist, or the new physical quantity is below reserved stock. Return to /admin/inventory, refresh and try again.",
      409,
    );
  }

  return res.redirect(303, "/admin/inventory");
}
