import express from "express";
import {
  createStitchNotificationHandler,
} from "../controllers/stitchNotificationController.js";

export function createStitchNotificationRouter(dependencies) {
  const router = express.Router();

  router.post(
    "/notify",
    express.raw({
      type: "application/json",
      limit: "128kb",
      inflate: false,
    }),
    createStitchNotificationHandler(dependencies),
  );

  // Payment completion is handled by the verified webhook.
  router.get("/return", (req, res) => {
    res.set("Cache-Control", "no-store");
    return res.redirect(303, "/orders");
  });

  return router;
}

export default createStitchNotificationRouter();