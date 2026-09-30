-- request_vat_filing: stop treating 'pending' AP bills as a filing blocker.
--
-- The desktop VAT3 screen (src/shared/vat3.js, fetchVat3PeriodData / vat3Blockers) blocks only
-- on bills still 'needs_review' — those aren't journalled yet, so T1–T4 don't reflect them.
-- A 'pending' bill has already been approved: approve_ap_bill and the manual bill form both post
-- its accrual journal (Dr expense / Cr 2000, dated the invoice date, with its VAT code), so it is
-- already counted in T2 for its period. (The only other source of 'pending' is migrated opening
-- balances, whose VAT belongs to returns before migration.) This function counted both, so a
-- business_owner could see Request Filing enabled and then be refused by the server.
--
-- Only the v_pending_bills filter changes; everything else is the live definition verbatim.
create or replace function public.request_vat_filing(p_company_id uuid, p_period_val text, p_period_start date, p_period_end date, p_figures jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_role            text;
  v_pending_bills   int;
  v_unreconciled_bt int;
  v_hard_block      int;
  v_is_filed        boolean;
  v_vat_control     numeric;
  v_t3              numeric;
  v_t4              numeric;
  v_delta           numeric;
  v_id              uuid;
  v_now             timestamptz := now();
begin
  v_role := public.user_company_role(p_company_id);
  if v_role is null or v_role not in ('business_owner', 'accountant') then
    raise exception 'Forbidden — no access to this company';
  end if;

  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'Invalid period range';
  end if;

  if p_figures is null then
    raise exception 'Figures snapshot is required';
  end if;

  select exists (
    select 1 from public.vat_returns
    where company_id = p_company_id and period_val = p_period_val and status = 'filed'
  ) into v_is_filed;
  if v_is_filed then
    raise exception 'This period is already filed';
  end if;

  -- Bills awaiting review only — same as the desktop VAT3 blocker (see header).
  select count(*) into v_pending_bills
  from public.ap_invoices
  where company_id = p_company_id
    and status = 'needs_review'
    and invoice_date >= p_period_start and invoice_date <= p_period_end;

  select count(*) into v_unreconciled_bt
  from public.bank_transactions
  where company_id = p_company_id
    and reconciled = false
    and date >= p_period_start and date <= p_period_end;

  v_hard_block := coalesce(v_pending_bills, 0) + coalesce(v_unreconciled_bt, 0);
  if v_hard_block > 0 then
    raise exception 'Cannot request filing — % item(s) blocking (AP review / bank reconciliation)', v_hard_block;
  end if;

  select coalesce(
           sum(case when debit_account = '2100' then amount else 0 end)
         - sum(case when credit_account = '2100' then amount else 0 end),
         0)
    into v_vat_control
  from public.journals
  where company_id = p_company_id
    and date <= p_period_end
    and (debit_account = '2100' or credit_account = '2100');

  v_t3 := coalesce((p_figures -> 'final' ->> 't3')::numeric, 0);
  v_t4 := coalesce((p_figures -> 'final' ->> 't4')::numeric, 0);
  v_delta := v_vat_control - (v_t3 - v_t4);

  insert into public.vat_filing_requests (
    company_id, period_val, period_start, period_end, figures,
    vat_control_balance, vat_control_delta, requested_by, requested_at, status
  ) values (
    p_company_id, p_period_val, p_period_start, p_period_end, p_figures,
    v_vat_control, v_delta, (auth.jwt() ->> 'sub'), v_now, 'pending'
  )
  on conflict (company_id, period_val) where status = 'pending'
  do update set
    figures              = excluded.figures,
    vat_control_balance  = excluded.vat_control_balance,
    vat_control_delta    = excluded.vat_control_delta,
    requested_by         = excluded.requested_by,
    requested_at         = excluded.requested_at,
    period_start         = excluded.period_start,
    period_end           = excluded.period_end
  returning id into v_id;

  return jsonb_build_object(
    'ok', true, 'id', v_id,
    'vat_control_balance', v_vat_control,
    'vat_control_delta', v_delta,
    'requested_at', v_now
  );
end;
$function$;
