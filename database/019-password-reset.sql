BEGIN;

ALTER TABLE users
  ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0
    CHECK (auth_version >= 0);

CREATE TABLE password_reset_tokens (
  id UUID PRIMARY KEY,

  user_id INTEGER NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,

  token_hash VARCHAR(64) NOT NULL UNIQUE
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,

  CHECK (expires_at > created_at),
  CHECK (used_at IS NULL OR used_at >= created_at)
);

CREATE INDEX password_reset_tokens_user_idx
  ON password_reset_tokens(user_id);

CREATE INDEX password_reset_tokens_expiry_idx
  ON password_reset_tokens(expires_at);

COMMIT;