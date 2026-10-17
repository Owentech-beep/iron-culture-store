import { getDashboardData } from "../models/Admin.js";

export async function showDashboard(req, res) {
  const dashboard = await getDashboardData();

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

  res.render("admin/dashboard", {
    pageTitle: "Admin Dashboard | Iron Culture",
    metaDescription: "Iron Culture store administration.",
    adminPage: "dashboard",
    dashboard,
    formatMoney,
    formatDate,
  });
}