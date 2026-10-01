-- Expense VAT code — carried onto the expense's journal when it's approved, so T2 counts the
-- expense's input VAT (expense journals had no VAT code at all, so it never reached T2).
alter table public.expenses
  add column if not exists vat_code text
  check (vat_code is null or vat_code in ('STD23', 'RED13', 'RED9', 'ZERO', 'EXEMPT', 'NONE'));

-- Accountant-only once created, exactly like journals: reuse the journals' trigger function
-- (it keeps OLD.vat_code whenever a non-accountant changes it) rather than a parallel one.
drop trigger if exists expenses_vat_code_lock on public.expenses;
create trigger expenses_vat_code_lock
  before update on public.expenses
  for each row execute function public.enforce_journals_vat_code_lock();
