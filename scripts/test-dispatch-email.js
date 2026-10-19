import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { pool } from "../config/database.js";
import { queueOrderEmail } from "../services/orderEmailService.js";
import { availableOrderStatuses } from "../models/AdminOrder.js";

let client;
let transactionStarted = false;

try {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.EMAIL_MODE !== "test" ||
    process.env.DATABASE_URL
  ) {
    throw new Error("Run only against local development PostgreSQL.");
  }

  client = await pool.connect();

  const { rows: connection } = await client.query(
    `SELECT
       current_database() AS database,
       host(inet_server_addr()) AS address`,
  );

  assert.equal(connection[0].database, "iron_culture_store");
  assert.ok(
    ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
      connection[0].address,
    ),
    "Expected local PostgreSQL.",
  );

  await client.query("BEGIN");
  transactionStarted = true;

  const schema = `dispatch_test_${randomUUID().replaceAll("-", "")}`;

  // Everything, including this schema, will be rolled back.
  await client.query(`CREATE SCHEMA "${schema}"`);

  await client.query(
    `CREATE TABLE "${schema}".orders
     (LIKE public.orders INCLUDING ALL)`,
  );

  await client.query(
    `CREATE TABLE "${schema}".email_outbox
     (LIKE public.email_outbox INCLUDING ALL)`,
  );

  await client.query(`SET LOCAL search_path TO "${schema}"`);

  const { rows: location } = await client.query(
    "SELECT current_schema() AS schema",
  );

  assert.equal(location[0].schema, schema);

  // Fictional shipped order in the isolated schema.
  // No real payment, inventory deduction or dispatch takes place.
  const { rows } = await client.query(
    `INSERT INTO orders (
       user_id,
       order_number,
       checkout_key,
       status,
       payment_status,
       shipping_rate_status,
       shipping_address,
       subtotal_cents,
       delivery_cents,
       total_cents,
       is_demo,
       stock_deducted_at,
       shipped_at,
       tracking_courier,
       tracking_number
     )
     VALUES (
       1, $1, $2,
       'shipped', 'paid', 'free',
       $3::JSONB,
       60000, 0, 60000, FALSE,
       NOW(), NOW(),
       'The Courier Guy', 'TEST-TRACKING-ONLY'
     )
     RETURNING id`,
    [
      `TEST-${randomUUID()}`,
      randomUUID(),
      JSON.stringify({ email: "dispatch-test@example.com" }),
    ],
  );

  const orderId = rows[0].id;

  const emailId = await queueOrderEmail(
    client,
    orderId,
    "order_shipped",
  );

  assert.ok(Number.isInteger(emailId));

  const duplicate = await queueOrderEmail(
    client,
    orderId,
    "order_shipped",
  );

  assert.equal(duplicate, null);

  const { rows: emails } = await client.query(
    "SELECT * FROM email_outbox WHERE order_id = $1",
    [orderId],
  );

  assert.equal(emails.length, 1);
  assert.equal(emails[0].event_type, "order_shipped");
  assert.equal(emails[0].event_version, 0);
  assert.equal(emails[0].status, "pending");
  assert.equal(emails[0].attempt_count, 0);
  assert.equal(emails[0].is_demo, false);
  assert.equal(emails[0].recipient, "dispatch-test@example.com");
  assert.match(emails[0].text_body, /The Courier Guy/);
  assert.match(emails[0].text_body, /TEST-TRACKING-ONLY/);

  console.log("PASS: dispatch email includes courier and tracking details.");
  console.log("PASS: repeated queuing creates only one dispatch email.");

  async function expectRejected() {
    await assert.rejects(
      () => queueOrderEmail(client, orderId, "order_shipped"),
      /Dispatch email requires/,
    );
  }

  await client.query(
    "UPDATE orders SET is_demo = TRUE WHERE id = $1",
    [orderId],
  );

  await expectRejected();

  assert.deepEqual(
    availableOrderStatuses({
      status: "processing",
      payment_status: "paid",
      stock_deducted_at: new Date(),
      is_demo: true,
    }),
    [],
  );

  console.log("PASS: demo orders cannot queue dispatch emails or ship.");

  await client.query(
    `UPDATE orders
     SET is_demo = FALSE, payment_status = 'unpaid'
     WHERE id = $1`,
    [orderId],
  );

  await expectRejected();
  console.log("PASS: unpaid orders cannot queue dispatch emails.");

  await client.query(
    `UPDATE orders
     SET payment_status = 'paid', stock_deducted_at = NULL
     WHERE id = $1`,
    [orderId],
  );

  await expectRejected();
  console.log("PASS: missing stock evidence blocks dispatch emails.");

  await client.query(
    `UPDATE orders
     SET stock_deducted_at = NOW(), tracking_number = ''
     WHERE id = $1`,
    [orderId],
  );

  await expectRejected();
  console.log("PASS: missing tracking number blocks dispatch emails.");

  await client.query(
    `UPDATE orders
     SET tracking_number = 'TEST-TRACKING-ONLY',
         status = 'processing'
     WHERE id = $1`,
    [orderId],
  );

  await expectRejected();
  console.log("PASS: orders not yet shipped cannot queue dispatch emails.");

  const { rows: counts } = await client.query(
    "SELECT COUNT(*)::INTEGER AS total FROM email_outbox",
  );

  assert.equal(counts[0].total, 1);
  console.log("PASS: rejected cases create no additional emails.");
  console.log("No emails were sent and no existing orders were changed.");
} catch (error) {
  console.error("TEST FAILED:", error.message);
  process.exitCode = 1;
} finally {
  if (client) {
    try {
      if (transactionStarted) {
        await client.query("ROLLBACK");
        console.log("Disposable schema and test records rolled back.");
      }
    } catch (error) {
      console.error("ROLLBACK FAILED:", error.message);
      process.exitCode = 1;
    } finally {
      client.release();
    }
  }

  await pool.end();
}