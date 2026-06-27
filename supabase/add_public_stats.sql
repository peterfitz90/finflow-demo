-- public_stats: single-row cache of the cross-company automation rollup.
-- Written by the /api/refresh-stats cron (service role).
-- Read by /api/public-stats (service role, server-side only).
-- Counts NEVER reach the client — only the gated pctAutomated value does.

CREATE TABLE IF NOT EXISTS public_stats (
  id              TEXT        PRIMARY KEY DEFAULT 'singleton',
  total_processed BIGINT      NOT NULL DEFAULT 0,
  auto_handled    BIGINT      NOT NULL DEFAULT 0,
  pct_automated   NUMERIC(5,2),           -- null until first cron run
  company_count   INT         NOT NULL DEFAULT 0,
  window_days     INT         NOT NULL DEFAULT 30,
  refreshed_at    TIMESTAMPTZ
);

-- Seed the singleton row so the endpoint always gets one row (not null).
INSERT INTO public_stats (id) VALUES ('singleton') ON CONFLICT (id) DO NOTHING;

-- Rollup function: mirrors useApprovalStats exactly.
--   autoHandled    = bank_matches WHERE status='confirmed' AND suggestion_kept=true
--   totalProcessed = bank_transactions WHERE reconciled=true
--   companyCount   = COUNT DISTINCT company_id from totalProcessed set
-- SECURITY DEFINER so it runs as owner (bypasses RLS on bank_matches which has RLS enabled).
-- Called by the cron via supabase.rpc(). anon cannot call this — only service_role.
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
      WHERE reconciled = true AND reconciled_at >= since),
    (SELECT COUNT(*)::BIGINT
       FROM bank_matches
      WHERE status = 'confirmed'
        AND suggestion_kept = true
        AND confirmed_at >= since),
    (SELECT COUNT(DISTINCT company_id)::INT
       FROM bank_transactions
      WHERE reconciled = true AND reconciled_at >= since);
END;
$$;

REVOKE EXECUTE ON FUNCTION compute_automation_rollup(INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION compute_automation_rollup(INT) TO service_role;

-- Match peer table security pattern: RLS disabled, anon has full table access.
-- public_stats holds only aggregate counts (no per-company data) but the endpoint
-- still gates what it returns — the table itself never reaches the browser.
ALTER TABLE public_stats DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public_stats TO anon;
