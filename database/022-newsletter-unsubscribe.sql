BEGIN;

ALTER TABLE newsletter_subscribers
  ADD COLUMN unsubscribe_token_hash CHAR(64);

CREATE UNIQUE INDEX newsletter_unsubscribe_token_idx
ON newsletter_subscribers (unsubscribe_token_hash)
WHERE unsubscribe_token_hash IS NOT NULL;

COMMIT;