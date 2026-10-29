import assert from "node:assert/strict";

import {
  createOzowPaymentClient,
} from "../services/payments/ozowPayment.js";

const clock = Date.parse("2026-01-01T12:00:00Z");

const config = Object.freeze({
  enabled: true,
  mode: "live",
  provider: "ozow_live",
  apiOrigin: "https://one.ozow.com",
  baseUrl: "https://example.com",
  siteCode: "TST-TST-001",
});

const attempt = Object.freeze({
  orderId: 3,
  paymentReference: "00000000-0000-4000-8000-000000000001",
  amountCents: 45400,
  provider: "ozow_live",
  expiresAt: "2026-01-01T12:30:00.000Z",
});

const requestId = "00000000-0000-4000-8000-000000000002";

const validResponse = {
  id: requestId,
  status: "Created",
  redirectUrl: `https://pay.ozow.com/${requestId}/secure`,
};

let calls = 0;
let sentRequest;
let behaviour = "success";
let responseData = validResponse;
let httpStatus = 201;

const client = createOzowPaymentClient(config, {
  now: () => clock,
  getAccessToken: async () => "fake-access-token",

  fetchImpl: async (url, options) => {
    calls += 1;
    sentRequest = { url, options };

    if (behaviour === "network") {
      throw new Error("Simulated connection failure.");
    }

    return {
      ok: httpStatus >= 200 && httpStatus < 300,
      status: httpStatus,
      json: async () => {
        if (behaviour === "invalid-json") {
          throw new Error("Invalid JSON.");
        }

        return responseData;
      },
    };
  },
});

const result = await client.createPaymentRequest(attempt);

assert.equal(calls, 1);
assert.equal(result.providerRequestId, requestId);
assert.equal(result.checkoutUrl, validResponse.redirectUrl);

assert.equal(
  sentRequest.url,
  "https://one.ozow.com/v1/payments",
);

assert.equal(
  sentRequest.options.headers["Idempotency-Key"],
  attempt.paymentReference,
);

assert.equal(sentRequest.options.redirect, "error");

const payload = JSON.parse(sentRequest.options.body);

assert.deepEqual(payload.amount, {
  currency: "ZAR",
  value: 454,
});

assert.equal(payload.region, "ZA");
assert.equal(payload.merchantReference, attempt.paymentReference);
assert.equal(payload.beneficiaryReference, "IC3");
assert.equal(payload.expireAt, attempt.expiresAt);
assert.equal(payload.returnUrl, "https://example.com/orders/3/payment");
assert.equal(Object.hasOwn(payload, "variableAmount"), false);

console.log("PASS: request uses ZAR, database amount and stable payment reference.");
console.log("PASS: valid Ozow request ID and checkout URL are returned.");

for (const changes of [
  { amountCents: 0 },
  { amountCents: 1.5 },
  { paymentReference: "invalid" },
  { provider: "payfast_live" },
  { expiresAt: "2025-01-01T00:00:00Z" },
]) {
  const before = calls;

  await assert.rejects(
    client.createPaymentRequest({ ...attempt, ...changes }),
  );

  assert.equal(calls, before);
}

console.log("PASS: invalid attempts are rejected before sending.");

for (const redirectUrl of [
  "https://pay.ozow.com.evil.example/checkout",
  "https://evil.example/checkout",
  "http://pay.ozow.com/checkout",
  "https://user:password@pay.ozow.com/checkout",
  "https://stagingpay.ozow.com/checkout",
]) {
  responseData = { ...validResponse, redirectUrl };

  await assert.rejects(
    client.createPaymentRequest(attempt),
    (error) => error.requestMayExist === true,
  );
}

console.log("PASS: unsafe and wrong-environment checkout URLs are rejected.");

responseData = { ...validResponse, id: undefined };

await assert.rejects(
  client.createPaymentRequest(attempt),
  (error) => error.code === "OZOW_REQUEST_UNRESOLVED",
);

console.log("PASS: success without a request ID remains unresolved.");

responseData = validResponse;

for (const failure of ["network", "invalid-json", "http"]) {
  behaviour = failure;
  httpStatus = failure === "http" ? 503 : 201;
  const before = calls;

  await assert.rejects(
    client.createPaymentRequest(attempt),
    (error) => error.requestMayExist === true,
  );

  assert.equal(calls, before + 1);
}

console.log("PASS: uncertain responses are not automatically retried.");

let paymentPosts = 0;

const authFailureClient = createOzowPaymentClient(config, {
  now: () => clock,
  getAccessToken: async () => {
    throw new Error("Authentication unavailable.");
  },
  fetchImpl: async () => {
    paymentPosts += 1;
    throw new Error("Payment POST must not run.");
  },
});

await assert.rejects(
  authFailureClient.createPaymentRequest(attempt),
  /Authentication unavailable/,
);

assert.equal(paymentPosts, 0);

console.log("PASS: authentication failure prevents the payment POST.");
console.log("No network requests were sent or database records changed.");