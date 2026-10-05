-- Snapshot of 13 SECURITY DEFINER functions that existed only in the live database, with no repo
-- file. Each definition is pg_get_functiondef() output, copied unchanged on 2026-10-05, before the
-- harden_security_definer_grants migration. Kept as a record, not as a migration to re-run.
--
-- Changed since this snapshot (see supabase/harden_security_definer_grants.sql):
--   * log_vat_refile: now requires the accountant role.
--   * get_locked_periods, search_*, resolve_vat_filing_request, unfile_vat_return, log_vat_refile:
--     EXECUTE revoked from PUBLIC/anon, granted explicitly to authenticated + service_role.
-- Untouched infrastructure: enforce_period_lock, log_write_during_reopen (trigger functions),
--   user_company_ids, user_company_role, user_is_accountant.

-- ── enforce_period_lock (trigger) ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_period_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_col      text := TG_ARGV[0];
  v_new_date date;
  v_old_date date;
BEGIN
  v_new_date := (to_jsonb(NEW) ->> v_col)::date;

  IF v_new_date IS NOT NULL AND EXISTS (
    SELECT 1 FROM vat_returns
    WHERE company_id   = NEW.company_id
      AND status       = 'filed'
      AND period_start <= v_new_date
      AND period_end   >= v_new_date
  ) THEN
    RAISE EXCEPTION 'Period is locked — this date falls inside a filed VAT return';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_old_date := (to_jsonb(OLD) ->> v_col)::date;
    IF v_old_date IS NOT NULL AND EXISTS (
      SELECT 1 FROM vat_returns
      WHERE company_id   = OLD.company_id
        AND status       = 'filed'
        AND period_start <= v_old_date
        AND period_end   >= v_old_date
    ) THEN
      RAISE EXCEPTION 'Period is locked — this date falls inside a filed VAT return';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

-- ── get_locked_periods ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_locked_periods(p_company_id uuid)
 RETURNS TABLE(period_start date, period_end date, filed_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_company_id NOT IN (SELECT user_company_ids()) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT vr.period_start, vr.period_end, vr.filed_at
    FROM vat_returns vr
    WHERE vr.company_id = p_company_id AND vr.status = 'filed';
END;
$function$
;

-- ── log_vat_refile (as it was; superseded by harden_security_definer_grants.sql) ───────────────
CREATE OR REPLACE FUNCTION public.log_vat_refile(p_company_id uuid, p_period_val text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_return_id  uuid;
  v_superseded timestamptz;
BEGIN
  SELECT id, superseded_at INTO v_return_id, v_superseded
  FROM vat_returns
  WHERE company_id = p_company_id AND period_val = p_period_val;

  IF v_return_id IS NOT NULL AND v_superseded IS NOT NULL THEN
    INSERT INTO period_lock_events (company_id, vat_return_id, period_val, action, actor, reason)
    VALUES (p_company_id, v_return_id, p_period_val, 'refiled', (auth.jwt() ->> 'sub'), NULL);
  END IF;
END;
$function$
;

-- ── log_write_during_reopen (trigger) ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_write_during_reopen()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_col    text := TG_ARGV[0];
  v_date   date;
  v_return RECORD;
BEGIN
  v_date := (to_jsonb(NEW) ->> v_col)::date;
  IF v_date IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id, period_val INTO v_return
  FROM vat_returns
  WHERE company_id    = NEW.company_id
    AND status        = 'draft'
    AND superseded_at IS NOT NULL
    AND period_start  <= v_date
    AND period_end    >= v_date
  LIMIT 1;

  IF FOUND THEN
    INSERT INTO period_lock_events (company_id, vat_return_id, period_val, action, actor, affected_table, affected_row_id)
    VALUES (NEW.company_id, v_return.id, v_return.period_val, 'write_during_reopen', (auth.jwt() ->> 'sub'), TG_TABLE_NAME, NEW.id);
  END IF;

  RETURN NEW;
END;
$function$
;

-- ── resolve_vat_filing_request ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_vat_filing_request(p_company_id uuid, p_period_val text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  if not public.user_is_accountant(p_company_id) then
    raise exception 'Forbidden — accountant access required';
  end if;

  update public.vat_filing_requests
  set status = 'filed', resolved_at = now()
  where company_id = p_company_id
    and period_val = p_period_val
    and status = 'pending'
  returning id into v_id;

  return jsonb_build_object('ok', true, 'resolved_id', v_id);
end;
$function$
;

-- ── search_bank_transactions ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_bank_transactions(p_company_id uuid, p_query text)
 RETURNS TABLE(id uuid, date date, description text, amount numeric, bank_account_id uuid, bank_account_name text, reconciled boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_company_id NOT IN (SELECT user_company_ids()) THEN RETURN; END IF;
  IF p_query IS NULL OR btrim(p_query) = '' THEN RETURN; END IF;

  RETURN QUERY
    SELECT bt.id, bt.date, bt.description, bt.amount, bt.bank_account_id, ba.display_name, bt.reconciled
    FROM bank_transactions bt
    LEFT JOIN bank_accounts ba ON ba.id = bt.bank_account_id
    WHERE bt.company_id = p_company_id
      AND bt.search_text LIKE '%' || lower(btrim(p_query)) || '%'
    ORDER BY similarity(bt.search_text, lower(btrim(p_query))) DESC, bt.date DESC NULLS LAST
    LIMIT 5;
END;
$function$
;

-- ── search_customers ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_customers(p_company_id uuid, p_query text)
 RETURNS TABLE(id uuid, name text, email text, phone text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_company_id NOT IN (SELECT user_company_ids()) THEN RETURN; END IF;
  IF p_query IS NULL OR btrim(p_query) = '' THEN RETURN; END IF;

  RETURN QUERY
    SELECT c.id, c.name, c.email, c.phone
    FROM customers c
    WHERE c.company_id = p_company_id
      AND c.search_text LIKE '%' || lower(btrim(p_query)) || '%'
    ORDER BY similarity(c.search_text, lower(btrim(p_query))) DESC, c.name ASC
    LIMIT 5;
END;
$function$
;

-- ── search_invoices ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_invoices(p_company_id uuid, p_query text)
 RETURNS TABLE(id uuid, invoice_number text, invoice_ref text, client text, total numeric, status text, type text, invoice_date date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_company_id NOT IN (SELECT user_company_ids()) THEN RETURN; END IF;
  IF p_query IS NULL OR btrim(p_query) = '' THEN RETURN; END IF;

  RETURN QUERY
    SELECT i.id, i.invoice_number, i.invoice_ref, i.client, i.total, i.status, i.type, i.invoice_date
    FROM invoices i
    WHERE i.company_id = p_company_id
      AND i.search_text LIKE '%' || lower(btrim(p_query)) || '%'
    ORDER BY similarity(i.search_text, lower(btrim(p_query))) DESC, i.invoice_date DESC NULLS LAST
    LIMIT 5;
END;
$function$
;

-- ── search_journals ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_journals(p_company_id uuid, p_query text)
 RETURNS TABLE(id uuid, date date, description text, reference text, amount numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_company_id NOT IN (SELECT user_company_ids()) THEN RETURN; END IF;
  IF p_query IS NULL OR btrim(p_query) = '' THEN RETURN; END IF;

  RETURN QUERY
    SELECT j.id, j.date, j.description, j.reference, j.amount
    FROM journals j
    WHERE j.company_id = p_company_id
      AND j.search_text LIKE '%' || lower(btrim(p_query)) || '%'
    ORDER BY similarity(j.search_text, lower(btrim(p_query))) DESC, j.date DESC NULLS LAST
    LIMIT 5;
END;
$function$
;

-- ── unfile_vat_return ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.unfile_vat_return(p_company_id uuid, p_period_val text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_return_id uuid;
  v_status    text;
  v_now       timestamptz := now();
BEGIN
  IF NOT public.user_is_accountant(p_company_id) THEN
    RAISE EXCEPTION 'Forbidden — accountant access required';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required to unfile a period';
  END IF;

  SELECT id, status INTO v_return_id, v_status
  FROM vat_returns
  WHERE company_id = p_company_id AND period_val = p_period_val
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No filed return found for this period';
  END IF;
  IF v_status <> 'filed' THEN
    RAISE EXCEPTION 'Period is not currently filed — nothing to unfile';
  END IF;

  UPDATE vat_returns
  SET status = 'draft', superseded_at = v_now
  WHERE id = v_return_id;

  INSERT INTO period_lock_events (company_id, vat_return_id, period_val, action, actor, reason, occurred_at)
  VALUES (p_company_id, v_return_id, p_period_val, 'unfiled', (auth.jwt() ->> 'sub'), btrim(p_reason), v_now);

  RETURN jsonb_build_object('ok', true, 'superseded_at', v_now);
END;
$function$
;

-- ── user_company_ids (infrastructure) ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.user_company_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select id from public.companies where clerk_user_id = (auth.jwt() ->> 'sub')
  union
  select company_id from public.user_company_access where user_id = (auth.jwt() ->> 'sub')
$function$
;

-- ── user_company_role (infrastructure) ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.user_company_role(p_company_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when exists (
      select 1 from public.companies
      where id = p_company_id and clerk_user_id = (auth.jwt() ->> 'sub')
    ) then 'accountant'
    else (
      select role from public.user_company_access
      where company_id = p_company_id and user_id = (auth.jwt() ->> 'sub')
    )
  end;
$function$
;

-- ── user_is_accountant (infrastructure) ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.user_is_accountant(p_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.companies
    where id = p_company_id and clerk_user_id = (auth.jwt() ->> 'sub')
  ) or exists (
    select 1 from public.user_company_access
    where company_id = p_company_id
      and user_id = (auth.jwt() ->> 'sub')
      and role = 'accountant'
  );
$function$
;
