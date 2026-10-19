const supportedEvents = new Set([
  "order_received",
  "payment_confirmed",
]);

// Call using the client from an existing order/payment transaction.
// This function only queues an email. It never contacts an email provider.
export async function enqueueOrderEmail(
  client,
  {
    orderId,
    eventType,
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
       recipient,
       subject,
       text_body,
       is_demo
     )
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (order_id, event_type) DO NOTHING
     RETURNING id`,
    [
      orderId,
      eventType,
      recipient.trim(),
      subject.trim(),
      textBody.trim(),
      isDemo,
    ],
  );

  return rows[0]?.id ?? null;
}