import "dotenv/config";

async function main() {
  const clientId = process.env.OZOW_CLIENT_ID?.trim();
  const clientSecret = process.env.OZOW_CLIENT_SECRET?.trim();
  const mode = process.env.OZOW_MODE?.trim();

  if (!clientId || !clientSecret) {
    throw new Error("Set OZOW_CLIENT_ID and OZOW_CLIENT_SECRET.");
  }

  if (!["live", "staging"].includes(mode)) {
    throw new Error("Set OZOW_MODE to live or staging.");
  }

  const origin =
    mode === "live"
      ? "https://one.ozow.com"
      : "https://stagingone.ozow.com";

  function redact(value) {
    if (typeof value !== "string") return undefined;

    let safe = value;

    for (const credential of [clientId, clientSecret]) {
      safe = safe.split(credential).join("[REDACTED]");
      safe = safe
        .split(encodeURIComponent(credential))
        .join("[REDACTED]");
    }

    return safe.slice(0, 500);
  }

  const response = await fetch(`${origin}/v1/token`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "payments",
      grant_type: "client_credentials",
    }),
  });

  if (!response.ok) {
    const problem = await response.json().catch(() => null);

    console.error("Ozow authentication error:", {
      mode,
      endpoint: `${origin}/v1/token`,
      status: response.status,
      correlationId: response.headers.get("x-correlation-id"),
      code: redact(problem?.code),
      title: redact(problem?.title),
      detail: redact(problem?.detail),
      error: redact(problem?.error),
      description: redact(problem?.error_description),
    });

    throw new Error(
      `Ozow authentication returned HTTP ${response.status}.`,
    );
  }

  const data = await response.json();

  if (
    typeof data.access_token !== "string" ||
    !data.access_token ||
    String(data.token_type).toLowerCase() !== "bearer" ||
    !Number.isFinite(Number(data.expires_in)) ||
    Number(data.expires_in) <= 0
  ) {
    throw new Error("Ozow returned an incomplete token response.");
  }

  console.log(`PASS: Ozow ${mode} authentication accepted.`);
  console.log("No payment requests were created or database records changed.");
  console.log("Credentials and access token were not printed or saved.");
}

main().catch((error) => {
  console.error(
    "OZOW AUTH CHECK FAILED:",
    error.name === "TimeoutError"
      ? "The authentication request timed out."
      : error.message,
  );

  process.exitCode = 1;
});