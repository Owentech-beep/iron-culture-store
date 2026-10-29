import { Webhook } from "svix";

function webhookError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function verifyOzowWebhook(
  rawBody,
  headers,
  secret = process.env.OZOW_WEBHOOK_SECRET,
) {
  // Verify notifications even when new checkout attempts are disabled.
  // Existing payments may still finish after checkout is switched off.
  if (
    typeof secret !== "string" ||
    !secret.trim().startsWith("whsec_")
  ) {
    throw webhookError("Ozow webhook verification is not configured.", 503);
  }

  let verifier;

  try {
    verifier = new Webhook(secret.trim());
  } catch {
    throw webhookError("Ozow webhook verification is not configured.", 503);
  }

  if (
    !Buffer.isBuffer(rawBody) ||
    rawBody.length === 0 ||
    rawBody.length > 128 * 1024
  ) {
    throw webhookError("Invalid Ozow notification body.", 400);
  }

  const names = [
    "svix-id",
    "svix-timestamp",
    "svix-signature",
  ];

  const signatureHeaders = {};

  for (const name of names) {
    const value = headers?.[name];

    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > 4096
    ) {
      throw webhookError("Ozow notification signature is missing.", 403);
    }

    signatureHeaders[name] = value;
  }

  try {
    // Do not use the return value: Svix versions differ here.
    verifier.verify(rawBody, signatureHeaders);
  } catch {
    throw webhookError("Ozow notification signature was rejected.", 403);
  }

  let event;

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(rawBody);
    event = JSON.parse(text);
  } catch {
    throw webhookError("Ozow notification contains invalid JSON.", 400);
  }

  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw webhookError("Invalid Ozow notification event.", 400);
  }

  return {
    messageId: signatureHeaders["svix-id"],
    event,
  };
}