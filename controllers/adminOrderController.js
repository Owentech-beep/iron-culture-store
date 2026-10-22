import {
  listAdminOrders,
  findAdminOrder,
  saveDeliveryQuote,
  availableOrderStatuses,
  changeAdminOrderStatus,
  getOrderStatusHistory,
} from "../models/AdminOrder.js";
import {
  listRecoverableSandboxAttempts,
  closeAbandonedSandboxAttempt,
} from "../models/SandboxRecovery.js";
import {
  listPaymentReconciliationAlerts,
  resolveSuccessfulPaymentAlert,
} from "../models/PaymentReconciliation.js";

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

export async function showAdminOrders(req, res) {
  const orders = await listAdminOrders();

  res.render("admin/orders", {
    pageTitle: "Orders | Iron Culture Admin",
    metaDescription: "Manage customer orders.",
    adminPage: "orders",
    orders,
    formatMoney,
    formatDate,
  });
}

export async function showAdminOrder(req, res) {
  const validId =
    /^[1-9]\d*$/.test(req.params.id) && Number(req.params.id) <= 2147483647;

  const order = validId ? await findAdminOrder(Number(req.params.id)) : null;

  if (!order) {
    return res.status(404).render("error", {
      pageTitle: "Order Not Found | Iron Culture",
      metaDescription: "This order could not be found.",
      activePage: "",
      statusCode: 404,
      message: "This order could not be found.",
    });
  }
  const history = await getOrderStatusHistory(order.id);
  const canRecoverSandbox =
    process.env.NODE_ENV === "development" &&
    process.env.PAYFAST_MODE?.trim() === "sandbox" &&
    order.is_demo;

  const recoverableAttempts = canRecoverSandbox
    ? await listRecoverableSandboxAttempts(order.id)
    : [];
  const reconciliationAlerts = await listPaymentReconciliationAlerts(order.id);

  const allowedStatuses =
    reconciliationAlerts.length > 0 ? [] : availableOrderStatuses(order);

  res.render("admin/order-details", {
    pageTitle: "Order Details | Iron Culture Admin",
    metaDescription: "View customer order details.",
    adminPage: "orders",
    order,
    formatMoney,
    formatDate,
    history,
    allowedStatuses,
    recoverableAttempts,
    reconciliationAlerts,
  });
}

export async function submitDeliveryQuote(req, res) {
  function reject(message, status = 400) {
    return res.status(status).render("error", {
      pageTitle: "Delivery Quote Not Saved | Iron Culture",
      metaDescription: "The delivery quote needs attention.",
      activePage: "",
      statusCode: status,
      message,
    });
  }

  const rawId = req.params.id;
  const rawAmount =
    typeof req.body.deliveryAmount === "string"
      ? req.body.deliveryAmount.trim()
      : "";

  const rawVersion =
    typeof req.body.quoteVersion === "string" ? req.body.quoteVersion : "";

  const courier =
    typeof req.body.courier === "string" ? req.body.courier.trim() : "";

  const service =
    typeof req.body.service === "string" ? req.body.service.trim() : "";

  if (!/^[1-9]\d*$/.test(rawId) || Number(rawId) > 2147483647) {
    return reject("Invalid order.");
  }

  if (!/^\d{1,9}$/.test(rawVersion) || Number(rawVersion) > 2147483646) {
    return reject("Invalid quote version. Refresh the order page.");
  }

  if (!/^\d{1,5}(\.\d{1,2})?$/.test(rawAmount)) {
    return reject(
      "Enter a delivery charge from R0 to R99,999.99, with up to two decimal places.",
    );
  }

  const [whole, fraction = ""] = rawAmount.split(".");
  const deliveryCents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));

  if (!["The Courier Guy", "Aramex"].includes(courier)) {
    return reject("Choose The Courier Guy or Aramex.");
  }

  if (!service || service.length > 120) {
    return reject("Enter a courier service description of 1–120 characters.");
  }

  const result = await saveDeliveryQuote({
    orderId: Number(rawId),
    adminId: req.user.id,
    deliveryCents,
    courier,
    service,
    expectedVersion: Number(rawVersion),
  });

  if (!result) {
    return reject(
      "The quote was not saved. The order changed, is no longer eligible, or already has free delivery. Refresh its admin page before trying again.",
      409,
    );
  }

  return res.redirect(303, `/admin/orders/${result.id}`);
}

export async function submitOrderStatus(req, res) {
  function text(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function reject(message, status = 400) {
    return res.status(status).render("error", {
      pageTitle: "Order Update Failed | Iron Culture",
      metaDescription: "The order status could not be updated.",
      activePage: "",
      statusCode: status,
      message,
    });
  }

  const rawId = req.params.id;
  const expectedStatus = text(req.body.expectedStatus);
  const nextStatus = text(req.body.nextStatus);
  const note = text(req.body.note);
  const courier = text(req.body.courier);
  const trackingNumber = text(req.body.trackingNumber);

  if (!/^[1-9]\d*$/.test(rawId) || Number(rawId) > 2147483647) {
    return reject("Invalid order.");
  }

  if (!note || note.length > 500) {
    return reject("Enter a brief reason or update note of 1–500 characters.");
  }

  if (
    !["cancelled", "processing", "shipped", "delivered"].includes(nextStatus)
  ) {
    return reject("Choose a valid next status.");
  }

  if (courier.length > 60 || trackingNumber.length > 120) {
    return reject("Courier or tracking details are too long.");
  }

  try {
    await changeAdminOrderStatus({
      orderId: Number(rawId),
      adminId: req.user.id,
      expectedStatus,
      nextStatus,
      note,
      courier,
      trackingNumber,
    });

    return res.redirect(303, `/admin/orders/${rawId}`);
  } catch (error) {
    if (error.publicMessage) {
      return reject(error.publicMessage, error.status);
    }

    throw error;
  }
}

export async function submitSandboxRecovery(req, res) {
  function reject(message, status = 400) {
    return res.status(status).render("error", {
      pageTitle: "Sandbox Recovery | Iron Culture",
      metaDescription: "Sandbox payment recovery needs attention.",
      activePage: "",
      statusCode: status,
      message,
    });
  }

  const validId = (value) =>
    typeof value === "string" &&
    /^[1-9]\d*$/.test(value) &&
    Number(value) <= 2147483647;

  if (!validId(req.params.id) || !validId(req.params.paymentId)) {
    return reject("Invalid order or payment.");
  }

  const note = typeof req.body.note === "string" ? req.body.note.trim() : "";

  if (req.body.confirmChecked !== "yes") {
    return reject(
      "Confirm that you checked the exact payment reference in PayFast sandbox.",
    );
  }

  if (note.length < 10 || note.length > 300) {
    return reject("Enter a recovery note of 10–300 characters.");
  }

  try {
    await closeAbandonedSandboxAttempt({
      orderId: Number(req.params.id),
      paymentId: Number(req.params.paymentId),
      adminId: req.user.id,
      note,
    });
  } catch (error) {
    if (error.status === 409) {
      return reject(error.publicMessage, 409);
    }

    throw error;
  }

  return res.redirect(303, `/admin/orders/${req.params.id}`);
}

export async function submitReconciliationResolution(req, res) {
  function reject(message, status = 400) {
    return res.status(status).render("error", {
      pageTitle: "Payment Review | Iron Culture",
      metaDescription: "Payment reconciliation needs attention.",
      activePage: "",
      statusCode: status,
      message,
    });
  }

  const validNumber = (value) =>
    typeof value === "string" &&
    /^[1-9]\d*$/.test(value) &&
    Number(value) <= 2147483647;

  if (
    !validNumber(req.params.id) ||
    !validNumber(req.params.alertId) ||
    !validNumber(req.body.occurrenceCount)
  ) {
    return reject("Invalid order or alert. Refresh the page.");
  }

  const note = typeof req.body.note === "string" ? req.body.note.trim() : "";

  if (note.length < 10 || note.length > 300) {
    return reject("Enter a resolution note of 10–300 characters.");
  }

  try {
    await resolveSuccessfulPaymentAlert({
      orderId: Number(req.params.id),
      alertId: Number(req.params.alertId),
      adminId: req.user.id,
      expectedOccurrenceCount: Number(req.body.occurrenceCount),
      note,
    });
  } catch (error) {
    if (error.status === 409) {
      return reject(error.publicMessage, 409);
    }

    throw error;
  }

  return res.redirect(303, `/admin/orders/${req.params.id}`);
}
