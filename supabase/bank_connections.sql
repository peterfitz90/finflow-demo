-- Yapily bank connections
-- Run in Supabase SQL editor (safe to re-run — IF NOT EXISTS throughout)

CREATE TABLE IF NOT EXISTS bank_connections (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  UUID NOT NULL,
  yapily_consent_request_id   TEXT,
  yapily_consent_token        TEXT,
  institution_id              TEXT NOT NULL DEFAULT 'modelo-sandbox',
  status                      TEXT NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','active','expired','revoked','failed')),
  consent_expires_at          TIMESTAMPTZ,
  application_user_id         TEXT,
  yapily_user_uuid            TEXT,
  account_refs                JSONB,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add yapily_user_uuid if table was created before this column existed
ALTER TABLE bank_connections ADD COLUMN IF NOT EXISTS yapily_user_uuid TEXT;

CREATE INDEX IF NOT EXISTS bank_connections_company_id_idx ON bank_connections(company_id);
CREATE INDEX IF NOT EXISTS bank_connections_consent_request_id_idx ON bank_connections(yapily_consent_request_id);

-- Disable RLS — matches the pattern of all peer tables in this project
-- (invoices, journals, bank_transactions, vat_returns, fixed_assets, etc.).
-- RLS is non-functional here: the Supabase client uses the anon key with no Clerk JWT,
-- so auth.jwt() sub is always null. Company isolation is enforced at the app layer via
-- company_id scoping in every API function and every frontend query.
DROP POLICY IF EXISTS "company members can manage bank_connections" ON bank_connections;
ALTER TABLE bank_connections DISABLE ROW LEVEL SECURITY;
GRANT ALL ON bank_connections TO anon;
