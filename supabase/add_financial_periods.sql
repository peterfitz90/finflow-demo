-- STA-01 Stage 4a: year ends on any day, and financial periods other than 12 months.
-- Design approved by Peter (6 Oct 2026).
--
-- companies.fy_end_day   day of year_end_month the financial year ends; null = the last day of
--                        that month (every existing company, so nothing changes until set).
--                        A day past the month's end (29 Feb in a non-leap year) is read as the
--                        month's last day by src/shared/statements/periods.js.
-- financial_periods      a period that is not the regular 12 months: a first period from
--                        incorporation, or a shortened or extended period after a change of
--                        year end. Accountant-only, read and write. Periods of one company may
--                        not overlap (checked by trigger: btree_gist is not installed).
--
-- Standing rules: RLS on; policies to authenticated only; explicit grants (nothing to public or
-- anon); fixed search_path and explicit grants on every function. Both trigger functions are
-- SECURITY INVOKER: the overlap check sees the company's periods through the caller's own RLS,
-- and only an accountant (who sees them all) can write.

alter table public.companies add column if not exists fy_end_day smallint;
alter table public.companies drop constraint if exists companies_fy_end_day_check;
alter table public.companies add constraint companies_fy_end_day_check check (
  fy_end_day is null or (fy_end_day between 1 and 31 and fy_end_day <= case
    when year_end_month = 2 then 29 when year_end_month in (4, 6, 9, 11) then 30 else 31 end));
comment on column public.companies.fy_end_day is
  'Day of year_end_month the financial year ends; null = last day of the month (STA-01 Stage 4a).';

create table if not exists public.financial_periods (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  period_start date not null,
  period_end   date not null,
  kind         text not null check (kind in ('first', 'normal', 'changed')),
  reason       text,
  updated_by   text,
  updated_at   timestamptz not null default now(),
  check (period_end > period_start),
  unique (company_id, period_end)
);
create index if not exists financial_periods_company_idx on public.financial_periods (company_id, period_start);

-- No two periods of one company overlap.
create or replace function public.financial_periods_no_overlap()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if exists (select 1 from public.financial_periods p
             where p.company_id = new.company_id and p.id <> new.id
               and p.period_start <= new.period_end and new.period_start <= p.period_end) then
    raise exception 'financial period % to % overlaps another period of this company', new.period_start, new.period_end
      using errcode = '23P01';
  end if;
  return new;
end;
$$;
revoke execute on function public.financial_periods_no_overlap() from public, anon;
grant  execute on function public.financial_periods_no_overlap() to authenticated;

drop trigger if exists financial_periods_overlap on public.financial_periods;
create trigger financial_periods_overlap before insert or update on public.financial_periods
  for each row execute function public.financial_periods_no_overlap();
drop trigger if exists financial_periods_stamp on public.financial_periods;
create trigger financial_periods_stamp before insert or update on public.financial_periods
  for each row execute function public.fs_stamp_updated();

alter table public.financial_periods enable row level security;
drop policy if exists financial_periods_select on public.financial_periods;
drop policy if exists financial_periods_insert on public.financial_periods;
drop policy if exists financial_periods_update on public.financial_periods;
drop policy if exists financial_periods_delete on public.financial_periods;
create policy financial_periods_select on public.financial_periods for select to authenticated
  using (coalesce(public.user_is_accountant(company_id), false));
create policy financial_periods_insert on public.financial_periods for insert to authenticated
  with check (coalesce(public.user_is_accountant(company_id), false));
create policy financial_periods_update on public.financial_periods for update to authenticated
  using (coalesce(public.user_is_accountant(company_id), false)) with check (coalesce(public.user_is_accountant(company_id), false));
create policy financial_periods_delete on public.financial_periods for delete to authenticated
  using (coalesce(public.user_is_accountant(company_id), false));

revoke all on public.financial_periods from public, anon;
grant select, insert, update, delete on public.financial_periods to authenticated;
