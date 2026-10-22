import { createHash, timingSafeEqual } from "node:crypto";
import { getPayfastConfig } from "../../config/payfast.js";

function notificationError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// Notification values must retain their original whitespace.
function encodeNotificationValue(value) {
  return encodeURIComponent(value)
    .replace(
      /[!'()*~]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    )
    .replace(/%20/g, "+");
}

export function parseSignedNotification(rawBody, passphrase) {
  if (
    typeof rawBody !== "string" ||
    !rawBody ||
    Buffer.byteLength(rawBody, "utf8") > 20 * 1024
  ) {
    throw notificationError("Invalid notification body.");
  }

  const entries = [...new URLSearchParams(rawBody)];
  const seen = new Set();

  for (const [name] of entries) {
    if (!/^[a-z][a-z0-9_]*$/.test(name) || seen.has(name)) {
      throw notificationError("Invalid or duplicate notification field.");
    }

    seen.add(name);
  }

  const data = Object.fromEntries(entries);
  const suppliedSignature = data.signature;

  if (!/^[a-f0-9]{32}$/i.test(suppliedSignature ?? "")) {
    throw notificationError("Invalid notification signature.", 403);
  }

  // Preserve incoming field order and include empty values.
  const parameterString = entries
    .filter(([name]) => name !== "signature")
    .map(([name, value]) => `${name}=${encodeNotificationValue(value)}`)
    .join("&");

  const expectedSignature = createHash("md5")
    .update(
      `${parameterString}&passphrase=${encodeNotificationValue(passphrase)}`,
      "utf8",
    )
    .digest("hex");

  if (
    !timingSafeEqual(
      Buffer.from(suppliedSignature, "hex"),
      Buffer.from(expectedSignature, "hex"),
    )
  ) {
    throw notificationError("Invalid notification signature.", 403);
  }

  return { data, parameterString };
}

export function notificationAmountCents(value) {
  if (typeof value !== "string" || !/^\d+\.\d{2}$/.test(value)) {
    throw notificationError("Invalid notification amount.");
  }

  const [whole, fraction] = value.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction);

  if (cents <= 0n || cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw notificationError("Invalid notification amount.");
  }

  return Number(cents);
}

export async function verifyPayfastNotification(rawBody) {
  const config = getPayfastConfig();

  const { data, parameterString } = parseSignedNotification(
    rawBody,
    config.passphrase,
  );

  if (data.merchant_id !== config.merchantId) {
    throw notificationError("Unexpected payment merchant.", 403);
  }

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      data.m_payment_id ?? "",
    ) ||
    !/^\d{1,255}$/.test(data.pf_payment_id ?? "")
  ) {
    throw notificationError("Invalid payment reference.");
  }

  if (
    typeof data.payment_status !== "string" ||
    !/^[A-Z_]{1,30}$/.test(data.payment_status)
  ) {
    throw notificationError("Invalid payment status.");
  }

  const amountCents = notificationAmountCents(data.amount_gross);

  let responseText;

  try {
    const response = await fetch(config.validationUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: parameterString,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error("Validation service unavailable.");
    }

    responseText = await response.text();
  } catch {
    throw notificationError(
      "PayFast confirmation is temporarily unavailable.",
      503,
    );
  }

  if (responseText.trim() !== "VALID") {
    throw notificationError("PayFast rejected the notification.", 403);
  }

  return {
    paymentReference: data.m_payment_id,
    providerPaymentId: data.pf_payment_id,
    paymentStatus: data.payment_status,
    amountCents,
    provider: config.provider,
  };
}

export async function verifySandboxNotification(rawBody) {
  if (getPayfastConfig().mode !== "sandbox") {
    throw notificationError("Sandbox verification is unavailable.", 503);
  }

  return verifyPayfastNotification(rawBody);
}
