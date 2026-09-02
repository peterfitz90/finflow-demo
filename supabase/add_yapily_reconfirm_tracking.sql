-- Yapily AIS consents require periodic reconfirmation (90 days UK, 180 days EEA) — distinct
-- from the consent token's hard expiry. Track the Consent object's `reconfirmBy` deadline and
-- the last time the user actively reconfirmed, so we can warn before access lapses.
-- Run in Supabase SQL editor (safe to re-run).

ALTER TABLE bank_connections ADD COLUMN IF NOT EXISTS yapily_reconfirm_by TIMESTAMPTZ;
ALTER TABLE bank_connections ADD COLUMN IF NOT EXISTS yapily_last_confirmed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS bank_connections_reconfirm_by_idx ON bank_connections(yapily_reconfirm_by);
