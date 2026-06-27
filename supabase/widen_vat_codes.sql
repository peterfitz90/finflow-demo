-- Widen VAT code CHECK constraints to include RCT and RC_EU.
-- 'RC' is kept in the constraint so existing journal data remains valid.
-- Run AFTER add_vat_fields.sql and add_recurring_checklist.sql.

ALTER TABLE journals
  DROP CONSTRAINT IF EXISTS journals_vat_code_check;
ALTER TABLE journals
  ADD CONSTRAINT journals_vat_code_check
    CHECK (vat_code IN ('STD23','RED13','RED9','ZERO','EXEMPT','RC','RCT','RC_EU','NONE'));

ALTER TABLE chart_of_accounts
  DROP CONSTRAINT IF EXISTS chart_of_accounts_default_vat_code_check;
ALTER TABLE chart_of_accounts
  ADD CONSTRAINT chart_of_accounts_default_vat_code_check
    CHECK (default_vat_code IN ('STD23','RED13','RED9','ZERO','EXEMPT','RC','RCT','RC_EU','NONE'));

ALTER TABLE recurring_journals
  DROP CONSTRAINT IF EXISTS recurring_journals_vat_code_check;
ALTER TABLE recurring_journals
  ADD CONSTRAINT recurring_journals_vat_code_check
    CHECK (vat_code IN ('STD23','RED13','RED9','ZERO','EXEMPT','RC','RCT','RC_EU','NONE'));
