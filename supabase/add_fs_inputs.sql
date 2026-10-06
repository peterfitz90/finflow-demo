-- STA-01 Stage 3b: inputs and attestations for statutory financial statements.
-- Design approved by Peter (Stage 3a). Everything is accountant-only, read and write: business
-- owners never see draft inputs (they see approved snapshots in Stage 5). No default claims:
-- a negative statement ("nothing to disclose") exists only as an fs_disclosures row, stamped
-- with who attested and when by trigger from the caller's own JWT, never from the client.
--
-- Tables
--   company_statutory_profile  company-level facts (legal form, registered office, country)
--   company_directors          directors with appointment and resignation dates
--   fs_year_inputs             per company, year end and regime: employees, approval date,
--                              signatories, policy inputs
--   fs_disclosures             one row per disclosure key; has_items = false is the explicit
--                              "nothing to disclose" attestation; a missing row = information
--                              required
--   fs_disclosure_events       append-only history of every disclosure insert, update, delete,
--                              written only by trigger (no client insert, update or delete)
--
-- Standing rules: RLS on; policies to authenticated only; explicit grants (nothing to public
-- or anon); fixed search_path and explicit grants on every function. The stamping functions
-- are SECURITY INVOKER. fs_log_disclosure is SECURITY DEFINER so the history can be written by
-- the trigger alone: its access check is the RLS-checked write on fs_disclosures that fires it,
-- and a trigger function cannot be called directly.

-- ── Tables ──────────────────────────────────────────────────────────────────────────────────
create table if not exists public.company_statutory_profile (
  company_id        uuid primary key references public.companies(id) on delete cascade,
  legal_form        text check (legal_form in ('LTD', 'DAC', 'CLG', 'UC', 'ULC')),
  registered_office text,
  country           text,
  updated_by        text,
  updated_at        timestamptz not null default now()
);

create table if not exists public.company_directors (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  full_name    text not null check (length(trim(full_name)) > 0),
  appointed_on date,
  resigned_on  date,
  updated_by   text,
  updated_at   timestamptz not null default now(),
  check (resigned_on is null or appointed_on is null or resigned_on >= appointed_on)
);
create index if not exists company_directors_company_idx on public.company_directors (company_id);

create table if not exists public.fs_year_inputs (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  year_end_date     date not null,
  regime            text not null default 'FRS105' check (regime in ('FRS105', 'FRS102_1A', 'FRS102', 'FRS101')),
  average_employees integer check (average_employees >= 0),
  approval_date     date,
  signatory_ids     uuid[] not null default '{}',
  policy_inputs     jsonb not null default '{}'::jsonb,
  updated_by        text,
  updated_at        timestamptz not null default now(),
  unique (company_id, year_end_date, regime),
  check (approval_date is null or approval_date > year_end_date),
  check (cardinality(signatory_ids) <= 2)
);

create table if not exists public.fs_disclosures (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  year_end_date    date not null,
  regime           text not null default 'FRS105' check (regime in ('FRS105', 'FRS102_1A', 'FRS102', 'FRS101')),
  disclosure_key   text not null check (disclosure_key in (
    'directors_advances', 'commitments', 'dividends', 'own_shares', 'post_bs_events',
    'audit_exemption', 'no_s334_notice', 'not_group_parent', 'not_consolidated_subsidiary',
    'not_investment_or_financial_holding', 'not_ineligible_entity', 'not_in_liquidation',
    'format_change', 'comparatives_adjusted', 'no_going_concern_uncertainty')),
  has_items        boolean not null,
  details          jsonb not null default '{}'::jsonb,
  narrative        text,
  -- how the attestation was made: typed by the accountant, or a ledger-evidenced suggestion the
  -- accountant confirmed (still the accountant's own attestation)
  basis            text not null default 'entered' check (basis in ('entered', 'confirmed_suggestion')),
  evidence         jsonb not null default '{}'::jsonb,   -- ledger evidence shown when confirmed
  attested_by      text,                                 -- set by trigger from auth.jwt()
  attested_by_name text,
  attested_at      timestamptz,                          -- set by trigger
  unique (company_id, year_end_date, regime, disclosure_key)
);

create table if not exists public.fs_disclosure_events (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  year_end_date  date not null,
  regime         text not null,
  disclosure_key text not null,
  action         text not null check (action in ('insert', 'update', 'delete')),
  old_row        jsonb,
  new_row        jsonb,
  actor          text,
  occurred_at    timestamptz not null default now()
);
create index if not exists fs_disclosure_events_key_idx on public.fs_disclosure_events (company_id, year_end_date, disclosure_key);

-- ── Trigger functions ───────────────────────────────────────────────────────────────────────
-- Stamp updated_by / updated_at from the caller (company-level and year tables).
create or replace function public.fs_stamp_updated()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.updated_by := auth.jwt() ->> 'sub';
  new.updated_at := now();
  return new;
end;
$$;

-- Stamp the attestation: who and when come from the caller's JWT, whatever the client sent.
create or replace function public.fs_stamp_attestation()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.attested_by := auth.jwt() ->> 'sub';
  new.attested_at := now();
  return new;
end;
$$;

-- Append every change to the history. SECURITY DEFINER: only this trigger writes the history;
-- it fires only after an RLS-checked (accountant-only) write to fs_disclosures.
create or replace function public.fs_log_disclosure()
returns trigger language plpgsql security definer set search_path = public as $$
declare r public.fs_disclosures;
begin
  r := coalesce(new, old);
  insert into public.fs_disclosure_events (company_id, year_end_date, regime, disclosure_key, action, old_row, new_row, actor)
  values (r.company_id, r.year_end_date, r.regime, r.disclosure_key, lower(tg_op),
          case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end,
          auth.jwt() ->> 'sub');
  return null;
end;
$$;

revoke execute on function public.fs_stamp_updated()      from public, anon;
revoke execute on function public.fs_stamp_attestation()  from public, anon;
revoke execute on function public.fs_log_disclosure()     from public, anon;
grant  execute on function public.fs_stamp_updated()      to authenticated;
grant  execute on function public.fs_stamp_attestation()  to authenticated;
grant  execute on function public.fs_log_disclosure()     to authenticated;

drop trigger if exists company_statutory_profile_stamp on public.company_statutory_profile;
create trigger company_statutory_profile_stamp before insert or update on public.company_statutory_profile
  for each row execute function public.fs_stamp_updated();
drop trigger if exists company_directors_stamp on public.company_directors;
create trigger company_directors_stamp before insert or update on public.company_directors
  for each row execute function public.fs_stamp_updated();
drop trigger if exists fs_year_inputs_stamp on public.fs_year_inputs;
create trigger fs_year_inputs_stamp before insert or update on public.fs_year_inputs
  for each row execute function public.fs_stamp_updated();
drop trigger if exists fs_disclosures_stamp on public.fs_disclosures;
create trigger fs_disclosures_stamp before insert or update on public.fs_disclosures
  for each row execute function public.fs_stamp_attestation();
drop trigger if exists fs_disclosures_log on public.fs_disclosures;
create trigger fs_disclosures_log after insert or update or delete on public.fs_disclosures
  for each row execute function public.fs_log_disclosure();

-- ── RLS: accountant-only ────────────────────────────────────────────────────────────────────
alter table public.company_statutory_profile enable row level security;
alter table public.company_directors         enable row level security;
alter table public.fs_year_inputs            enable row level security;
alter table public.fs_disclosures            enable row level security;
alter table public.fs_disclosure_events      enable row level security;

do $$
declare t text;
begin
  foreach t in array array['company_statutory_profile', 'company_directors', 'fs_year_inputs', 'fs_disclosures'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (coalesce(public.user_is_accountant(company_id), false))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (coalesce(public.user_is_accountant(company_id), false))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (coalesce(public.user_is_accountant(company_id), false)) with check (coalesce(public.user_is_accountant(company_id), false))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (coalesce(public.user_is_accountant(company_id), false))', t || '_delete', t);
  end loop;
end $$;

drop policy if exists fs_disclosure_events_select on public.fs_disclosure_events;
drop policy if exists fs_disclosure_events_insert on public.fs_disclosure_events;
create policy fs_disclosure_events_select on public.fs_disclosure_events for select to authenticated
  using (coalesce(public.user_is_accountant(company_id), false));
-- No insert, update or delete policy or grant: the history is written by fs_log_disclosure only.

-- ── Grants ──────────────────────────────────────────────────────────────────────────────────
revoke all on public.company_statutory_profile from public, anon;
revoke all on public.company_directors         from public, anon;
revoke all on public.fs_year_inputs            from public, anon;
revoke all on public.fs_disclosures            from public, anon;
revoke all on public.fs_disclosure_events      from public, anon;
grant select, insert, update, delete on public.company_statutory_profile to authenticated;
grant select, insert, update, delete on public.company_directors         to authenticated;
grant select, insert, update, delete on public.fs_year_inputs            to authenticated;
grant select, insert, update, delete on public.fs_disclosures            to authenticated;
grant select                         on public.fs_disclosure_events      to authenticated;
