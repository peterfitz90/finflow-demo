-- Add per-company inbound email token for the AP Mailbox feature.
-- Each company gets a unique random hex token used as the mailbox address prefix:
--   {inbound_token}@inbound.ledgrly.ie
--
-- Existing companies are backfilled so they immediately have an address.
-- New companies get a token via the DEFAULT expression.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS inbound_token TEXT;

-- Backfill existing rows that have no token yet.
UPDATE companies
SET inbound_token = lower(encode(gen_random_bytes(5), 'hex'))
WHERE inbound_token IS NULL;

-- Unique index ensures Postmark lookups map to exactly one company.
CREATE UNIQUE INDEX IF NOT EXISTS companies_inbound_token_key
  ON companies (inbound_token)
  WHERE inbound_token IS NOT NULL;

-- Default for new companies created after this migration runs.
ALTER TABLE companies
  ALTER COLUMN inbound_token SET DEFAULT lower(encode(gen_random_bytes(5), 'hex'));
