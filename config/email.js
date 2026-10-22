import "dotenv/config";

export function getEmailConfig() {
  const mode = process.env.EMAIL_MODE?.trim();
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  const testRecipient = process.env.EMAIL_TEST_RECIPIENT?.trim();
  const enabled = process.env.EMAIL_SENDING_ENABLED?.trim();

  if (!["test", "live"].includes(mode)) {
    throw new Error("Set EMAIL_MODE to test or live.");
  }

  if (
    (mode === "test" && process.env.NODE_ENV !== "development") ||
    (mode === "live" && process.env.NODE_ENV !== "production")
  ) {
    throw new Error(
      "Test email requires development; live email requires production.",
    );
  }

  if (!["true", "false"].includes(enabled)) {
    throw new Error("Set EMAIL_SENDING_ENABLED to true or false.");
  }

  if (
    !apiKey ||
    apiKey.startsWith("replace_with_") ||
    !apiKey.startsWith("re_")
  ) {
    throw new Error("Set a valid Resend API key.");
  }

  if (!from || from.length > 320 || /[\r\n]/.test(from)) {
    throw new Error("Set a valid EMAIL_FROM value.");
  }

  // Accept a plain address or a display name followed by <address>.
  const senderAddress = from.includes("<")
    ? from.match(/^[^<>]+<([^<>]+)>$/)?.[1]
    : from;

  const validAddress = (value) =>
    typeof value === "string" &&
    value.length <= 254 &&
    /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);

  if (!validAddress(senderAddress)) {
    throw new Error("EMAIL_FROM must contain a valid sender address.");
  }

  if (
    mode === "live" &&
    senderAddress.split("@")[1].toLowerCase() !== "ironculturesubs.co.za"
  ) {
    throw new Error(
      "Live EMAIL_FROM must use the ironculturesubs.co.za domain.",
    );
  }

  if (
    mode === "test" &&
    (
      !validAddress(testRecipient) ||
      testRecipient.startsWith("replace_with_")
    )
  ) {
    throw new Error("Set a valid EMAIL_TEST_RECIPIENT.");
  }

  return Object.freeze({
    mode,
    enabled: enabled === "true",
    apiKey,
    from,
    testRecipient: mode === "test" ? testRecipient : null,
  });
}