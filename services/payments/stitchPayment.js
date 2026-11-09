const apiOrigin = "https://express.stitch.money";

const identifierPattern = /^[A-Za-z0-9_-]{1,255}$/;

const referencePattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createStitchPaymentClient(
  config,
  { fetchImpl = fetch, now = Date.now } = {},
) {
  let accessToken;
  let tokenExpiresAt = 0;
  let tokenRequest;

  async function request(path, { token, body } = {}) {
    const response = await fetchImpl(`${apiOrigin}/api/v1${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });

    if (!response.ok) {
      const error = new Error(
        `Stitch request failed (${response.status}).`,
      );

      error.status = response.status;
      throw error;
    }

    const result = await response.json();

    if (result.success !== true || !result.data) {
      throw new Error("Invalid Stitch response.");
    }

    return result.data;
  }

  async function getAccessToken() {
    if (accessToken && now() < tokenExpiresAt) {
      return accessToken;
    }

    if (!tokenRequest) {
      tokenRequest = (async () => {
        const startedAt = now();

        const data = await request("/token", {
          body: {
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            scope: "client_paymentrequest",
          },
        });

        if (
          typeof data.accessToken !== "string" ||
          !data.accessToken
        ) {
          throw new Error("Stitch did not return an access token.");
        }

        accessToken = data.accessToken;

        // Refresh before Stitch's 15-minute token expiry.
        tokenExpiresAt = startedAt + 14 * 60 * 1000;

        return accessToken;
      })().finally(() => {
        tokenRequest = null;
      });
    }

    return tokenRequest;
  }

  return {
    async registerRedirect() {
      return request("/redirect-urls", {
        token: await getAccessToken(),
        body: {
          redirectUrl: `${config.baseUrl}/payments/stitch/return`,
        },
      });
    },

    async registerWebhook() {
      return request("/webhook", {
        token: await getAccessToken(),
        body: {
          url: `${config.baseUrl}/payments/stitch/notify`,
        },
      });
    },

    async createPaymentRequest(attempt) {
      const expiry = Date.parse(attempt.expiresAt);

      if (
        !Number.isSafeInteger(attempt.amountCents) ||
        attempt.amountCents < 100 ||
        typeof attempt.paymentReference !== "string" ||
        !referencePattern.test(attempt.paymentReference) ||
        typeof attempt.payerName !== "string" ||
        attempt.payerName.trim().length < 3 ||
        attempt.payerName.length > 40 ||
        !Number.isFinite(expiry) ||
        expiry <= now()
      ) {
        throw new Error("Invalid Stitch payment attempt.");
      }

      // A timeout can happen after Stitch accepts the request.
      // The caller must preserve the attempt for review.
      const data = await request("/payment-links", {
        token: await getAccessToken(),
        body: {
          amount: attempt.amountCents,
          payerName: attempt.payerName,
          merchantReference: attempt.paymentReference,
          expiresAt: attempt.expiresAt,
          collectDeliveryDetails: false,
        },
      });

      const link = data.payment;

      if (
        !link ||
        typeof link.id !== "string" ||
        !identifierPattern.test(link.id) ||
        link.amount !== attempt.amountCents ||
        link.status !== "PENDING" ||
        Date.parse(link.expireAt) !== expiry
      ) {
        throw new Error(
          "Stitch payment link does not match this attempt.",
        );
      }

      if (
        link.merchantReference !== undefined &&
        link.merchantReference !== attempt.paymentReference
      ) {
        throw new Error("Stitch returned a different merchant reference.");
      }

      const checkoutUrl = new URL(link.link);

      if (
        checkoutUrl.origin !== apiOrigin ||
        checkoutUrl.username ||
        checkoutUrl.password ||
        checkoutUrl.hash
      ) {
        throw new Error("Unexpected Stitch checkout destination.");
      }

      checkoutUrl.searchParams.set(
        "redirect_url",
        `${config.baseUrl}/payments/stitch/return`,
      );

      return {
        providerRequestId: link.id,
        checkoutUrl: checkoutUrl.href,
        expiresAt: attempt.expiresAt,
      };
    },
  };
}