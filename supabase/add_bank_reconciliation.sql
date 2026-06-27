-- Bank Reconciliation module
-- Run in Supabase SQL editor

-- 1. Add reconciliation fields to bank_transactions
ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS reconciled     boolean      DEFAULT false,
  ADD COLUMN IF NOT EXISTS reconciled_at  timestamptz;

-- 2. bank_matches table
--    matched_type: 'invoice' = AR invoice, 'ap_invoice' = AP invoice, 'journal' = journal entry
CREATE TABLE IF NOT EXISTS bank_matches (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid         NOT NULL,
  bank_transaction_id uuid         NOT NULL REFERENCES bank_transactions(id) ON DELETE CASCADE,
  matched_type        text         NOT NULL CHECK (matched_type IN ('invoice','ap_invoice','journal')),
  matched_id          uuid         NOT NULL,
  confidence          numeric(5,2) NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 100),
  status              text         NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested','confirmed','rejected')),
  matched_by          text         NOT NULL DEFAULT 'auto' CHECK (matched_by IN ('auto','user')),
  created_at          timestamptz  DEFAULT now(),
  confirmed_at        timestamptz
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS bank_matches_company_status      ON bank_matches (company_id, status);
CREATE INDEX IF NOT EXISTS bank_matches_bank_transaction_id ON bank_matches (bank_transaction_id);

-- RLS: match the pattern on bank_transactions (allow all authenticated reads/writes per company)
ALTER TABLE bank_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company members can manage bank_matches"
  ON bank_matches FOR ALL
  USING (
    company_id IN (
      SELECT id FROM companies WHERE clerk_user_id = auth.jwt() ->> 'sub'
    )
  );
