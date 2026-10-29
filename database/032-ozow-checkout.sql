BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE payments
  ADD COLUMN provider_request_id VARCHAR(255),
  ADD COLUMN provider_checkout_url TEXT,
  ADD COLUMN provider_request_started_at TIMESTAMPTZ,
  ADD COLUMN provider_request_expires_at TIMESTAMPTZ;

CREATE UNIQUE INDEX payments_provider_request_unique_idx
  ON payments (provider, provider_request_id)
  WHERE provider_request_id IS NOT NULL;

ALTER TABLE payments
  ADD CONSTRAINT payments_provider_request_id_not_empty
  CHECK (
    provider_request_id IS NULL
    OR LENGTH(BTRIM(provider_request_id)) > 0
  ),

  ADD CONSTRAINT payments_checkout_url_requires_request
  CHECK (
    provider_checkout_url IS NULL
    OR (
      provider_request_id IS NOT NULL
      AND LENGTH(BTRIM(provider_checkout_url)) > 0
    )
  ),

  ADD CONSTRAINT payments_request_expiry_after_start
  CHECK (
    provider_request_expires_at IS NULL
    OR (
      provider_request_started_at IS NOT NULL
      AND provider_request_expires_at > provider_request_started_at
    )
  );

COMMIT;