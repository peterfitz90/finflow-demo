-- Server-side nominal balance (replaces fetchNominalBalanceAsOf's client-side sum)
-- Applied 2026-09-28 as migration add_nominal_balance_as_of_rpc. Safe to re-run.
--
-- The PostgREST API silently caps every response at 1,000 rows (HTTP 206, no error), so
-- fetching raw journal rows and summing them in the browser truncates once a company's
-- matching journals pass 1,000. Summing here removes that ceiling entirely.
--
-- SECURITY INVOKER: journals' own RLS (company_id IN user_company_ids()) applies, so a caller
-- only ever sums rows they can already read. Debit-normal, inception-to-date, same semantics as
-- the JS reduce it replaces: +amount when the debit side is in p_codes, -amount when the credit
-- side is (a transfer between two summed codes nets to zero).

CREATE OR REPLACE FUNCTION public.nominal_balance_as_of(p_company_id uuid, p_codes text[], p_as_of date)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT coalesce(sum(
           (CASE WHEN debit_account  = ANY(p_codes) THEN amount ELSE 0 END)
         - (CASE WHEN credit_account = ANY(p_codes) THEN amount ELSE 0 END)), 0)
  FROM journals
  WHERE company_id = p_company_id
    AND date <= p_as_of
    AND (debit_account = ANY(p_codes) OR credit_account = ANY(p_codes));
$$;

REVOKE ALL ON FUNCTION public.nominal_balance_as_of(uuid, text[], date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nominal_balance_as_of(uuid, text[], date) TO authenticated;

-- journals had no company_id index at all (only pkey, reclass link, search trigram), so every
-- per-company query was a sequential scan.
CREATE INDEX IF NOT EXISTS idx_journals_company_date ON public.journals (company_id, date);
