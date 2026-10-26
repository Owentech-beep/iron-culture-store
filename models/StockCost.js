import { randomUUID } from "node:crypto";
import { pool } from "../config/database.js";

function costError(message) {
  const error = new Error(message);
  error.status = 409;
  error.publicMessage = message;
  return error;
}

function validId(value) {
  return (
    Number.isInteger(value) &&
    value > 0 &&
    value <= 2147483647
  );
}

function validQuantity(value, allowZero = false) {
  return (
    Number.isInteger(value) &&
    value >= (allowZero ? 0 : 1) &&
    value <= 9999999
  );
}

function validCost(value) {
  return (
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 999999999
  );
}

function validDate(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function validKey(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function cleanText(value, maximum) {
  if (typeof value !== "string") {
    throw costError("A stock receipt field is missing.");
  }

  const result = value.trim();

  if (result.length > maximum) {
    throw costError("A stock receipt field is too long.");
  }

  return result;
}

async function withTransaction(action) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");

    const result = await action(client);

    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// Match the product -> variant -> inventory order used by admin edits.
async function lockStockOption(client, variantId) {
  const { rows: matches } = await client.query(
    `SELECT product_id
     FROM product_variants
     WHERE id = $1`,
    [variantId],
  );

  if (!matches.length) {
    throw costError("This product option no longer exists.");
  }

  const { rows: products } = await client.query(
    `SELECT id, name, is_demo, retired_at
     FROM products
     WHERE id = $1
     FOR UPDATE`,
    [matches[0].product_id],
  );

  const product = products[0];

  if (!product || product.retired_at) {
    throw costError("This product was removed or retired.");
  }

  const { rows: variants } = await client.query(
    `SELECT id
     FROM product_variants
     WHERE id = $1 AND product_id = $2
     FOR UPDATE`,
    [variantId, product.id],
  );

  if (!variants.length) {
    throw costError("This product option changed. Refresh and try again.");
  }

  const { rows: inventory } = await client.query(
    `SELECT *
     FROM inventory
     WHERE variant_id = $1
     FOR UPDATE`,
    [variantId],
  );

  if (!inventory.length) {
    throw costError("This product option has no inventory record.");
  }

  return {
    product,
    inventory: inventory[0],
  };
}

// Caller must already hold this option's inventory row lock.
// Existing stock is never assigned a guessed purchase cost.
export async function ensureStockCostTracking(
  client,
  inventory,
  isDemo,
  userId = null,
) {
  if (inventory.cost_tracking_started_at) return;

  const quantity = Number(inventory.quantity);

  if (!validQuantity(quantity, true)) {
    throw costError("The existing physical stock quantity is invalid.");
  }

  if (quantity > 0) {
    await client.query(
      `INSERT INTO stock_cost_batches (
         variant_id,
         entry_type,
         quantity_received,
         quantity_remaining,
         unit_cost_cents,
         received_on,
         note,
         is_demo,
         created_by,
         submission_key
       )
       VALUES (
         $1,
         'opening_balance',
         $2,
         $2,
         NULL,
         (NOW() AT TIME ZONE 'Africa/Johannesburg')::DATE,
         'Existing physical stock. Purchase cost not recorded.',
         $3,
         $4,
         $5
       )`,
      [
        inventory.variant_id,
        quantity,
        isDemo,
        userId,
        randomUUID(),
      ],
    );
  }

  await client.query(
    `UPDATE inventory
     SET cost_tracking_started_at = NOW()
     WHERE variant_id = $1`,
    [inventory.variant_id],
  );
}

// Caller must hold the inventory row lock before checking or changing batches.
export async function assertStockCostBalance(client, variantId, quantity) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(quantity_remaining), 0)::TEXT AS quantity
     FROM stock_cost_batches
     WHERE variant_id = $1`,
    [variantId],
  );

  if (BigInt(rows[0].quantity) !== BigInt(quantity)) {
    throw costError(
      "Stock quantities and cost batches do not match. Review this option before changing stock.",
    );
  }
}

export async function receiveStockPurchase(variantId, userId, data) {
  if (!validId(variantId) || !validId(userId)) {
    throw costError("Invalid product option or administrator.");
  }

  if (
    !validQuantity(data.quantity) ||
    !validCost(data.unitCostCents) ||
    !validDate(data.receivedOn) ||
    !validKey(data.submissionKey)
  ) {
    throw costError("Enter a valid quantity, purchase cost and receipt date.");
  }

  const supplier = cleanText(data.supplier, 180);
  const invoiceReference = cleanText(data.invoiceReference, 120);
  const note = cleanText(data.note, 500);

  return withTransaction(async (client) => {
    const { product, inventory } = await lockStockOption(
      client,
      variantId,
    );

    const { rows: previous } = await client.query(
      `SELECT *,
              TO_CHAR(received_on, 'YYYY-MM-DD') AS receipt_date
       FROM stock_cost_batches
       WHERE submission_key = $1`,
      [data.submissionKey],
    );

    if (previous.length) {
      const receipt = previous[0];

      const sameReceipt =
        receipt.entry_type === "purchase" &&
        Number(receipt.variant_id) === variantId &&
        Number(receipt.created_by) === userId &&
        Number(receipt.quantity_received) === data.quantity &&
        Number(receipt.unit_cost_cents) === data.unitCostCents &&
        receipt.receipt_date === data.receivedOn &&
        receipt.supplier === supplier &&
        receipt.invoice_reference === invoiceReference &&
        receipt.note === note;

      if (!sameReceipt) {
        throw costError(
          "This submission reference was already used for different details. Refresh the page.",
        );
      }

      return {
        receiptId: receipt.id,
        alreadyRecorded: true,
      };
    }

    const nextQuantity = Number(inventory.quantity) + data.quantity;

    if (!validQuantity(nextQuantity, true)) {
      throw costError("Physical stock cannot exceed 9,999,999 units.");
    }

    await ensureStockCostTracking(
      client,
      inventory,
      product.is_demo,
      userId,
    );

    await assertStockCostBalance(
      client,
      variantId,
      Number(inventory.quantity),
    );

    const { rows } = await client.query(
      `INSERT INTO stock_cost_batches (
         variant_id,
         entry_type,
         quantity_received,
         quantity_remaining,
         unit_cost_cents,
         received_on,
         supplier,
         invoice_reference,
         note,
         is_demo,
         created_by,
         submission_key
       )
       VALUES (
         $1, 'purchase', $2, $2, $3, $4::DATE,
         $5, $6, $7, $8, $9, $10
       )
       RETURNING id`,
      [
        variantId,
        data.quantity,
        data.unitCostCents,
        data.receivedOn,
        supplier,
        invoiceReference,
        note,
        product.is_demo,
        userId,
        data.submissionKey,
      ],
    );

    await client.query(
      `UPDATE inventory
       SET quantity = $2
       WHERE variant_id = $1`,
      [variantId, nextQuantity],
    );

    await assertStockCostBalance(client, variantId, nextQuantity);

    return {
      receiptId: rows[0].id,
      alreadyRecorded: false,
    };
  });
}

// Set the opening cost only before any units from that batch are consumed.
// This changes cost information; it does not add physical stock.
export async function setOpeningStockCost(
  variantId,
  userId,
  { unitCostCents, expectedQuantity, note },
) {
  if (
    !validId(variantId) ||
    !validId(userId) ||
    !validCost(unitCostCents) ||
    !validQuantity(expectedQuantity)
  ) {
    throw costError("Enter a valid opening quantity and purchase cost.");
  }

  const cleanNote = cleanText(note, 500);

  if (cleanNote.length < 10) {
    throw costError(
      "Add a note of at least 10 characters explaining the opening cost.",
    );
  }

  return withTransaction(async (client) => {
    const { product, inventory } = await lockStockOption(
      client,
      variantId,
    );

    // Protect an opening-balance form that became stale before setup.
    if (
      !inventory.cost_tracking_started_at &&
      Number(inventory.quantity) !== expectedQuantity
    ) {
      throw costError("Stock changed. Refresh before recording its opening cost.");
    }

    await ensureStockCostTracking(
      client,
      inventory,
      product.is_demo,
      userId,
    );

    await assertStockCostBalance(
      client,
      variantId,
      Number(inventory.quantity),
    );

    const { rows } = await client.query(
      `SELECT *
       FROM stock_cost_batches
       WHERE variant_id = $1
         AND entry_type = 'opening_balance'
       FOR UPDATE`,
      [variantId],
    );

    const batch = rows[0];

    if (
      !batch ||
      Number(batch.quantity_received) !== expectedQuantity ||
      Number(batch.quantity_remaining) !== expectedQuantity
    ) {
      throw costError(
        "The opening stock changed or some units were already consumed. Its cost needs a separate review.",
      );
    }

    if (batch.unit_cost_cents !== null) {
      throw costError(
        "The opening cost has already been recorded. It cannot be overwritten here.",
      );
    }

    await client.query(
      `UPDATE stock_cost_batches
       SET unit_cost_cents = $2,
           note = $3,
           created_by = $4
       WHERE id = $1`,
      [batch.id, unitCostCents, cleanNote, userId],
    );

    return batch.id;
  });
}

// Caller must hold the inventory row lock.
// Batch order uses recording order (id), not an editable receipt date.
async function consumeCostBatches(
  client,
  variantId,
  quantity,
  { orderItemId = null, adjustmentId = null },
) {
  if (
    !validQuantity(quantity) ||
    (orderItemId === null) === (adjustmentId === null)
  ) {
    throw costError("Invalid stock cost allocation.");
  }

  const { rows: batches } = await client.query(
    `SELECT id, quantity_remaining, unit_cost_cents
     FROM stock_cost_batches
     WHERE variant_id = $1
       AND quantity_remaining > 0
     ORDER BY id
     FOR UPDATE`,
    [variantId],
  );

  let remaining = quantity;
  let totalCost = 0n;
  let hasUnknownCost = false;

  for (const batch of batches) {
    if (remaining === 0) break;

    const taken = Math.min(
      remaining,
      Number(batch.quantity_remaining),
    );

    if (batch.unit_cost_cents === null) {
      hasUnknownCost = true;
    } else {
      totalCost += BigInt(batch.unit_cost_cents) * BigInt(taken);
    }

    await client.query(
      `INSERT INTO stock_cost_allocations (
         variant_id,
         batch_id,
         order_item_id,
         adjustment_id,
         quantity,
         unit_cost_cents
       )
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        variantId,
        batch.id,
        orderItemId,
        adjustmentId,
        taken,
        batch.unit_cost_cents,
      ],
    );

    await client.query(
      `UPDATE stock_cost_batches
       SET quantity_remaining = quantity_remaining - $2
       WHERE id = $1`,
      [batch.id, taken],
    );

    remaining -= taken;
  }

  if (remaining !== 0) {
    throw costError(
      "There are not enough recorded stock units to allocate this change.",
    );
  }

  // A string preserves exact cents even for totals above JS safe integers.
  return hasUnknownCost ? null : totalCost.toString();
}


// Run inside completePayment's transaction, before physical stock deduction.
// The caller already holds the order, payment and reservation locks.
export async function recordPaidOrderCosts(client, orderId) {
  if (!validId(orderId)) {
    throw costError("Invalid order for stock costing.");
  }

  const { rows: items } = await client.query(
    `SELECT
       id,
       variant_id,
       quantity,
       cost_recorded_at
     FROM order_items
     WHERE order_id = $1
     ORDER BY variant_id, id
     FOR UPDATE`,
    [orderId],
  );

  if (!items.length) {
    throw costError("This order has no items to cost.");
  }

  // Duplicate successful notifications return earlier in completePayment.
  // Reaching this point with existing cost records indicates inconsistency.
  if (items.some((item) => item.cost_recorded_at !== null)) {
    throw costError(
      "This order already has cost records. Review it before processing again.",
    );
  }

  const groupedItems = new Map();

  for (const item of items) {
    if (!validQuantity(Number(item.quantity))) {
      throw costError("An order item has an invalid quantity.");
    }

    const group = groupedItems.get(item.variant_id) ?? [];
    group.push(item);
    groupedItems.set(item.variant_id, group);
  }

  // Items were ordered by variant_id, giving consistent inventory lock order.
  for (const [variantId, variantItems] of groupedItems) {
    const { rows } = await client.query(
      `SELECT i.*, p.is_demo
       FROM inventory i
       JOIN product_variants v ON v.id = i.variant_id
       JOIN products p ON p.id = v.product_id
       WHERE i.variant_id = $1
       FOR UPDATE OF i`,
      [variantId],
    );

    const inventory = rows[0];

    if (!inventory) {
      throw costError("An order item has no inventory record.");
    }

    const totalQuantity = variantItems.reduce(
      (sum, item) => sum + Number(item.quantity),
      0,
    );

    if (
      !Number.isSafeInteger(totalQuantity) ||
      totalQuantity > Number(inventory.quantity) ||
      totalQuantity > Number(inventory.reserved_quantity)
    ) {
      throw costError("Reserved stock is insufficient for cost allocation.");
    }

    await ensureStockCostTracking(
      client,
      inventory,
      inventory.is_demo,
    );

    await assertStockCostBalance(
      client,
      variantId,
      Number(inventory.quantity),
    );

    for (const item of variantItems) {
      const totalCost = await consumeCostBatches(
        client,
        variantId,
        Number(item.quantity),
        { orderItemId: item.id },
      );

      await client.query(
        `UPDATE order_items
         SET cost_total_cents = $2,
             cost_recorded_at = NOW()
         WHERE id = $1`,
        [item.id, totalCost],
      );
    }

    // Physical stock is deducted next by completePayment, in this transaction.
    await assertStockCostBalance(
      client,
      variantId,
      Number(inventory.quantity) - totalQuantity,
    );
  }
}


// Stock corrections are not supplier purchases.
// Positive corrections enter with an unknown cost.
export async function adjustStockWithCosts(variantId, userId, data) {
  if (
    !validId(variantId) ||
    !validId(userId) ||
    !validQuantity(data.quantity, true) ||
    !validQuantity(data.previousQuantity, true) ||
    !validQuantity(data.threshold, true) ||
    !validKey(data.submissionKey)
  ) {
    throw costError("Invalid stock correction.");
  }

  const reason = cleanText(data.reason, 500);

  if (
    data.quantity !== data.previousQuantity &&
    reason.length < 10
  ) {
    throw costError(
      "Explain the stock correction using at least 10 characters.",
    );
  }

  return withTransaction(async (client) => {
    const { product, inventory } = await lockStockOption(
      client,
      variantId,
    );

    const { rows: previous } = await client.query(
      `SELECT *
       FROM stock_cost_adjustments
       WHERE submission_key = $1`,
      [data.submissionKey],
    );

    if (previous.length) {
      const adjustment = previous[0];

      if (
        Number(adjustment.variant_id) !== variantId ||
        Number(adjustment.created_by) !== userId ||
        Number(adjustment.previous_quantity) !== data.previousQuantity ||
        Number(adjustment.new_quantity) !== data.quantity ||
        adjustment.reason !== reason
      ) {
        throw costError(
          "This correction reference was already used for different details.",
        );
      }

      return {
        adjustmentId: adjustment.id,
        alreadyRecorded: true,
      };
    }

    const currentQuantity = Number(inventory.quantity);

    if (currentQuantity !== data.previousQuantity) {
      throw costError(
        "Physical stock changed. Refresh the inventory page before saving.",
      );
    }

    if (data.quantity < Number(inventory.reserved_quantity)) {
      throw costError("Physical stock cannot be below reserved stock.");
    }

    await ensureStockCostTracking(
      client,
      inventory,
      product.is_demo,
      userId,
    );

    await assertStockCostBalance(client, variantId, currentQuantity);

    const difference = data.quantity - currentQuantity;
    let adjustmentId = null;

    if (difference !== 0) {
      const { rows } = await client.query(
        `INSERT INTO stock_cost_adjustments (
           variant_id,
           previous_quantity,
           new_quantity,
           reason,
           is_demo,
           created_by,
           submission_key
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          variantId,
          currentQuantity,
          data.quantity,
          reason,
          product.is_demo,
          userId,
          data.submissionKey,
        ],
      );

      adjustmentId = rows[0].id;

      if (difference < 0) {
        await consumeCostBatches(
          client,
          variantId,
          -difference,
          { adjustmentId },
        );
      } else {
        await client.query(
          `INSERT INTO stock_cost_batches (
             variant_id,
             entry_type,
             quantity_received,
             quantity_remaining,
             unit_cost_cents,
             received_on,
             note,
             is_demo,
             created_by,
             submission_key
           )
           VALUES (
             $1, 'adjustment', $2, $2, NULL,
             (NOW() AT TIME ZONE 'Africa/Johannesburg')::DATE,
             $3, $4, $5, $6
           )`,
          [
            variantId,
            difference,
            reason,
            product.is_demo,
            userId,
            data.submissionKey,
          ],
        );
      }
    }

    await client.query(
      `UPDATE inventory
       SET quantity = $2,
           low_stock_threshold = $3
       WHERE variant_id = $1`,
      [variantId, data.quantity, data.threshold],
    );

    await assertStockCostBalance(
      client,
      variantId,
      data.quantity,
    );

    return {
      adjustmentId,
      alreadyRecorded: false,
    };
  });
}