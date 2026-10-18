BEGIN;

ALTER TABLE payment_reconciliation_alerts
  ADD COLUMN resolved_at TIMESTAMPTZ,
  ADD COLUMN resolved_by INTEGER REFERENCES users(id),
  ADD COLUMN resolution_note VARCHAR(300);

COMMIT;