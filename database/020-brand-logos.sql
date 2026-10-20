BEGIN;

ALTER TABLE brands
  ADD COLUMN logo_url TEXT,
  ADD COLUMN logo_public_id TEXT;

ALTER TABLE brands
  ADD CONSTRAINT brands_logo_pair_check
    CHECK (
      (logo_url IS NULL AND logo_public_id IS NULL)
      OR
      (
        logo_url IS NOT NULL
        AND logo_public_id IS NOT NULL
        AND CHAR_LENGTH(TRIM(logo_url)) > 0
        AND CHAR_LENGTH(TRIM(logo_public_id)) > 0
      )
    );

COMMIT;