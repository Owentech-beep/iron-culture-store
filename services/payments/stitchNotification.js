import { Webhook } from "svix";
import { getStitchConfig } from "../../config/stitch.js";

function notificationError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function verifyStitchNotification(
  rawBody,
  headers,
  env = process.env,
) {
  let config;
  let verifier;

  try {
    // Existing payments may finish after new checkout is disabled.
    config = getStitchConfig(env, { forWebhook: true });
    verifier = new Webhook(config.webhookSecret);
  } catch {
    throw notificationError(
      "Stitch notification verification is unavailable.",
      503,
    );
  }

  if (
    !Buffer.isBuffer(rawBody) ||
    rawBody.length === 0 ||
    rawBody.length > 128 * 1024
  ) {
    throw notificationError("Invalid Stitch notification body.", 400);
  }

  const signatureHeaders = {};

  for (const name of [
    "svix-id",
    "svix-timestamp",
    "svix-signature",
  ]) {
    const value = headers?.[name];

    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > 4096
    ) {
      throw notificationError(
        "Stitch notification signature is missing.",
        403,
      );
    }

    signatureHeaders[name] = value;
  }

  try {
    verifier.verify(rawBody, signatureHeaders);
  } catch {
    throw notificationError(
      "Stitch notification signature was rejected.",
      403,
    );
  }

  let event;

  try {
    // Parse only after verifying the original request bytes.
    const text = new TextDecoder("utf-8", { fatal: true }).decode(rawBody);
    event = JSON.parse(text);
  } catch {
    throw notificationError(
      "Stitch notification contains invalid JSON.",
      400,
    );
  }

  const identifierPattern = /^[A-Za-z0-9_-]{1,255}$/;

  if (
    !event ||
    typeof event !== "object" ||
    Array.isArray(event) ||
    event.status !== "PAID" ||
    event.type !== "LINK" ||
    typeof event.id !== "string" ||
    !identifierPattern.test(event.id) ||
    typeof event.linkId !== "string" ||
    !identifierPattern.test(event.linkId) ||
    !Number.isSafeInteger(event.amount) ||
    event.amount < 100
  ) {
    throw notificationError("Invalid Stitch payment event.", 400);
  }

  return Object.freeze({
    messageId: signatureHeaders["svix-id"],
    provider: config.provider,
    providerRequestId: event.linkId,
    providerPaymentId: event.id,
    amountCents: event.amount,
    paymentStatus: "COMPLETE",
  });
}