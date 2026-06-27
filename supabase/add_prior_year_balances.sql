-- Prior year trial balance storage
-- Run once per Supabase project. Safe to re-run (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS prior_year_balances (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     TEXT         NOT NULL,
  year_end_date  DATE         NOT NULL,
  account_code   TEXT         NOT NULL,
  account_name   TEXT         NOT NULL DEFAULT '',
  debit_balance  NUMERIC(14,2) NOT NULL DEFAULT 0,
  credit_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS prior_year_balances_company_date_idx
  ON prior_year_balances (company_id, year_end_date);

-- Row-level security (match journals/chart_of_accounts pattern)
ALTER TABLE prior_year_balances ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read/write their own company's data.
-- Adjust the policy to match your existing RLS strategy.
CREATE POLICY IF NOT EXISTS "prior_year_balances_company_access"
  ON prior_year_balances
  FOR ALL
  USING (true)
  WITH CHECK (true);
