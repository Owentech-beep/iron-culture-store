import {
  getCategories,
  getBrands,
  getFeaturedProducts,
  getDealProducts,
  getGoalCollections,
} from "../models/Product.js";
import { listHomeSlides } from "../models/HomeSlide.js";

export async function getHome(req, res) {
  const [
    categoryRows,
    brands,
    featuredProducts,
    dealProducts,
    goalCollections,
    homeSlides,
  ] = await Promise.all([
    getCategories(),
    getBrands(),
    getFeaturedProducts(),
    getDealProducts(),
    getGoalCollections(),
    listHomeSlides(true),
  ]);

  const requestedGoal =
    typeof req.query.goal === "string" ? req.query.goal : "";

  const selectedGoal =
    goalCollections.find((goal) => goal.slug === requestedGoal) ??
    goalCollections[0] ??
    null;

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
   pageTitle: "Iron Culture Supplements | Online Store & Ficksburg",
   metaDescription:
   "Shop protein, creatine and pre-workout supplements at Iron Culture. Order online with nationwide delivery or visit our store in Ficksburg.",
    activePage: "home",
    categories,
    brands,
    featuredProducts,
    dealProducts,
    formatMoney,
    goalCollections,
    selectedGoal,
    homeSlides,
  });
}
