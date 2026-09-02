-- Remove all bank_connections with plaintext consent tokens.
-- These are sandbox test connections (modelo-sandbox only) — safe to delete.
-- After deploying the encryption change, reconnect via the UI to get an encrypted row.
-- New connections will store ENC1:<iv>:<tag>:<ct> in yapily_consent_token.

DELETE FROM bank_connections
WHERE yapily_consent_token IS NOT NULL
  AND yapily_consent_token NOT LIKE 'ENC1:%';
