BEGIN;

ALTER TABLE order_status_history
  ALTER COLUMN changed_by DROP NOT NULL;

COMMENT ON COLUMN order_status_history.changed_by IS
  'Admin user responsible for a manual change; NULL for a system-generated change.';

COMMIT;