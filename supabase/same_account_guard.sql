-- Same-account guard (Peter, 7 Oct 2026). See src/shared/transferHold.js.
--
-- bank_transactions.hold_reason  'transfer' = a bank line held unposted in Reconciliation because
--                                its category was a transfer or its own bank nominal; cleared
--                                when the accountant posts it against the other account.
-- journals_debit_ne_credit       no journal may debit and credit the same account. Added NOT VALID:
--                                it applies to every new or updated row now, while Moyvencap's nine
--                                existing same-account journals are left alone until they are
--                                corrected; then run
--                                  alter table public.journals validate constraint journals_debit_ne_credit;
alter table public.bank_transactions add column if not exists hold_reason text;
alter table public.bank_transactions drop constraint if exists bank_transactions_hold_reason_check;
alter table public.bank_transactions add constraint bank_transactions_hold_reason_check
  check (hold_reason is null or hold_reason in ('transfer'));
comment on column public.bank_transactions.hold_reason is
  'transfer = held unposted in Reconciliation: choose the other account (src/shared/transferHold.js)';

alter table public.journals drop constraint if exists journals_debit_ne_credit;
alter table public.journals add constraint journals_debit_ne_credit
  check (debit_account <> credit_account) not valid;
