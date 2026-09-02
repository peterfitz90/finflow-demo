-- Grant service_role write access to tables used by Yapily ingest (server-side writes).
-- The anon key (frontend) can already write these tables.
-- The service_role key needs explicit GRANT on each table — default privileges don't
-- cover it automatically on tables created before the default was set.
-- Safe to re-run: GRANT is idempotent.

GRANT ALL ON public.journals            TO service_role;
GRANT ALL ON public.bank_transactions   TO service_role;
GRANT ALL ON public.bank_matches        TO service_role;
