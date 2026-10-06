-- 2026-10-06: the shared system categorisation rules (transaction_rules rows with company_id NULL,
-- 89 supplier-pattern -> nominal mappings) were readable by anon, because the select policy was
-- TO public and its "company_id IS NULL" branch needs no login. Found by scripts/anon-check.mjs.
-- No company data was exposed (company rules need membership), but the rule set is Ledgrly's own
-- and only signed-in users need it. Restrict the policy to authenticated; the condition is
-- unchanged, so signed-in users see exactly what they saw before (shared rows + their companies'
-- rules). Every app read is as a signed-in user (useTransactionRules: bank import, needs review,
-- reconciliation, rules settings, expense suggestion, mobile) or service_role (api/yapily/ingest,
-- which bypasses RLS).
--
-- Definition as it stood:
--   CREATE POLICY transaction_rules_select ON public.transaction_rules AS PERMISSIVE FOR SELECT TO public
--     USING ((company_id IS NULL) OR (company_id IN (SELECT user_company_ids())));

drop policy if exists transaction_rules_select on public.transaction_rules;
create policy transaction_rules_select on public.transaction_rules
  for select to authenticated
  using ((company_id is null) or (company_id in (select public.user_company_ids())));
