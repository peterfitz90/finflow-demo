-- Add payroll control accounts (current liabilities) to existing companies.
-- New companies receive these via the COA_SEED upsert on first app load.
--
-- These are hold-then-pay control accounts for the BrightPay journal workflow:
--   2250  Net Wages Payable   DR gross wages (6000) → CR here → DR here when bank pays staff
--   2260  Pension Payable     DR gross wages (6000) → CR here → DR here when pension remitted
--   2200  PAYE & PRSI Payable already exists — no change needed
--
-- Codes slot into the existing 2xxx current-liabilities range (2000–2499).

INSERT INTO chart_of_accounts
  (company_id, code, name, account_type, category, is_system, is_active)
SELECT
  c.id,
  vals.code,
  vals.name,
  'liability',
  'Current Liabilities',
  true,
  true
FROM companies c
CROSS JOIN (VALUES
  ('2250', 'Net Wages Payable'),
  ('2260', 'Pension Payable')
) AS vals(code, name)
WHERE EXISTS (
  SELECT 1 FROM chart_of_accounts x WHERE x.company_id = c.id
)
ON CONFLICT (company_id, code) DO NOTHING;
