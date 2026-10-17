import { randomUUID } from "node:crypto";

import { getCart } from "../models/Cart.js";
import {
  provinces,
  calculateShipping,
} from "../services/shippingService.js";

import {
  validateCart,
  cartFingerprint,
  createPendingOrder,
  checkoutError,
} from "../services/checkoutService.js";

const addressFields = [
  ["firstName", "First name", 100],
  ["lastName", "Last name", 100],
  ["email", "Email address", 254],
  ["phone", "Phone number", 30],
  ["street", "Street address", 200],
  ["suburb", "Suburb", 100],
  ["city", "City / town", 100],
  ["province", "Province", 100],
  ["postalCode", "Postal code", 4],
];

function formatMoney(cents) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
  }).format(Number(cents) / 100);
}

function readAddress(body) {
  const address = {};
  const errors = [];

  for (const [key, label, maxLength] of addressFields) {
    const value =
      typeof body[key] === "string" ? body[key].trim() : "";

    address[key] = value.slice(0, maxLength);

    if (!value || value.length > maxLength) {
      errors.push(`${label} is required and must be within ${maxLength} characters.`);
    }
  }

  address.email = address.email.toLowerCase();
  address.country = "ZA";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.email)) {
    errors.push("Enter a valid email address.");
  }

  const phoneDigits = address.phone.replace(/\D/g, "");

  if (
    !/^\+?[\d\s()-]+$/.test(address.phone) ||
    phoneDigits.length < 10 ||
    phoneDigits.length > 15
  ) {
    errors.push("Enter a valid contact number.");
  }

  if (!/^\d{4}$/.test(address.postalCode)) {
    errors.push("Enter a four-digit South African postal code.");
  }

  if (!provinces.includes(address.province)) {
    errors.push("Choose a South African province.");
  }

  return { address, errors };
}

function renderCheckout(req, res, cart, values, errors = [], status = 200) {
  return res.status(status).render("checkout", {
    pageTitle: "Checkout | Iron Culture",
    metaDescription: "Enter your delivery details.",
    activePage: "cart",
    cart,
    values,
    errors,
    provinces,
    formatMoney,
  });
}

function handleCheckoutError(res, error) {
  if (!error.publicMessage) throw error;

  return res.status(error.status).render("error", {
    pageTitle: "Review Your Checkout | Iron Culture",
    metaDescription: "Your checkout needs attention.",
    activePage: "cart",
    statusCode: error.status,
    message: error.publicMessage,
  });
}

export async function showCheckout(req, res) {
  try {
    const cart = await getCart(req.user.id);
    validateCart(cart);

    const values = req.session.checkoutDraft?.address ?? {
      email: req.user.email,
    };

    return renderCheckout(req, res, cart, values);
  } catch (error) {
    return handleCheckoutError(res, error);
  }
}

export async function reviewCheckout(req, res) {
  try {
    const cart = await getCart(req.user.id);
    validateCart(cart);

    const { address, errors } = readAddress(req.body);

    if (errors.length > 0) {
      return renderCheckout(req, res, cart, address, errors, 400);
    }

    const draft = {
      token: randomUUID(),
      address,
      fingerprint: cartFingerprint(cart),
      createdAt: Date.now(),
    };

    req.session.checkoutDraft = draft;

    await new Promise((resolve, reject) => {
      req.session.save((error) => {
        if (error) return reject(error);
        resolve();
      });
    });

    const shipping = calculateShipping(cart.subtotalCents);

    return res.render("checkout-review", {
      pageTitle: "Review Order | Iron Culture",
      metaDescription: "Review your delivery details and order.",
      activePage: "cart",
      cart,
      draft,
      shipping,
      formatMoney,
    });
  } catch (error) {
    return handleCheckoutError(res, error);
  }
}

export async function submitCheckout(req, res) {
  try {
    const draft = req.session.checkoutDraft;

    if (
      !draft ||
      req.body.checkoutToken !== draft.token ||
      Date.now() - draft.createdAt > 30 * 60 * 1000
    ) {
      throw checkoutError(
        "Your checkout review expired or changed. Open /checkout and review your order again."
      );
    }

    const orderId = await createPendingOrder(req.user.id, draft);

    return res.redirect(303, `/orders/${orderId}`);
  } catch (error) {
    return handleCheckoutError(res, error);
  }
}