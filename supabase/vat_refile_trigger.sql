-- Re-file audit written atomically with the VAT return save (Peter, 7 Oct 2026).
--
-- Before: the app saved vat_returns, then called log_vat_refile as a separate, best-effort RPC;
-- if that second call failed (an expired session, a network drop) the 'refiled' event was lost
-- with only a console warning. Now a trigger on vat_returns writes it in the same transaction as
-- the save: when a return that was unfiled (superseded_at set) goes back to status 'filed'.
--
-- vat_returns writes are already accountant-only (RLS), so the trigger only fires for an
-- accountant's save. The trigger function is SECURITY DEFINER because period_lock_events has no
-- client insert policy; it is a trigger function, so it cannot be called directly.
--
-- log_vat_refile stays (open browser tabs on the old code still call it) but no longer writes a
-- second event when the trigger already has: it only inserts if no 'refiled' event exists for
-- this return since it was last unfiled.

create or replace function public.vat_returns_log_refile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'filed' and old.status is distinct from 'filed' and new.superseded_at is not null then
    insert into public.period_lock_events (company_id, vat_return_id, period_val, action, actor, reason)
    values (new.company_id, new.id, new.period_val, 'refiled', auth.jwt() ->> 'sub', null);
  end if;
  return null;
end;
$$;
revoke execute on function public.vat_returns_log_refile() from public, anon;
grant  execute on function public.vat_returns_log_refile() to authenticated;

drop trigger if exists vat_returns_log_refile on public.vat_returns;
create trigger vat_returns_log_refile after update on public.vat_returns
  for each row execute function public.vat_returns_log_refile();

create or replace function public.log_vat_refile(p_company_id uuid, p_period_val text)
returns void language plpgsql security definer set search_path to 'public' as $function$
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

  -- The vat_returns trigger normally records this already; only fill a gap.
  if v_return_id is not null and v_superseded is not null
     and not exists (select 1 from period_lock_events e
                     where e.vat_return_id = v_return_id and e.action = 'refiled' and e.occurred_at >= v_superseded) then
    insert into period_lock_events (company_id, vat_return_id, period_val, action, actor, reason)
    values (p_company_id, v_return_id, p_period_val, 'refiled', (auth.jwt() ->> 'sub'), null);
  end if;
end;
$function$;
revoke execute on function public.log_vat_refile(uuid, text) from public, anon;
grant  execute on function public.log_vat_refile(uuid, text) to authenticated;
