-- Settlement/matching engine: AP GL posting, payment tracking, allocation tables.
-- Prerequisites: add_ar_core.sql, fix_invoice_ref_nullable.sql
-- Run AFTER all prior migrations.

-- ── ap_invoices: payment tracking + expense nominal ───────────────────────────
ALTER TABLE ap_invoices
  ADD COLUMN IF NOT EXISTS amount_paid  NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nominal_code TEXT,
  ADD COLUMN IF NOT EXISTS vat_code     TEXT NOT NULL DEFAULT 'STD23';

-- ── bank_transactions: settlement type lock ───────────────────────────────────
-- Enforces: each bank line resolves to exactly one settlement type, no double-counting.
ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS settlement_type TEXT
    CHECK (settlement_type IN ('ap', 'ar', 'stripe', 'categorise', 'on_account'));

-- ── settlement_allocations: one row per invoice per bank-line settlement ──────
-- Supports: one bank line → many invoices, many bank lines → one invoice (partial).
CREATE TABLE IF NOT EXISTS settlement_allocations (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID          NOT NULL,
  bank_transaction_id   UUID          NOT NULL,
  invoice_id            UUID          NOT NULL,
  invoice_type          TEXT          NOT NULL CHECK (invoice_type IN ('ar', 'ap')),
  allocated_amount      NUMERIC(12,2) NOT NULL,
  difference_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,   -- tolerance written off
  difference_nominal    TEXT,                                -- e.g. '6500' Bank Charges
  settlement_journal_id UUID,
  created_at            TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS settlement_alloc_bt  ON settlement_allocations (bank_transaction_id);
CREATE INDEX IF NOT EXISTS settlement_alloc_inv ON settlement_allocations (invoice_id);
ALTER TABLE settlement_allocations DISABLE ROW LEVEL SECURITY;
GRANT ALL ON settlement_allocations TO anon;

-- ── on_account_entries: unallocated receipts/payments to match later ──────────
CREATE TABLE IF NOT EXISTS on_account_entries (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID          NOT NULL,
  bank_transaction_id   UUID          NOT NULL,
  party_type            TEXT          NOT NULL CHECK (party_type IN ('customer', 'supplier')),
  party_name            TEXT          NOT NULL,
  amount                NUMERIC(12,2) NOT NULL,
  allocated_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes                 TEXT,
  settlement_journal_id UUID,
  created_at            TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS on_account_company ON on_account_entries (company_id);
ALTER TABLE on_account_entries DISABLE ROW LEVEL SECURITY;
GRANT ALL ON on_account_entries TO anon;
