BEGIN;

CREATE TABLE newsletter_subscribers (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  email VARCHAR(254) NOT NULL UNIQUE,

  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'subscribed', 'unsubscribed')),

  consent_version VARCHAR(40) NOT NULL,
  consent_requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  confirmation_token_hash CHAR(64),
  confirmation_expires_at TIMESTAMPTZ,

  confirmed_at TIMESTAMPTZ,
  unsubscribed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (email = LOWER(TRIM(email))),

  CHECK (
    (
      confirmation_token_hash IS NULL
      AND confirmation_expires_at IS NULL
    )
    OR
    (
      confirmation_token_hash IS NOT NULL
      AND confirmation_expires_at IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX newsletter_confirmation_token_idx
ON newsletter_subscribers (confirmation_token_hash)
WHERE confirmation_token_hash IS NOT NULL;

COMMIT;