import "dotenv/config";

export function getStitchConfig(
  env = process.env,
  { forWebhook = false, requireWebhook = true } = {},
) {
  const enabled = env.STITCH_CHECKOUT_ENABLED?.trim() ?? "false";

  if (!["true", "false"].includes(enabled)) {
    throw new Error("STITCH_CHECKOUT_ENABLED must be true or false.");
  }

  if (enabled === "false" && !forWebhook) return null;

  const mode = env.STITCH_MODE?.trim();
  const clientId = env.STITCH_CLIENT_ID?.trim();
  const clientSecret = env.STITCH_CLIENT_SECRET?.trim();
  const webhookSecret = env.STITCH_WEBHOOK_SECRET?.trim();

  if (!["test", "live"].includes(mode) || !clientId || !clientSecret) {
    throw new Error("Complete the Stitch mode and client credentials.");
  }

  if (clientId.startsWith("test-") !== (mode === "test")) {
    throw new Error("Stitch client ID does not match STITCH_MODE.");
  }

  if (requireWebhook && !webhookSecret?.startsWith("whsec_")) {
    throw new Error("Set STITCH_WEBHOOK_SECRET before enabling checkout.");
  }

  const base = new URL(env.STITCH_PUBLIC_BASE_URL || "");

  if (
    base.protocol !== "https:" ||
    base.pathname !== "/" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  ) {
    throw new Error("STITCH_PUBLIC_BASE_URL must be an HTTPS origin.");
  }

  return Object.freeze({
    mode,
    clientId,
    clientSecret,
    webhookSecret,
    provider: `stitch_${mode}`,
    baseUrl: base.origin,
  });
}