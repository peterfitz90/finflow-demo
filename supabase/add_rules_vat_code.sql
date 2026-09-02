-- Add vat_code to transaction_rules so a saved rule can carry a VAT-code correction
-- alongside the nominal, not just the nominal. NULL means "no VAT override — use the
-- matched nominal's default_vat_code from chart_of_accounts", preserving existing behaviour
-- for every rule that predates this column.
ALTER TABLE transaction_rules ADD COLUMN IF NOT EXISTS vat_code TEXT;
