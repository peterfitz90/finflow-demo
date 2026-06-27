-- Fix unique index on transaction_rules to allow multiple system rules (company_id IS NULL)
-- while still preventing duplicate user rules per company.
DROP INDEX IF EXISTS idx_rules_company_unique;
CREATE UNIQUE INDEX idx_rules_company_unique
  ON transaction_rules (company_id, pattern, direction)
  WHERE company_id IS NOT NULL;
