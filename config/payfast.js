import "dotenv/config";

export function getPayfastConfig() {
  const mode = process.env.PAYFAST_MODE?.trim();

  // Live payments stay disabled until the integration is tested.
  if (mode !== "sandbox") {
    throw new Error("Only PayFast sandbox is enabled at this stage.");
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
      (value) => value.startsWith("replace_with_")
    )
  ) {
    throw new Error("Set the PayFast sandbox credentials.");
  }

  if (!rawBaseUrl) {
    throw new Error("Set PAYFAST_PUBLIC_BASE_URL before testing checkout.");
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
      "Use an HTTPS origin without credentials, paths, queries or fragments."
    );
  }

  return Object.freeze({
    mode,
    merchantId,
    merchantKey,
    passphrase,
    baseUrl: url.origin,
    processUrl: "https://sandbox.payfast.co.za/eng/process",
    validationUrl: "https://sandbox.payfast.co.za/eng/query/validate",
  });
}