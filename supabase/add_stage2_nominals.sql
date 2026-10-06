-- STA-01 Stage 2: five new nominals for every limited company's chart (the limited-company seed in
-- src/shared/chartOfAccounts.js has them too, so new companies get them on first use).
--   2210 Corporation Tax Payable            liability  Current Liabilities   Sch 3B E (C when in debit)
--   3400 Dividends Paid                     equity     Equity                deducted in the P&L reserve
--   4250 Profit on Disposal of Fixed Assets income     Income                P&L 2 Other income
--   6550 Interest Payable                   expense    Overheads             P&L 6 Other expenses
--   8000 Corporation Tax                    expense    Taxation              P&L 7 Tax
-- Checked before adding: none of these codes exists in either seed chart, any company's chart,
-- any journal, or the app's code. Sole traders are excluded (their seed has no company nominals).
-- Idempotent: rows are only added; an existing (company_id, code) row is left untouched.
-- No grant or policy change: chart_of_accounts access rules are unchanged.

insert into public.chart_of_accounts (company_id, code, name, account_type, category, is_system)
select c.id, v.code, v.name, v.account_type, v.category, v.is_system
from public.companies c
cross join (values
  ('2210', 'Corporation Tax Payable', 'liability', 'Current Liabilities', true),
  ('3400', 'Dividends Paid', 'equity', 'Equity', true),
  ('4250', 'Profit on Disposal of Fixed Assets', 'income', 'Income', true),
  ('6550', 'Interest Payable', 'expense', 'Overheads', true),
  ('8000', 'Corporation Tax', 'expense', 'Taxation', true)
) as v(code, name, account_type, category, is_system)
where c.company_type = 'Limited Company'
on conflict (company_id, code) do nothing;
