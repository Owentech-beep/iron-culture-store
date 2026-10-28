(() => {
  const form = document.getElementById("payfastCheckoutForm");
  if (!form) return;

  const status = document.getElementById("payfastRedirectStatus");
  const reference = form.querySelector(
    'input[name="m_payment_id"]',
  )?.value;

  const allowedActions = new Set([
    "https://www.payfast.co.za/eng/process",
    "https://sandbox.payfast.co.za/eng/process",
  ]);

  if (
    form.method.toLowerCase() !== "post" ||
    !allowedActions.has(form.action) ||
    !reference
  ) {
    if (status) {
      status.textContent =
        "Payment checkout could not be prepared. Return to Payment Status.";
    }
    return;
  }

  const storageKey = `iron-culture-payfast-handoff:${reference}`;
  let submitted = false;

  function goToStatus() {
    window.location.replace(form.dataset.statusUrl);
  }

  // Do not automatically repost a payment form when returning
  // from PayFast using browser Back.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) goToStatus();
  });

  try {
    if (sessionStorage.getItem(storageKey) === "sent") {
      goToStatus();
      return;
    }
  } catch {
    // Checkout can still work when browser storage is unavailable.
  }

  form.addEventListener("submit", (event) => {
    if (submitted) {
      event.preventDefault();
      return;
    }

    submitted = true;

    try {
      sessionStorage.setItem(storageKey, "sent");
    } catch {
      // Database checks remain responsible for payment safety.
    }

    if (status) {
      status.textContent = "Connecting to PayFast...";
    }
  });

  try {
    form.requestSubmit();
  } catch {
    if (status) {
      status.textContent =
        "Use Continue to PayFast below to complete your payment.";
    }
  }
})();