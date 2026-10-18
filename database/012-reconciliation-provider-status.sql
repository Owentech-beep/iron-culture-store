BEGIN;

ALTER TABLE payment_reconciliation_alerts
  ADD COLUMN provider_status VARCHAR(30)
  NOT NULL DEFAULT 'COMPLETE';

COMMIT;