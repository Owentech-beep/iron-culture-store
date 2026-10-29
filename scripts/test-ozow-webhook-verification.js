import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";

import {
  verifyOzowWebhook,
} from "../services/payments/ozowWebhookVerification.js";

const key = randomBytes(32);
const secret = `whsec_${key.toString("base64")}`;
const messageId = "msg_local_ozow_verification_test";

const body = Buffer.from(
  JSON.stringify({
    test: true,
    description: "Local signature verification fixture",
  }),
);

function signedHeaders(
  payload = body,
  timestamp = Math.floor(Date.now() / 1000),
  signingKey = key,
) {
  const signature = createHmac("sha256", signingKey)
    .update(`${messageId}.${timestamp}.`)
    .update(payload)
    .digest("base64");

  return {
    "svix-id": messageId,
    "svix-timestamp": String(timestamp),
    "svix-signature": `v1,${signature}`,
  };
}

function rejected(payload, headers, expectedStatus = 403) {
  assert.throws(
    () => verifyOzowWebhook(payload, headers, secret),
    (error) => error.status === expectedStatus,
  );
}

const headers = signedHeaders();

const verified = verifyOzowWebhook(body, headers, secret);

assert.equal(verified.messageId, messageId);
assert.equal(verified.event.test, true);

console.log("PASS: valid signature returns the authenticated event.");

rejected(
  Buffer.from(JSON.stringify({ test: false })),
  headers,
);

console.log("PASS: changed notification body is rejected.");

for (const name of [
  "svix-id",
  "svix-timestamp",
  "svix-signature",
]) {
  const missing = { ...headers };
  delete missing[name];
  rejected(body, missing);
}

console.log("PASS: each signature header is required.");

rejected(body, {
  ...headers,
  "svix-id": "msg_changed",
});

rejected(body, signedHeaders(body, Math.floor(Date.now() / 1000), randomBytes(32)));

console.log("PASS: changed message ID and wrong signing key are rejected.");

const now = Math.floor(Date.now() / 1000);

rejected(body, signedHeaders(body, now - 600));
rejected(body, signedHeaders(body, now + 600));

console.log("PASS: stale and future-dated signatures are rejected.");

const rotationHeaders = {
  ...headers,
  "svix-signature": [
    `v1,${randomBytes(32).toString("base64")}`,
    headers["svix-signature"],
  ].join(" "),
};

assert.equal(
  verifyOzowWebhook(body, rotationHeaders, secret).messageId,
  messageId,
);

console.log("PASS: a valid signature is accepted during key rotation.");

rejected({ test: true }, headers, 400);
rejected(Buffer.alloc(128 * 1024 + 1), headers, 400);

console.log("PASS: parsed objects and oversized bodies are rejected.");

assert.throws(
  () => verifyOzowWebhook(body, headers, ""),
  (error) => error.status === 503,
);

console.log("PASS: missing webhook configuration fails closed.");

const previousEnabled = process.env.OZOW_CHECKOUT_ENABLED;

try {
  process.env.OZOW_CHECKOUT_ENABLED = "false";

  assert.equal(
    verifyOzowWebhook(body, headers, secret).messageId,
    messageId,
  );
} finally {
  if (previousEnabled === undefined) {
    delete process.env.OZOW_CHECKOUT_ENABLED;
  } else {
    process.env.OZOW_CHECKOUT_ENABLED = previousEnabled;
  }
}

console.log("PASS: disabling new checkout does not block valid notifications.");
console.log("No network requests were sent or database records changed.");