-- BNK-14 step 3b: a read is recorded when it starts ('reading') and updated as each chunk finishes,
-- so the accountant sees progress; once it ends (read, refused or failed) it never changes, except
-- that imports made from it are added.
alter table public.statement_reads drop constraint if exists statement_reads_status_check;
alter table public.statement_reads add constraint statement_reads_status_check check (status in ('reading', 'read', 'refused', 'failed'));
alter table public.statement_reads add column if not exists chunks_done integer not null default 0;

create or replace function public.statement_reads_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'statement reads are never deleted' using errcode = '42501';
  end if;
  -- while reading: progress and the outcome may be written, once
  if old.status = 'reading' then
    if new.id <> old.id or new.company_id <> old.company_id or new.source_document_id <> old.source_document_id
       or new.created_by <> old.created_by or new.created_at <> old.created_at or new.imports <> old.imports then
      raise exception 'a read in progress keeps its identity' using errcode = '42501';
    end if;
    return new;
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
