-- Rolled-back test of supabase/fx_guard_db.sql (guard + categorise_bank_line) against the live
-- schema. Nothing persists: the test block ends by raising its results, which aborts the whole
-- transaction (the guard's DDL included). The error's first line reads "N failure(s)".
-- Generated from fx_guard_db.sql by the session's generator; keep the two in step.
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

-- ── Role tests (same transaction as the guard above; all undone) ──────────────────────────
-- Fixtures: an unreconciled GBP and EUR line on Fitzsimons Test (TEST company); test users with
-- access there as accountant and business owner, and an accountant of S&P (another company).
-- Each case has an expected result per role (a pattern), and "pass" compares. For another
-- company's user and anon, every case aimed at Fitzsimons must give an RLS or permission error
-- (or touch 0 rows), never the guard's message; that is counted as a failure on its own too.
-- Cases 12 and 13 use the caller's own company (S&P) with Fitzsimons' line as the reference.
-- The block ends by raising its results, which aborts and rolls back the whole transaction,
-- the guard's DDL included.
DO $fx$
DECLARE
  c   uuid := '5f4e4585-8937-4624-b0fc-079a8379a160';
  oc  uuid := '1d4bf5bd-3f2f-4919-b972-b00b2b9cac99';
  r jsonb := '[]'::jsonb; msg text; who record; t record; n bigint; exp text; fails int := 0;
BEGIN
  INSERT INTO user_company_access(user_id, company_id, role) VALUES
    ('fxtest_accountant', c, 'accountant'), ('fxtest_owner', c, 'business_owner'), ('fxtest_other', oc, 'accountant');
  INSERT INTO bank_transactions(id, company_id, revolut_id, date, description, amount, currency, reconciled)
  VALUES ('00000000-0000-0000-0000-0000000f0101', c, 'FXT-GBP', current_date, 'fx guard GBP line', -12.50, 'GBP', false),
         ('00000000-0000-0000-0000-0000000f0102', c, 'FXT-EUR', current_date, 'fx guard EUR line', -12.50, 'EUR', false);

  FOR who IN SELECT * FROM (VALUES ('accountant','authenticated','fxtest_accountant'), ('business_owner','authenticated','fxtest_owner'),
                                   ('other_company','authenticated','fxtest_other'), ('anon','anon',NULL)) v(label, role, sub) LOOP
    FOR t IN SELECT * FROM (VALUES
      ('01 insert GBP line, reconciled (import posting)', $q$INSERT INTO bank_transactions(company_id, revolut_id, date, description, amount, currency, reconciled) VALUES ('5f4e4585-8937-4624-b0fc-079a8379a160','FXT-NEW-GBP',current_date,'x',-5,'GBP',true)$q$, 'can''t be posted yet', 'row-level security', 'row-level security'),
      ('02 insert GBP line, unreconciled (reference only)', $q$INSERT INTO bank_transactions(company_id, revolut_id, date, description, amount, currency, reconciled) VALUES ('5f4e4585-8937-4624-b0fc-079a8379a160','FXT-NEW-GBP2',current_date,'x',-5,'GBP',false)$q$, '^ok, 1 row', 'row-level security', 'row-level security'),
      ('03 reconcile the GBP line (Categorise / transfer)', $q$UPDATE bank_transactions SET reconciled = true WHERE id = '00000000-0000-0000-0000-0000000f0101'$q$, 'can''t be settled against', '^ok, 0 row', '^ok, 0 row'),
      ('04 switch the GBP line to EUR', $q$UPDATE bank_transactions SET currency = 'EUR' WHERE id = '00000000-0000-0000-0000-0000000f0101'$q$, 'can''t be changed to EUR', '^ok, 0 row', '^ok, 0 row'),
      ('05 journal referencing the GBP line (its company)', $q$INSERT INTO journals(company_id, date, description, debit_account, credit_account, amount, reference) VALUES ('5f4e4585-8937-4624-b0fc-079a8379a160',current_date,'x','6600','1000',12.5,'FXT-GBP')$q$, 'can''t be posted yet', 'row-level security', 'row-level security'),
      ('06 confirmed match on the GBP line (its company)', $q$INSERT INTO bank_matches(company_id, bank_transaction_id, matched_type, matched_id, confidence, status, matched_by) VALUES ('5f4e4585-8937-4624-b0fc-079a8379a160','00000000-0000-0000-0000-0000000f0101','journal',gen_random_uuid(),100,'confirmed','user')$q$, 'can''t be matched yet', 'row-level security', 'row-level security'),
      ('07 settle the GBP line (confirm_settlement)', $q$SELECT confirm_settlement('5f4e4585-8937-4624-b0fc-079a8379a160','00000000-0000-0000-0000-0000000f0101','on_account',NULL,'supplier','FX test')$q$, 'can''t be settled against', 'Transaction not found', 'permission denied'),
      ('08 control: insert EUR line, reconciled', $q$INSERT INTO bank_transactions(company_id, revolut_id, date, description, amount, currency, reconciled) VALUES ('5f4e4585-8937-4624-b0fc-079a8379a160','FXT-NEW-EUR',current_date,'x',-5,'EUR',true)$q$, '^ok, 1 row', 'row-level security', 'row-level security'),
      ('09 control: euro-printed line, reconciled', $q$INSERT INTO bank_transactions(company_id, revolut_id, date, description, amount, currency, reconciled, original_currency, original_amount, printed_eur_amount) VALUES ('5f4e4585-8937-4624-b0fc-079a8379a160','FXT-NEW-EP',current_date,'x',-5.8,'EUR',true,'GBP',-5,-5.8)$q$, '^ok, 1 row', 'row-level security', 'row-level security'),
      ('10 control: journal referencing the EUR line', $q$INSERT INTO journals(company_id, date, description, debit_account, credit_account, amount, reference) VALUES ('5f4e4585-8937-4624-b0fc-079a8379a160',current_date,'x','6600','1000',12.5,'FXT-EUR')$q$, '^ok, 1 row', 'row-level security', 'row-level security'),
      ('11 control: reconcile the EUR line', $q$UPDATE bank_transactions SET reconciled = true WHERE id = '00000000-0000-0000-0000-0000000f0102'$q$, '^ok, 1 row', '^ok, 0 row', '^ok, 0 row'),
      ('12 journal in S&P referencing the Fitzsimons GBP line', $q$INSERT INTO journals(company_id, date, description, debit_account, credit_account, amount, reference) VALUES ('1d4bf5bd-3f2f-4919-b972-b00b2b9cac99',current_date,'x','6600','1000',12.5,'FXT-GBP')$q$, 'row-level security', '^ok, 1 row', 'row-level security'),
      ('13 confirmed match in S&P on the Fitzsimons GBP line id', $q$INSERT INTO bank_matches(company_id, bank_transaction_id, matched_type, matched_id, confidence, status, matched_by) VALUES ('1d4bf5bd-3f2f-4919-b972-b00b2b9cac99','00000000-0000-0000-0000-0000000f0101','journal',gen_random_uuid(),100,'confirmed','user')$q$, 'row-level security', '^ok, 1 row', 'row-level security'),
      ('14 categorise_bank_line on the EUR line', $q$SELECT categorise_bank_line('5f4e4585-8937-4624-b0fc-079a8379a160','00000000-0000-0000-0000-0000000f0102',current_date,'x','6600','1000',12.5,'REC-FXT')$q$, '^ok, 1 row', 'Transaction not found', 'permission denied'),
      ('15 categorise_bank_line on the GBP line', $q$SELECT categorise_bank_line('5f4e4585-8937-4624-b0fc-079a8379a160','00000000-0000-0000-0000-0000000f0101',current_date,'x','6600','1000',12.5,'REC-FXT')$q$, 'can''t be settled against', 'Transaction not found', 'permission denied')
    ) v(name, q, exp_member, exp_other, exp_anon) LOOP
      BEGIN
        PERFORM set_config('request.jwt.claims', CASE WHEN who.sub IS NULL THEN '{"role":"anon"}' ELSE json_build_object('sub', who.sub, 'role', who.role)::text END, true);
        EXECUTE format('SET LOCAL ROLE %I', who.role);
        EXECUTE t.q;
        GET DIAGNOSTICS n = ROW_COUNT;
        RAISE EXCEPTION 'undo:ok, % row(s)', n;
      EXCEPTION WHEN OTHERS THEN
        msg := regexp_replace(SQLERRM, '^undo:', '');
      END;
      RESET ROLE;
      exp := CASE who.label WHEN 'other_company' THEN t.exp_other WHEN 'anon' THEN t.exp_anon ELSE t.exp_member END;
      IF msg !~ exp THEN fails := fails + 1; END IF;
      IF who.label IN ('other_company', 'anon') AND msg ~ 'can''t be (posted|settled|matched|changed)' THEN fails := fails + 1; END IF;
      r := r || jsonb_build_object('who', who.label, 'test', t.name, 'pass', msg ~ exp, 'result', msg);
    END LOOP;
  END LOOP;
  RAISE EXCEPTION 'ROLLED BACK. % failure(s). results=%', fails, r::text;
END $fx$;

ROLLBACK;
