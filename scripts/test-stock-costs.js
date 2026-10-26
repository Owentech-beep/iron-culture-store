import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { pool } from "../config/database.js";
import {
  receiveStockPurchase,
  setOpeningStockCost,
  adjustStockWithCosts,
} from "../models/StockCost.js";

let categoryId;
let brandId;
let productId;
let variantId;
let userId;
let setupCommitted = false;

async function snapshot() {
  const { rows } = await pool.query(
    `SELECT
       i.quantity,
       i.reserved_quantity,
       i.low_stock_threshold,

       (
         SELECT COUNT(*)::INTEGER
         FROM stock_cost_batches b
         WHERE b.variant_id = i.variant_id
       ) AS batch_count,

       (
         SELECT COALESCE(SUM(quantity_remaining), 0)::INTEGER
         FROM stock_cost_batches b
         WHERE b.variant_id = i.variant_id
       ) AS batch_units,

       (
         SELECT COALESCE(SUM(
           quantity_remaining::BIGINT * unit_cost_cents
         ), 0)::TEXT
         FROM stock_cost_batches b
         WHERE b.variant_id = i.variant_id
       ) AS known_remaining_cost,

       (
         SELECT COALESCE(SUM(quantity_remaining), 0)::INTEGER
         FROM stock_cost_batches b
         WHERE b.variant_id = i.variant_id
           AND unit_cost_cents IS NULL
       ) AS unknown_units,

       (
         SELECT COUNT(*)::INTEGER
         FROM stock_cost_adjustments a
         WHERE a.variant_id = i.variant_id
       ) AS adjustment_count,

       (
         SELECT COUNT(*)::INTEGER
         FROM stock_cost_allocations a
         WHERE a.variant_id = i.variant_id
       ) AS allocation_count

     FROM inventory i
     WHERE i.variant_id = $1`,
    [variantId],
  );

  assert.equal(rows.length, 1);
  return rows[0];
}

async function expectConflict(action) {
  await assert.rejects(action, (error) => {
    assert.equal(error.status, 409);
    return true;
  });
}

try {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.DATABASE_URL
  ) {
    throw new Error("Run only against local development PostgreSQL.");
  }

  const { rows: connection } = await pool.query(
    `SELECT
       current_database() AS database,
       host(inet_server_addr()) AS server_address`,
  );

  assert.equal(connection[0].database, "iron_culture_store");

  assert.ok(
    ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
      connection[0].server_address,
    ),
    "Expected local PostgreSQL.",
  );

  const { rows: users } = await pool.query(
    `SELECT id
     FROM users
     WHERE is_active
     ORDER BY id
     LIMIT 1`,
  );

  assert.equal(users.length, 1, "An active local account is required.");
  userId = users[0].id;

  const token = randomUUID();
  const setup = await pool.connect();

  try {
    await setup.query("BEGIN");

    const category = await setup.query(
      `INSERT INTO categories (name, slug)
       VALUES ('Disposable cost test', $1)
       RETURNING id`,
      [`cost-category-${token}`],
    );
    categoryId = category.rows[0].id;

    const brand = await setup.query(
      `INSERT INTO brands (name, slug, is_demo)
       VALUES ('Disposable cost test', $1, TRUE)
       RETURNING id`,
      [`cost-brand-${token}`],
    );
    brandId = brand.rows[0].id;

    const product = await setup.query(
      `INSERT INTO products (
         category_id,
         brand_id,
         name,
         slug,
         price,
         is_active,
         is_demo
       )
       VALUES (
         $1, $2, 'Disposable stock-cost test',
         $3, 600, TRUE, TRUE
       )
       RETURNING id`,
      [categoryId, brandId, `cost-product-${token}`],
    );
    productId = product.rows[0].id;

    const variant = await setup.query(
      `INSERT INTO product_variants (
         product_id, sku, flavour, size, price
       )
       VALUES ($1, $2, 'Test flavour', '1 kg', 600)
       RETURNING id`,
      [productId, `COST-${token}`],
    );
    variantId = variant.rows[0].id;

    await setup.query(
      `INSERT INTO inventory (
         variant_id,
         quantity,
         reserved_quantity,
         low_stock_threshold
       )
       VALUES ($1, 2, 0, 5)`,
      [variantId],
    );

    await setup.query("COMMIT");
    setupCommitted = true;
  } catch (error) {
    await setup.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    setup.release();
  }

  // Existing two units cost R100 each.
  await setOpeningStockCost(variantId, userId, {
    unitCostCents: 10000,
    expectedQuantity: 2,
    note: "Opening cost supported by disposable test records.",
  });

  let state = await snapshot();

  assert.equal(state.quantity, 2);
  assert.equal(state.batch_units, 2);
  assert.equal(state.known_remaining_cost, "20000");
  assert.equal(state.unknown_units, 0);

  console.log("PASS: opening cost records R200 without adding stock.");

  const beforeOverwrite = await snapshot();

  await expectConflict(() =>
    setOpeningStockCost(variantId, userId, {
      unitCostCents: 99900,
      expectedQuantity: 2,
      note: "Attempt to overwrite an established opening cost.",
    }),
  );

  assert.deepEqual(await snapshot(), beforeOverwrite);
  console.log("PASS: an established opening cost cannot be overwritten.");

  // Two concurrent submissions of the same receipt must add stock once.
  const receipt = {
    quantity: 2,
    unitCostCents: 15000,
    receivedOn: new Date().toISOString().slice(0, 10),
    supplier: "Disposable supplier",
    invoiceReference: "TEST-RECEIPT-ONE",
    note: "Two additional units at R150 each.",
    submissionKey: randomUUID(),
  };

  const receiptResults = await Promise.allSettled([
    receiveStockPurchase(variantId, userId, receipt),
    receiveStockPurchase(variantId, userId, receipt),
  ]);

  // Both operations must finish before assertions or cleanup.
  for (const result of receiptResults) {
    if (result.status === "rejected") throw result.reason;
  }

  assert.deepEqual(
    receiptResults
      .map((result) => result.value.alreadyRecorded)
      .sort(),
    [false, true],
  );

  assert.equal(
    receiptResults[0].value.receiptId,
    receiptResults[1].value.receiptId,
  );

  state = await snapshot();

  assert.equal(state.quantity, 4);
  assert.equal(state.batch_units, 4);
  assert.equal(state.batch_count, 2);
  assert.equal(state.known_remaining_cost, "50000");

  console.log("PASS: concurrent receipt submissions add stock only once.");
  console.log("PASS: different purchase costs remain in separate batches.");

  const beforeChangedReceipt = await snapshot();

  await expectConflict(() =>
    receiveStockPurchase(variantId, userId, {
      ...receipt,
      quantity: 3,
    }),
  );

  assert.deepEqual(await snapshot(), beforeChangedReceipt);
  console.log("PASS: a reused receipt key rejects changed details.");

  const beforeInvalidReceipt = await snapshot();

  await expectConflict(() =>
    receiveStockPurchase(variantId, userId, {
      ...receipt,
      submissionKey: randomUUID(),
      unitCostCents: -1,
    }),
  );

  assert.deepEqual(await snapshot(), beforeInvalidReceipt);
  console.log("PASS: invalid purchase costs leave stock unchanged.");

  // Remove one unit by correction: oldest recorded batch is consumed first.
  const correction = {
    quantity: 3,
    previousQuantity: 4,
    threshold: 5,
    reason: "One damaged unit removed during the test stock count.",
    submissionKey: randomUUID(),
  };

  await adjustStockWithCosts(variantId, userId, correction);

  state = await snapshot();

  assert.equal(state.quantity, 3);
  assert.equal(state.batch_units, 3);
  assert.equal(state.known_remaining_cost, "40000");
  assert.equal(state.adjustment_count, 1);
  assert.equal(state.allocation_count, 1);

  const { rows: correctionCosts } = await pool.query(
    `SELECT a.quantity, a.unit_cost_cents::TEXT AS unit_cost_cents
     FROM stock_cost_allocations a
     WHERE a.variant_id = $1
       AND a.adjustment_id IS NOT NULL`,
    [variantId],
  );

  assert.equal(correctionCosts.length, 1);
  assert.equal(correctionCosts[0].quantity, 1);
  assert.equal(correctionCosts[0].unit_cost_cents, "10000");

  console.log("PASS: downward correction consumes the oldest recorded cost.");

  const beforeRepeat = await snapshot();
  const repeated = await adjustStockWithCosts(
    variantId,
    userId,
    correction,
  );

  assert.equal(repeated.alreadyRecorded, true);
  assert.deepEqual(await snapshot(), beforeRepeat);
  console.log("PASS: repeated correction does not remove stock twice.");

  await expectConflict(() =>
    adjustStockWithCosts(variantId, userId, {
      ...correction,
      submissionKey: randomUUID(),
    }),
  );

  assert.deepEqual(await snapshot(), beforeRepeat);
  console.log("PASS: stale stock counts are rejected.");

  // Simulate units reserved for an unresolved payment.
  await pool.query(
    `UPDATE inventory
     SET reserved_quantity = 2
     WHERE variant_id = $1`,
    [variantId],
  );

  const beforeReserved = await snapshot();

  await expectConflict(() =>
    adjustStockWithCosts(variantId, userId, {
      quantity: 1,
      previousQuantity: 3,
      threshold: 5,
      reason: "Attempt to reduce physical stock below reserved units.",
      submissionKey: randomUUID(),
    }),
  );

  assert.deepEqual(await snapshot(), beforeReserved);

  await pool.query(
    `UPDATE inventory
     SET reserved_quantity = 0
     WHERE variant_id = $1`,
    [variantId],
  );

  console.log("PASS: corrections cannot remove reserved stock.");

  // A count increase is not a supplier purchase and has no guessed cost.
  await adjustStockWithCosts(variantId, userId, {
    quantity: 4,
    previousQuantity: 3,
    threshold: 5,
    reason: "One additional unit found during a physical stock count.",
    submissionKey: randomUUID(),
  });

  state = await snapshot();

  assert.equal(state.quantity, 4);
  assert.equal(state.batch_units, 4);
  assert.equal(state.known_remaining_cost, "40000");
  assert.equal(state.unknown_units, 1);

  console.log("PASS: upward correction records unknown cost, not zero cost.");

  const beforeThreshold = await snapshot();

  await adjustStockWithCosts(variantId, userId, {
    quantity: 4,
    previousQuantity: 4,
    threshold: 8,
    reason: "",
    submissionKey: randomUUID(),
  });

  const afterThreshold = await snapshot();

  assert.equal(afterThreshold.low_stock_threshold, 8);
  assert.equal(afterThreshold.quantity, beforeThreshold.quantity);
  assert.equal(afterThreshold.batch_units, beforeThreshold.batch_units);
  assert.equal(
    afterThreshold.known_remaining_cost,
    beforeThreshold.known_remaining_cost,
  );
  assert.equal(
    afterThreshold.adjustment_count,
    beforeThreshold.adjustment_count,
  );

  console.log("PASS: threshold-only changes do not create stock movements.");

  const { rows: purchases } = await pool.query(
    `SELECT
       COUNT(*)::INTEGER AS count,
       SUM(
         quantity_received::BIGINT * unit_cost_cents
       )::TEXT AS total_cents
     FROM stock_cost_batches
     WHERE variant_id = $1
       AND entry_type = 'purchase'`,
    [variantId],
  );

  assert.equal(purchases[0].count, 1);
  assert.equal(purchases[0].total_cents, "30000");

  console.log("PASS: purchases exclude opening balances and corrections.");
  console.log("No emails or payment requests were sent.");
} catch (error) {
  console.error("TEST FAILED:", error.message);
  process.exitCode = 1;
} finally {
  if (setupCommitted) {
    const cleanup = await pool.connect();

    try {
      await cleanup.query("BEGIN");

      await cleanup.query(
        "DELETE FROM stock_cost_allocations WHERE variant_id = $1",
        [variantId],
      );

      await cleanup.query(
        "DELETE FROM stock_cost_adjustments WHERE variant_id = $1",
        [variantId],
      );

      await cleanup.query(
        "DELETE FROM stock_cost_batches WHERE variant_id = $1",
        [variantId],
      );

      await cleanup.query(
        "DELETE FROM inventory WHERE variant_id = $1",
        [variantId],
      );

      await cleanup.query(
        "DELETE FROM product_variants WHERE id = $1",
        [variantId],
      );

      await cleanup.query("DELETE FROM products WHERE id = $1", [productId]);
      await cleanup.query("DELETE FROM brands WHERE id = $1", [brandId]);
      await cleanup.query("DELETE FROM categories WHERE id = $1", [categoryId]);

      await cleanup.query("COMMIT");
      console.log("Disposable stock-cost test records removed.");
    } catch (error) {
      await cleanup.query("ROLLBACK").catch(() => {});
      console.error("TEST CLEANUP FAILED:", error.message);
      console.error("Fixture IDs:", {
        categoryId,
        brandId,
        productId,
        variantId,
      });
      process.exitCode = 1;
    } finally {
      cleanup.release();
    }
  }

  await pool.end();
}