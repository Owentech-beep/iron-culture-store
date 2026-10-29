import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import express from "express";

import { createOzowNotificationRouter } from
  "../routes/ozowNotificationRoutes.js";
import { verifyOzowNotification } from
  "../services/payments/ozowNotification.js";

const key = randomBytes(32);

const testEnv = {
  OZOW_MODE: "staging",
  OZOW_SITE_CODE: "TEST-SITE",
  OZOW_CHECKOUT_ENABLED: "false",
  OZOW_WEBHOOK_SECRET: `whsec_${key.toString("base64")}`,
};

const calls = [];
let failCompletion = false;
let failReconciliation = false;

const app = express();

app.use(
  "/payments/ozow",
  createOzowNotificationRouter({
    verify(body, headers) {
      assert.ok(Buffer.isBuffer(body));
      return verifyOzowNotification(body, headers, testEnv);
    },

    async complete(notification) {
      calls.push("complete");
      assert.equal(notification.amountCents, 45400);
      assert.equal(notification.provider, "ozow_staging");

      if (failCompletion) {
        throw Object.assign(new Error("Test conflict"), { status: 409 });
      }

      return { orderId: 1, alreadyProcessed: false };
    },

    async reconcile() {
      calls.push("reconcile");

      if (failReconciliation) {
        throw new Error("Test database failure");
      }
    },

    logger: { error() {} },
  }),
);

// Match the intended ordering in app.js.
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// A webhook must finish before reaching session/CSRF middleware.
app.use((req, res) => {
  res.status(403).send("Reached protected application middleware.");
});

app.use((error, req, res, next) => {
  res.status(error.status || 500).send("Request rejected.");
});

function makeBody(status = "Successful") {
  // Deliberate whitespace tests preservation of the exact signed bytes.
  return Buffer.from(JSON.stringify({
    type: "transaction.complete",
    timestamp: new Date().toISOString(),
    data: {
      SiteCode: testEnv.OZOW_SITE_CODE,
      TransactionId: randomUUID(),
      TransactionReference: randomUUID(),
      Amount: "454.00",
      Status: status,
      CurrencyCode: "ZAR",
      IsTest: "True",
    },
  }, null, 2));
}

function sign(body) {
  const id = `msg_${randomUUID()}`;
  const timestamp = String(Math.floor(Date.now() / 1000));

  const signature = createHmac("sha256", key)
    .update(`${id}.${timestamp}.`)
    .update(body)
    .digest("base64");

  return {
    "content-type": "application/json",
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,${signature}`,
  };
}

const server = app.listen(0, "127.0.0.1");

try {
  await once(server, "listening");

  const url =
    `http://127.0.0.1:${server.address().port}/payments/ozow/notify`;

  async function send(body, headers = sign(body)) {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });

    return {
      status: response.status,
      body: await response.text(),
      cacheControl: response.headers.get("cache-control"),
    };
  }

  let result = await send(makeBody());

  assert.equal(result.status, 200);
  assert.equal(result.body, "OK");
  assert.equal(result.cacheControl, "no-store");
  assert.deepEqual(calls, ["complete"]);

  console.log(
    "PASS: signed raw JSON reaches completion without session or CSRF.",
  );

  calls.length = 0;

  const original = makeBody();
  const changed = Buffer.from(
    original.toString().replace('"454.00"', '"1.00"'),
  );

  result = await send(changed, sign(original));

  assert.equal(result.status, 403);
  assert.deepEqual(calls, []);

  result = await send(makeBody(), {
    "content-type": "application/json",
  });

  assert.equal(result.status, 403);
  assert.deepEqual(calls, []);

  console.log("PASS: altered bodies and missing signatures cannot process payments.");

  result = await send(makeBody(), {
    "content-type": "text/plain",
  });

  assert.equal(result.status, 415);
  assert.deepEqual(calls, []);

  const oversized = Buffer.alloc(129 * 1024, "x");
  result = await send(oversized);

  assert.equal(result.status, 413);
  assert.deepEqual(calls, []);

  console.log("PASS: wrong content type and oversized bodies are rejected.");

  result = await send(makeBody("Pending"));

  assert.equal(result.status, 200);
  assert.deepEqual(calls, ["reconcile"]);

  console.log("PASS: pending notifications reach reconciliation only.");

  calls.length = 0;
  failCompletion = true;

  result = await send(makeBody());

  assert.equal(result.status, 200);
  assert.deepEqual(calls, ["complete", "reconcile"]);

  calls.length = 0;
  failReconciliation = true;

  result = await send(makeBody());

  assert.equal(result.status, 500);
  assert.notEqual(result.body, "OK");
  assert.deepEqual(calls, ["complete", "reconcile"]);

  console.log("PASS: conflicts are acknowledged only after review evidence is saved.");
  console.log("Only a temporary localhost server was contacted.");
  console.log("No database records changed or external payment requests were sent.");
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}