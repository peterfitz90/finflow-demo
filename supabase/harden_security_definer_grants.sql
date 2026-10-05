-- Security-definer sweep fixes (2026-10-05). SECURITY DEFINER functions run as their owner and so
-- bypass RLS; before this, most had default PUBLIC execute, so anyone (even without a login) could
-- call them, and the access check inside each function was the only guard.
--
-- 1. log_vat_refile had no access check at all: anyone, even anon, could append a 'refiled' row
--    to any company's period_lock_events (verified in a rolled-back test). It now requires the
--    accountant role, like unfile_vat_return. Its only caller is markFiled (src/App.jsx), which
--    runs after the vat_returns upsert succeeds, and RLS allows that upsert to accountants only.
-- 2. EXECUTE moves from PUBLIC/anon to explicit grants for authenticated and service_role on the
--    guarded functions, so the only rights removed are PUBLIC's and anon's. (Each still checks
--    membership or the accountant role inside.) None is called from api/; all are called
--    signed-in from the app.
-- 3. compute_automation_rollup gets a fixed search_path (it was the only SECURITY DEFINER function
--    in public without one).
-- 4. New functions created by postgres no longer get PUBLIC execute by default. Every new function
--    therefore needs an explicit GRANT EXECUTE to authenticated (and service_role if server code
--    calls it). A missing grant fails loudly ("permission denied for function") the first time
--    the app calls it, so test every new function as anon and as authenticated.
--
-- Untouched on purpose: user_company_ids, user_company_role, user_is_accountant (RLS policies call
-- them, so every role that reads tables needs them), enforce_period_lock and the other trigger
-- functions (Postgres refuses direct calls to trigger functions).

-- 1. log_vat_refile: accountant only
create or replace function public.log_vat_refile(p_company_id uuid, p_period_val text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_return_id  uuid;
  v_superseded timestamptz;
begin
  if not public.user_is_accountant(p_company_id) then
    raise exception 'Forbidden — accountant access required';
  end if;

  select id, superseded_at into v_return_id, v_superseded
  from vat_returns
  where company_id = p_company_id and period_val = p_period_val;

  if v_return_id is not null and v_superseded is not null then
    insert into period_lock_events (company_id, vat_return_id, period_val, action, actor, reason)
    values (p_company_id, v_return_id, p_period_val, 'refiled', (auth.jwt() ->> 'sub'), null);
  end if;
end;
$$;

-- 2. EXECUTE: PUBLIC/anon out, authenticated + service_role in explicitly
revoke execute on function public.log_vat_refile(uuid, text)                                  from public, anon;
revoke execute on function public.get_locked_periods(uuid)                                    from public, anon;
revoke execute on function public.search_invoices(uuid, text)                                 from public, anon;
revoke execute on function public.search_journals(uuid, text)                                 from public, anon;
revoke execute on function public.search_bank_transactions(uuid, text)                        from public, anon;
revoke execute on function public.search_customers(uuid, text)                                from public, anon;
revoke execute on function public.request_vat_filing(uuid, text, date, date, jsonb)           from public, anon;
revoke execute on function public.resolve_vat_filing_request(uuid, text)                      from public, anon;
revoke execute on function public.unfile_vat_return(uuid, text, text)                         from public, anon;

grant execute on function public.log_vat_refile(uuid, text)                                   to authenticated, service_role;
grant execute on function public.get_locked_periods(uuid)                                     to authenticated, service_role;
grant execute on function public.search_invoices(uuid, text)                                  to authenticated, service_role;
grant execute on function public.search_journals(uuid, text)                                  to authenticated, service_role;
grant execute on function public.search_bank_transactions(uuid, text)                         to authenticated, service_role;
grant execute on function public.search_customers(uuid, text)                                 to authenticated, service_role;
grant execute on function public.request_vat_filing(uuid, text, date, date, jsonb)            to authenticated, service_role;
grant execute on function public.resolve_vat_filing_request(uuid, text)                       to authenticated, service_role;
grant execute on function public.unfile_vat_return(uuid, text, text)                          to authenticated, service_role;

-- 3. Fixed search_path
alter function public.compute_automation_rollup(integer) set search_path = public;

-- 4. New functions created by postgres: no PUBLIC execute by default
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
