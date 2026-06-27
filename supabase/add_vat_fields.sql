-- VAT data capture: vat_code on journals, default_vat_code on CoA,
-- ros_efiler on companies, and the vat_returns filing table.
-- Run BEFORE set_vat_defaults.sql and backfill_vat_codes.sql.

-- 1. vat_code on journals (values match Irish VAT rates used in the engine)
ALTER TABLE journals
  ADD COLUMN IF NOT EXISTS vat_code TEXT
    CHECK (vat_code IN ('STD23','RED13','RED9','ZERO','EXEMPT','RC','NONE'));

-- 2. default_vat_code on chart_of_accounts (inherits into new journals)
ALTER TABLE chart_of_accounts
  ADD COLUMN IF NOT EXISTS default_vat_code TEXT
    CHECK (default_vat_code IN ('STD23','RED13','RED9','ZERO','EXEMPT','RC','NONE'));

-- 3. ROS e-filer flag on companies (23rd vs 19th filing deadline)
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS ros_efiler BOOLEAN NOT NULL DEFAULT false;

-- 4. vat_returns: stores filed/draft VAT3 figures per period
CREATE TABLE IF NOT EXISTS vat_returns (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID         NOT NULL,
  period_val    TEXT         NOT NULL,    -- 'b-2025-0' bimonthly or 'm-2025-3' monthly
  period_start  DATE         NOT NULL,
  period_end    DATE         NOT NULL,
  t1            NUMERIC(12,2),            -- VAT on Sales (output)
  t2            NUMERIC(12,2),            -- VAT on Purchases (input)
  t3            NUMERIC(12,2),            -- Net payable (max(0, T1-T2))
  t4            NUMERIC(12,2),            -- Net repayable (max(0, T2-T1))
  e1            NUMERIC(12,2) DEFAULT 0,  -- EU goods supplies
  e2            NUMERIC(12,2) DEFAULT 0,  -- EU goods acquisitions
  es1           NUMERIC(12,2) DEFAULT 0,  -- EU services supplies
  es2           NUMERIC(12,2) DEFAULT 0,  -- EU services acquisitions
  pa1           NUMERIC(12,2),            -- Total net sales (excl. VAT)
  pa2           NUMERIC(12,2),            -- Total net purchases (excl. VAT)
  figures       JSONB,                    -- Full snapshot at time of filing
  status        TEXT         NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','filed')),
  filed_at      TIMESTAMPTZ,
  filed_by      TEXT,
  created_at    TIMESTAMPTZ  DEFAULT now(),
  UNIQUE (company_id, period_val)
);

CREATE INDEX IF NOT EXISTS vat_returns_company ON vat_returns (company_id);

ALTER TABLE vat_returns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company members can manage vat_returns"
  ON vat_returns FOR ALL
  USING (
    company_id IN (
      SELECT id FROM companies WHERE clerk_user_id = auth.jwt() ->> 'sub'
    )
  );
