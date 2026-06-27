-- Default VAT codes for standard Irish chart of accounts.
-- REVIEW CAREFULLY before running — VAT treatment is a judgment call.
-- These are reasonable defaults for a typical Irish SME but may not suit every business.
-- Run AFTER add_vat_fields.sql. Run backfill_vat_codes.sql afterwards to backfill journals.

-- ─── INCOME NOMINALS ──────────────────────────────────────────────────────────

-- 4000 Sales Revenue: standard 23% — adjust to RED13/RED9 if you sell reduced-rate goods
UPDATE chart_of_accounts SET default_vat_code = 'STD23' WHERE code = '4000';

-- 4100 Service Income: standard 23% for most services; change to EXEMPT for financial,
--      insurance, or medical services
UPDATE chart_of_accounts SET default_vat_code = 'STD23' WHERE code = '4100';

-- 4200 Other Income: default STD23 — review if this captures non-trading income
UPDATE chart_of_accounts SET default_vat_code = 'STD23' WHERE code = '4200';

-- 4300 Interest Received: EXEMPT — bank interest is a financial service, always VAT-exempt
UPDATE chart_of_accounts SET default_vat_code = 'EXEMPT' WHERE code = '4300';

-- ─── COST OF SALES ────────────────────────────────────────────────────────────

-- 5000–5200: purchases of goods/materials/subcontractors at standard 23%
--   Note: subcontractor costs (5200) — change to RC if supplier is an EU business
--   billing without Irish VAT (reverse charge applies)
UPDATE chart_of_accounts SET default_vat_code = 'STD23' WHERE code IN ('5000','5100','5200');

-- 5300 Direct Labour: NONE — wages paid to employees are not a VAT supply
UPDATE chart_of_accounts SET default_vat_code = 'NONE' WHERE code = '5300';

-- ─── OVERHEAD NOMINALS ────────────────────────────────────────────────────────

-- 6000 Payroll & PAYE: NONE — wage cost is not a VAT transaction
UPDATE chart_of_accounts SET default_vat_code = 'NONE' WHERE code = '6000';

-- 6100 Rent & Rates: EXEMPT — commercial leases in Ireland are generally VAT-exempt
--   unless the landlord has exercised the option to tax (in which case change to STD23)
UPDATE chart_of_accounts SET default_vat_code = 'EXEMPT' WHERE code = '6100';

-- 6200 Motor & Travel: STD23 — fuel, parking, and most travel costs carry 23% VAT
--   Note: VAT on passenger cars is 100% blocked; only claim input VAT on commercial vehicles
UPDATE chart_of_accounts SET default_vat_code = 'STD23' WHERE code = '6200';

-- 6300 Telecoms & IT: STD23 — phones, broadband, software licences
UPDATE chart_of_accounts SET default_vat_code = 'STD23' WHERE code = '6300';

-- 6400 Professional Fees: STD23 — accountancy, legal, consulting fees in Ireland
--   Note: EU suppliers (law firms, consultants abroad) often bill RC — change those lines to RC
UPDATE chart_of_accounts SET default_vat_code = 'STD23' WHERE code = '6400';

-- 6500 Bank Charges & Interest: EXEMPT — financial services are VAT-exempt
UPDATE chart_of_accounts SET default_vat_code = 'EXEMPT' WHERE code = '6500';

-- 6600 Sundry Expenses: STD23 — catch-all; review individual transactions
UPDATE chart_of_accounts SET default_vat_code = 'STD23' WHERE code = '6600';

-- 6700 Marketing & Advertising: STD23
UPDATE chart_of_accounts SET default_vat_code = 'STD23' WHERE code = '6700';

-- 6800 Insurance: EXEMPT — insurance premiums are exempt from VAT in Ireland
UPDATE chart_of_accounts SET default_vat_code = 'EXEMPT' WHERE code = '6800';

-- 6900 Repairs & Maintenance: STD23
--   Note: certain building/construction services carry 13.5% (RED13) — change if applicable
UPDATE chart_of_accounts SET default_vat_code = 'STD23' WHERE code = '6900';

-- 6950 Depreciation: NONE — a book entry, no VAT applies
UPDATE chart_of_accounts SET default_vat_code = 'NONE' WHERE code = '6950';

-- ─── BALANCE SHEET ACCOUNTS (no direct VAT) ──────────────────────────────────

-- Assets, liabilities, equity: NONE — these are control/balance accounts, not VAT supplies
UPDATE chart_of_accounts SET default_vat_code = 'NONE'
  WHERE code IN ('1000','1100','1200','1500','1600',
                 '2000','2100','2200','2300','2400','2500',
                 '3000','3100');
