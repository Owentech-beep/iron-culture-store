import {
  getCategories,
  getBrands,
  getFeaturedProducts,
} from "../models/Product.js";

export async function getHome(req, res) {
  const [categoryRows, brands, featuredProducts] = await Promise.all([
    getCategories(),
    getBrands(),
    getFeaturedProducts(),
  ]);

  const categories = categoryRows.map((category, index) => ({
    ...category,
    number: String(index + 1).padStart(2, "0"),
    description: `Explore ${category.name.toLowerCase()}`,
  }));

  const formatMoney = (amount) =>
    new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency: "ZAR",
    }).format(amount);

  res.render("home", {
    pageTitle: "Iron Culture Supplements | Fuel Your Next Level",
    metaDescription:
      "Explore supplements and training essentials from Iron Culture Supplements.",
    activePage: "home",
    categories,
    brands,
    featuredProducts,
    formatMoney,
  });
}