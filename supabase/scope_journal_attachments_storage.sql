-- CRITICAL FIX (2026-10-05): the journal-attachments bucket was open to anyone holding the public
-- anon key. Three policies granted anon SELECT / INSERT / DELETE on storage.objects conditioned only
-- on the bucket name, so anyone could list, download, upload and delete every company's files (at
-- the time: 19 Heros Gym supplier bills under ap/<company>/). The bucket itself is private
-- (public = false); these policies overrode that.
--
-- Exact definitions as they stood before this migration (from pg_policies):
--
--   CREATE POLICY "anon can read journal attachments" ON storage.objects
--     AS PERMISSIVE FOR SELECT TO anon
--     USING (bucket_id = 'journal-attachments'::text);
--
--   CREATE POLICY "anon can upload journal attachments" ON storage.objects
--     AS PERMISSIVE FOR INSERT TO anon
--     WITH CHECK (bucket_id = 'journal-attachments'::text);
--
--   CREATE POLICY "anon can delete journal attachments" ON storage.objects
--     AS PERMISSIVE FOR DELETE TO anon
--     USING (bucket_id = 'journal-attachments'::text);
--
-- Replacement: signed-in users only, and only for files whose path names one of their companies.
-- The app writes three layouts, each carrying the company id:
--   <company>/<journal>/<file>     journal attachments (src/App.jsx, attachments panel)
--   ap/<company>/<file>            supplier bills from inbound email (api/inbound-email.js, service role)
--   logos/<company>.<ext>          invoice logos (src/App.jsx uploadLogo, upsert)
-- service_role (inbound email, server functions) bypasses RLS and is unaffected.

-- Company id from a journal-attachments object name, or NULL when the name matches none of the
-- layouts. Regex-guarded, so a malformed name yields NULL (access denied), never a cast error.
create or replace function public.storage_path_company_id(p_name text)
returns uuid language sql immutable set search_path to 'public' as $$
  select case
    when p_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+/[^/]+$'
      then substring(p_name from '^([0-9a-fA-F-]{36})/')::uuid
    when p_name ~* '^ap/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
      then substring(p_name from '^ap/([0-9a-fA-F-]{36})/')::uuid
    when p_name ~* '^logos/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,5}$'
      then substring(p_name from '^logos/([0-9a-fA-F-]{36})\.')::uuid
    else null
  end;
$$;
revoke execute on function public.storage_path_company_id(text) from public, anon;
grant execute on function public.storage_path_company_id(text) to authenticated, service_role;

drop policy if exists "anon can read journal attachments"   on storage.objects;
drop policy if exists "anon can upload journal attachments" on storage.objects;
drop policy if exists "anon can delete journal attachments" on storage.objects;

create policy "members read company attachments" on storage.objects
  for select to authenticated
  using (bucket_id = 'journal-attachments'
         and coalesce(public.storage_path_company_id(name) in (select public.user_company_ids()), false));

create policy "members upload company attachments" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'journal-attachments'
              and coalesce(public.storage_path_company_id(name) in (select public.user_company_ids()), false));

-- Logo upload uses upsert, which needs UPDATE (plus SELECT) on an existing object.
create policy "members replace company attachments" on storage.objects
  for update to authenticated
  using (bucket_id = 'journal-attachments'
         and coalesce(public.storage_path_company_id(name) in (select public.user_company_ids()), false))
  with check (bucket_id = 'journal-attachments'
              and coalesce(public.storage_path_company_id(name) in (select public.user_company_ids()), false));

create policy "members delete company attachments" on storage.objects
  for delete to authenticated
  using (bucket_id = 'journal-attachments'
         and coalesce(public.storage_path_company_id(name) in (select public.user_company_ids()), false));
