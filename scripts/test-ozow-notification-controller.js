import assert from "node:assert/strict";
import { createOzowNotificationHandler } from
  "../controllers/ozowNotificationController.js";

const notification = {
  messageId: "test-message",
  provider: "ozow_staging",
  paymentReference: "00000000-0000-4000-8000-000000000001",
  providerPaymentId: "00000000-0000-4000-8000-000000000002",
  amountCents: 45400,
  paymentStatus: "COMPLETE",
};

function failure(properties) {
  return Object.assign(new Error("Test failure"), properties);
}

async function run({
  status = "COMPLETE",
  verificationError,
  completionError,
  reconciliationError,
  json = true,
} = {}) {
  const calls = [];

  const handler = createOzowNotificationHandler({
    verify(body) {
      calls.push("verify");
      assert.ok(Buffer.isBuffer(body));

      if (verificationError) throw verificationError;

      return { ...notification, paymentStatus: status };
    },

    async complete(value) {
      calls.push("complete");
      assert.equal(value.paymentStatus, "COMPLETE");

      if (completionError) throw completionError;

      return { orderId: 1, alreadyProcessed: false };
    },

    async reconcile(value) {
      calls.push("reconcile");
      assert.equal(value.paymentStatus, status);

      if (reconciliationError) throw reconciliationError;
    },

    logger: { error() {} },
  });

  const req = {
    body: Buffer.from("{}"),
    headers: {},
    is(type) {
      assert.equal(type, "application/json");
      return json;
    },
  };

  const res = {
    statusCode: 200,
    body: null,
    set() { return this; },
    status(value) {
      this.statusCode = value;
      return this;
    },
    type() { return this; },
    send(value) {
      this.body = value;
      return this;
    },
  };

  await handler(req, res);
  return { calls, status: res.statusCode, body: res.body };
}

let result = await run();

assert.deepEqual(result.calls, ["verify", "complete"]);
assert.equal(result.status, 200);
assert.equal(result.body, "OK");
console.log("PASS: completed payment is acknowledged.");

for (const status of ["PENDING", "INCOMPLETE", "ERROR"]) {
  result = await run({ status });

  assert.deepEqual(result.calls, ["verify", "reconcile"]);
  assert.equal(result.status, 200);
}

console.log("PASS: non-success notifications are saved for review.");

for (const completionError of [
  failure({ status: 409 }),
  failure({ code: "23505" }),
]) {
  result = await run({ completionError });

  assert.deepEqual(result.calls, ["verify", "complete", "reconcile"]);
  assert.equal(result.status, 200);
}

console.log("PASS: completion conflicts are acknowledged after reconciliation.");

result = await run({
  completionError: failure({ status: 409 }),
  reconciliationError: failure({ code: "TEST_DATABASE_FAILURE" }),
});

assert.equal(result.status, 500);
assert.notEqual(result.body, "OK");

result = await run({
  status: "PENDING",
  reconciliationError: failure({ code: "TEST_DATABASE_FAILURE" }),
});

assert.equal(result.status, 500);

console.log("PASS: failed reconciliation is not acknowledged.");

result = await run({
  completionError: failure({ code: "TEST_DATABASE_FAILURE" }),
});

assert.deepEqual(result.calls, ["verify", "complete"]);
assert.equal(result.status, 500);

console.log("PASS: unexpected completion failures remain retryable.");

for (const status of [400, 403, 503]) {
  result = await run({
    verificationError: failure({ status }),
  });

  assert.deepEqual(result.calls, ["verify"]);
  assert.equal(result.status, status);
}

console.log("PASS: failed verification cannot reach payment processing.");

result = await run({ json: false });

assert.deepEqual(result.calls, []);
assert.equal(result.status, 415);

console.log("PASS: unsupported content types are rejected.");
console.log("No network requests were sent or database records changed.");