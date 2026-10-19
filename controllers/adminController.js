import { getDashboardData } from "../models/Admin.js";
import { getAdminEmailOverview } from "../models/AdminEmail.js";

export async function showDashboard(req, res) {
  const [dashboard, emailOverview] = await Promise.all([
    getDashboardData(),
    getAdminEmailOverview(),
  ]);

  const formatMoney = (cents) =>
    new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency: "ZAR",
    }).format(Number(cents) / 100);

  const formatDate = (value) =>
    new Date(value).toLocaleDateString("en-ZA", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Africa/Johannesburg",
    });

  const formatDateTime = (value) =>
    new Date(value).toLocaleString("en-ZA", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Africa/Johannesburg",
    });

  const emailEventLabels = {
    order_received: "Order received",
    payment_confirmed: "Payment confirmed",
    delivery_quote_ready: "Delivery quote",
    order_shipped: "Order dispatched",
  };

  const emailStatusLabels = {
    pending: "Pending",
    sending: "Sending",
    sent: "Accepted by provider",
    failed: "Failed",
    review_required: "Review required",
  };

  res.render("admin/dashboard", {
    pageTitle: "Admin Dashboard | Iron Culture",
    metaDescription: "Iron Culture store administration.",
    adminPage: "dashboard",
    dashboard,
    emailOverview,
    emailEventLabels,
    emailStatusLabels,
    formatMoney,
    formatDate,
    formatDateTime,
  });
}