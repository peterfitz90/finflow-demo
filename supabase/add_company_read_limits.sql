-- BNK-14: optional per-company limits on statement reads by the model (Peter, 10 Oct 2026). Without
-- a row the defaults apply (40 reads or US$5 a day, api/_read-cap.js). Server-only: no client can
-- read or write it; Peter sets a company's limits directly, for example:
--   insert into public.company_read_limits (company_id, max_reads_per_day, max_usd_per_day, note, set_by)
--   values ('<company id>', 100, 15, 'year-end catch-up', 'Peter')
--   on conflict (company_id) do update set max_reads_per_day = excluded.max_reads_per_day,
--     max_usd_per_day = excluded.max_usd_per_day, note = excluded.note, set_by = excluded.set_by, set_at = now();
create table if not exists public.company_read_limits (
  company_id        uuid primary key references public.companies(id) on delete cascade,
  max_reads_per_day integer check (max_reads_per_day is null or max_reads_per_day > 0),
  max_usd_per_day   numeric(10, 2) check (max_usd_per_day is null or max_usd_per_day > 0),
  note              text,
  set_by            text,
  set_at            timestamptz not null default now()
);
alter table public.company_read_limits enable row level security;
revoke all on public.company_read_limits from public, anon, authenticated, service_role;
grant select on public.company_read_limits to service_role;
