import {
  getCart,
  addCartItem,
  updateCartItem,
  removeCartItem,
} from "../models/Cart.js";

function readPositiveInteger(value, max) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    return null;
  }

  const number = Number(value);

  return Number.isSafeInteger(number) && number <= max
    ? number
    : null;
}

async function renderCart(req, res, errorMessage = "", status = 200) {
  const cart = await getCart(req.user.id);

  const formatMoney = (cents) =>
    new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency: "ZAR",
    }).format(cents / 100);

  res.status(status).render("cart", {
    pageTitle: "Your Cart | Iron Culture",
    metaDescription: "Review your Iron Culture shopping cart.",
    activePage: "cart",
    cart,
    errorMessage,
    formatMoney,
    cartCount: cart.itemCount,
  });
}

async function handleMutation(req, res, action) {
  try {
    await action();
    return res.redirect(303, "/cart");
  } catch (error) {
    if (error.status === 409) {
      return renderCart(req, res, error.message, 409);
    }

    throw error;
  }
}

export async function showCart(req, res) {
  return renderCart(req, res);
}

export async function addItem(req, res) {
  const variantId = readPositiveInteger(req.body.variantId, 2147483647);
  const quantity = readPositiveInteger(req.body.quantity, 99);

  if (!variantId || !quantity) {
    return renderCart(
      req,
      res,
      "Choose a product option and a whole-number quantity from 1 to 99.",
      400
    );
  }

  return handleMutation(req, res, () =>
    addCartItem(req.user.id, variantId, quantity)
  );
}

export async function updateItem(req, res) {
  const itemId = readPositiveInteger(req.params.id, 2147483647);
  const quantity = readPositiveInteger(req.body.quantity, 99);

  if (!itemId || !quantity) {
    return renderCart(
      req,
      res,
      "Enter a whole-number quantity from 1 to 99.",
      400
    );
  }

  return handleMutation(req, res, () =>
    updateCartItem(req.user.id, itemId, quantity)
  );
}

export async function removeItem(req, res) {
  const itemId = readPositiveInteger(req.params.id, 2147483647);

  if (!itemId) {
    return renderCart(req, res, "Invalid cart item.", 400);
  }

  return handleMutation(req, res, () =>
    removeCartItem(req.user.id, itemId)
  );
}