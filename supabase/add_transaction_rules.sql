-- Transaction rules engine
-- company_id = NULL means global system rule that applies to all companies.
-- Run once in the Supabase SQL editor. Safe to re-run (IF NOT EXISTS / ON CONFLICT DO NOTHING).

CREATE TABLE IF NOT EXISTS transaction_rules (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID        REFERENCES companies(id) ON DELETE CASCADE,  -- NULL = global
  pattern       TEXT        NOT NULL,
  match_type    TEXT        NOT NULL DEFAULT 'contains',  -- contains | startswith | exact | regex
  direction     TEXT        NOT NULL DEFAULT 'both',      -- in | out | both
  nominal_code  TEXT        NOT NULL,
  nominal_name  TEXT        NOT NULL,
  confidence    TEXT        NOT NULL DEFAULT 'high',      -- high | medium | low
  source        TEXT        NOT NULL DEFAULT 'system',    -- system | user | learned
  usage_count   INTEGER     NOT NULL DEFAULT 0,
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rules_company ON transaction_rules (company_id);
CREATE INDEX IF NOT EXISTS idx_rules_active  ON transaction_rules (is_active);

-- Partial unique index: prevents duplicate global rules and duplicate per-company rules
CREATE UNIQUE INDEX IF NOT EXISTS idx_rules_global_unique
  ON transaction_rules (pattern, direction) WHERE company_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_rules_company_unique
  ON transaction_rules (company_id, pattern, direction) WHERE company_id IS NOT NULL;

ALTER TABLE public.transaction_rules DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.transaction_rules TO anon;
GRANT ALL ON public.transaction_rules TO authenticated;

-- ── Seed global system rules ─────────────────────────────────────────────────
INSERT INTO transaction_rules (company_id, pattern, match_type, direction, nominal_code, nominal_name, confidence, source) VALUES
-- Wages / Payroll
(NULL, 'wages',            'contains',   'out',  '6000', 'Payroll & PAYE',          'high',   'system'),
(NULL, 'salary',           'contains',   'out',  '6000', 'Payroll & PAYE',          'high',   'system'),
(NULL, 'payroll',          'contains',   'out',  '6000', 'Payroll & PAYE',          'high',   'system'),
(NULL, 'bwages',           'contains',   'both', '6000', 'Payroll & PAYE',          'high',   'system'),
(NULL, 'lwages',           'contains',   'both', '6000', 'Payroll & PAYE',          'high',   'system'),
(NULL, 'swages',           'contains',   'both', '6000', 'Payroll & PAYE',          'high',   'system'),
(NULL, 'wwages',           'contains',   'both', '6000', 'Payroll & PAYE',          'high',   'system'),
(NULL, 'inet.*wag',        'regex',      'both', '6000', 'Payroll & PAYE',          'high',   'system'),
-- Revenue & Tax
(NULL, 'revenue commis',   'contains',   'out',  '2100', 'VAT Control',             'high',   'system'),
(NULL, 'collector general','contains',   'out',  '2100', 'VAT Control',             'high',   'system'),
(NULL, 'd/d revenue',      'contains',   'out',  '2100', 'VAT Control',             'high',   'system'),
(NULL, 'stamp duty',       'contains',   'out',  '2100', 'VAT Control',             'high',   'system'),
-- Bank Charges
(NULL, 'fee-qtr',          'startswith', 'out',  '6500', 'Bank Charges',            'high',   'system'),
(NULL, 'bank charge',      'contains',   'out',  '6500', 'Bank Charges',            'high',   'system'),
(NULL, 'bank fee',         'contains',   'out',  '6500', 'Bank Charges',            'high',   'system'),
(NULL, 'monthly fee',      'contains',   'out',  '6500', 'Bank Charges',            'high',   'system'),
(NULL, 'cgs fee',          'contains',   'out',  '6500', 'Bank Charges',            'high',   'system'),
(NULL, 'pymt fee',         'contains',   'out',  '6500', 'Bank Charges',            'high',   'system'),
(NULL, 'quarterly fee',    'contains',   'out',  '6500', 'Bank Charges',            'high',   'system'),
-- Loans
(NULL, 'close brothers',   'contains',   'out',  '2500', 'Bank Loan',               'high',   'system'),
(NULL, 'naps loan',        'contains',   'out',  '2500', 'Bank Loan',               'high',   'system'),
(NULL, 'inet.*loan',       'regex',      'out',  '2500', 'Bank Loan',               'high',   'system'),
-- Rent
(NULL, 'inet.*rent',       'regex',      'out',  '6100', 'Rent & Rates',            'high',   'system'),
(NULL, 'herorent',         'contains',   'out',  '6100', 'Rent & Rates',            'high',   'system'),
-- Telecoms & IT — outgoing
(NULL, 'eir',              'exact',      'out',  '6300', 'Telecoms & IT',           'high',   'system'),
(NULL, 'vodafone',         'contains',   'out',  '6300', 'Telecoms & IT',           'high',   'system'),
(NULL, 'three mobile',     'contains',   'out',  '6300', 'Telecoms & IT',           'high',   'system'),
(NULL, 'google',           'contains',   'out',  '6300', 'Telecoms & IT',           'high',   'system'),
(NULL, 'gsuite',           'contains',   'out',  '6300', 'Telecoms & IT',           'high',   'system'),
(NULL, 'microsoft',        'contains',   'out',  '6300', 'Telecoms & IT',           'high',   'system'),
(NULL, 'adobe',            'contains',   'out',  '6300', 'Telecoms & IT',           'high',   'system'),
(NULL, 'zoom',             'contains',   'out',  '6300', 'Telecoms & IT',           'high',   'system'),
(NULL, 'slack',            'contains',   'out',  '6300', 'Telecoms & IT',           'high',   'system'),
(NULL, 'wix',              'contains',   'out',  '6300', 'Telecoms & IT',           'high',   'system'),
(NULL, 'spotify',          'contains',   'out',  '6300', 'Telecoms & IT',           'high',   'system'),
(NULL, 'hubfit',           'contains',   'out',  '6300', 'Telecoms & IT',           'high',   'system'),
(NULL, 'glofox',           'contains',   'out',  '6300', 'Telecoms & IT',           'high',   'system'),
-- Income — inbound payment processors
(NULL, 'glofox',           'contains',   'in',   '4000', 'Sales Revenue',           'high',   'system'),
(NULL, 'stripe',           'contains',   'in',   '4000', 'Sales Revenue',           'high',   'system'),
(NULL, 'paypal',           'contains',   'in',   '4000', 'Sales Revenue',           'high',   'system'),
-- Insurance
(NULL, 'insurance',        'contains',   'both', '6800', 'Insurance',               'high',   'system'),
(NULL, 'allianz',          'contains',   'out',  '6800', 'Insurance',               'high',   'system'),
(NULL, 'axa',              'contains',   'out',  '6800', 'Insurance',               'high',   'system'),
(NULL, 'aviva',            'contains',   'out',  '6800', 'Insurance',               'high',   'system'),
(NULL, 'fbd',              'contains',   'out',  '6800', 'Insurance',               'high',   'system'),
(NULL, 'zurich',           'contains',   'out',  '6800', 'Insurance',               'high',   'system'),
-- Motor & Travel
(NULL, 'circle k',         'contains',   'out',  '6200', 'Motor & Travel',          'high',   'system'),
(NULL, 'applegreen',       'contains',   'out',  '6200', 'Motor & Travel',          'high',   'system'),
(NULL, 'maxol',            'contains',   'out',  '6200', 'Motor & Travel',          'high',   'system'),
(NULL, 'texaco',           'contains',   'out',  '6200', 'Motor & Travel',          'high',   'system'),
(NULL, 'apcoa',            'contains',   'out',  '6200', 'Motor & Travel',          'high',   'system'),
(NULL, 'parking',          'contains',   'out',  '6200', 'Motor & Travel',          'high',   'system'),
(NULL, 'ryanair',          'contains',   'out',  '6200', 'Motor & Travel',          'high',   'system'),
(NULL, 'uber',             'contains',   'out',  '6200', 'Motor & Travel',          'high',   'system'),
(NULL, 'taxi',             'contains',   'out',  '6200', 'Motor & Travel',          'high',   'system'),
-- Professional Fees
(NULL, 'imro',             'contains',   'out',  '6400', 'Professional Fees',       'high',   'system'),
(NULL, 'solicitor',        'contains',   'out',  '6400', 'Professional Fees',       'high',   'system'),
(NULL, 'legal fee',        'contains',   'out',  '6400', 'Professional Fees',       'high',   'system'),
(NULL, 'accountant fee',   'contains',   'out',  '6400', 'Professional Fees',       'high',   'system'),
-- Marketing & Advertising
(NULL, 'google ads',       'contains',   'out',  '6700', 'Marketing & Advertising', 'high',   'system'),
(NULL, 'facebook ads',     'contains',   'out',  '6700', 'Marketing & Advertising', 'high',   'system'),
(NULL, 'linkedin',         'contains',   'out',  '6700', 'Marketing & Advertising', 'high',   'system'),
(NULL, 'wix.com',          'contains',   'out',  '6700', 'Marketing & Advertising', 'high',   'system'),
-- Utilities
(NULL, 'electric ireland', 'contains',   'out',  '6900', 'Repairs & Maintenance',   'high',   'system'),
(NULL, 'bord gais',        'contains',   'out',  '6900', 'Repairs & Maintenance',   'high',   'system'),
(NULL, 'sse airtricity',   'contains',   'out',  '6900', 'Repairs & Maintenance',   'high',   'system'),
(NULL, 'irish water',      'contains',   'out',  '6900', 'Repairs & Maintenance',   'high',   'system'),
-- Equipment & Materials
(NULL, 'equipment',        'contains',   'out',  '5100', 'Materials & Supplies',    'high',   'system'),
(NULL, 'fitness equip',    'contains',   'out',  '5100', 'Materials & Supplies',    'high',   'system')
ON CONFLICT DO NOTHING;
