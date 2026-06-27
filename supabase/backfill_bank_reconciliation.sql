-- Backfill bank_reconciliation: link existing bank_transactions to their journals
-- Run AFTER add_bank_reconciliation.sql has been applied.
-- Safe to re-run: the WHERE clause skips already-matched transactions.

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1: New-style imports (import_batch_id present on both sides)
--         Link where exactly one journal exists per bank_transaction.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO bank_matches (
  company_id, bank_transaction_id, matched_type, matched_id,
  confidence, status, matched_by, confirmed_at
)
SELECT
  bt.company_id,
  bt.id,
  'journal',
  j.id,
  100,
  'confirmed',
  'auto',
  COALESCE(bt.created_at, now())
FROM bank_transactions bt
JOIN journals j
  ON  j.company_id      = bt.company_id
  AND j.reference       = bt.revolut_id
  AND j.import_batch_id = bt.import_batch_id
WHERE bt.import_batch_id IS NOT NULL
  AND bt.id NOT IN (SELECT bank_transaction_id FROM bank_matches)
  -- Only unambiguous: exactly one journal candidate for this bank_transaction
  AND 1 = (
    SELECT COUNT(*) FROM journals j2
    WHERE j2.company_id      = bt.company_id
      AND j2.reference       = bt.revolut_id
      AND j2.import_batch_id = bt.import_batch_id
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2: Legacy imports (import_batch_id NULL on both sides)
--         Match by revolut_id == journal.reference, both sides have no batch id.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO bank_matches (
  company_id, bank_transaction_id, matched_type, matched_id,
  confidence, status, matched_by, confirmed_at
)
SELECT
  bt.company_id,
  bt.id,
  'journal',
  j.id,
  100,
  'confirmed',
  'auto',
  COALESCE(bt.created_at, now())
FROM bank_transactions bt
JOIN journals j
  ON  j.company_id      = bt.company_id
  AND j.reference       = bt.revolut_id
  AND j.import_batch_id IS NULL
WHERE bt.import_batch_id IS NULL
  AND bt.revolut_id IS NOT NULL
  AND bt.id NOT IN (SELECT bank_transaction_id FROM bank_matches)
  AND 1 = (
    SELECT COUNT(*) FROM journals j2
    WHERE j2.company_id      = bt.company_id
      AND j2.reference       = bt.revolut_id
      AND j2.import_batch_id IS NULL
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3: Mark those bank_transactions as reconciled
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE bank_transactions
SET
  reconciled    = true,
  reconciled_at = COALESCE(created_at, now())
WHERE id IN (
  SELECT bank_transaction_id FROM bank_matches WHERE status = 'confirmed'
)
  AND (reconciled IS NULL OR reconciled = false);

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4: Report — ambiguous cases (multiple journal candidates per bt)
--         Review these rows manually; nothing is inserted for them above.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  bt.id               AS bank_transaction_id,
  bt.revolut_id,
  bt.date,
  bt.amount,
  bt.description,
  bt.import_batch_id,
  COUNT(j.id)         AS journal_candidates,
  STRING_AGG(j.id::text || ' (' || j.description || ')', ' | ' ORDER BY j.date) AS candidate_detail
FROM bank_transactions bt
JOIN journals j
  ON  j.company_id = bt.company_id
  AND j.reference  = bt.revolut_id
  AND (
    (bt.import_batch_id IS NOT NULL AND j.import_batch_id = bt.import_batch_id)
    OR
    (bt.import_batch_id IS NULL     AND j.import_batch_id IS NULL)
  )
WHERE bt.id NOT IN (SELECT bank_transaction_id FROM bank_matches)
GROUP BY bt.id, bt.revolut_id, bt.date, bt.amount, bt.description, bt.import_batch_id
HAVING COUNT(j.id) > 1
ORDER BY bt.date;
