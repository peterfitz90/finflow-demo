-- Store the Yapily Consent id (returned by the consent-one-time-token exchange as `id`)
-- separately from the encrypted consentToken. DELETE /consents/{consentId} needs this id,
-- not the token — without it a stored connection can never be revoked at Yapily.
-- Run in Supabase SQL editor (safe to re-run).

ALTER TABLE bank_connections ADD COLUMN IF NOT EXISTS yapily_consent_id TEXT;

CREATE INDEX IF NOT EXISTS bank_connections_consent_id_idx ON bank_connections(yapily_consent_id);
