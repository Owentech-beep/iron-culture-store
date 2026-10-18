import { verifySandboxNotification } from "../services/payments/payfastNotification.js";
import { completeSandboxPayment } from "../models/Payment.js";
import { recordSandboxReconciliation } from "../models/PaymentReconciliation.js";

export async function receivePayfastNotification(req, res) {
  if (!req.is("application/x-www-form-urlencoded")) {
    return res
      .status(415)
      .type("text/plain")
      .send("Expected a form-encoded notification.");
  }

  try {
    const notification = await verifySandboxNotification(req.body);

    if (notification.paymentStatus !== "COMPLETE") {
      await recordSandboxReconciliation(notification);

      console.warn("PayFast sandbox status saved for review:", {
        paymentReference: notification.paymentReference,
        paymentStatus: notification.paymentStatus,
      });
      // Acknowledge only after the alert is stored successfully.
      return res.status(200).type("text/plain").send("OK");
    }

    let result;

    try {
      result = await completeSandboxPayment(notification);
    } catch (error) {
      if (error.status !== 409 && error.code !== "23505") {
        throw error;
      }

      await recordSandboxReconciliation(notification);

      console.error("PayFast sandbox payment requires reconciliation:", {
        paymentReference: notification.paymentReference,
        providerPaymentId: notification.providerPaymentId,
      });

      // Acknowledge durable receipt, not successful order fulfilment.
      return res.status(200).type("text/plain").send("OK");
    }

    console.log("PayFast sandbox payment confirmed:", {
      orderId: result.orderId,
      alreadyProcessed: result.alreadyProcessed,
    });

    // Acknowledge only after the transaction commits.
    return res.status(200).type("text/plain").send("OK");
  } catch (error) {
    const status = [400, 403, 409, 503].includes(error.status)
      ? error.status
      : 500;

    // Do not print raw notification bodies or credentials.
    console.error("PayFast sandbox notification failed:", {
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
