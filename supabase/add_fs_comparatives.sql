-- STA-01 Stage 4a: comparatives (prior-year figures), entered by hand now and by extraction in
-- Stage 4b, with provenance. Design approved by Peter (7 Oct 2026). Precedence on the statements:
-- approved snapshot (Stage 5), then confirmed lines from this table, then the ledger as a check.
--
-- One row per statement line of the comparative year (prior_year_start .. prior_year_end):
--   line_key  bs.A bs.B bs.C bs.D bs.E bs.F bs.G bs.H bs.I bs.K bs.K1 bs.K2   balance sheet
--             res.bf res.div                                                reserves movement
--             pnl.1 .. pnl.8                                               profit and loss
--   amounts as the engine holds them: creditors (E, H), provisions (I), costs (pnl.3-7) and
--   dividends positive; subtotals F, G, K and pnl.8 optional (computed when absent).
--   status    draft -> confirmed (only through fs_confirm_comparatives, which re-runs the checks)
--             confirmed -> superseded (only through fs_reopen_comparatives, which opens new drafts)
--   source    manual | extracted (Stage 4b); extracted_amount keeps what extraction read,
--             amount is the working figure, confirmed_amount what was confirmed;
--             source_file / source_page say where it came from.
--
-- Standing rules: RLS on, accountant-only; policies to authenticated only; explicit grants and
-- column grants (status and the confirmation fields are not client-writable); functions with a
-- fixed search_path and explicit grants. The two functions are SECURITY DEFINER so they can set
-- the protected columns; each checks user_is_accountant() for the caller first.

create table if not exists public.fs_comparatives (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  regime           text not null default 'FRS105' check (regime in ('FRS105', 'FRS102_1A', 'FRS102', 'FRS101')),
  prior_year_start date not null,
  prior_year_end   date not null,
  line_group       text not null check (line_group in ('bs', 'pnl')),
  line_key         text not null check (line_key in (
    'bs.A', 'bs.B', 'bs.C', 'bs.D', 'bs.E', 'bs.F', 'bs.G', 'bs.H', 'bs.I', 'bs.K', 'bs.K1', 'bs.K2',
    'res.bf', 'res.div', 'pnl.1', 'pnl.2', 'pnl.3', 'pnl.4', 'pnl.5', 'pnl.6', 'pnl.7', 'pnl.8')),
  status           text not null default 'draft' check (status in ('draft', 'confirmed', 'superseded')),
  source           text not null default 'manual' check (source in ('manual', 'extracted')),
  amount           numeric(14, 2) not null,
  extracted_amount numeric(14, 2),
  confirmed_amount numeric(14, 2),
  source_file      text,
  source_page      integer check (source_page is null or source_page > 0),
  note             text,
  confirm_checks   jsonb,
  created_by       text,
  updated_by       text,
  updated_at       timestamptz not null default now(),
  confirmed_by     text,
  confirmed_at     timestamptz,
  superseded_at    timestamptz,
  check (prior_year_end > prior_year_start),
  check ((line_group = 'pnl') = (line_key like 'pnl.%')),
  check (status = 'draft' or (confirmed_amount is not null and confirmed_at is not null)),
  check (status <> 'superseded' or superseded_at is not null)
);
-- One live (draft or confirmed) row per line; superseded rows are the history.
create unique index if not exists fs_comparatives_live_line
  on public.fs_comparatives (company_id, regime, prior_year_end, line_key) where status <> 'superseded';
create index if not exists fs_comparatives_company_idx on public.fs_comparatives (company_id, prior_year_end);

-- Who and when, from the caller's JWT.
create or replace function public.fs_comparatives_stamp()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.created_by := coalesce(auth.jwt() ->> 'sub', new.created_by); end if;
  new.updated_by := auth.jwt() ->> 'sub';
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.fs_comparatives_stamp() from public, anon;
grant  execute on function public.fs_comparatives_stamp() to authenticated;
drop trigger if exists fs_comparatives_stamp on public.fs_comparatives;
create trigger fs_comparatives_stamp before insert or update on public.fs_comparatives
  for each row execute function public.fs_comparatives_stamp();

-- The checks, shared by confirm (and callable on their own for a preview). Rounding: printed
-- accounts round each line to whole euros, so a total may differ from the sum of its components
-- by up to EUR 1 per component ('rounding'); more is an 'error'. Returns a jsonb array of
-- { check, expected, actual, difference, tolerance, result } plus a 'missing' entry when a
-- required line has no live row.
create or replace function public.fs_comparatives_checks(p_company_id uuid, p_prior_year_end date, p_group text, p_regime text default 'FRS105')
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v jsonb := '{}'::jsonb;
  r record;
  out jsonb := '[]'::jsonb;
  req text[];
  missing text[];
  a numeric; b numeric; c numeric; d numeric; e numeric; h numeric; i numeric; k1 numeric; k2 numeric;
  f numeric; g numeric; p8 numeric;
begin
  for r in select line_key, amount from public.fs_comparatives
           where company_id = p_company_id and regime = p_regime and prior_year_end = p_prior_year_end and status <> 'superseded'
  loop v := v || jsonb_build_object(r.line_key, r.amount); end loop;

  req := case p_group when 'bs' then array['bs.A','bs.B','bs.C','bs.D','bs.E','bs.H','bs.I','bs.K1','bs.K2']
                      else array['pnl.1','pnl.2','pnl.3','pnl.4','pnl.5','pnl.6','pnl.7'] end;
  select array_agg(x) into missing from unnest(req) x where not (v ? x);
  if missing is not null then
    return jsonb_build_array(jsonb_build_object('check', 'required lines', 'result', 'error', 'missing', to_jsonb(missing)));
  end if;

  if p_group = 'bs' then
    a := (v->>'bs.A')::numeric; b := (v->>'bs.B')::numeric; c := (v->>'bs.C')::numeric; d := (v->>'bs.D')::numeric;
    e := (v->>'bs.E')::numeric; h := (v->>'bs.H')::numeric; i := (v->>'bs.I')::numeric;
    k1 := (v->>'bs.K1')::numeric; k2 := (v->>'bs.K2')::numeric;
    f := coalesce((v->>'bs.F')::numeric, c + d - e);
    g := coalesce((v->>'bs.G')::numeric, a + b + f);
    if v ? 'bs.F' then out := out || jsonb_build_object('check', 'F = C + D - E', 'expected', c + d - e, 'actual', f, 'components', 3); end if;
    if v ? 'bs.G' then out := out || jsonb_build_object('check', 'G = A + B + F', 'expected', a + b + f, 'actual', g, 'components', 3); end if;
    if v ? 'bs.K' then out := out || jsonb_build_object('check', 'K = K1 + K2', 'expected', k1 + k2, 'actual', (v->>'bs.K')::numeric, 'components', 2); end if;
    out := out || jsonb_build_object('check', 'net assets (G - H - I) = capital and reserves (K1 + K2)', 'expected', k1 + k2, 'actual', g - h - i, 'components', 5);
    if v ? 'res.bf' then
      p8 := coalesce((v->>'pnl.8')::numeric,
        case when v ? 'pnl.1' then (v->>'pnl.1')::numeric + coalesce((v->>'pnl.2')::numeric, 0) - coalesce((v->>'pnl.3')::numeric, 0)
          - coalesce((v->>'pnl.4')::numeric, 0) - coalesce((v->>'pnl.5')::numeric, 0) - coalesce((v->>'pnl.6')::numeric, 0) - coalesce((v->>'pnl.7')::numeric, 0) end);
      if p8 is null then
        out := out || jsonb_build_object('check', 'reserves: K2 = b/f + profit - dividends', 'result', 'not run', 'reason', 'no profit or loss for the year entered');
      else
        out := out || jsonb_build_object('check', 'reserves: K2 = b/f + profit - dividends', 'expected', (v->>'res.bf')::numeric + p8 - coalesce((v->>'res.div')::numeric, 0), 'actual', k2, 'components', 3);
      end if;
    end if;
  else
    if v ? 'pnl.8' then
      out := out || jsonb_build_object('check', 'profit or loss = 1 + 2 - 3 - 4 - 5 - 6 - 7',
        'expected', (v->>'pnl.1')::numeric + (v->>'pnl.2')::numeric - (v->>'pnl.3')::numeric - (v->>'pnl.4')::numeric - (v->>'pnl.5')::numeric - (v->>'pnl.6')::numeric - (v->>'pnl.7')::numeric,
        'actual', (v->>'pnl.8')::numeric, 'components', 7);
    end if;
  end if;

  -- difference, tolerance (EUR 1 per component) and result for every computed check
  select coalesce(jsonb_agg(case when x ? 'expected' then
           x || jsonb_build_object('difference', round(((x->>'actual')::numeric - (x->>'expected')::numeric), 2),
                                   'tolerance', (x->>'components')::numeric,
                                   'result', case when abs((x->>'actual')::numeric - (x->>'expected')::numeric) < 0.005 then 'exact'
                                                  when abs((x->>'actual')::numeric - (x->>'expected')::numeric) <= (x->>'components')::numeric then 'rounding'
                                                  else 'error' end)
         else x end), '[]'::jsonb)
    into out from jsonb_array_elements(out) x;
  return out;
end;
$$;
revoke execute on function public.fs_comparatives_checks(uuid, date, text, text) from public, anon;
grant  execute on function public.fs_comparatives_checks(uuid, date, text, text) to authenticated;

-- Confirm one group ('bs' or 'pnl') of draft lines: re-runs the checks, and confirms only when
-- none is an error. SECURITY DEFINER to write the protected columns; accountant-checked first.
create or replace function public.fs_confirm_comparatives(p_company_id uuid, p_prior_year_end date, p_group text, p_regime text default 'FRS105')
returns jsonb language plpgsql security definer set search_path = public as $$
declare chk jsonb; n int;
begin
  if not coalesce(public.user_is_accountant(p_company_id), false) then
    raise exception 'only the company''s accountant can confirm comparatives' using errcode = '42501';
  end if;
  if p_group not in ('bs', 'pnl') then raise exception 'group must be bs or pnl'; end if;
  chk := public.fs_comparatives_checks(p_company_id, p_prior_year_end, p_group, p_regime);
  if exists (select 1 from jsonb_array_elements(chk) x where x->>'result' = 'error') then
    return jsonb_build_object('confirmed', 0, 'checks', chk);
  end if;
  update public.fs_comparatives
     set status = 'confirmed', confirmed_amount = amount, confirmed_by = auth.jwt() ->> 'sub', confirmed_at = now(), confirm_checks = chk
   where company_id = p_company_id and regime = p_regime and prior_year_end = p_prior_year_end and status = 'draft'
     and (line_group = p_group or (p_group = 'bs' and line_key like 'res.%'));
  get diagnostics n = row_count;
  return jsonb_build_object('confirmed', n, 'checks', chk);
end;
$$;
revoke execute on function public.fs_confirm_comparatives(uuid, date, text, text) from public, anon;
grant  execute on function public.fs_confirm_comparatives(uuid, date, text, text) to authenticated;

-- Reopen a confirmed group: its rows become history (superseded) and new drafts carry the
-- confirmed figures and provenance forward for editing.
create or replace function public.fs_reopen_comparatives(p_company_id uuid, p_prior_year_end date, p_group text, p_regime text default 'FRS105')
returns integer language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not coalesce(public.user_is_accountant(p_company_id), false) then
    raise exception 'only the company''s accountant can reopen comparatives' using errcode = '42501';
  end if;
  if p_group not in ('bs', 'pnl') then raise exception 'group must be bs or pnl'; end if;
  create temp table if not exists fs_reopen_tmp on commit drop as select * from public.fs_comparatives where false;
  delete from fs_reopen_tmp;
  with old as (
    update public.fs_comparatives
       set status = 'superseded', superseded_at = now()
     where company_id = p_company_id and regime = p_regime and prior_year_end = p_prior_year_end and status = 'confirmed'
       and (line_group = p_group or (p_group = 'bs' and line_key like 'res.%'))
    returning *)
  insert into fs_reopen_tmp select * from old;
  get diagnostics n = row_count;
  insert into public.fs_comparatives (company_id, regime, prior_year_start, prior_year_end, line_group, line_key, source,
    amount, extracted_amount, source_file, source_page, note)
  select company_id, regime, prior_year_start, prior_year_end, line_group, line_key, source,
    confirmed_amount, extracted_amount, source_file, source_page, note from fs_reopen_tmp;
  return n;
end;
$$;
revoke execute on function public.fs_reopen_comparatives(uuid, date, text, text) from public, anon;
grant  execute on function public.fs_reopen_comparatives(uuid, date, text, text) to authenticated;

-- ── RLS: accountant-only; only drafts are editable or deletable by the client ───────────────
alter table public.fs_comparatives enable row level security;
drop policy if exists fs_comparatives_select on public.fs_comparatives;
drop policy if exists fs_comparatives_insert on public.fs_comparatives;
drop policy if exists fs_comparatives_update on public.fs_comparatives;
drop policy if exists fs_comparatives_delete on public.fs_comparatives;
create policy fs_comparatives_select on public.fs_comparatives for select to authenticated
  using (coalesce(public.user_is_accountant(company_id), false));
create policy fs_comparatives_insert on public.fs_comparatives for insert to authenticated
  with check (coalesce(public.user_is_accountant(company_id), false) and status = 'draft');
create policy fs_comparatives_update on public.fs_comparatives for update to authenticated
  using (coalesce(public.user_is_accountant(company_id), false) and status = 'draft')
  with check (coalesce(public.user_is_accountant(company_id), false) and status = 'draft');
create policy fs_comparatives_delete on public.fs_comparatives for delete to authenticated
  using (coalesce(public.user_is_accountant(company_id), false) and status = 'draft');

-- ── Grants: status and the confirmation fields are not client-writable ─────────────────────
revoke all on public.fs_comparatives from public, anon, authenticated;
grant select, delete on public.fs_comparatives to authenticated;
grant insert (company_id, regime, prior_year_start, prior_year_end, line_group, line_key, source,
              amount, extracted_amount, source_file, source_page, note) on public.fs_comparatives to authenticated;
grant update (amount, source_file, source_page, note) on public.fs_comparatives to authenticated;
