-- Fixed Asset Register v1
-- Run in Supabase SQL editor (safe to re-run — IF NOT EXISTS throughout)

-- Asset register
CREATE TABLE IF NOT EXISTS fixed_assets (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                 UUID NOT NULL,
  name                       TEXT NOT NULL,
  description                TEXT,
  category                   TEXT NOT NULL DEFAULT 'other'
                               CHECK (category IN ('plant_machinery','fixtures_fittings','computer_equipment','motor_vehicles','other')),
  cost                       NUMERIC(15,2) NOT NULL,
  purchase_date              DATE NOT NULL,
  method                     TEXT NOT NULL DEFAULT 'straight_line'
                               CHECK (method IN ('straight_line','reducing_balance')),
  useful_life_months         INT,            -- required for straight_line
  rate_percent               NUMERIC(7,4),   -- required for reducing_balance (annual %)
  residual_value             NUMERIC(15,2) NOT NULL DEFAULT 0,
  asset_nominal              TEXT NOT NULL DEFAULT '1500',   -- CoA code for cost (e.g. 1510)
  accum_dep_nominal          TEXT NOT NULL DEFAULT '1501',   -- CoA code for accum dep (e.g. 1511)
  status                     TEXT NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active','disposed')),
  disposal_date              DATE,
  disposal_proceeds          NUMERIC(15,2),
  disposal_journal_ids       UUID[],
  source_ap_invoice_id       UUID,
  source_bank_transaction_id UUID,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON fixed_assets TO anon;

-- One row per company per period — idempotency guard (same pattern as recurring_journal_runs)
CREATE TABLE IF NOT EXISTS asset_depreciation_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL,
  period       TEXT NOT NULL,        -- 'YYYY-MM'
  journal_ids  UUID[],
  total        NUMERIC(15,2),
  posted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, period)
);

GRANT ALL ON asset_depreciation_runs TO anon;

-- New CoA accounts for the fixed asset register
-- These are upserted so existing companies get them automatically via the CoA seed path
INSERT INTO chart_of_accounts (company_id, code, name, account_type, category, is_system)
  SELECT c.id, a.code, a.name, a.account_type, a.category, true
  FROM companies c
  CROSS JOIN (VALUES
    ('1501', 'Accum Dep — Fixed Assets',          'asset',   'Fixed Assets'),
    ('1510', 'Plant & Machinery',                 'asset',   'Fixed Assets'),
    ('1511', 'Accum Dep — Plant & Machinery',     'asset',   'Fixed Assets'),
    ('1520', 'Fixtures & Fittings',               'asset',   'Fixed Assets'),
    ('1521', 'Accum Dep — Fixtures & Fittings',  'asset',   'Fixed Assets'),
    ('1530', 'Computer Equipment',                'asset',   'Fixed Assets'),
    ('1531', 'Accum Dep — Computer Equipment',   'asset',   'Fixed Assets'),
    ('1540', 'Motor Vehicles',                    'asset',   'Fixed Assets'),
    ('1541', 'Accum Dep — Motor Vehicles',        'asset',   'Fixed Assets'),
    ('6910', 'Loss on Disposal of Assets',        'expense', 'Overheads')
  ) AS a(code, name, account_type, category)
  ON CONFLICT (company_id, code) DO NOTHING;
