import express from "express";
import { createOzowNotificationHandler } from
  "../controllers/ozowNotificationController.js";

export function createOzowNotificationRouter(dependencies) {
  const router = express.Router();

  router.post(
    "/notify",
    express.raw({
      type: "application/json",
      limit: "128kb",
      inflate: false,
    }),
    createOzowNotificationHandler(dependencies),
  );

  return router;
}

export default createOzowNotificationRouter();