import { Router } from "express";
import { getHome } from "../controllers/homeController.js";

const router = Router();

router.get("/", getHome);

router.get("/about", (req, res) => {
  res.render("about", {
    pageTitle: "About Iron Culture | Discipline, Strength & Community",
    metaDescription:
      "Discover the mindset behind Iron Culture Supplements: Spartan-inspired discipline, consistent effort and a community built around training.",
    activePage: "about",
  });
});

export default router;