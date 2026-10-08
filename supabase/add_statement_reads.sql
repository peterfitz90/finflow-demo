-- BNK-14 step 3a: every read of an uploaded PDF statement, with its cost, so the import batch can
-- show what was read, how (text layer or page images) and what it cost. Written only by the server
-- (api/statement-read.js, service role, after requireAccountant); readable by the company's
-- accountant. A read never changes, except that each import made from it is appended to imports.
create table if not exists public.statement_reads (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete restrict,
  source_document_id uuid not null references public.source_documents(id),
  mode               text not null check (mode in ('text', 'image')),
  status             text not null check (status in ('read', 'refused', 'failed')),
  refused_reason     text,
  model              text,
  pages              integer,
  chunks             integer,
  tokens_in          integer not null default 0,
  tokens_out         integer not null default 0,
  cost_usd           numeric(10, 4) not null default 0,
  ms                 integer,
  period_start       date,
  period_end         date,
  summary            jsonb,
  result             jsonb,                 -- sections, rows and checks as read (accountant-only)
  created_by         text not null,
  created_by_name    text,
  created_at         timestamptz not null default now(),
  imports            jsonb not null default '[]'::jsonb,   -- [{ section_key, import_batch_id, at, by }]
  check (status <> 'refused' or length(trim(coalesce(refused_reason, ''))) > 0)
);
create index if not exists statement_reads_company_idx on public.statement_reads (company_id, created_at desc);
create index if not exists statement_reads_document_idx on public.statement_reads (source_document_id);

create or replace function public.statement_reads_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'statement reads are never deleted' using errcode = '42501';
  end if;
  if (to_jsonb(new) - 'imports') is distinct from (to_jsonb(old) - 'imports')
     or jsonb_typeof(new.imports) <> 'array'
     or not (new.imports @> old.imports)
     or jsonb_array_length(new.imports) < jsonb_array_length(old.imports) then
    raise exception 'a statement read does not change; imports made from it are only added' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.statement_reads_guard() from public, anon, authenticated;
drop trigger if exists statement_reads_guard on public.statement_reads;
create trigger statement_reads_guard before update or delete on public.statement_reads
  for each row execute function public.statement_reads_guard();

alter table public.statement_reads enable row level security;
drop policy if exists statement_reads_select on public.statement_reads;
create policy statement_reads_select on public.statement_reads for select to authenticated
  using (company_id in (select public.user_company_ids()) and coalesce(public.user_is_accountant(company_id), false));
revoke all on public.statement_reads from public, anon, authenticated, service_role;
grant select on public.statement_reads to authenticated;
grant select, insert, update on public.statement_reads to service_role;
