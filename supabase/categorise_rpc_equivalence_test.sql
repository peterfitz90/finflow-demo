-- Rolled-back equivalence test of categorise_bank_line against the current app path.
-- Nothing persists: the final block raises its results, aborting the transaction.
-- Generated from fx_guard_db.sql; keep the two in step.
BEGIN;

-- GEO-02 interim, defence in depth: the database itself refuses to post, reconcile or match a
-- foreign-currency bank line as euro, whatever the client does. The app already blocks every
-- path (src/shared/fxGuard.js); these triggers catch a path that is missed or added later.
-- Also: categorise_bank_line, the Categorise action as one atomic RPC.
--
-- A bank line is foreign when its currency is set and is not EUR. A line from a euro-printed
-- section is stored with currency 'EUR' and original_currency set (fx_guard_geo02.sql), so it
-- is euro here and passes. Existing rows are not touched: only a new insert, a line becoming
-- reconciled, a match becoming confirmed or a new journal is checked.
--
--  1. bank_transactions: a foreign line cannot be inserted already reconciled (the import posts
--     a journal for every line it inserts reconciled), cannot become reconciled (Categorise,
--     transfer release, Settle, confirm_journal_match all set reconciled), and cannot have its
--     currency changed to EUR unless it records its original currency (the euro-printed shape).
--  2. bank_matches: a match on a foreign line cannot be confirmed.
--  3. journals: a journal whose reference is a foreign line's revolut_id (the import and the
--     transfer release both use it) cannot be inserted.
--
-- The guards run as the caller (SECURITY INVOKER) and look only in the row's own company
-- (NEW.company_id), so a caller sees only lines their row-level security lets them see. A
-- caller writing into a company they have no access to gets the table's ordinary RLS or
-- permission error, never the guard's message: the guard tells no one anything about another
-- company's lines. The currency test is written out in each function, so they need no helper
-- and no grant.

CREATE OR REPLACE FUNCTION public.fx_guard_bank_line()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  -- A signed-in or anonymous caller with no access to the row's company gets the table's own
  -- RLS refusal, not this guard's message (BEFORE triggers run before RLS checks the new row).
  -- Server roles (the feed's service role) are not subject to RLS and are always guarded.
  IF current_user IN ('anon', 'authenticated')
     AND NOT (NEW.company_id IN (SELECT public.user_company_ids())) THEN
    RETURN NEW;
  END IF;
  IF NEW.currency IS NOT NULL AND NEW.currency <> '' AND upper(NEW.currency) <> 'EUR' THEN
    IF TG_OP = 'INSERT' AND NEW.reconciled THEN
      RAISE EXCEPTION 'Foreign-currency lines can''t be posted yet; multi-currency posting is planned.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.reconciled AND NOT coalesce(OLD.reconciled, false) THEN
      RAISE EXCEPTION 'Foreign-currency lines can''t be settled against an invoice or bill yet; multi-currency posting is planned.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.currency IS NOT NULL AND OLD.currency <> '' AND upper(OLD.currency) <> 'EUR'
     AND (NEW.currency IS NULL OR NEW.currency = '' OR upper(NEW.currency) = 'EUR')
     AND NEW.original_currency IS NULL THEN
    RAISE EXCEPTION 'A foreign-currency line''s currency can''t be changed to EUR.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fx_guard_bank_match()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'confirmed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'confirmed')
     AND EXISTS (SELECT 1 FROM public.bank_transactions b
                 WHERE b.id = NEW.bank_transaction_id AND b.company_id = NEW.company_id
                   AND b.currency IS NOT NULL AND b.currency <> '' AND upper(b.currency) <> 'EUR') THEN
    RAISE EXCEPTION 'Foreign-currency lines can''t be matched yet; multi-currency posting is planned.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fx_guard_journal()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF NEW.reference IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.bank_transactions b
       WHERE b.company_id = NEW.company_id AND b.revolut_id = NEW.reference
         AND b.currency IS NOT NULL AND b.currency <> '' AND upper(b.currency) <> 'EUR') THEN
    RAISE EXCEPTION 'Foreign-currency lines can''t be posted yet; multi-currency posting is planned.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- trigger functions are not callable as RPCs; no role needs execute on them
REVOKE EXECUTE ON FUNCTION public.fx_guard_bank_line()  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.fx_guard_bank_match() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.fx_guard_journal()    FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS bank_transactions_fx_guard ON public.bank_transactions;
CREATE TRIGGER bank_transactions_fx_guard BEFORE INSERT OR UPDATE ON public.bank_transactions
  FOR EACH ROW EXECUTE FUNCTION public.fx_guard_bank_line();

DROP TRIGGER IF EXISTS bank_matches_fx_guard ON public.bank_matches;
CREATE TRIGGER bank_matches_fx_guard BEFORE INSERT OR UPDATE ON public.bank_matches
  FOR EACH ROW EXECUTE FUNCTION public.fx_guard_bank_match();

DROP TRIGGER IF EXISTS journals_fx_guard ON public.journals;
CREATE TRIGGER journals_fx_guard BEFORE INSERT ON public.journals
  FOR EACH ROW EXECUTE FUNCTION public.fx_guard_journal();

-- ── categorise_bank_line: Reconciliation's Categorise in one transaction ─────────────────
-- Was three separate client writes (journal, then match, then reconcile), so a failure after
-- the first left a journal with no line. Same rows as that path, written together or not at
-- all: the journal exactly as the form gives it (no VAT code, as before), a confirmed 'user'
-- match at 100 with suggestion_kept false, and the line reconciled with settlement_type
-- 'categorise'; confirmed_at and reconciled_at are the same instant. SECURITY INVOKER: the
-- caller's row-level security applies to every read and write. Refuses a foreign line, a line
-- already reconciled (the old path would have posted a second journal) and an unknown line.
-- A date inside a filed VAT return is refused by the journals period lock, with its own message.
CREATE OR REPLACE FUNCTION public.categorise_bank_line(
  p_company_id uuid, p_bt_id uuid, p_date date, p_description text,
  p_debit_account text, p_credit_account text, p_amount numeric, p_reference text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_bt  record;
  v_jnl uuid;
  v_now timestamptz := now();
BEGIN
  SELECT id, currency, reconciled INTO v_bt
  FROM public.bank_transactions WHERE id = p_bt_id AND company_id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transaction not found'; END IF;
  IF v_bt.currency IS NOT NULL AND v_bt.currency <> '' AND upper(v_bt.currency) <> 'EUR' THEN
    RAISE EXCEPTION 'Foreign-currency lines can''t be settled against an invoice or bill yet; multi-currency posting is planned.';
  END IF;
  IF v_bt.reconciled THEN RAISE EXCEPTION 'This transaction is already reconciled'; END IF;

  INSERT INTO public.journals (company_id, date, description, debit_account, credit_account, amount, reference)
  VALUES (p_company_id, p_date, p_description, p_debit_account, p_credit_account, p_amount, p_reference)
  RETURNING id INTO v_jnl;

  INSERT INTO public.bank_matches (company_id, bank_transaction_id, matched_type, matched_id,
    confidence, status, matched_by, confirmed_at, suggestion_kept)
  VALUES (p_company_id, p_bt_id, 'journal', v_jnl, 100, 'confirmed', 'user', v_now, false);

  UPDATE public.bank_transactions
  SET reconciled = true, reconciled_at = v_now, settlement_type = 'categorise'
  WHERE id = p_bt_id AND company_id = p_company_id;

  RETURN jsonb_build_object('ok', true, 'journal_id', v_jnl);
END $$;

REVOKE EXECUTE ON FUNCTION public.categorise_bank_line(uuid, uuid, date, text, text, text, numeric, text) FROM PUBLIC, anon, service_role;
GRANT  EXECUTE ON FUNCTION public.categorise_bank_line(uuid, uuid, date, text, text, text, numeric, text) TO authenticated;

-- ── Categorise RPC equivalence (rolled back) ─────────────────────────────────────────────
-- Each case runs twice on the same line: the current app path (the three client writes of
-- Reconciliation saveJnl, as the signed-in accountant) and categorise_bank_line, each in its
-- own savepoint, rolled back after its rows are read. The journal, its VAT code, the match and
-- the line are compared with zero tolerance (ids and timestamps aside; the match's
-- confirmed_at must equal the line's reconciled_at in both). Lines are unreconciled copies of
-- real lines (no real line is unreconciled today); the "already reconciled" case uses a real
-- line itself. Everything is undone: the block ends by raising its results.
CREATE FUNCTION pg_temp.eq_run(mode text, c uuid, bt uuid, d date, descr text, dr text, cr text, amt numeric, ref text, sub text)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE j uuid; v_now timestamptz := clock_timestamp(); out jsonb; r jsonb;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', sub, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    IF mode = 'app' THEN
      INSERT INTO journals(company_id, date, description, debit_account, credit_account, amount, reference)
      VALUES (c, d, descr, dr, cr, amt, ref) RETURNING id INTO j;
      INSERT INTO bank_matches(company_id, bank_transaction_id, matched_type, matched_id, confidence, status, matched_by, confirmed_at, suggestion_kept)
      VALUES (c, bt, 'journal', j, 100, 'confirmed', 'user', v_now, false);
      UPDATE bank_transactions SET reconciled = true, reconciled_at = v_now, settlement_type = 'categorise' WHERE id = bt;
    ELSE
      r := categorise_bank_line(c, bt, d, descr, dr, cr, amt, ref);
      j := (r->>'journal_id')::uuid;
    END IF;
    SELECT jsonb_build_object(
      'journal', (SELECT to_jsonb(x) - 'id' - 'created_at' FROM journals x WHERE x.id = j),
      'match',   (SELECT to_jsonb(m) - 'id' - 'matched_id' - 'created_at' - 'confirmed_at' FROM bank_matches m WHERE m.matched_id = j),
      'line',    (SELECT jsonb_build_object('reconciled', b.reconciled, 'settlement_type', b.settlement_type,
                    'reconciled_at_is_confirmed_at', b.reconciled_at = (SELECT m.confirmed_at FROM bank_matches m WHERE m.matched_id = j))
                  FROM bank_transactions b WHERE b.id = bt),
      'matches_on_line', (SELECT count(*) FROM bank_matches m WHERE m.bank_transaction_id = bt AND m.status = 'confirmed'))
    INTO out;
    RAISE EXCEPTION 'RESULT:%', out::text;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'RESULT:%' THEN RETURN substr(SQLERRM, 8)::jsonb; END IF;
    RETURN jsonb_build_object('error', SQLERRM);
  END;
END $f$;

DO $eq$
DECLARE
  fz uuid := '5f4e4585-8937-4624-b0fc-079a8379a160';   -- Fitzsimons Test
  el uuid := 'e1599dfc-9988-4d10-aeef-33de252b9c02';   -- Elevate (VAT-coded chart: 6600 = STD23)
  r jsonb := '[]'::jsonb; k record; a jsonb; b jsonb; src uuid; tgt uuid;
BEGIN
  INSERT INTO user_company_access(user_id, company_id, role) VALUES ('fxtest_accountant', fz, 'accountant'), ('fxtest_accountant', el, 'accountant');
  FOR k IN SELECT * FROM (VALUES
    -- name, source line, copy?, form date (null = line date), debit, credit (null = app prefill), reference
    ('out: coffee',            'ca59361e-ffbb-4f84-8f0d-bfb9337e0523'::uuid, true,  NULL::date, NULL, NULL, 'REC-EQ001'),
    ('out: electricity',       '690fcd19-05f7-406b-9935-8d24fe7ae550'::uuid, true,  NULL,       NULL, NULL, 'REC-EQ002'),
    ('out: rent',              '283e241a-8d63-433e-a9ac-717c7ba798d0'::uuid, true,  NULL,       NULL, NULL, 'REC-EQ003'),
    ('in: customer A',         '95eab836-9e0c-4559-a7f1-44f5e87bb079'::uuid, true,  NULL,       NULL, NULL, 'REC-EQ004'),
    ('in: customer B',         '1e705a50-2510-4df0-b4a1-c2a28e99b110'::uuid, true,  NULL,       NULL, NULL, 'REC-EQ005'),
    ('VAT-coded account (Elevate 6600 STD23)', '6e7fc2de-70bd-445a-a784-2d3ee19cccf9'::uuid, true, NULL, '6600', '1000', 'REC-EQ006'),
    ('user re-codes to 7100',  'dc881d67-d995-466b-b97c-f766ac9b1d15'::uuid, true,  NULL,       '7100', '1000', 'REC-EQ007'),
    ('date in filed VAT period (Mar-Apr 2026)', 'dc2c2848-55ce-4d68-b503-b54f220dcbe8'::uuid, true, '2026-04-15'::date, NULL, NULL, 'REC-EQ008'),
    ('already reconciled (real line)', '5929e2ff-f7da-402d-a5ee-6d0308ef2a26'::uuid, false, NULL,  NULL, NULL, 'REC-EQ009')
  ) v(name, src, copy, fdate, dr, cr, ref) LOOP
    IF k.copy THEN
      tgt := gen_random_uuid();
      INSERT INTO bank_transactions(id, company_id, revolut_id, date, description, amount, currency, balance, type, reference,
        nominal_account, bank_account_id, bank_format, import_batch_id, reconciled, reconciled_at, settlement_type, hold_reason)
      SELECT tgt, company_id, revolut_id || '-EQ', date, description, amount, currency, balance, type, reference,
        nominal_account, bank_account_id, bank_format, NULL, false, NULL, NULL, NULL
      FROM bank_transactions WHERE id = k.src;
    ELSE
      tgt := k.src;
    END IF;
    DECLARE t record; bank text; c uuid; d date; dr text; cr text;
    BEGIN
      SELECT * INTO t FROM bank_transactions WHERE id = tgt;
      c := t.company_id;
      bank := coalesce((SELECT nominal_code FROM bank_accounts WHERE id = t.bank_account_id), '1000');
      d := coalesce(k.fdate, t.date);
      dr := coalesce(k.dr, CASE WHEN t.amount < 0 THEN '6600' ELSE bank END);
      cr := coalesce(k.cr, CASE WHEN t.amount < 0 THEN bank ELSE '4000' END);
      a := pg_temp.eq_run('app', c, tgt, d, coalesce(t.description, ''), dr, cr, round(abs(t.amount), 2), k.ref, 'fxtest_accountant');
      b := pg_temp.eq_run('rpc', c, tgt, d, coalesce(t.description, ''), dr, cr, round(abs(t.amount), 2), k.ref, 'fxtest_accountant');
      r := r || jsonb_build_object('case', k.name, 'identical', a = b,
        'app', CASE WHEN a = b THEN jsonb_build_object('vat_code', a #> '{journal,vat_code}', 'dr', dr, 'cr', cr, 'amount', a #> '{journal,amount}', 'error', a->'error') ELSE a END,
        'rpc', CASE WHEN a = b THEN NULL ELSE b END);
    END;
  END LOOP;
  RAISE EXCEPTION 'ROLLED BACK. equivalence=%', jsonb_pretty(r);
END $eq$;

ROLLBACK;
