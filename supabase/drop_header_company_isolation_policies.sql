-- CRITICAL FIX (2026-10-05): drop four legacy RLS policies that trusted a client-supplied header.
--
-- Each policy let ANY caller, including anon (no login, using the public anon key shipped in the
-- app bundle), read, insert, update and delete a company's rows by sending the HTTP header
-- `x-company-id: <company uuid>`: PostgREST exposes request headers to SQL as request.headers, and
-- requesting_company_id() returned that header verbatim. Policies are OR-ed, so these granted
-- access on top of the member-based policies. Verified before the fix: anon + header saw Heros
-- Gym's 19 invoices and 1,042 journals; a live anon API call with the header returned Fitzsimons
-- Test's invoices. The app never sends this header (0 references in src/ and api/), so nothing
-- depends on these policies; access continues through the member-based policies
-- (company_id IN user_company_ids(), plus the accountant checks where they exist).
--
-- Exact definitions as they stood before this migration (from pg_policies):
--
--   CREATE POLICY "Company isolation invoices" ON public.invoices
--     AS PERMISSIVE FOR ALL TO public
--     USING (company_id = requesting_company_id());
--
--   CREATE POLICY "Company isolation journals" ON public.journals
--     AS PERMISSIVE FOR ALL TO public
--     USING (company_id = requesting_company_id());
--
--   CREATE POLICY "Company isolation bank_transactions" ON public.bank_transactions
--     AS PERMISSIVE FOR ALL TO public
--     USING (company_id = requesting_company_id());
--
--   CREATE POLICY "Company isolation checklists" ON public.checklists
--     AS PERMISSIVE FOR ALL TO public
--     USING (company_id = requesting_company_id());
--
--   (No WITH CHECK clause, so for INSERT/UPDATE the USING expression doubled as the check:
--   writes with a forged header were allowed too.)
--
--   requesting_company_id() itself:
--     CREATE OR REPLACE FUNCTION public.requesting_company_id() RETURNS uuid LANGUAGE sql STABLE AS
--     $$ select (current_setting('request.headers', true)::json->>'x-company-id')::uuid; $$;
--   It is left in place by this migration; drop it once nothing references it.

drop policy if exists "Company isolation invoices"          on public.invoices;
drop policy if exists "Company isolation journals"          on public.journals;
drop policy if exists "Company isolation bank_transactions" on public.bank_transactions;
drop policy if exists "Company isolation checklists"        on public.checklists;
