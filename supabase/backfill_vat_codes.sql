-- Backfill journals.vat_code from the nominal account's default_vat_code.
-- Run AFTER add_vat_fields.sql AND set_vat_defaults.sql.
-- Safe to re-run: only touches journals where vat_code IS NULL.
-- Picks the income/expense account (4xxx–6xxx) from each journal to determine the code.

WITH vat_lookup AS (
  SELECT
    j.id,
    COALESCE(
      -- Priority 1: debit account in income/expense range
      CASE WHEN j.debit_account >= '4000' AND j.debit_account < '7000'
           THEN d.default_vat_code END,
      -- Priority 2: credit account in income/expense range
      CASE WHEN j.credit_account >= '4000' AND j.credit_account < '7000'
           THEN c.default_vat_code END
    ) AS resolved_vat_code
  FROM journals j
  LEFT JOIN chart_of_accounts d
    ON  d.company_id = j.company_id
    AND d.code       = j.debit_account
  LEFT JOIN chart_of_accounts c
    ON  c.company_id = j.company_id
    AND c.code       = j.credit_account
  WHERE j.vat_code IS NULL
)
UPDATE journals j
SET    vat_code = vl.resolved_vat_code
FROM   vat_lookup vl
WHERE  vl.id                 = j.id
AND    vl.resolved_vat_code IS NOT NULL;
