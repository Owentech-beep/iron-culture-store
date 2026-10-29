import assert from "node:assert/strict";

import { getOzowConfig } from "../config/ozow.js";
import { createOzowTokenProvider } from "../services/payments/ozowToken.js";

assert.equal(getOzowConfig({}), null);

assert.equal(
  getOzowConfig({
    OZOW_CHECKOUT_ENABLED: "false",
    OZOW_MODE: "invalid",
  }),
  null,
);

assert.throws(() =>
  getOzowConfig({ OZOW_CHECKOUT_ENABLED: "yes" }),
);

const env = {
  OZOW_CHECKOUT_ENABLED: "true",
  OZOW_MODE: "live",
  OZOW_CLIENT_ID: "test-client",
  OZOW_CLIENT_SECRET: "test-secret",
  OZOW_SITE_CODE: "TST-TST-001",
  OZOW_PUBLIC_BASE_URL: "https://example.com",
};

const config = getOzowConfig(env);

assert.equal(config.provider, "ozow_live");
assert.equal(config.apiOrigin, "https://one.ozow.com");

assert.throws(() =>
  getOzowConfig({
    ...env,
    OZOW_PUBLIC_BASE_URL: "https://example.com/checkout",
  }),
);

console.log("PASS: disabled Ozow needs no credentials; enabled config validates.");

let clock = 0;
let calls = 0;
let failNext = false;

const getToken = createOzowTokenProvider(config, {
  now: () => clock,

  fetchImpl: async (url, options) => {
    calls += 1;

    assert.equal(url, "https://one.ozow.com/v1/token");
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    assert.equal(options.body.get("scope"), "payments");
    assert.equal(
      options.body.get("grant_type"),
      "client_credentials",
    );

    if (failNext) {
      failNext = false;
      return {
        ok: false,
        status: 503,
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        access_token: `fake-token-${calls}`,
        token_type: "Bearer",
        expires_in: "120",
        scope: "payments",
      }),
    };
  },
});

const tokens = await Promise.all([
  getToken(),
  getToken(),
  getToken(),
]);

assert.equal(calls, 1);
assert.ok(tokens.every((token) => token === tokens[0]));

await getToken();
assert.equal(calls, 1);

console.log("PASS: concurrent calls share one request and reuse the cached token.");

clock = 109_000;

await getToken();
assert.equal(calls, 2);

console.log("PASS: token refreshes before expiry.");

clock = 218_000;
failNext = true;

await assert.rejects(getToken(), /HTTP 503/);
assert.equal(calls, 3);

await getToken();
assert.equal(calls, 4);

console.log("PASS: authentication failure does not poison subsequent requests.");

const invalidToken = createOzowTokenProvider(config, {
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      token_type: "Bearer",
      expires_in: 120,
    }),
  }),
});

await assert.rejects(invalidToken(), /incomplete authentication response/);

console.log("PASS: incomplete token responses are rejected.");
console.log("No network requests were sent or database records changed.");