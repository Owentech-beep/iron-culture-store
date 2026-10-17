import {
  findOrdersForUser,
  findOrderForUser,
  acceptDeliveryQuote,
} from "../models/Order.js";

function formatMoney(cents) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
  }).format(Number(cents) / 100);
}

function formatDate(value) {
  return new Date(value).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Johannesburg",
  });
}

export async function showOrders(req, res) {
  const orders = await findOrdersForUser(req.user.id);

  res.render("orders", {
    pageTitle: "My Orders | Iron Culture",
    metaDescription: "Your Iron Culture orders.",
    activePage: "account",
    orders,
    formatMoney,
    formatDate,
  });
}

export async function showOrder(req, res) {
  const validId =
    /^[1-9]\d*$/.test(req.params.id) &&
    Number(req.params.id) <= 2147483647;

  const order = validId
    ? await findOrderForUser(Number(req.params.id), req.user.id)
    : null;

  if (!order) {
    return res.status(404).render("error", {
      pageTitle: "Order Not Found | Iron Culture",
      metaDescription: "This order could not be found.",
      activePage: "account",
      statusCode: 404,
      message: "This order could not be found.",
    });
  }

  res.render("order-details", {
    pageTitle: "Order Details | Iron Culture",
    metaDescription: "Your Iron Culture order details.",
    activePage: "account",
    order,
    formatMoney,
    formatDate,
  });
}

export async function acceptQuote(req, res) {
  const rawId = req.params.id;
  const rawVersion = req.body.quoteVersion;

  const validId =
    /^[1-9]\d*$/.test(rawId) &&
    Number(rawId) <= 2147483647;

  const validVersion =
    typeof rawVersion === "string" &&
    /^[1-9]\d{0,9}$/.test(rawVersion) &&
    Number(rawVersion) <= 2147483647;

  if (!validId || !validVersion) {
    return res.status(400).render("error", {
      pageTitle: "Invalid Quote | Iron Culture",
      metaDescription: "The delivery quote could not be accepted.",
      activePage: "account",
      statusCode: 400,
      message: "Invalid quote details. Open your order again and retry.",
    });
  }

  const orderId = Number(rawId);

  // Return the same 404 for missing orders and another customer's orders.
  const order = await findOrderForUser(orderId, req.user.id);

  if (!order) {
    return res.status(404).render("error", {
      pageTitle: "Order Not Found | Iron Culture",
      metaDescription: "This order could not be found.",
      activePage: "account",
      statusCode: 404,
      message: "This order could not be found.",
    });
  }

  const accepted = await acceptDeliveryQuote(
    orderId,
    req.user.id,
    Number(rawVersion)
  );

  if (!accepted) {
    return res.status(409).render("error", {
      pageTitle: "Review Updated Quote | Iron Culture",
      metaDescription: "Your delivery quote needs another review.",
      activePage: "account",
      statusCode: 409,
      message:
        "The quote or order status changed. Return to My Orders, open this order and review its latest details before accepting.",
    });
  }

  return res.redirect(303, `/orders/${orderId}`);
}