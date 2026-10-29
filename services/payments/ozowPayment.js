import { createOzowTokenProvider } from "./ozowToken.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uncertainOutcome(message) {
  const error = new Error(message);

  error.code = "OZOW_REQUEST_UNRESOLVED";
  error.requestMayExist = true;

  return error;
}

export function createOzowPaymentClient(
  config,
  { fetchImpl = globalThis.fetch, now = Date.now, getAccessToken } = {},
) {
  if (!config?.enabled) {
    throw new Error("Ozow checkout is disabled.");
  }

  const environments = {
    live: {
      apiOrigin: "https://one.ozow.com",
      checkoutHost: "pay.ozow.com",
      provider: "ozow_live",
    },
    staging: {
      apiOrigin: "https://stagingone.ozow.com",
      checkoutHost: "stagingpay.ozow.com",
      provider: "ozow_staging",
    },
  };

  const environment = environments[config.mode];

  if (
    !environment ||
    config.apiOrigin !== environment.apiOrigin ||
    config.provider !== environment.provider
  ) {
    throw new Error("Ozow payment environment does not match.");
  }

  if (
    typeof config.siteCode !== "string" ||
    !config.siteCode.trim() ||
    config.siteCode.length > 50
  ) {
    throw new Error("Invalid Ozow Site Code.");
  }

  const baseUrl = new URL(config.baseUrl);

  if (
    baseUrl.protocol !== "https:" ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.pathname !== "/" ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    throw new Error("Invalid Ozow public origin.");
  }

  const siteCode = config.siteCode;
  const publicOrigin = baseUrl.origin;

  const tokenProvider =
    getAccessToken ?? createOzowTokenProvider(config, { fetchImpl, now });

  return {
    async createPaymentRequest(attempt) {
      const { orderId, paymentReference, amountCents, provider, expiresAt } =
        attempt;

      if (!Number.isInteger(orderId) || orderId < 1 || orderId > 2147483647) {
        throw new Error("Invalid checkout order ID.");
      }

      if (
        typeof paymentReference !== "string" ||
        !UUID.test(paymentReference)
      ) {
        throw new Error("Invalid payment reference.");
      }

      if (provider !== environment.provider) {
        throw new Error("Payment attempt belongs to another provider.");
      }

      if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
        throw new Error("Invalid payment amount.");
      }

      // The store uses integer cents; Ozow expects a rand amount.
      const amount = amountCents / 100;

      if (Math.round(amount * 100) !== amountCents) {
        throw new Error("Payment amount cannot be represented accurately.");
      }

      // The caller supplies the expiry saved for this attempt.
      // Never generate a different expiry when reusing a request.
      const expiryMs =
        typeof expiresAt === "string" ? Date.parse(expiresAt) : NaN;

      if (!Number.isFinite(expiryMs) || expiryMs <= now()) {
        throw new Error("The payment request expiry is invalid or expired.");
      }

      const payload = {
        siteCode,
        region: "ZA",
        amount: {
          currency: "ZAR",
          value: amount,
        },
        merchantReference: paymentReference,
        beneficiaryReference: `IC${orderId}`,
        expireAt: new Date(expiryMs).toISOString(),
        returnUrl: `${publicOrigin}/orders/${orderId}/payment`,
      };

      // Authentication failure occurs before any payment POST.
      const accessToken = await tokenProvider();

      if (
        typeof accessToken !== "string" ||
        !accessToken.trim() ||
        /[\r\n]/.test(accessToken)
      ) {
        throw new Error("Invalid Ozow access token.");
      }

      let response;

      try {
        response = await fetchImpl(`${environment.apiOrigin}/v1/payments`, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(20_000),
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "Idempotency-Key": paymentReference,
          },
          body: JSON.stringify(payload),
        });
       } catch (cause) {
        const error = uncertainOutcome(
          "Ozow payment request outcome is unknown. Review before retrying.",
        );

        error.cause = cause;
        throw error;
      }

      if (!response.ok) {
        // Keep the attempt unresolved until its outcome is checked.
        // Do not release stock or create another provider attempt here.
        throw uncertainOutcome(
          `Ozow payment request returned HTTP ${response.status}.`,
        );
      }

      let data;

      try {
        data = await response.json();
      } catch {
        throw uncertainOutcome("Ozow returned an unreadable payment response.");
      }

      if (
        typeof data.id !== "string" ||
        !UUID.test(data.id) ||
        data.status !== "Created"
      ) {
        throw uncertainOutcome("Ozow did not return a usable payment request.");
      }

      let checkoutUrl;

      try {
        if (
          typeof data.redirectUrl !== "string" ||
          data.redirectUrl.length > 2048
        ) {
          throw new Error("Invalid URL.");
        }

        checkoutUrl = new URL(data.redirectUrl);
      } catch {
        throw uncertainOutcome("Ozow did not return a valid checkout URL.");
      }

      if (
        checkoutUrl.protocol !== "https:" ||
        checkoutUrl.hostname !== environment.checkoutHost ||
        checkoutUrl.port ||
        checkoutUrl.username ||
        checkoutUrl.password ||
        checkoutUrl.hash
      ) {
        throw uncertainOutcome(
          "Ozow returned an unexpected checkout destination.",
        );
      }

      return {
        providerRequestId: data.id,
        checkoutUrl: checkoutUrl.href,
        expiresAt: payload.expireAt,
      };
    },
  };
}
