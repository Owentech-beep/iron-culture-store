import "dotenv/config";

export function getPayfastConfig() {
  const mode = process.env.PAYFAST_MODE?.trim();

  if (!["sandbox", "live"].includes(mode)) {
    throw new Error("PAYFAST_MODE must be sandbox or live.");
  }

  const merchantId = process.env.PAYFAST_MERCHANT_ID?.trim();
  const merchantKey = process.env.PAYFAST_MERCHANT_KEY?.trim();
  const passphrase = process.env.PAYFAST_PASSPHRASE?.trim();
  const rawBaseUrl = process.env.PAYFAST_PUBLIC_BASE_URL?.trim();

  if (
    !merchantId ||
    !merchantKey ||
    !passphrase ||
    [merchantId, merchantKey, passphrase].some(
      (value) => value.startsWith("replace_with_"),
    )
  ) {
    throw new Error("Set the PayFast credentials for the selected mode.");
  }

  if (!/^\d+$/.test(merchantId)) {
    throw new Error("PAYFAST_MERCHANT_ID must contain digits only.");
  }

  if (!rawBaseUrl) {
    throw new Error("Set PAYFAST_PUBLIC_BASE_URL.");
  }

  let url;

  try {
    url = new URL(rawBaseUrl);
  } catch {
    throw new Error("PAYFAST_PUBLIC_BASE_URL must be a valid HTTPS URL.");
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      "Use an HTTPS origin without credentials, paths, queries or fragments.",
    );
  }

  const checkoutEnabled =
    process.env.PAYFAST_CHECKOUT_ENABLED?.trim() === "true";

  const providerOrigin = mode === "live"
    ? "https://www.payfast.co.za"
    : "https://sandbox.payfast.co.za";

  return Object.freeze({
    mode,
    provider: mode === "live" ? "payfast_live" : "payfast_sandbox",
    checkoutEnabled,
    merchantId,
    merchantKey,
    passphrase,
    baseUrl: url.origin,
    processUrl: `${providerOrigin}/eng/process`,
    validationUrl: `${providerOrigin}/eng/query/validate`,
  });
}