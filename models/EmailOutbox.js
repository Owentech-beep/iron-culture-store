const supportedEvents = new Set([
  "order_received",
  "payment_confirmed",
  "delivery_quote_ready",
  "order_shipped",
]);

export async function enqueueOrderEmail(
  client,
  {
    orderId,
    eventType,
    eventVersion = 0,
    recipient,
    subject,
    textBody,
    isDemo,
  },
) {
  if (
    !Number.isSafeInteger(orderId) ||
    orderId <= 0 ||
    !supportedEvents.has(eventType) ||
    typeof isDemo !== "boolean"
  ) {
    throw new Error("Invalid order email event.");
  }

  if (
    !Number.isSafeInteger(eventVersion) ||
    eventVersion > 2147483647 ||
    (eventType === "delivery_quote_ready"
      ? eventVersion <= 0
      : eventVersion !== 0)
  ) {
    throw new Error("Invalid order email event version.");
  }

  if (
    typeof recipient !== "string" ||
    !recipient.trim() ||
    recipient.trim().length > 254 ||
    /[\r\n]/.test(recipient)
  ) {
    throw new Error("Invalid order email recipient.");
  }

  if (
    typeof subject !== "string" ||
    !subject.trim() ||
    subject.trim().length > 200 ||
    /[\r\n]/.test(subject)
  ) {
    throw new Error("Invalid order email subject.");
  }

  if (typeof textBody !== "string" || !textBody.trim()) {
    throw new Error("Order email content is required.");
  }

  const { rows } = await client.query(
    `INSERT INTO email_outbox (
       order_id,
       event_type,
       event_version,
       recipient,
       subject,
       text_body,
       is_demo
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (order_id, event_type, event_version) DO NOTHING
     RETURNING id`,
    [
      orderId,
      eventType,
      eventVersion,
      recipient.trim(),
      subject.trim(),
      textBody.trim(),
      isDemo,
    ],
  );

  return rows[0]?.id ?? null;
}