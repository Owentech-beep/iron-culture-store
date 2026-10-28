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
const flatDeliveryCents = 9900;
const maximumAmountCents = 2147483647;

export function calculateShipping(subtotalCents, discountCents = 0) {
  if (
    !Number.isSafeInteger(subtotalCents) ||
    !Number.isSafeInteger(discountCents) ||
    subtotalCents < 0 ||
    discountCents < 0 ||
    discountCents > subtotalCents
  ) {
    throw new Error("Invalid shipping calculation amounts.");
  }

  const eligibleSubtotal = subtotalCents - discountCents;
  const qualifiesForFreeDelivery =
    eligibleSubtotal >= freeDeliveryThresholdCents;

  const deliveryCents = qualifiesForFreeDelivery
    ? 0
    : flatDeliveryCents;

  const totalCents = eligibleSubtotal + deliveryCents;

  if (
    !Number.isSafeInteger(totalCents) ||
    totalCents > maximumAmountCents
  ) {
    throw new Error("Order total exceeds the supported amount.");
  }

  return {
    status: qualifiesForFreeDelivery ? "free" : "flat_rate",
    deliveryCents,
    totalCents,
  };
}