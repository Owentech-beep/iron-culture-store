import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { verifyOzowNotification } from
  "../services/payments/ozowNotification.js";

const key = randomBytes(32);

const env = {
  OZOW_MODE: "live",
  OZOW_SITE_CODE: "TEST-SITE",
  OZOW_CHECKOUT_ENABLED: "false",
  OZOW_WEBHOOK_SECRET: `whsec_${key.toString("base64")}`,
};

const reference = randomUUID();
const transactionId = randomUUID();

const baseData = {
  SiteCode: env.OZOW_SITE_CODE,
  TransactionId: transactionId,
  TransactionReference: reference,
  Amount: "454.00",
  Status: "Successful",
  CurrencyCode: "ZAR",
  IsTest: "False",
};

function signed(data, type = "transaction.complete") {
  const body = Buffer.from(JSON.stringify({
    type,
    timestamp: new Date().toISOString(),
    data,
  }));

  const id = `msg_${randomUUID()}`;
  const timestamp = String(Math.floor(Date.now() / 1000));

  const signature = createHmac("sha256", key)
    .update(`${id}.${timestamp}.`)
    .update(body)
    .digest("base64");

  return {
    body,
    headers: {
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${signature}`,
    },
  };
}

function verify(data, configuration = env, type) {
  const { body, headers } = signed(data, type);
  return verifyOzowNotification(body, headers, configuration);
}

const result = verify(baseData);

assert.equal(result.provider, "ozow_live");
assert.equal(result.paymentReference, reference);
assert.equal(result.providerPaymentId, transactionId);
assert.equal(result.amountCents, 45400);
assert.equal(result.paymentStatus, "COMPLETE");

console.log("PASS: authenticated full notification produces payment details.");

for (const [amount, expected] of [
  ["0.01", 1],
  ["348.00", 34800],
  ["749.99", 74999],
  ["750.00", 75000],
]) {
  assert.equal(verify({ ...baseData, Amount: amount }).amountCents, expected);
}

console.log("PASS: amounts convert to exact integer cents.");

for (const amount of [
  "0.00", "-1.00", "454", "454.001", "4e2",
  "454,00", " 454.00", "99999999999999.99", 454,
]) {
  assert.throws(
    () => verify({ ...baseData, Amount: amount }),
    { status: 400 },
  );
}

console.log("PASS: malformed, zero and excessive amounts are rejected.");

assert.throws(
  () => verify({ ...baseData, SiteCode: "OTHER-SITE" }),
  { status: 403 },
);

assert.throws(
  () => verify({ ...baseData, CurrencyCode: "USD" }),
  { status: 400 },
);

assert.throws(
  () => verify({ ...baseData, IsTest: "True" }),
  { status: 403 },
);

for (const field of ["TransactionReference", "TransactionId"]) {
  assert.throws(
    () => verify({ ...baseData, [field]: "invalid" }),
    { status: 400 },
  );
}

console.log("PASS: wrong site, currency, environment and identifiers are rejected.");

for (const [status, expected] of [
  ["Incomplete", "INCOMPLETE"],
  ["Pending", "PENDING"],
  ["Error", "ERROR"],
]) {
  assert.equal(
    verify({ ...baseData, Status: status }).paymentStatus,
    expected,
  );
}

assert.throws(
  () => verify({ ...baseData, Status: "Complete" }),
  { status: 400 },
);

assert.throws(
  () => verify({ id: transactionId, status: "Successful" }),
  { status: 400 },
);

assert.throws(
  () => verify(baseData, env, "refund.complete"),
  { status: 400 },
);

console.log("PASS: non-success states stay distinct; thin and unrelated events are rejected.");

const staging = verify(
  { ...baseData, IsTest: "True" },
  { ...env, OZOW_MODE: "staging" },
);

assert.equal(staging.provider, "ozow_staging");

const tampered = signed(baseData);
const changedBody = Buffer.from(
  tampered.body.toString().replace('"454.00"', '"1.00"'),
);

assert.throws(
  () => verifyOzowNotification(changedBody, tampered.headers, env),
  { status: 403 },
);

assert.throws(
  () => verify(baseData, { ...env, OZOW_SITE_CODE: "" }),
  { status: 503 },
);

console.log("PASS: staging is separate; altered signatures and missing configuration fail.");
console.log("PASS: disabled checkout does not block authenticated notifications.");
console.log("No network requests were sent or database records changed.");