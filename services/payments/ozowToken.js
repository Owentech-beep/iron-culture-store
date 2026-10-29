export function createOzowTokenProvider(
  config,
  { fetchImpl = globalThis.fetch, now = Date.now } = {},
) {
  if (!config?.enabled) {
    throw new Error("Ozow checkout is disabled.");
  }

  const allowedOrigins = [
    "https://one.ozow.com",
    "https://stagingone.ozow.com",
  ];

  if (!allowedOrigins.includes(config.apiOrigin)) {
    throw new Error("Unsupported Ozow API origin.");
  }

  // Capture configuration for this token provider.
  const { apiOrigin, clientId, clientSecret } = config;

  if (!clientId || !clientSecret) {
    throw new Error("Ozow client credentials are missing.");
  }

  let cachedToken = null;
  let validUntil = 0;
  let pendingRequest = null;

  async function requestToken() {
    const startedAt = now();
    let response;

    try {
      response = await fetchImpl(`${apiOrigin}/v1/token`, {
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
    } catch (cause) {
      throw new Error("Ozow authentication could not be reached.", { cause });
    }

    if (!response.ok) {
      // Do not include credentials or provider response bodies.
      throw new Error(`Ozow authentication returned HTTP ${response.status}.`);
    }

    let data;

    try {
      data = await response.json();
    } catch {
      throw new Error("Ozow returned an invalid authentication response.");
    }

    const lifetimeSeconds = Number(data.expires_in);

    if (
      typeof data.access_token !== "string" ||
      !data.access_token.trim() ||
      /[\r\n]/.test(data.access_token) ||
      String(data.token_type).toLowerCase() !== "bearer" ||
      !Number.isFinite(lifetimeSeconds) ||
      lifetimeSeconds <= 0
    ) {
      throw new Error("Ozow returned an incomplete authentication response.");
    }

    if (
      data.scope !== undefined &&
      (typeof data.scope !== "string" ||
        !data.scope.split(/\s+/).includes("payments"))
    ) {
      throw new Error("Ozow did not grant the payments scope.");
    }

    const lifetimeMs = lifetimeSeconds * 1000;
    const marginMs = Math.min(60_000, lifetimeMs * 0.1);
    const expiresAt = startedAt + lifetimeMs - marginMs;

    if (!Number.isFinite(expiresAt) || expiresAt <= now()) {
      throw new Error(
        "Ozow returned a token with insufficient remaining life.",
      );
    }

    cachedToken = data.access_token;
    validUntil = expiresAt;

    return cachedToken;
  }

  return async function getAccessToken() {
    if (cachedToken && now() < validUntil) {
      return cachedToken;
    }

    // Concurrent callers share one authentication request.
    if (!pendingRequest) {
      pendingRequest = requestToken().finally(() => {
        pendingRequest = null;
      });
    }

    return pendingRequest;
  };
}
