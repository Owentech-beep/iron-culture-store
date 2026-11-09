import { pool } from "../config/database.js";
import { completePayment } from "../models/Payment.js";
import {
  recordPaymentReconciliation,
} from "../models/PaymentReconciliation.js";
import {
  verifyStitchNotification,
} from "../services/payments/stitchNotification.js";

export function createStitchNotificationHandler({
  verify = verifyStitchNotification,
  db = pool,
  complete = completePayment,
  reconcile = recordPaymentReconciliation,
  logger = console,
} = {}) {
  return async function receiveStitchNotification(req, res) {
    res.set("Cache-Control", "no-store");

    if (!req.is("application/json")) {
      return res.status(415).send("Expected a JSON notification.");
    }

    let event;

    try {
      event = verify(req.body, req.headers);
    } catch (error) {
      const status = [400, 403, 503].includes(error.status)
        ? error.status
        : 500;

      logger.error("Stitch notification verification failed", {
        status,
      });

      return res.status(status).send("Notification rejected.");
    }

    try {
      const { rows } = await db.query(
        `SELECT idempotency_key
         FROM payments
         WHERE provider = $1
           AND provider_request_id = $2
           AND provider_request_started_at IS NOT NULL`,
        [event.provider, event.providerRequestId],
      );

      // The webhook can arrive before the checkout response is saved.
      // A retryable response lets Stitch deliver it again.
      if (!rows.length) {
        return res.status(503).send(
          "Payment link is not recorded yet.",
        );
      }

      const notification = {
        ...event,
        paymentReference: rows[0].idempotency_key,
      };

      try {
        await complete(notification);
      } catch (error) {
        if (error.status !== 409 && error.code !== "23505") {
          throw error;
        }

        // Preserve verified payment evidence for admin review.
        await reconcile(notification);
      }

      return res.status(200).send("OK");
    } catch (error) {
      logger.error("Stitch notification processing failed", {
        messageId: event.messageId,
        provider: event.provider,
        code: error.code,
      });

      return res.status(500).send(
        "Notification processing unavailable.",
      );
    }
  };
}