import {
  normalizeNewsletterEmail,
  isNewsletterConfirmationValid,
  confirmNewsletterSubscription,
  isNewsletterUnsubscribeValid,
  unsubscribeNewsletter,
} from "../models/Newsletter.js";
import {
  sendNewsletterConfirmation,
} from "../services/newsletterService.js";

function renderPage(res, options = {}) {
  return res.status(options.status ?? 200).render("newsletter", {
    pageTitle: "Newsletter | Iron Culture",
    heading: options.heading ?? "Stay in the Loop",
    message: options.message ?? "",
    action: options.action ?? "",
    buttonLabel: options.buttonLabel ?? "",
    token: options.token ?? "",
  });
}

export function newsletterHeaders(req, res, next) {
  res.set("Cache-Control", "no-store");
  res.set("Referrer-Policy", "no-referrer");
  res.set("X-Robots-Tag", "noindex, nofollow");
  next();
}

export async function subscribeNewsletter(req, res) {
  const email = normalizeNewsletterEmail(req.body.email);

  if (!email || req.body.consent !== "yes") {
    return renderPage(res, {
      status: 400,
      heading: "Check your signup",
      message:
        "Enter a valid email address and tick the newsletter consent box.",
    });
  }

  try {
    await sendNewsletterConfirmation(email);
    } catch (error) {
    console.error("Newsletter signup failed:", {
      name: error.name,
      code: error.code ?? null,
    });
  }

  // Same response for existing, restricted and newly requested addresses.
  return renderPage(res, {
    heading: "Check your inbox",
    message:
      "If this address is eligible, a confirmation email will arrive shortly. " +
      "During local testing, only the configured test address can receive it. " +
      "If needed, wait two minutes before requesting another link.",
  });
}

export async function showNewsletterConfirmation(req, res) {
  const token = req.query.token;

  if (!(await isNewsletterConfirmationValid(token))) {
    return renderPage(res, {
      status: 400,
      heading: "Link unavailable",
      message:
        "This link has expired, was replaced or has already been used. " +
        "You can request a new link from the homepage.",
    });
  }

  return renderPage(res, {
    heading: "Confirm your subscription",
    message:
      "Receive Iron Culture product news, launches and offers by email. " +
      "You can unsubscribe whenever you choose.",
    action: "/newsletter/confirm",
    buttonLabel: "Confirm Subscription",
    token,
  });
}

export async function confirmNewsletter(req, res) {
  const confirmed = await confirmNewsletterSubscription(req.body.token);

  return renderPage(res, {
    status: confirmed ? 200 : 400,
    heading: confirmed ? "You’re subscribed" : "Link unavailable",
    message: confirmed
      ? "Your newsletter subscription is confirmed."
      : "This confirmation link is no longer valid.",
  });
}

export async function showNewsletterUnsubscribe(req, res) {
  const token = req.query.token;

  if (!(await isNewsletterUnsubscribeValid(token))) {
    return renderPage(res, {
      status: 400,
      heading: "Link unavailable",
      message: "This unsubscribe link is no longer valid.",
    });
  }

  return renderPage(res, {
    heading: "Unsubscribe",
    message:
      "Stop newsletter emails or cancel your pending subscription request. " +
      "Your account and order notifications will remain available.",
    action: "/newsletter/unsubscribe",
    buttonLabel: "Unsubscribe",
    token,
  });
}

export async function submitNewsletterUnsubscribe(req, res) {
  const unsubscribed = await unsubscribeNewsletter(req.body.token);

  return renderPage(res, {
    status: unsubscribed ? 200 : 400,
    heading: unsubscribed ? "You’re unsubscribed" : "Link unavailable",
    message: unsubscribed
      ? "You will not receive newsletter emails from this subscription."
      : "This unsubscribe link is no longer valid.",
  });
}