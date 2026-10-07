-- STA-01 Stages 5b and 5c: approved financial statements, their archive and the signed copies.
-- Design approved by Peter (7 Oct 2026, with changes; go for 5b-5d 9 Oct 2026).
--
--   fs_approvals        one row per approval: the snapshot (figures, inputs, wording and its status,
--                       comparatives, ledger fingerprint, rule evidence) and both PDFs' archive
--                       paths and SHA-256. status approved -> superseded (a later approval of the
--                       same period, with a reason); nothing else ever changes and nothing is deleted.
--   fs_approval_files   the directors' signed copies, uploaded after approval: never replacing the
--                       approved PDF; a corrected copy is a new n.
--   statutory-documents a private storage bucket, PDF only, 10 MB a file:
--                       {company}/{period_end}/{approval_id}/full.pdf, abridged.pdf,
--                       signed-full-{n}.pdf, signed-abridged-{n}.pdf
--
-- Who writes: only the server (api/statements-approval.js, with the service role, after
-- requireAccountant, the company check and the approval rule). The approval row and the archive
-- certify that the server checked the rule and produced exactly these files, so clients get no
-- insert, update or delete on either table and there is no storage policy on the bucket at all:
-- reads go through short-lived signed URLs the server issues after its role check.
-- Who reads (RLS, authenticated only): the company's accountant, every row; a business owner,
-- approved rows only (never superseded ones, never drafts: drafts are never stored).

create table if not exists public.fs_approvals (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references public.companies(id) on delete restrict,
  regime                  text not null default 'FRS105' check (regime in ('FRS105', 'FRS102_1A', 'FRS102', 'FRS101')),
  period_start            date not null,
  period_end              date not null,
  status                  text not null default 'approved' check (status in ('approved', 'superseded')),
  approved_by             text not null,            -- Clerk user id, verified by the server
  approved_by_name        text,
  recorded_at             timestamptz not null default now(),   -- when Ledgrly recorded the approval
  directors_approval_date date not null,                        -- from the inputs (a separate fact)
  snapshot                jsonb not null,
  full_pdf_path           text not null unique,
  full_pdf_sha256         text not null check (full_pdf_sha256 ~ '^[0-9a-f]{64}$'),
  abridged_pdf_path       text unique,
  abridged_pdf_sha256     text check (abridged_pdf_sha256 ~ '^[0-9a-f]{64}$'),
  writes_after_signoff    integer not null default 0 check (writes_after_signoff >= 0),
  ack_count               integer,
  ack_reason              text,
  superseded_at           timestamptz,
  superseded_by           uuid references public.fs_approvals(id) deferrable initially deferred,
  supersede_reason        text,
  check (period_end > period_start),
  check ((abridged_pdf_path is null) = (abridged_pdf_sha256 is null)),
  check (writes_after_signoff = 0 or (ack_count = writes_after_signoff and length(trim(coalesce(ack_reason, ''))) > 0)),
  check ((status = 'superseded') = (superseded_at is not null)),
  check (status = 'approved' or (superseded_by is not null and length(trim(coalesce(supersede_reason, ''))) > 0))
);
-- One live approval per company, regime and period end.
create unique index if not exists fs_approvals_live
  on public.fs_approvals (company_id, regime, period_end) where status = 'approved';
create index if not exists fs_approvals_company_idx on public.fs_approvals (company_id, period_end);

create table if not exists public.fs_approval_files (
  id               uuid primary key default gen_random_uuid(),
  approval_id      uuid not null references public.fs_approvals(id) on delete restrict,
  company_id       uuid not null references public.companies(id) on delete restrict,
  kind             text not null check (kind in ('signed_full', 'signed_abridged')),
  n                integer not null check (n > 0),
  path             text not null unique,
  sha256           text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes       integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by      text not null,
  uploaded_by_name text,
  uploaded_at      timestamptz not null default now(),
  unique (approval_id, kind, n)
);
create index if not exists fs_approval_files_approval_idx on public.fs_approval_files (approval_id);

-- Append-only: rows are never deleted; an approval may only move approved -> superseded (with
-- superseded_at, superseded_by and the reason), and nothing else on it changes. Signed-copy rows
-- never change.
create or replace function public.fs_approvals_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'approved financial statements are never deleted' using errcode = '42501';
  end if;
  if tg_table_name = 'fs_approval_files' then
    raise exception 'signed copies never change; upload a corrected copy as a new file' using errcode = '42501';
  end if;
  if old.status <> 'approved' or new.status <> 'superseded'
     or (to_jsonb(new) - array['status', 'superseded_at', 'superseded_by', 'supersede_reason'])
        is distinct from (to_jsonb(old) - array['status', 'superseded_at', 'superseded_by', 'supersede_reason']) then
    raise exception 'an approval can only be superseded; nothing else on it changes' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.fs_approvals_guard() from public, anon, authenticated;
drop trigger if exists fs_approvals_guard on public.fs_approvals;
create trigger fs_approvals_guard before update or delete on public.fs_approvals
  for each row execute function public.fs_approvals_guard();
drop trigger if exists fs_approval_files_guard on public.fs_approval_files;
create trigger fs_approval_files_guard before update or delete on public.fs_approval_files
  for each row execute function public.fs_approvals_guard();

alter table public.fs_approvals enable row level security;
alter table public.fs_approval_files enable row level security;

drop policy if exists fs_approvals_select on public.fs_approvals;
create policy fs_approvals_select on public.fs_approvals for select to authenticated
  using (company_id in (select public.user_company_ids())
         and (coalesce(public.user_is_accountant(company_id), false) or status = 'approved'));

drop policy if exists fs_approval_files_select on public.fs_approval_files;
create policy fs_approval_files_select on public.fs_approval_files for select to authenticated
  using (company_id in (select public.user_company_ids())
         and (coalesce(public.user_is_accountant(company_id), false)
              or exists (select 1 from public.fs_approvals a where a.id = approval_id and a.status = 'approved')));

revoke all on public.fs_approvals, public.fs_approval_files from public, anon, authenticated;
grant select on public.fs_approvals, public.fs_approval_files to authenticated;
-- The server's writes (service role): insert, and the supersede update; never delete.
revoke all on public.fs_approvals, public.fs_approval_files from service_role;
grant select, insert, update on public.fs_approvals to service_role;
grant select, insert on public.fs_approval_files to service_role;

-- Records an approval in one transaction: supersedes the live approval of the same period (only
-- when the caller names it and gives a reason) and inserts the new row. Service role only: the
-- endpoint calls it after its checks and after both PDFs are stored. SECURITY INVOKER: the
-- service role's own grants apply.
create or replace function public.fs_record_approval(p_row jsonb, p_supersedes uuid default null, p_supersede_reason text default null)
returns public.fs_approvals language plpgsql security invoker set search_path = public as $$
declare
  v_live public.fs_approvals;
  v_new  public.fs_approvals;
begin
  select * into v_live from public.fs_approvals
   where company_id = (p_row->>'company_id')::uuid and regime = coalesce(p_row->>'regime', 'FRS105')
     and period_end = (p_row->>'period_end')::date and status = 'approved'
   for update;
  if v_live.id is not null and v_live.id is distinct from p_supersedes then
    raise exception 'this period already has an approval (%); supersede it with a reason', v_live.id using errcode = '23505';
  end if;
  if v_live.id is null and p_supersedes is not null then
    raise exception 'the approval to supersede is not the live approval of this period' using errcode = '22023';
  end if;

  v_new := jsonb_populate_record(null::public.fs_approvals, p_row);
  if v_new.id is null then
    raise exception 'the approval id is required (the archive paths contain it)' using errcode = '22023';
  end if;
  v_new.regime := coalesce(v_new.regime, 'FRS105');
  v_new.writes_after_signoff := coalesce(v_new.writes_after_signoff, 0);
  v_new.status := 'approved';
  v_new.recorded_at := now();
  v_new.superseded_at := null; v_new.superseded_by := null; v_new.supersede_reason := null;

  if v_live.id is not null then
    if length(trim(coalesce(p_supersede_reason, ''))) = 0 then
      raise exception 'a reason is required to supersede an approval' using errcode = '22023';
    end if;
    -- free the live slot first (the unique index covers status = 'approved' only); superseded_by
    -- is set once the new row exists, within the same transaction
    update public.fs_approvals set status = 'superseded', superseded_at = now(), superseded_by = v_new.id,
           supersede_reason = trim(p_supersede_reason)
     where id = v_live.id;
  end if;
  insert into public.fs_approvals select v_new.* returning * into v_new;
  return v_new;
end;
$$;
revoke execute on function public.fs_record_approval(jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.fs_record_approval(jsonb, uuid, text) to service_role;

-- 5c: the archive bucket. Private, PDF only, 10 MB a file. No storage.objects policy names this
-- bucket, so anon and authenticated can neither list, read, sign, upload, update nor delete in it;
-- only the service role (the server) writes and signs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('statutory-documents', 'statutory-documents', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['application/pdf'];
