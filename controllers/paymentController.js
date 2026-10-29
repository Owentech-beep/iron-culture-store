import {
  getPaymentPageData,
  startPayment,
  startSandboxPayment,
} from "../services/payments/paymentService.js";

function readOrderId(value) {
  if (!/^[1-9]\d*$/.test(value)) return null;

  const id = Number(value);

  return Number.isSafeInteger(id) && id <= 2147483647
    ? id
    : null;
}

function orderNotFound(res) {
  return res.status(404).render("error", {
    pageTitle: "Order Not Found | Iron Culture",
    metaDescription: "This order could not be found.",
    activePage: "account",
    statusCode: 404,
    message: "This order could not be found.",
  });
}

export async function showPayment(req, res) {
  const orderId = readOrderId(req.params.id);

  const data = orderId
    ? await getPaymentPageData(orderId, req.user.id)
    : null;

  if (!data) return orderNotFound(res);

  const formatMoney = (cents) =>
    new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency: "ZAR",
    }).format(Number(cents) / 100);

  return res.render("payment", {
    pageTitle: "Payment Status | Iron Culture",
    metaDescription: "View payment availability for your order.",
    activePage: "account",
    ...data,
    formatMoney,
  });
}

async function renderCheckout(req, res, start) {
  const orderId = readOrderId(req.params.id);

  if (!orderId) return orderNotFound(res);

  let checkout;

  try {
    checkout = await start(orderId, req.user.id);
  } catch (error) {
    if (error.status === 404) {
      return orderNotFound(res);
    }

    if (error.status === 409) {
      return res.redirect(303, `/orders/${orderId}/payment`);
    }

    throw error;
  }

  const isSandbox = checkout.mode === "sandbox";

  return res.render("payfast-checkout", {
    pageTitle: isSandbox
      ? "Sandbox Checkout | Iron Culture"
      : "Secure Checkout | Iron Culture",
    metaDescription: isSandbox
      ? "Continue to PayFast sandbox."
      : "Continue to PayFast to pay for your order.",
    activePage: "account",
    orderId,
    checkout,
    isSandbox,
  });
}

export async function submitPayment(req, res) {
  return renderCheckout(req, res, startPayment);
}

export async function submitSandboxPayment(req, res) {
  return renderCheckout(req, res, startSandboxPayment);
}