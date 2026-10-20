import { randomUUID } from "node:crypto";

import { getEmailConfig } from "../config/email.js";
import {
  normalizeNewsletterEmail,
  requestNewsletterConfirmation,
} from "../models/Newsletter.js";
import { deliverQueuedEmail } from "./emailDeliveryService.js";

export async function sendNewsletterConfirmation(rawEmail) {
  const config = getEmailConfig();
  const email = normalizeNewsletterEmail(rawEmail);

  if (!config.enabled) {
    throw new Error("Newsletter test sending is disabled.");
  }

  // Never redirect another person's confirmation to the test inbox.
  if (
    !email ||
    email !== config.testRecipient.trim().toLowerCase()
  ) {
    return;
  }

  const baseUrl = new URL(
    process.env.NEWSLETTER_PUBLIC_BASE_URL?.trim() || "",
  );

  if (
    baseUrl.protocol !== "https:" ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.pathname !== "/" ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    throw new Error("Set a valid HTTPS newsletter origin.");
  }

  const request = await requestNewsletterConfirmation(email);

  if (!request) return;

  const confirmationUrl = new URL(
    "/newsletter/confirm",
    baseUrl.origin,
  );
  confirmationUrl.searchParams.set("token", request.token);

  const unsubscribeUrl = new URL(
    "/newsletter/unsubscribe",
    baseUrl.origin,
  );
  unsubscribeUrl.searchParams.set("token", request.unsubscribeToken);

  const emailJob = {
    delivery_key: randomUUID(),
    attempt_count: 1,
    delivery_payload: {
      from: config.from,
      to: [request.email],
      subject: "[SANDBOX TEST] Confirm your Iron Culture subscription",
      text: [
        "LOCAL NEWSLETTER TEST",
        "",
        "You requested Iron Culture product news and offers.",
        "Confirm your subscription using the link below:",
        confirmationUrl.href,
        "",
        "This confirmation link expires in 24 hours.",
        "Opening the link does not subscribe you automatically.",
        "",
        "If you did not request this, ignore this email.",
        "To cancel this request or unsubscribe:",
        unsubscribeUrl.href,
        "",
        "Iron Culture Supplements",
      ].join("\n"),
    },
  };

  const result = await deliverQueuedEmail(emailJob, config);

    if (result.status !== "sent") {
    console.error("Newsletter delivery result:", {
      status: result.status,
      message: result.message,
    });

    throw new Error("Newsletter confirmation was not confirmed accepted.");
  }
}