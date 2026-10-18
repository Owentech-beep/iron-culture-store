import { createHash, randomUUID } from "node:crypto";
import { pool } from "../config/database.js";
import { getCart } from "../models/Cart.js";
import { calculateShipping } from "./shippingService.js";

export function checkoutError(message) {
  const error = new Error(message);
  error.status = 409;
  error.publicMessage = message;
  return error;
}

export function validateCart(cart) {
  if (cart.items.length === 0) {
    throw checkoutError("Your cart is empty.");
  }

  if (cart.hasUnavailableItems) {
    throw checkoutError(
      "Some cart items are unavailable or exceed current stock. Update your cart before continuing."
    );
  }
}

export function cartFingerprint(cart) {
  const snapshot = cart.items.map((item) => ({
    id: item.id,
    revision: item.revision,
    variantId: item.variantId,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    available: item.available,
    isDemo: item.isDemo,
  }));

  return createHash("sha256")
    .update(JSON.stringify(snapshot))
    .digest("hex");
}

export async function createPendingOrder(userId, draft) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Uses the same cart lock as add/update/remove operations.
    const cartResult = await client.query(
      `SELECT id
       FROM carts
       WHERE user_id = $1
       FOR UPDATE`,
      [userId]
    );

    if (!cartResult.rows[0]) {
      throw checkoutError("Your cart is empty.");
    }

    // Repeated submissions of the same review return the original order.
    const existing = await client.query(
      `SELECT id
       FROM orders
       WHERE checkout_key = $1 AND user_id = $2`,
      [draft.token, userId]
    );

    if (existing.rows[0]) {
      await client.query("COMMIT");
      return existing.rows[0].id;
    }

    const cart = await getCart(userId, client);

    validateCart(cart);

    if (cartFingerprint(cart) !== draft.fingerprint) {
      throw checkoutError(
        "Your cart or its prices changed. Return to checkout and review the updated amounts."
      );
    }

    const discountCents = 0;
    const shipping = calculateShipping(
      cart.subtotalCents,
      discountCents
    );

    const isDemo = cart.items.some((item) => item.isDemo);
    const orderNumber = `IC-${randomUUID().toUpperCase()}`;

    const result = await client.query(
      `INSERT INTO orders (
         user_id,
         order_number,
         checkout_key,
         shipping_rate_status,
         shipping_address,
         subtotal_cents,
         discount_cents,
         delivery_cents,
         total_cents,
         is_demo
       )
       VALUES ($1, $2, $3, $4, $5::JSONB, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        userId,
        orderNumber,
        draft.token,
        shipping.status,
        JSON.stringify(draft.address),
        cart.subtotalCents,
        discountCents,
        shipping.deliveryCents,
        shipping.totalCents,
        isDemo,
      ]
    );

    const orderId = result.rows[0].id;

        for (const item of cart.items) {
      await client.query(
        `INSERT INTO order_items (
           order_id,
           variant_id,
           product_name,
           variant_name,
           quantity,
           unit_price_cents,
           line_total_cents,
           source_cart_item_id,
           source_cart_item_revision
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          orderId,
          item.variantId,
          item.name,
          item.flavour,
          item.quantity,
          item.unitPriceCents,
          item.lineTotalCents,
          item.id,
          item.revision,
        ],
      );
    }

    // No payment has happened: do not decrement inventory or clear the cart.
    await client.query("COMMIT");
    return orderId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}