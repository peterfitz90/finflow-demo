-- VAT3 return filing table.
-- Upserted by markFiled (VATReturns component) on conflict (company_id, period_val).
-- Read by: VATReturns filedMap, Overview vatFiledSet, getLockedPeriods, isPeriodLocked,
--          useHealthy compliance check.
-- Run AFTER add_ar_core.sql (companies table must exist).

CREATE TABLE IF NOT EXISTS vat_returns (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID          NOT NULL,
  period_val   TEXT          NOT NULL,           -- e.g. 'b-2026-2' (bimonthly) / 'm-2026-5' (monthly)
  period_start DATE          NOT NULL,
  period_end   DATE          NOT NULL,

  -- VAT3 box figures (all nullable — upsert always provides values, but allow partial rows)
  t1           NUMERIC(14,2),                    -- VAT on sales
  t2           NUMERIC(14,2),                    -- VAT on purchases
  t3           NUMERIC(14,2),
  t4           NUMERIC(14,2),
  e1           NUMERIC(14,2),                    -- EU acquisitions (goods)
  e2           NUMERIC(14,2),                    -- EU acquisitions (services)
  es1          NUMERIC(14,2),
  es2          NUMERIC(14,2),
  pa1          NUMERIC(14,2),                    -- net VAT payable / repayable

  figures      JSONB,                            -- snapshot of all box values at filing time
  status       TEXT          NOT NULL DEFAULT 'draft',
  filed_at     TIMESTAMPTZ,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Required for upsert onConflict: 'company_id,period_val'
CREATE UNIQUE INDEX IF NOT EXISTS vat_returns_company_period
  ON vat_returns (company_id, period_val);

-- Secondary index for period-range lock checks (isPeriodLocked, getLockedPeriods)
CREATE INDEX IF NOT EXISTS vat_returns_company_dates
  ON vat_returns (company_id, period_start, period_end);

-- add_vat_fields.sql enabled RLS with an auth.jwt() policy that is non-functional:
-- the Supabase client uses only the anon key (no Clerk JWT injected), so auth.jwt() ->> 'sub'
-- is always null. All peer tables (invoices, journals, bank_transactions, settlement_allocations)
-- use DISABLE ROW LEVEL SECURITY + GRANT ALL TO anon; app-layer company_id filtering is the
-- sole isolation mechanism. Match that pattern here.
DROP POLICY IF EXISTS "company members can manage vat_returns" ON vat_returns;
ALTER TABLE vat_returns DISABLE ROW LEVEL SECURITY;
GRANT ALL ON vat_returns TO anon;
