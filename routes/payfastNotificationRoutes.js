import express, { Router } from "express";

import {
 requirePayfastSource,
} from "../middleware/payfastSourceMiddleware.js";

import {
  receivePayfastNotification,
} from "../controllers/payfastNotificationController.js";

const router = Router();

router.post(
  "/notify",
  requirePayfastSource,
  express.text({
    type: "application/x-www-form-urlencoded",
    limit: "20kb",
    inflate: false,
  }),
  receivePayfastNotification
);

// Keep parser errors on this endpoint independent of EJS/session locals.
router.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  const status = [400, 413, 415].includes(error.status)
    ? error.status
    : 500;

  res.status(status).type("text/plain").send(
    "Invalid notification request."
  );
});

export default router;