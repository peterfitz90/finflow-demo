-- STA-01 Stage 2a: two nullable company dates, edited by the accountant in Settings.
--   incorporation_date    the company's date of incorporation (CRO).
--   ledger_complete_from  the date from which the ledger holds every transaction: the OPENING
--                         journal date for a migrated company, or the incorporation date for one
--                         that started on Ledgrly. The FRS 105 guard's "no opening balances"
--                         condition is satisfied for any period starting on or after it.
--
-- Access: no new policy or grant is needed. companies_update already allows only the company's
-- accountant (company_id in user_company_ids() and user_is_accountant(id)); companies_select lets
-- members read; anon has no policy. Columns added to an existing table inherit the table grants.
-- Deploy order: apply this before the app version whose Settings form saves these columns.

alter table public.companies
  add column if not exists incorporation_date date,
  add column if not exists ledger_complete_from date;

comment on column public.companies.incorporation_date is 'Date of incorporation (CRO). Set by the accountant.';
comment on column public.companies.ledger_complete_from is 'Date from which the ledger holds every transaction (OPENING journal date or incorporation date). Satisfies the FRS 105 no-opening-balances check for periods starting on or after it.';
