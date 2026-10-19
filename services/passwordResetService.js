import { Resend } from "resend";

import { getEmailConfig } from "../config/email.js";
import { createPasswordResetToken } from "../models/PasswordReset.js";

export function getPasswordResetConfig() {
  const email = getEmailConfig();

  if (!email.enabled) {
    throw new Error("Email sending is disabled.");
  }

  const rawUrl = process.env.PASSWORD_RESET_PUBLIC_BASE_URL?.trim();

  if (!rawUrl) {
    throw new Error("Set PASSWORD_RESET_PUBLIC_BASE_URL.");
  }

  const url = new URL(rawUrl);

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error("Password reset base URL must be an HTTPS origin.");
  }

  return {
    ...email,
    baseUrl: url.origin,
  };
}

export async function requestPasswordReset(emailAddress) {
  const config = getPasswordResetConfig();

  // Local test restriction: never redirect another user's reset link.
  if (
    emailAddress !== config.testRecipient.toLowerCase()
  ) {
    return;
  }

  const reset = await createPasswordResetToken(emailAddress);

  if (!reset) return;

  const link = new URL("/reset-password", config.baseUrl);
  link.searchParams.set("token", reset.token);

  const resend = new Resend(config.apiKey);

  const { data, error } = await resend.emails.send(
    {
      from: config.from,
      to: [reset.recipient],
      subject: "[LOCAL TEST] Reset your Iron Culture password",
      text: [
        "A password reset was requested for your Iron Culture account.",
        "",
        "This is a local development test, but using this link WILL",
        "change your local account password.",
        "",
        "Open this link to choose a new password:",
        link.href,
        "",
        "The link expires 30 minutes after it was requested.",
        "It can be used only once.",
        "",
        "If you did not request this, ignore this email.",
        "Your password has not changed.",
        "",
        "Iron Culture Supplements",
      ].join("\n"),
    },
    {
      idempotencyKey: `iron-culture-password-reset/${reset.tokenId}`,
    },
  );

  if (error || !data?.id) {
    // Do not log the request, token, reset URL or provider response body.
    throw new Error("Password reset email was not confirmed by the provider.");
  }
}