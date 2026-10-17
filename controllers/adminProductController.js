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

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function positiveId(value) {
  const raw = text(value);

  if (!/^[1-9]\d*$/.test(raw)) return null;

  const number = Number(raw);

  return Number.isSafeInteger(number) && number <= 2147483647
    ? number
    : null;
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
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
  }).format(Number(value));
}

function readProduct(body) {
  const data = {
    name: text(body.name),
    slug: text(body.slug).toLowerCase(),
    category_id: positiveId(body.category_id),
    brand_id: positiveId(body.brand_id),
    price: text(body.price),
    sale_price: text(body.sale_price),
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

  if (
    data.slug.length > 160 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.slug)
  ) {
    errors.push(
      "Use a URL slug of up to 160 lowercase letters, numbers and single hyphens."
    );
  }

  if (!data.category_id || !data.brand_id) {
    errors.push("Choose a category and a brand.");
  }

  const regularCents = priceCents(data.price);
  const saleCents = data.sale_price
    ? priceCents(data.sale_price)
    : null;

  if (regularCents === null || regularCents <= 0) {
    errors.push("Enter a price greater than zero with up to two decimals.");
  }

  if (
    data.sale_price &&
    (
      saleCents === null ||
      saleCents <= 0 ||
      regularCents === null ||
      saleCents >= regularCents
    )
  ) {
    errors.push("Sale price must be greater than zero and below the regular price.");
  }

  for (const key of [
    "short_description",
    "description",
    "ingredients",
    "allergens",
  ]) {
    if (data[key].length > 5000) {
      errors.push(`${key.replaceAll("_", " ")} must be under 5,000 characters.`);
    }
  }

  if (
    data.image_url &&
    (
      data.image_url.length > 300 ||
      !/^\/images\/[a-zA-Z0-9/_-]+\.(jpg|jpeg|png|webp|avif)$/i.test(data.image_url)
    )
  ) {
    errors.push("Use a local image path such as /images/protein-front.jpg.");
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
    is_demo: true,
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
        ["That URL slug is already used by another product."],
        400
      );
    }

    if (error.code === "23503") {
      return renderForm(
        res,
        values,
        ["The selected category or brand no longer exists."],
        400
      );
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
  const flavour = text(req.body.flavour);

  if (!product) {
    return showAdminError(res, "Product not found.", 404);
  }

  if (!flavour || flavour.length > 100) {
    return renderForm(
      res,
      product,
      ["Enter an option name of 1–100 characters."],
      400
    );
  }

  try {
    await addAdminVariant(id, flavour);
    return res.redirect(303, `/admin/products/${id}/edit`);
  } catch (error) {
    if (error.code === "23505") {
      return renderForm(
        res,
        product,
        ["This option already exists for the product."],
        400
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
      400
    );
  }

  const updated = await updateAdminStock(
    id,
    quantity,
    previousQuantity,
    threshold
  );

  if (!updated) {
    return showAdminError(
      res,
      "Stock changed since this page loaded, or the option no longer exists. Return to /admin/inventory, refresh and try again."
    );
  }

  return res.redirect(303, "/admin/inventory");
}