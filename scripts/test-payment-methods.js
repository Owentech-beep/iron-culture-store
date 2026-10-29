import "dotenv/config";
import assert from "node:assert/strict";
import fs from "node:fs";
import ejs from "ejs";
import { pool } from "../config/database.js";
import {
  getAvailablePaymentMethods,
} from "../services/payments/paymentService.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const originalQuery = pool.query;
const originalConnect = pool.connect;

function forbidden() {
  throw new Error("This test must not access the database or network.");
}

globalThis.fetch = forbidden;
pool.query = forbidden;
pool.connect = forbidden;

function ids(isDemo) {
  return getAvailablePaymentMethods(isDemo).map((method) => method.id);
}

try {
  // Fake credentials, confined to this test process.
  Object.assign(process.env, {
    NODE_ENV: "development",
    PAYFAST_MODE: "sandbox",
    PAYFAST_CHECKOUT_ENABLED: "true",
    PAYFAST_MERCHANT_ID: "10000100",
    PAYFAST_MERCHANT_KEY: "test-merchant-key",
    PAYFAST_PASSPHRASE: "test-passphrase",
    PAYFAST_PUBLIC_BASE_URL: "https://example.com",
    OZOW_MODE: "staging",
    OZOW_CHECKOUT_ENABLED: "true",
    OZOW_CLIENT_ID: "test-client",
    OZOW_CLIENT_SECRET: "test-secret",
    OZOW_SITE_CODE: "TEST-SITE",
    OZOW_PUBLIC_BASE_URL: "https://example.com",
  });

  assert.deepEqual(ids(true), ["payfast", "ozow"]);
  assert.deepEqual(ids(false), []);

  console.log("PASS: test providers appear only for demo orders.");

  process.env.PAYFAST_CHECKOUT_ENABLED = "false";
  assert.deepEqual(ids(true), ["ozow"]);

  process.env.PAYFAST_CHECKOUT_ENABLED = "true";
  process.env.OZOW_CHECKOUT_ENABLED = "false";
  assert.deepEqual(ids(true), ["payfast"]);

  process.env.PAYFAST_CHECKOUT_ENABLED = "false";
  assert.deepEqual(ids(true), []);

  console.log("PASS: each checkout switch works independently.");

  process.env.PAYFAST_CHECKOUT_ENABLED = "true";
  process.env.OZOW_CHECKOUT_ENABLED = "true";
  process.env.PAYFAST_MERCHANT_ID = "";

  assert.deepEqual(ids(true), ["ozow"]);

  process.env.PAYFAST_MERCHANT_ID = "10000100";
  process.env.OZOW_CLIENT_SECRET = "";

  assert.deepEqual(ids(true), ["payfast"]);

  console.log("PASS: invalid configuration for one provider does not hide the other.");

  process.env.OZOW_CLIENT_SECRET = "test-secret";
  process.env.NODE_ENV = "production";
  process.env.PAYFAST_MODE = "live";
  process.env.OZOW_MODE = "live";

  assert.deepEqual(ids(false), ["payfast", "ozow"]);
  assert.deepEqual(ids(true), []);

  console.log("PASS: live providers appear only for non-demo orders.");

  const methods = getAvailablePaymentMethods(false);

  for (const method of methods) {
    assert.deepEqual(
      Object.keys(method).sort(),
      ["id", "label", "mode"],
    );
  }

  console.log("PASS: template payment options contain no credentials.");

  const templateFile = "views/checkout-review.ejs";
  const template = fs.readFileSync(templateFile, "utf8")
    .replace(/<%-\s*include\([^]*?\)\s*%>/g, "");

  const locals = {
    csrfToken: "test-csrf",
    cart: {
      subtotalCents: 60000,
      items: [{
        name: "Test product",
        variantName: "Test option",
        quantity: 1,
        lineTotalCents: 60000,
        isDemo: false,
      }],
    },
    draft: {
      token: "test-checkout-token",
      address: {
        firstName: "Test",
        lastName: "Customer",
        street: "Test street",
        suburb: "Test suburb",
        city: "Test city",
        province: "Free State",
        postalCode: "9730",
        email: "test@example.com",
        phone: "0000000000",
      },
    },
    shipping: {
      status: "flat_rate",
      deliveryCents: 9900,
      totalCents: 69900,
    },
    formatMoney: (cents) => `R ${(cents / 100).toFixed(2)}`,
  };

  let html = ejs.render(
    template,
    { ...locals, paymentMethods: methods },
    { filename: templateFile },
  );

  assert.match(html, /name="paymentProvider"/);
  assert.match(html, /value="payfast"/);
  assert.match(html, /value="ozow"/);
  assert.match(html, /R 99\.00/);
  assert.match(html, /R 699\.00/);
  assert.match(html, /name="_csrf"/);
  assert.match(html, /name="checkoutToken"/);

  html = ejs.render(
    template,
    { ...locals, paymentMethods: [] },
    { filename: templateFile },
  );

  assert.doesNotMatch(html, /name="paymentProvider"/);
  assert.doesNotMatch(html, /type="submit"/);
  assert.match(html, /temporarily unavailable/i);

  console.log("PASS: review shows available methods, delivery and total.");
  console.log("PASS: unavailable checkout has no payment submission button.");
  console.log("No database access or network requests were made.");
} finally {
  globalThis.fetch = originalFetch;
  pool.query = originalQuery;
  pool.connect = originalConnect;

  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }

  Object.assign(process.env, originalEnv);
  await pool.end();
}