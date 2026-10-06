-- Follow-up to drop_header_company_isolation_policies.sql (2026-10-05): drop requesting_company_id(),
-- which returned the client-supplied x-company-id request header as a uuid. Its only users were the
-- four "Company isolation" policies dropped there. Checked before dropping: no policy (public or
-- storage), view, materialized view, function body, constraint, column default or pg_depend entry
-- references it, and nothing in src/, api/ or supabase/ calls it.
--
-- Definition as it stood:
--   CREATE OR REPLACE FUNCTION public.requesting_company_id() RETURNS uuid LANGUAGE sql STABLE AS
--   $$ select (current_setting('request.headers', true)::json->>'x-company-id')::uuid; $$;

drop function if exists public.requesting_company_id();
