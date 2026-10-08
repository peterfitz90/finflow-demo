-- BNK-14 step 2: one upload path for signed copies, prior-year accounts and bank statements
-- (design approved by Peter, 9 Oct 2026, with additions: the clean-up removes only temporary paths
-- never registered, never an archived record; every rejected upload records who attempted it and
-- why). The browser sends the file straight to private storage through a signed upload URL, so no
-- file passes through a function body; the server trusts nothing until it has checked the stored
-- file itself.
--
--   uploads            every upload attempt: start (declared name, size, purpose, who), then
--                      accepted (checked size, SHA-256, where it was archived) or rejected (who and
--                      why) or expired. Rejections at start are recorded too.
--   source_documents   prior-year accounts and bank statements as received: purpose, original name,
--                      size, SHA-256, uploader, the period once read, retain_until (six years after
--                      the financial year ends, Peter 8 Oct 2026). Never deleted by any job here.
--   uploads-staging    private bucket, temporary: staging/{company}/{upload_id}. The clean-up job
--                      may delete only here, only objects whose upload never became a record.
--   source-documents   private bucket: {company}/{purpose}/{upload_id}.{pdf|csv}
-- Signed copies keep their archive (statutory-documents, fs_approval_files) exactly as Stage 5c.
--
-- Access: no storage policy names either bucket; both tables are select-only for the company's
-- accountant (uploads are accountant-only in the first version) and written only by the server
-- (service role, after requireAccountant).

create table if not exists public.uploads (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete restrict,
  purpose          text not null check (purpose in ('signed_copy', 'prior_accounts', 'bank_statement')),
  purpose_ref      jsonb,                         -- signed_copy: { approval_id, kind }
  filename         text not null,
  declared_size    bigint not null check (declared_size >= 0),
  declared_type    text not null,
  status           text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'expired')),
  staging_path     text unique,                   -- null when refused at start
  created_by       text not null,                 -- Clerk user id, verified by the server
  created_by_name  text,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '2 hours',
  finished_by      text,
  finished_at      timestamptz,
  size_bytes       bigint,                        -- as stored, measured by the server
  sha256           text check (sha256 ~ '^[0-9a-f]{64}$'),
  destination      jsonb,                         -- { bucket, path, record: 'fs_approval_files' | 'source_documents', id }
  rejected_reason  text,
  check (status <> 'accepted' or (sha256 is not null and size_bytes is not null and destination is not null and finished_at is not null)),
  check (status <> 'rejected' or length(trim(coalesce(rejected_reason, ''))) > 0)
);
create index if not exists uploads_company_idx on public.uploads (company_id, created_at desc);
create index if not exists uploads_pending_idx on public.uploads (status, created_at) where status in ('pending', 'rejected', 'expired');

create table if not exists public.source_documents (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete restrict,
  purpose        text not null check (purpose in ('prior_accounts', 'bank_statement')),
  upload_id      uuid not null unique references public.uploads(id),
  bucket         text not null default 'source-documents' check (bucket = 'source-documents'),
  path           text not null unique,
  filename       text not null,
  mime           text not null check (mime in ('application/pdf', 'text/csv')),
  size_bytes     bigint not null check (size_bytes > 0),
  sha256         text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by    text not null,
  uploaded_by_name text,
  uploaded_at    timestamptz not null default now(),
  period_start   date,
  period_end     date,
  retain_until   date
);
create index if not exists source_documents_company_idx on public.source_documents (company_id, uploaded_at desc);
create index if not exists source_documents_sha_idx on public.source_documents (company_id, sha256);

-- A received document is never deleted here, and only what is learned later (the period, and the
-- retention date that follows from it) may be filled in.
create or replace function public.source_documents_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'source documents are kept for their retention period and never deleted here' using errcode = '42501';
  end if;
  if (to_jsonb(new) - array['period_start', 'period_end', 'retain_until'])
     is distinct from (to_jsonb(old) - array['period_start', 'period_end', 'retain_until']) then
    raise exception 'a received document does not change; only its period and retention date are filled in' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.source_documents_guard() from public, anon, authenticated;
drop trigger if exists source_documents_guard on public.source_documents;
create trigger source_documents_guard before update or delete on public.source_documents
  for each row execute function public.source_documents_guard();

-- An upload record is a log: never deleted; once accepted or rejected it does not change.
create or replace function public.uploads_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'upload records are never deleted' using errcode = '42501';
  end if;
  if old.status in ('accepted', 'rejected') then
    raise exception 'a finished upload record does not change' using errcode = '42501';
  end if;
  if (to_jsonb(new) - array['status', 'finished_by', 'finished_at', 'size_bytes', 'sha256', 'destination', 'rejected_reason'])
     is distinct from (to_jsonb(old) - array['status', 'finished_by', 'finished_at', 'size_bytes', 'sha256', 'destination', 'rejected_reason']) then
    raise exception 'only the outcome of an upload is recorded after it starts' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.uploads_guard() from public, anon, authenticated;
drop trigger if exists uploads_guard on public.uploads;
create trigger uploads_guard before update or delete on public.uploads
  for each row execute function public.uploads_guard();

alter table public.uploads enable row level security;
alter table public.source_documents enable row level security;
drop policy if exists uploads_select on public.uploads;
create policy uploads_select on public.uploads for select to authenticated
  using (company_id in (select public.user_company_ids()) and coalesce(public.user_is_accountant(company_id), false));
drop policy if exists source_documents_select on public.source_documents;
create policy source_documents_select on public.source_documents for select to authenticated
  using (company_id in (select public.user_company_ids()) and coalesce(public.user_is_accountant(company_id), false));

revoke all on public.uploads, public.source_documents from public, anon, authenticated, service_role;
grant select on public.uploads, public.source_documents to authenticated;
grant select, insert, update on public.uploads, public.source_documents to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('uploads-staging', 'uploads-staging', false, 33554432, array['application/pdf', 'text/csv', 'text/plain', 'application/vnd.ms-excel']),
       ('source-documents', 'source-documents', false, 33554432, array['application/pdf', 'text/csv'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
