import { Router } from "express";
import { storePolicies } from "../config/storePolicies.js";

const router = Router();

for (const [slug, policy] of Object.entries(storePolicies)) {
  router.get(`/${slug}`, (req, res) => {
    res.render("policy", {
      pageTitle: `${policy.title} | Iron Culture Supplements`,
      metaDescription: `${policy.title} for Iron Culture Supplements.`,
      activePage: "policy",
      policyPath: `/${slug}`,
      policy,
    });
  });
}

export default router;