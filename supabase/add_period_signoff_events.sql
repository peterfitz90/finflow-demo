-- BNK-01 — accountant period sign-off: an append-only, auditable record that an accountant has
-- signed off a period (any date range; the app defaults to a calendar month). A RECORD, not a
-- lock: it doesn't block later writes (enforce_period_lock is unchanged). Instead every write
-- dated inside a signed-off period is logged as write_after_signoff, by an AFTER trigger on the
-- same five tables log_write_during_reopen covers — so "changed since sign-off" is auditable.
-- Shaped like period_lock_events, keyed by dates rather than a VAT return.

create table if not exists public.period_signoff_events (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  period_start    date not null,
  period_end      date not null,
  action          text not null check (action in ('signed_off', 'withdrawn', 'write_after_signoff')),
  actor           text,            -- Clerk user id (auth.jwt() sub); null for server-side writes
  actor_name      text,
  reason          text,            -- sign-off note / withdrawal reason
  affected_table  text,            -- write_after_signoff only
  affected_row_id uuid,            -- write_after_signoff only
  snapshot        jsonb,           -- signed_off only: P&L / balance sheet / bank / journal count
  occurred_at     timestamptz not null default clock_timestamp(),  -- clock_timestamp: ordered within a transaction
  check (period_end >= period_start)
);
create index if not exists period_signoff_events_company_period
  on public.period_signoff_events (company_id, period_start, period_end, occurred_at);

-- Readable by every member of the company (accountant and business_owner). No write policies and
-- no write grants: rows are only ever added by the SECURITY DEFINER functions/trigger below.
alter table public.period_signoff_events enable row level security;
drop policy if exists period_signoff_events_select on public.period_signoff_events;
create policy period_signoff_events_select on public.period_signoff_events
  for select using (company_id in (select public.user_company_ids()));
revoke all on public.period_signoff_events from anon, authenticated;
grant select on public.period_signoff_events to authenticated;

-- Current status of an exact range: its latest signed_off / withdrawn event (null = never).
create or replace function public.period_signoff_status(p_company_id uuid, p_start date, p_end date)
returns text language sql stable security definer set search_path to 'public' as $$
  select action from public.period_signoff_events
  where company_id = p_company_id and period_start = p_start and period_end = p_end
    and action in ('signed_off', 'withdrawn')
  order by occurred_at desc, id desc limit 1;
$$;

create or replace function public.sign_off_period(p_company_id uuid, p_period_start date, p_period_end date,
                                                  p_note text default null, p_actor_name text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_snapshot jsonb;
  v_codes    text[];
  v_bank     numeric;
  v_row      public.period_signoff_events;
begin
  if not public.user_is_accountant(p_company_id) then
    raise exception 'Forbidden — only the accountant can sign off a period';
  end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'Invalid period range';
  end if;
  if public.period_signoff_status(p_company_id, p_period_start, p_period_end) = 'signed_off' then
    raise exception 'This period is already signed off';
  end if;

  select coalesce(array_agg(nominal_code), array['1000']) into v_codes
  from public.bank_accounts where company_id = p_company_id and is_active and nominal_code is not null;
  v_bank := public.nominal_balance_as_of(p_company_id, v_codes, p_period_end);

  -- Figures as they stood at sign-off. P&L for the period; balance sheet inception-to-date at its
  -- end (assets debit-normal, liabilities/equity credit-normal).
  select jsonb_build_object(
    'income',        round(coalesce(sum(case when credit_account between '4000' and '4999' and date >= p_period_start then amount else 0 end), 0)
                         - coalesce(sum(case when debit_account  between '4000' and '4999' and date >= p_period_start then amount else 0 end), 0), 2),
    'expenses',      round(coalesce(sum(case when debit_account  between '5000' and '6999' and date >= p_period_start then amount else 0 end), 0)
                         - coalesce(sum(case when credit_account between '5000' and '6999' and date >= p_period_start then amount else 0 end), 0), 2),
    'assets',        round(coalesce(sum(case when debit_account  between '1000' and '1999' then amount else 0 end), 0)
                         - coalesce(sum(case when credit_account between '1000' and '1999' then amount else 0 end), 0), 2),
    'liabilities',   round(coalesce(sum(case when credit_account between '2000' and '2999' then amount else 0 end), 0)
                         - coalesce(sum(case when debit_account  between '2000' and '2999' then amount else 0 end), 0), 2),
    'equity',        round(coalesce(sum(case when credit_account between '3000' and '3999' then amount else 0 end), 0)
                         - coalesce(sum(case when debit_account  between '3000' and '3999' then amount else 0 end), 0), 2),
    'journal_count', count(*) filter (where date >= p_period_start),
    'bank_balance',  round(v_bank, 2),
    'bank_nominals', to_jsonb(v_codes)
  ) into v_snapshot
  from public.journals where company_id = p_company_id and date <= p_period_end;
  v_snapshot := v_snapshot || jsonb_build_object('net_profit', round((v_snapshot->>'income')::numeric - (v_snapshot->>'expenses')::numeric, 2));

  insert into public.period_signoff_events (company_id, period_start, period_end, action, actor, actor_name, reason, snapshot)
  values (p_company_id, p_period_start, p_period_end, 'signed_off', (auth.jwt() ->> 'sub'), left(p_actor_name, 120), nullif(trim(p_note), ''), v_snapshot)
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.withdraw_signoff(p_company_id uuid, p_period_start date, p_period_end date,
                                                   p_reason text, p_actor_name text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_row public.period_signoff_events;
begin
  if not public.user_is_accountant(p_company_id) then
    raise exception 'Forbidden — only the accountant can withdraw a sign-off';
  end if;
  if coalesce(public.period_signoff_status(p_company_id, p_period_start, p_period_end), '') <> 'signed_off' then
    raise exception 'This period is not signed off';
  end if;
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'A reason is required to withdraw a sign-off';
  end if;
  insert into public.period_signoff_events (company_id, period_start, period_end, action, actor, actor_name, reason)
  values (p_company_id, p_period_start, p_period_end, 'withdrawn', (auth.jwt() ->> 'sub'), left(p_actor_name, 120), trim(p_reason))
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

-- Change log: any insert/update dated inside a currently signed-off period (new date, or the old
-- date when a row is moved out of one) adds a write_after_signoff row per covering sign-off.
create or replace function public.log_write_after_signoff()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_col text := TG_ARGV[0];
  v_new date := (to_jsonb(NEW) ->> v_col)::date;
  v_old date := case when TG_OP = 'UPDATE' then (to_jsonb(OLD) ->> v_col)::date end;
begin
  insert into public.period_signoff_events (company_id, period_start, period_end, action, actor, affected_table, affected_row_id)
  select NEW.company_id, s.period_start, s.period_end, 'write_after_signoff', (auth.jwt() ->> 'sub'), TG_TABLE_NAME, NEW.id
  from (
    select distinct on (period_start, period_end) period_start, period_end, action
    from public.period_signoff_events
    where company_id = NEW.company_id and action in ('signed_off', 'withdrawn')
    order by period_start, period_end, occurred_at desc, id desc
  ) s
  where s.action = 'signed_off'
    and ((v_new is not null and v_new between s.period_start and s.period_end)
      or (v_old is not null and v_old between s.period_start and s.period_end));
  return NEW;
end;
$$;

drop trigger if exists journals_log_write_after_signoff on public.journals;
create trigger journals_log_write_after_signoff after insert or update on public.journals
  for each row execute function public.log_write_after_signoff('date');
drop trigger if exists bank_transactions_log_write_after_signoff on public.bank_transactions;
create trigger bank_transactions_log_write_after_signoff after insert or update on public.bank_transactions
  for each row execute function public.log_write_after_signoff('date');
drop trigger if exists ap_invoices_log_write_after_signoff on public.ap_invoices;
create trigger ap_invoices_log_write_after_signoff after insert or update on public.ap_invoices
  for each row execute function public.log_write_after_signoff('invoice_date');
drop trigger if exists invoices_log_write_after_signoff on public.invoices;
create trigger invoices_log_write_after_signoff after insert or update on public.invoices
  for each row execute function public.log_write_after_signoff('issue_date');
drop trigger if exists expenses_log_write_after_signoff on public.expenses;
create trigger expenses_log_write_after_signoff after insert or update on public.expenses
  for each row execute function public.log_write_after_signoff('receipt_date');

-- Callable by signed-in users (each function checks the caller itself); the trigger function and
-- the status helper aren't meant to be called directly.
revoke execute on function public.sign_off_period(uuid, date, date, text, text) from public, anon;
revoke execute on function public.withdraw_signoff(uuid, date, date, text, text) from public, anon;
grant execute on function public.sign_off_period(uuid, date, date, text, text) to authenticated;
grant execute on function public.withdraw_signoff(uuid, date, date, text, text) to authenticated;
revoke execute on function public.log_write_after_signoff() from public, anon, authenticated;
