-- STA-01 Stage 4a follow-up (Peter, 7 Oct 2026): financial_periods is readable by any member of
-- the company (Overview, Cash Flow, GL Report and deadlines honour recorded periods for every
-- user, business owners included), and still writable only by the company's accountant. The
-- insert, update and delete policies from add_financial_periods.sql are unchanged.
drop policy if exists financial_periods_select on public.financial_periods;
create policy financial_periods_select on public.financial_periods for select to authenticated
  using (company_id in (select public.user_company_ids()));
