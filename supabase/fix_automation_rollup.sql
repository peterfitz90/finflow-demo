-- Fix compute_automation_rollup(): auto_handled was counting suggestion_kept = true only,
-- missing all engine-auto-confirmed rows (matched_by = 'auto', suggestion_kept = NULL).
--
-- The three cases:
--   matched_by = 'auto', suggestion_kept IS NULL  → engine reconciled, no human (1631 existing rows)
--   matched_by = 'auto', suggestion_kept = true   → AI suggested, human kept as-is
--   matched_by = 'auto', suggestion_kept = false  → AI suggested, human corrected → NOT automated
--   matched_by = 'user'                           → fully manual → NOT automated
--
-- Correct definition: automated = matched_by = 'auto' AND suggestion_kept IS NOT FALSE
--   IS NOT FALSE is TRUE for both NULL and TRUE, FALSE only for FALSE.
--   No backfill of existing rows needed — the query handles NULL correctly.
--
-- Run after add_public_stats.sql (replaces the function in-place via CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION compute_automation_rollup(window_days INT DEFAULT 30)
RETURNS TABLE(total_processed BIGINT, auto_handled BIGINT, company_count INT)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  since TIMESTAMPTZ := now() - (window_days * INTERVAL '1 day');
BEGIN
  RETURN QUERY SELECT
    (SELECT COUNT(*)::BIGINT
       FROM bank_transactions
      WHERE reconciled = true
        AND reconciled_at >= since),
    (SELECT COUNT(*)::BIGINT
       FROM bank_matches
      WHERE status    = 'confirmed'
        AND matched_by = 'auto'
        AND suggestion_kept IS NOT FALSE   -- NULL (auto-confirmed) + true (kept) both count; false (corrected) excluded
        AND confirmed_at >= since),
    (SELECT COUNT(DISTINCT company_id)::INT
       FROM bank_transactions
      WHERE reconciled = true
        AND reconciled_at >= since);
END;
$$;

-- Re-apply grants (CREATE OR REPLACE resets them).
REVOKE EXECUTE ON FUNCTION compute_automation_rollup(INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION compute_automation_rollup(INT) TO service_role;
