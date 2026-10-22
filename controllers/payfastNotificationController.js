import {
  verifyPayfastNotification,
} from "../services/payments/payfastNotification.js";

import { completePayment } from "../models/Payment.js";

import {
  recordPaymentReconciliation,
} from "../models/PaymentReconciliation.js";

export async function receivePayfastNotification(req, res) {
  if (!req.is("application/x-www-form-urlencoded")) {
    return res
      .status(415)
      .type("text/plain")
      .send("Expected a form-encoded notification.");
  }

  try {
    const notification = await verifyPayfastNotification(req.body);

    if (notification.paymentStatus !== "COMPLETE") {
      await recordPaymentReconciliation(notification);

      console.warn("PayFast status saved for review:", {
        provider: notification.provider,
        paymentReference: notification.paymentReference,
        paymentStatus: notification.paymentStatus,
      });

      return res.status(200).type("text/plain").send("OK");
    }

    let result;

    try {
      result = await completePayment(notification);
    } catch (error) {
      if (error.status !== 409 && error.code !== "23505") {
        throw error;
      }

      await recordPaymentReconciliation(notification);

      console.error("PayFast payment requires reconciliation:", {
        provider: notification.provider,
        paymentReference: notification.paymentReference,
        providerPaymentId: notification.providerPaymentId,
      });

      // Receipt is acknowledged only after the alert is stored.
      return res.status(200).type("text/plain").send("OK");
    }

    console.log("PayFast payment confirmed:", {
      provider: notification.provider,
      orderId: result.orderId,
      alreadyProcessed: result.alreadyProcessed,
    });

    return res.status(200).type("text/plain").send("OK");
  } catch (error) {
    const status = [400, 403, 409, 503].includes(error.status)
      ? error.status
      : 500;

    console.error("PayFast notification failed:", {
      status,
      code: error.code,
    });

    return res
      .status(status)
      .type("text/plain")
      .send(
        status >= 500
          ? "Notification processing unavailable."
          : "Notification rejected.",
      );
  }
}