-- Lock companies.clerk_org_id: server-written only, one company per org.
-- Apply AFTER the app build where /api/create-org writes clerk_org_id server-side and the
-- client no longer does (else the old client's own update would be rejected).
--
-- clerk_org_id is the binding that /api/invite-user, /api/invite-business-owner and the Clerk
-- webhook (organizationMembership.created → user_company_access) trust to map an org to a
-- company. It was unique-less and client-writable (accountants can UPDATE their company; any
-- user can INSERT a company), so a user could point their OWN company at a client's org,
-- invite themselves into it, point it back before accepting, and be granted accountant
-- access to the client company by the webhook.

-- 1. One company per org (0 duplicates at time of writing).
CREATE UNIQUE INDEX IF NOT EXISTS companies_clerk_org_id_key
  ON public.companies (clerk_org_id) WHERE clerk_org_id IS NOT NULL;

-- 2. Only server-side code (service_role) may set or change it; API clients (authenticated /
--    anon) may not. current_user is the role PostgREST switched to for the request.
CREATE OR REPLACE FUNCTION public.enforce_clerk_org_id_server_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' AND NEW.clerk_org_id IS NOT NULL THEN
      RAISE EXCEPTION 'clerk_org_id can only be set by the server (use /api/create-org)' USING ERRCODE = '42501';
    ELSIF TG_OP = 'UPDATE' AND NEW.clerk_org_id IS DISTINCT FROM OLD.clerk_org_id THEN
      RAISE EXCEPTION 'clerk_org_id can only be set by the server (use /api/create-org)' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS companies_clerk_org_id_server_only ON public.companies;
CREATE TRIGGER companies_clerk_org_id_server_only
  BEFORE INSERT OR UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.enforce_clerk_org_id_server_only();

REVOKE ALL ON FUNCTION public.enforce_clerk_org_id_server_only() FROM PUBLIC, anon, authenticated;
