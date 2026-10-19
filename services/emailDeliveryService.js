export async function deliverQueuedEmail(
  email,
  config,
  fetchImpl = globalThis.fetch,
) {
  let status;
  let providerId = null;
  let message = null;

  try {
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `iron-culture/${email.delivery_key}`,
      },
      body: JSON.stringify(email.delivery_payload),
    });

    const body = await response.json().catch(() => null);

    if (
      response.ok &&
      typeof body?.id === "string" &&
      body.id.length > 0 &&
      body.id.length <= 255
    ) {
      status = "sent";
      providerId = body.id;
    } else if (
      response.status === 429 ||
      response.status >= 500 ||
      response.ok
    ) {
      status = "pending";
      message =
        `Temporary or uncertain provider response: HTTP ${response.status}.`;
    } else {
      status = "review_required";
      message =
        `Provider rejected the request: HTTP ${response.status}. Check Resend logs.`;
    }
  } catch {
    status = "pending";
    message =
      "Network request failed or timed out. Delivery outcome is uncertain.";
  }

  if (status === "pending" && email.attempt_count >= 5) {
    status = "review_required";
    message =
      "Retry limit reached. Inspect Resend before taking further action.";
  }

  return { status, providerId, message };
}