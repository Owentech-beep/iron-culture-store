import {
  listCustomers,
  findCustomer,
} from "../models/AdminCustomer.js";

function positiveId(value) {
  if (
    typeof value !== "string" ||
    !/^[1-9]\d*$/.test(value)
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isSafeInteger(number) && number <= 2147483647
    ? number
    : null;
}

function formatDate(value) {
  return new Date(value).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Johannesburg",
  });
}

function formatMoney(cents) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
  }).format(Number(cents) / 100);
}

export async function showCustomers(req, res) {
  const search =
    typeof req.query.q === "string"
      ? req.query.q.trim().slice(0, 100)
      : "";

  const requestedPage = positiveId(req.query.page) ?? 1;
  const result = await listCustomers(search, requestedPage);

  res.render("admin/customers", {
    pageTitle: "Customers | Iron Culture Admin",
    metaDescription: "View customer accounts.",
    adminPage: "customers",
    search,
    ...result,
    formatDate,
  });
}

export async function showCustomer(req, res) {
  const id = positiveId(req.params.id);
  const customer = id ? await findCustomer(id) : null;

  if (!customer) {
    return res.status(404).render("error", {
      pageTitle: "Customer Not Found | Iron Culture",
      metaDescription: "This customer could not be found.",
      activePage: "",
      statusCode: 404,
      message: "This customer could not be found.",
    });
  }

  res.render("admin/customer-details", {
    pageTitle: "Customer Details | Iron Culture Admin",
    metaDescription: "View customer details and order history.",
    adminPage: "customers",
    customer,
    formatDate,
    formatMoney,
  });
}