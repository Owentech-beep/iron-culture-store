import {
  getPaymentPageData,
  startSandboxPayment,
} from "../services/payments/paymentService.js";

export async function showPayment(req, res) {
  const orderId = Number(req.params.id);

  const validId =
    /^[1-9]\d*$/.test(req.params.id) &&
    Number.isSafeInteger(orderId) &&
    orderId <= 2147483647;

  const data = validId
    ? await getPaymentPageData(orderId, req.user.id)
    : null;

  if (!data) {
    return res.status(404).render("error", {
      pageTitle: "Order Not Found | Iron Culture",
      metaDescription: "This order could not be found.",
      activePage: "account",
      statusCode: 404,
      message: "This order could not be found.",
    });
  }

  const formatMoney = (cents) =>
    new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency: "ZAR",
    }).format(Number(cents) / 100);

  res.render("payment", {
    pageTitle: "Payment Status | Iron Culture",
    metaDescription: "View payment availability for your order.",
    activePage: "account",
    ...data,
    formatMoney,
  });
}

export async function submitSandboxPayment(req, res) {
  const orderId = Number(req.params.id);

  if (
    !/^[1-9]\d*$/.test(req.params.id) ||
    !Number.isSafeInteger(orderId) ||
    orderId > 2147483647
  ) {
    return res.status(404).render("error", {
      pageTitle: "Order Not Found | Iron Culture",
      metaDescription: "This order could not be found.",
      activePage: "account",
      statusCode: 404,
      message: "This order could not be found.",
    });
  }

  const checkout = await startSandboxPayment(orderId, req.user.id);

  res.render("payfast-checkout", {
    pageTitle: "Sandbox Checkout | Iron Culture",
    metaDescription: "Continue to PayFast sandbox.",
    activePage: "account",
    orderId,
    checkout,
  });
}