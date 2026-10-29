import { verifyOzowNotification } from
  "../services/payments/ozowNotification.js";
import { completePayment } from "../models/Payment.js";
import { recordPaymentReconciliation } from
  "../models/PaymentReconciliation.js";

export function createOzowNotificationHandler({
  verify = verifyOzowNotification,
  complete = completePayment,
  reconcile = recordPaymentReconciliation,
  logger = console,
} = {}) {
  return async function receiveOzowNotification(req, res) {
    res.set("Cache-Control", "no-store");

    if (!req.is("application/json")) {
      return res.status(415).type("text/plain").send(
        "Expected a JSON notification.",
      );
    }

    let notification;

    try {
      notification = verify(req.body, req.headers);
    } catch (error) {
      const status = [400, 403, 503].includes(error.status)
        ? error.status
        : 500;

      logger.error("Ozow notification verification failed:", { status });

      return res.status(status).type("text/plain").send(
        status >= 500
          ? "Notification verification unavailable."
          : "Notification rejected.",
      );
    }

    try {
      if (notification.paymentStatus !== "COMPLETE") {
        await reconcile(notification);
      } else {
        try {
          await complete(notification);
        } catch (error) {
          if (error.status !== 409 && error.code !== "23505") {
            throw error;
          }

          // Preserve verified payment evidence for admin review.
          // If saving fails, return 500 so delivery can be retried.
          await reconcile(notification);
        }
      }

      return res.status(200).type("text/plain").send("OK");
    } catch (error) {
      logger.error("Ozow notification processing failed:", {
        messageId: notification.messageId,
        provider: notification.provider,
        code: error.code,
      });

      return res.status(500).type("text/plain").send(
        "Notification processing unavailable.",
      );
    }
  };
}

export const receiveOzowNotification =
  createOzowNotificationHandler();