import "dotenv/config";

export function getEmailConfig() {
  const mode = process.env.EMAIL_MODE?.trim();
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  const testRecipient = process.env.EMAIL_TEST_RECIPIENT?.trim();
  const enabled = process.env.EMAIL_SENDING_ENABLED?.trim();

  if (process.env.NODE_ENV !== "development" || mode !== "test") {
    throw new Error("Only local development email testing is enabled.");
  }

  if (!["true", "false"].includes(enabled)) {
    throw new Error("Set EMAIL_SENDING_ENABLED to true or false.");
  }

  if (
    !apiKey ||
    apiKey.startsWith("replace_with_") ||
    !apiKey.startsWith("re_")
  ) {
    throw new Error("Set a Resend API key in your local .env.");
  }

  if (!from || /[\r\n]/.test(from)) {
    throw new Error("Set a valid EMAIL_FROM value.");
  }

  if (
    !testRecipient ||
    testRecipient.startsWith("replace_with_") ||
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(testRecipient)
  ) {
    throw new Error("Set EMAIL_TEST_RECIPIENT to your Resend account email.");
  }

  return Object.freeze({
    mode,
    enabled: enabled === "true",
    apiKey,
    from,
    testRecipient,
  });
}