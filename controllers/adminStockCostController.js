import { randomUUID } from "node:crypto";

import {
  receiveStockPurchase,
  setOpeningStockCost,
  adjustStockWithCosts,
} from "../models/StockCost.js";

import {
  getCostInventory,
  getRecentStockPurchases,
} from "../models/StockCostOverview.js";

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function integer(value, maximum = 9999999) {
  const raw = text(value);

  if (!/^\d+$/.test(raw)) return null;

  const number = Number(raw);

  return Number.isSafeInteger(number) &&
    number >= 0 &&
    number <= maximum
    ? number
    : null;
}

function positiveId(value) {
  const number = integer(value, 2147483647);
  return number && number > 0 ? number : null;
}

function moneyCents(value) {
  const raw = text(value);

  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(raw)) return null;

  const [whole, fraction = ""] = raw.split(".");

  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

function formatMoney(cents) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
  }).format(Number(cents) / 100);
}

function renderProblem(res, message, status = 400) {
  return res.status(status).render("error", {
    pageTitle: "Stock Update Failed | Iron Culture",
    metaDescription: "The stock update could not be completed.",
    activePage: "",
    statusCode: status,
    message,
  });
}

async function performUpdate(res, action, notice) {
  try {
    await action();
    return res.redirect(303, `/admin/inventory?notice=${notice}`);
  } catch (error) {
    if (error.publicMessage) {
      return renderProblem(
        res,
        error.publicMessage,
        error.status || 409,
      );
    }

    if (["23505", "55P03", "40P01"].includes(error.code)) {
      return renderProblem(
        res,
        "This stock record was submitted or changed elsewhere. Refresh the inventory page and check its current values.",
        409,
      );
    }

    throw error;
  }
}

export async function showCostInventory(req, res) {
  const search = text(req.query.q).slice(0, 100);

  const [stockItems, purchases] = await Promise.all([
    getCostInventory(search),
    getRecentStockPurchases(),
  ]);

  const items = stockItems.map((item) => ({
    ...item,
    receiptKey: randomUUID(),
    correctionKey: randomUUID(),
  }));

  const notices = {
    received: "Stock purchase recorded.",
    opening: "Opening stock cost recorded. Physical quantity was unchanged.",
    corrected: "Stock correction saved.",
  };

  const notice = Object.hasOwn(notices, text(req.query.notice))
    ? notices[text(req.query.notice)]
    : "";

  const dateParts = new Intl.DateTimeFormat("en", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const dateValues = Object.fromEntries(
    dateParts.map((part) => [part.type, part.value]),
  );

  const today =
    `${dateValues.year}-${dateValues.month}-${dateValues.day}`;

  res.render("admin/inventory", {
    pageTitle: "Inventory & Purchase Costs | Iron Culture Admin",
    metaDescription: "Manage stock receipts, quantities and purchase costs.",
    adminPage: "inventory",
    search,
    items,
    purchases,
    notice,
    today,
    formatMoney,
  });
}

export async function receivePurchase(req, res) {
  const variantId = positiveId(req.params.id);

  if (!variantId) {
    return renderProblem(res, "Invalid product option.");
  }

  return performUpdate(
    res,
    () => receiveStockPurchase(variantId, req.user.id, {
      quantity: integer(req.body.quantity),
      unitCostCents: moneyCents(req.body.unit_cost),
      receivedOn: text(req.body.received_on),
      supplier: text(req.body.supplier),
      invoiceReference: text(req.body.invoice_reference),
      note: text(req.body.note),
      submissionKey: text(req.body.submissionKey),
    }),
    "received",
  );
}

export async function saveOpeningCost(req, res) {
  const variantId = positiveId(req.params.id);

  if (!variantId) {
    return renderProblem(res, "Invalid product option.");
  }

  return performUpdate(
    res,
    () => setOpeningStockCost(variantId, req.user.id, {
      unitCostCents: moneyCents(req.body.unit_cost),
      expectedQuantity: integer(req.body.expectedQuantity),
      note: text(req.body.note),
    }),
    "opening",
  );
}

export async function correctStock(req, res) {
  const variantId = positiveId(req.params.id);

  if (!variantId) {
    return renderProblem(res, "Invalid product option.");
  }

  return performUpdate(
    res,
    () => adjustStockWithCosts(variantId, req.user.id, {
      quantity: integer(req.body.quantity),
      previousQuantity: integer(req.body.previousQuantity),
      threshold: integer(req.body.threshold),
      reason: text(req.body.reason),
      submissionKey: text(req.body.submissionKey),
    }),
    "corrected",
  );
}