function unavailableError() {
  const error = new Error("Payment provider is not configured.");
  error.code = "PAYMENTS_NOT_CONFIGURED";
  error.status = 503;
  return error;
}

// Future adapters will implement this interface.
// No provider is enabled until its integration is implemented and tested.
const unconfiguredProvider = Object.freeze({
  name: "none",
  configured: false,

  async createCheckout() {
    throw unavailableError();
  },

  async verifyNotification() {
    throw unavailableError();
  },
});

export function getPaymentProvider() {
  return unconfiguredProvider;
}