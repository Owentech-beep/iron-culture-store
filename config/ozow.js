import "dotenv/config";

export function getOzowConfig(env = process.env) {
  const enabled = env.OZOW_CHECKOUT_ENABLED?.trim() ?? "false";

  if (!["true", "false"].includes(enabled)) {
    throw new Error("OZOW_CHECKOUT_ENABLED must be true or false.");
  }

  // Disabled Ozow must not interfere with PayFast checkout.
  if (enabled === "false") return null;

  const mode = env.OZOW_MODE?.trim();

  if (!["live", "staging"].includes(mode)) {
    throw new Error("OZOW_MODE must be live or staging.");
  }

  const clientId = env.OZOW_CLIENT_ID?.trim();
  const clientSecret = env.OZOW_CLIENT_SECRET?.trim();
  const siteCode = env.OZOW_SITE_CODE?.trim();

  if (
    !clientId ||
    !clientSecret ||
    !siteCode ||
    [clientId, clientSecret, siteCode].some(
      (value) => value.startsWith("your_"),
    )
  ) {
    throw new Error("Complete the Ozow client credentials and Site Code.");
  }

  let publicUrl;

  try {
    publicUrl = new URL(env.OZOW_PUBLIC_BASE_URL?.trim() || "");
  } catch {
    throw new Error("Set a valid OZOW_PUBLIC_BASE_URL.");
  }

  if (
    publicUrl.protocol !== "https:" ||
    publicUrl.username ||
    publicUrl.password ||
    publicUrl.pathname !== "/" ||
    publicUrl.search ||
    publicUrl.hash
  ) {
    throw new Error("OZOW_PUBLIC_BASE_URL must be an HTTPS origin.");
  }

  return Object.freeze({
    enabled: true,
    mode,
    provider: mode === "live" ? "ozow_live" : "ozow_staging",
    clientId,
    clientSecret,
    siteCode,
    baseUrl: publicUrl.origin,
    apiOrigin:
      mode === "live"
        ? "https://one.ozow.com"
        : "https://stagingone.ozow.com",
  });
}