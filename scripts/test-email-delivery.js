import assert from "node:assert/strict";
import { deliverQueuedEmail } from "../services/emailDeliveryService.js";

const config = { apiKey: "test-only-not-a-real-key" };

const email = {
  delivery_key: "11111111-1111-4111-8111-111111111111",
  attempt_count: 1,
  delivery_payload: {
    from: "Test <sender@example.com>",
    to: ["recipient@example.com"],
    subject: "[SANDBOX TEST] Disposable test",
    text: "Test content only.",
  },
};

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

const requests = [];

async function successfulFetch(url, options) {
  requests.push({ url, options });
  return response(200, { id: "test-provider-email-id" });
}

// Every delivery call receives a fake fetch function.
// No actual network request is made.
const sent = await deliverQueuedEmail(email, config, successfulFetch);

assert.equal(sent.status, "sent");
assert.equal(sent.providerId, "test-provider-email-id");
assert.equal(sent.message, null);

console.log("PASS: provider acceptance records a sent result.");

await deliverQueuedEmail(
  { ...email, attempt_count: 2 },
  config,
  successfulFetch,
);

assert.equal(
  requests[0].options.headers["Idempotency-Key"],
  requests[1].options.headers["Idempotency-Key"],
);
assert.equal(requests[0].options.body, requests[1].options.body);
assert.deepEqual(
  JSON.parse(requests[0].options.body),
  email.delivery_payload,
);

console.log("PASS: retries preserve the delivery key and payload.");

for (const httpStatus of [429, 500, 503]) {
  const result = await deliverQueuedEmail(
    email,
    config,
    async () => response(httpStatus, {}),
  );

  assert.equal(result.status, "pending");
  assert.equal(result.providerId, null);
}

console.log("PASS: rate limits and server errors remain retryable.");

const networkFailure = await deliverQueuedEmail(
  email,
  config,
  async () => {
    throw new Error("Simulated connection failure");
  },
);

assert.equal(networkFailure.status, "pending");
assert.match(networkFailure.message, /uncertain/i);

console.log("PASS: network failures preserve an uncertain outcome.");

const malformedSuccess = await deliverQueuedEmail(
  email,
  config,
  async () => response(200, {}),
);

assert.equal(malformedSuccess.status, "pending");
assert.equal(malformedSuccess.providerId, null);

console.log("PASS: success without a provider ID is not marked sent.");

for (const httpStatus of [400, 401, 403, 409, 422]) {
  const result = await deliverQueuedEmail(
    email,
    config,
    async () => response(httpStatus, {}),
  );

  assert.equal(result.status, "review_required");
}

console.log("PASS: rejected requests require review.");

const finalFailure = await deliverQueuedEmail(
  { ...email, attempt_count: 5 },
  config,
  async () => response(503, {}),
);

assert.equal(finalFailure.status, "review_required");

const finalSuccess = await deliverQueuedEmail(
  { ...email, attempt_count: 5 },
  config,
  successfulFetch,
);

assert.equal(finalSuccess.status, "sent");

console.log("PASS: fifth failure stops retries; fifth success remains sent.");
console.log("No emails were sent and no database records were changed.");