-- period_signoff_status() runs as its owner (SECURITY DEFINER), so RLS on period_signoff_events
-- doesn't apply inside it. Before this fix it had no membership check and default PUBLIC execute:
-- anyone, even without a login, could pass any company id and learn whether a period was signed
-- off or withdrawn.
--
-- Now, like get_locked_periods() and search_*(): a company the caller can't access returns nothing
-- (NULL), not an error. The check treats an unknown result (a NULL id) as no access, so a NULL in
-- either side of IN can't let the call through. Execute is revoked from PUBLIC/anon, so a call with
-- no login is refused outright.
--
-- Callers: sign_off_period() and withdraw_signoff() only (both run as the owner after their own
-- accountant check, and an accountant is always a member). The app doesn't call this function;
-- the Month End panel and the GL / Financial Statements badges read period_signoff_events
-- directly under RLS (src/shared/periodSignoff.js).

create or replace function public.period_signoff_status(p_company_id uuid, p_start date, p_end date)
returns text language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not coalesce(p_company_id in (select public.user_company_ids()), false) then
    return null;
  end if;
  return (
    select action from public.period_signoff_events
    where company_id = p_company_id and period_start = p_start and period_end = p_end
      and action in ('signed_off', 'withdrawn')
    order by occurred_at desc, id desc limit 1
  );
end;
$$;

revoke execute on function public.period_signoff_status(uuid, date, date) from public, anon;
grant execute on function public.period_signoff_status(uuid, date, date) to authenticated;
