import {
  findProducts,
  getCategories,
  getBrands,
  findProductBySlug,
  findRelatedProducts,
} from "../models/Product.js";
import { isAllowedProductImageUrl } from "../services/productImageStorage.js";

function readText(value, maxLength = 100) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function readPrice(value) {
  const text = readText(value, 20);

  if (!text) return null;

  if (!/^\d{1,7}(\.\d{1,2})?$/.test(text)) {
    const error = new Error("Invalid price filter.");
    error.status = 400;
    throw error;
  }

  return Number(text);
}

export async function getShop(req, res) {
  const categories = await getCategories();
  const brands = await getBrands();

  const category = readText(req.params.category ?? req.query.category);

  const selectedCategory = categories.find((item) => item.slug === category);

  if (category && !selectedCategory) {
    return res.status(404).render("error", {
      pageTitle: "Category Not Found | Iron Culture",
      metaDescription: "This product category could not be found.",
      activePage: "shop",
      statusCode: 404,
      message: "This product category does not exist.",
    });
  }

  const allowedSorts = [
    "newest",
    "price_asc",
    "price_desc",
    "rating",
    "popularity",
  ];

  const requestedSort = readText(req.query.sort);
  const requestedRating = Number(readText(req.query.rating));
  const requestedPage = Number(readText(req.query.page));

  const filters = {
    q: readText(req.query.q),
    category,
    brand: readText(req.query.brand),
    minPrice: readPrice(req.query.minPrice),
    maxPrice: readPrice(req.query.maxPrice),
    rating: [1, 2, 3, 4, 5].includes(requestedRating) ? requestedRating : 0,
    inStock: req.query.inStock === "1",
    sort: allowedSorts.includes(requestedSort) ? requestedSort : "newest",
    page:
      Number.isSafeInteger(requestedPage) && requestedPage > 0
        ? Math.min(requestedPage, 10000)
        : 1,
  };

  if (
    filters.minPrice !== null &&
    filters.maxPrice !== null &&
    filters.minPrice > filters.maxPrice
  ) {
    const error = new Error("Minimum price exceeds maximum price.");
    error.status = 400;
    throw error;
  }

  const result = await findProducts(filters);

  function pageUrl(page) {
    const query = new URLSearchParams();

    for (const [key, value] of Object.entries(filters)) {
      if (key === "page") continue;

      if (value !== null && value !== "" && value !== false) {
        query.set(key, value === true ? "1" : String(value));
      }
    }

    query.set("page", String(page));
    return `/shop?${query.toString()}`;
  }

  const formatMoney = (amount) =>
    new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency: "ZAR",
    }).format(amount);

  res.render("shop", {
    pageTitle: `${selectedCategory?.name ?? "Shop"} | Iron Culture`,
    metaDescription:
      "Browse the Iron Culture supplement catalogue by category, brand and price.",
    activePage: "shop",
    heading: selectedCategory?.name ?? "Shop Supplements",
    categories,
    brands,
    filters,
    ...result,
    pageUrl,
    formatMoney,
  });
}

export async function getProduct(req, res) {
  const slug = req.params.slug;

  const product =
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 160
      ? await findProductBySlug(slug)
      : null;

  if (!product) {
    return res.status(404).render("error", {
      pageTitle: "Product Not Found | Iron Culture",
      metaDescription: "This product could not be found.",
      activePage: "shop",
      statusCode: 404,
      message: "This product is unavailable or does not exist.",
    });
  }

  const relatedProducts = await findRelatedProducts(product);

  const images = [
    ...new Set(
      [product.imageUrl, ...(product.images ?? [])].filter(
        (value) =>
          typeof value === "string" &&
          value.trim().length > 0 &&
          isAllowedProductImageUrl(value),
      ),
    ),
  ];

  const formatMoney = (amount) =>
    new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency: "ZAR",
    }).format(amount);

  res.render("product", {
    pageTitle: `${product.name} | Iron Culture`,
    metaDescription: (
      product.description || `Explore ${product.name} at Iron Culture.`
    ).slice(0, 160),
    activePage: "shop",
    product,
    images,
    flavours: product.flavours ?? [],
    nutrition: product.nutrition ?? [],
    reviews: product.reviews ?? [],
    relatedProducts,
    formatMoney,
  });
}
