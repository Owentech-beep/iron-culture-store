export const provinces = [
  "Eastern Cape",
  "Free State",
  "Gauteng",
  "KwaZulu-Natal",
  "Limpopo",
  "Mpumalanga",
  "North West",
  "Northern Cape",
  "Western Cape",
];

const freeDeliveryThresholdCents = 75000;

export function calculateShipping(subtotalCents, discountCents = 0) {
  const eligibleSubtotal = subtotalCents - discountCents;

  if (eligibleSubtotal > freeDeliveryThresholdCents) {
    return {
      status: "free",
      deliveryCents: 0,
      totalCents: eligibleSubtotal,
    };
  }

  // A real courier integration will supply the delivery amount.
  // Never substitute a guessed price or zero on failure.
  return {
    status: "quote_required",
    deliveryCents: null,
    totalCents: null,
  };
}