import { verifyOzowWebhook } from "./ozowWebhookVerification.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const statuses = Object.freeze({
  Successful: "COMPLETE",
  Incomplete: "INCOMPLETE",
  Pending: "PENDING",
  Error: "ERROR",
});

function reject(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function verifyOzowNotification(
  rawBody,
  headers,
  env = process.env,
) {
  const mode = env.OZOW_MODE?.trim();
  const siteCode = env.OZOW_SITE_CODE?.trim();

  if (
    !["live", "staging"].includes(mode) ||
    !siteCode ||
    siteCode.length > 50
  ) {
    throw reject("Ozow notification configuration is incomplete.", 503);
  }

  const { messageId, event } = verifyOzowWebhook(
    rawBody,
    headers,
    env.OZOW_WEBHOOK_SECRET,
  );

  if (event.type !== "transaction.complete") {
    throw reject("Unsupported Ozow notification event.");
  }

  const data = event.data;

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw reject("Invalid Ozow transaction data.");
  }

  // This integration requires a full webhook payload.
  // Thin notifications cannot confirm an amount or merchant reference.
  if (
    typeof data.TransactionReference !== "string" ||
    !uuidPattern.test(data.TransactionReference) ||
    typeof data.TransactionId !== "string" ||
    !uuidPattern.test(data.TransactionId)
  ) {
    throw reject("Invalid Ozow payment identifiers.");
  }

  if (data.SiteCode !== siteCode) {
    throw reject("Ozow notification belongs to another site.", 403);
  }

  if (data.CurrencyCode !== "ZAR") {
    throw reject("Unexpected Ozow payment currency.");
  }

  const expectedTestFlag = mode === "staging" ? "True" : "False";

  if (data.IsTest !== expectedTestFlag) {
    throw reject("Ozow notification environment does not match.", 403);
  }

  if (
    typeof data.Status !== "string" ||
    !Object.hasOwn(statuses, data.Status)
  ) {
    throw reject("Unexpected Ozow transaction status.");
  }

  // Convert decimal rand strings into integer cents without
  // floating-point multiplication or rounding.
  if (
    typeof data.Amount !== "string" ||
    !/^(0|[1-9]\d{0,13})\.\d{2}$/.test(data.Amount)
  ) {
    throw reject("Invalid Ozow payment amount.");
  }

  const [rand, cents] = data.Amount.split(".");
  const amount = BigInt(rand) * 100n + BigInt(cents);

  if (amount <= 0n || amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw reject("Ozow payment amount is outside the supported range.");
  }

  return Object.freeze({
    messageId,
    provider: mode === "live" ? "ozow_live" : "ozow_staging",
    paymentReference: data.TransactionReference.toLowerCase(),
    providerPaymentId: data.TransactionId.toLowerCase(),
    amountCents: Number(amount),
    paymentStatus: statuses[data.Status],
  });
}