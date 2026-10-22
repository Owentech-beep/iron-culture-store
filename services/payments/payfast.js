import { createHash } from "node:crypto";
import { getPayfastConfig } from "../../config/payfast.js";

// Match PHP urlencode(), which PayFast uses for signatures.
export function payfastEncode(value) {
  return encodeURIComponent(String(value).trim())
    .replace(
      /[!'()*~]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    )
    .replace(/%20/g, "+");
}

// Entries must already be in PayFast's checkout field order.
export function signCheckoutEntries(entries, passphrase) {
  const parameters = entries
    .filter(([, value]) => String(value).trim() !== "")
    .map(([name, value]) => `${name}=${payfastEncode(value)}`);

  parameters.push(`passphrase=${payfastEncode(passphrase)}`);

  return createHash("md5").update(parameters.join("&"), "utf8").digest("hex");
}

export function buildPayfastCheckout({
  orderId,
  paymentReference,
  amountCents,
  provider,
  mode,
}) {
  const config = getPayfastConfig();

  if (!config.checkoutEnabled) {
    throw new Error("Online payments are disabled.");
  }

  if (provider !== config.provider || mode !== config.mode) {
    throw new Error(
      "The payment attempt does not match the configured payment environment.",
    );
  }

  if (!Number.isSafeInteger(orderId) || orderId < 1 || orderId > 2147483647) {
    throw new Error("Invalid checkout order ID.");
  }

  // The database payment attempt's UUID, not a browser-supplied value.
  if (
    typeof paymentReference !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      paymentReference,
    )
  ) {
    throw new Error("Invalid payment reference.");
  }

  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error("Invalid payment amount.");
  }

  // Format integer cents without floating-point currency arithmetic.
  const amount =
    `${Math.floor(amountCents / 100)}.` +
    String(amountCents % 100).padStart(2, "0");

  const orderPaymentUrl = `${config.baseUrl}/orders/${orderId}/payment`;

  // Preserve this order. Do not alphabetically sort these fields.
  const entries = [
    ["merchant_id", config.merchantId],
    ["merchant_key", config.merchantKey],
    ["return_url", orderPaymentUrl],
    ["cancel_url", orderPaymentUrl],
    ["notify_url", `${config.baseUrl}/payments/payfast/notify`],
    ["m_payment_id", paymentReference],
    ["amount", amount],
    [
      "item_name",
      config.mode === "sandbox"
        ? `Iron Culture sandbox order ${orderId}`
        : `Iron Culture order ${orderId}`,
    ],
  ];

  const signature = signCheckoutEntries(entries, config.passphrase);

  return {
    mode: config.mode,
    action: config.processUrl,
    fields: Object.fromEntries([...entries, ["signature", signature]]),
  };
}
