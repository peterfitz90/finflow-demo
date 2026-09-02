-- Adds superseded_at to vat_returns to track when a filed return is unlocked.
-- The filed_at and figures snapshot are NEVER erased — superseded_at is additive.
-- status reverts to 'draft'; the original filed_at and figures JSONB are retained.
-- Safe to run on live DB: IF NOT EXISTS is a no-op if column already present.

ALTER TABLE vat_returns
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;
