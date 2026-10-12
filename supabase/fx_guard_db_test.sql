-- Rolled-back test of supabase/fx_guard_db.sql against the live schema. Nothing persists:
-- the test block ends by raising its results, which aborts the whole transaction (the
-- guard's DDL included). Generated from fx_guard_db.sql; keep the two in step.
BEGIN;

-- GEO-02 interim, defence in depth: the database itself refuses to post or reconcile a
-- foreign-currency bank line as euro, whatever the client does. The app already blocks every
-- path (src/shared/fxGuard.js); these triggers catch a path that is missed or added later.
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
-- Not covered by the database: Categorise inserts its journal (reference REC-…) before the
-- match and the reconcile; guards 1 and 2 refuse those, so its journal would be left without a
-- line. The app blocks Categorise first; moving Categorise and the transfer release into one
-- RPC (as confirm_settlement is) would close this fully.

CREATE OR REPLACE FUNCTION public.fx_is_foreign(p_currency text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT p_currency IS NOT NULL AND p_currency <> '' AND upper(p_currency) <> 'EUR'
$$;

CREATE OR REPLACE FUNCTION public.fx_guard_bank_line()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF fx_is_foreign(NEW.currency) THEN
    IF TG_OP = 'INSERT' AND NEW.reconciled THEN
      RAISE EXCEPTION 'Foreign-currency lines can''t be posted yet; multi-currency posting is planned.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.reconciled AND NOT coalesce(OLD.reconciled, false) THEN
      RAISE EXCEPTION 'Foreign-currency lines can''t be settled against an invoice or bill yet; multi-currency posting is planned.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND fx_is_foreign(OLD.currency) AND NOT fx_is_foreign(NEW.currency) AND NEW.original_currency IS NULL THEN
    RAISE EXCEPTION 'A foreign-currency line''s currency can''t be changed to EUR.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- The trigger functions are SECURITY DEFINER: the line's currency is read whatever the
-- caller's row-level access (the write itself is still checked by the table's RLS), and the
-- helper needs no grant. A trigger function cannot be called as an RPC; execute is revoked.
CREATE OR REPLACE FUNCTION public.fx_guard_bank_match()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'confirmed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'confirmed')
     AND EXISTS (SELECT 1 FROM bank_transactions b WHERE b.id = NEW.bank_transaction_id AND fx_is_foreign(b.currency)) THEN
    RAISE EXCEPTION 'Foreign-currency lines can''t be settled against an invoice or bill yet; multi-currency posting is planned.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fx_guard_journal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.reference IS NOT NULL AND EXISTS (
       SELECT 1 FROM bank_transactions b
       WHERE b.company_id = NEW.company_id AND b.revolut_id = NEW.reference AND fx_is_foreign(b.currency)) THEN
    RAISE EXCEPTION 'Foreign-currency lines can''t be posted yet; multi-currency posting is planned.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.fx_guard_bank_line()  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fx_guard_bank_match() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fx_guard_journal()    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fx_is_foreign(text)   FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bank_transactions_fx_guard ON public.bank_transactions;
CREATE TRIGGER bank_transactions_fx_guard BEFORE INSERT OR UPDATE ON public.bank_transactions
  FOR EACH ROW EXECUTE FUNCTION public.fx_guard_bank_line();

DROP TRIGGER IF EXISTS bank_matches_fx_guard ON public.bank_matches;
CREATE TRIGGER bank_matches_fx_guard BEFORE INSERT OR UPDATE ON public.bank_matches
  FOR EACH ROW EXECUTE FUNCTION public.fx_guard_bank_match();

DROP TRIGGER IF EXISTS journals_fx_guard ON public.journals;
CREATE TRIGGER journals_fx_guard BEFORE INSERT ON public.journals
  FOR EACH ROW EXECUTE FUNCTION public.fx_guard_journal();

-- ── Role tests (run inside the same transaction as the guard above) ───────────────────────
-- Fixtures on Fitzsimons Test (TEST company) and S&P (another company); every write here is
-- undone: the block ends by raising its results, which aborts and rolls back the whole
-- transaction, the guard's DDL included.
DO $fx$
DECLARE
  c   uuid := '5f4e4585-8937-4624-b0fc-079a8379a160';  -- Fitzsimons Test
  oc  uuid := '1d4bf5bd-3f2f-4919-b972-b00b2b9cac99';  -- S&P (another company)
  gbp uuid := '00000000-0000-0000-0000-0000000f0101';  -- unreconciled GBP line
  eur uuid := '00000000-0000-0000-0000-0000000f0102';  -- unreconciled EUR line
  r jsonb := '[]'::jsonb; msg text; who record; t record;
BEGIN
  INSERT INTO user_company_access(user_id, company_id, role) VALUES
    ('fxtest_accountant', c, 'accountant'), ('fxtest_owner', c, 'business_owner'), ('fxtest_other', oc, 'accountant');
  INSERT INTO bank_transactions(id, company_id, revolut_id, date, description, amount, currency, reconciled)
  VALUES (gbp, c, 'FXT-GBP', current_date, 'fx guard GBP line', -12.50, 'GBP', false),
         (eur, c, 'FXT-EUR', current_date, 'fx guard EUR line', -12.50, 'EUR', false);

  FOR who IN SELECT * FROM (VALUES ('accountant','authenticated','fxtest_accountant'), ('business_owner','authenticated','fxtest_owner'),
                                   ('other_company','authenticated','fxtest_other'), ('anon','anon',NULL)) v(label, role, sub) LOOP
    FOR t IN SELECT * FROM (VALUES
      ('01 insert GBP line, reconciled (import posting)', $q$INSERT INTO bank_transactions(company_id, revolut_id, date, description, amount, currency, reconciled) VALUES ('5f4e4585-8937-4624-b0fc-079a8379a160','FXT-NEW-GBP',current_date,'x',-5,'GBP',true)$q$),
      ('02 insert GBP line, unreconciled (reference only)', $q$INSERT INTO bank_transactions(company_id, revolut_id, date, description, amount, currency, reconciled) VALUES ('5f4e4585-8937-4624-b0fc-079a8379a160','FXT-NEW-GBP2',current_date,'x',-5,'GBP',false)$q$),
      ('03 reconcile the GBP line (Categorise / transfer)', $q$UPDATE bank_transactions SET reconciled = true WHERE id = '00000000-0000-0000-0000-0000000f0101'$q$),
      ('04 switch the GBP line to EUR', $q$UPDATE bank_transactions SET currency = 'EUR' WHERE id = '00000000-0000-0000-0000-0000000f0101'$q$),
      ('05 journal referencing the GBP line', $q$INSERT INTO journals(company_id, date, description, debit_account, credit_account, amount, reference) VALUES ('5f4e4585-8937-4624-b0fc-079a8379a160',current_date,'x','6600','1000',12.5,'FXT-GBP')$q$),
      ('06 confirmed match on the GBP line', $q$INSERT INTO bank_matches(company_id, bank_transaction_id, matched_type, matched_id, confidence, status, matched_by) VALUES ('5f4e4585-8937-4624-b0fc-079a8379a160','00000000-0000-0000-0000-0000000f0101','journal',gen_random_uuid(),100,'confirmed','user')$q$),
      ('07 settle the GBP line (RPC)', $q$SELECT confirm_settlement('5f4e4585-8937-4624-b0fc-079a8379a160','00000000-0000-0000-0000-0000000f0101','on_account',NULL,'supplier','FX test')$q$),
      ('08 control: insert EUR line, reconciled', $q$INSERT INTO bank_transactions(company_id, revolut_id, date, description, amount, currency, reconciled) VALUES ('5f4e4585-8937-4624-b0fc-079a8379a160','FXT-NEW-EUR',current_date,'x',-5,'EUR',true)$q$),
      ('09 control: euro-printed line, reconciled', $q$INSERT INTO bank_transactions(company_id, revolut_id, date, description, amount, currency, reconciled, original_currency, original_amount, printed_eur_amount) VALUES ('5f4e4585-8937-4624-b0fc-079a8379a160','FXT-NEW-EP',current_date,'x',-5.8,'EUR',true,'GBP',-5,-5.8)$q$),
      ('10 control: journal referencing the EUR line', $q$INSERT INTO journals(company_id, date, description, debit_account, credit_account, amount, reference) VALUES ('5f4e4585-8937-4624-b0fc-079a8379a160',current_date,'x','6600','1000',12.5,'FXT-EUR')$q$),
      ('11 control: reconcile the EUR line', $q$UPDATE bank_transactions SET reconciled = true WHERE id = '00000000-0000-0000-0000-0000000f0102'$q$)
    ) v(name, q) LOOP
      DECLARE n bigint;
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
      r := r || jsonb_build_object('who', who.label, 'test', t.name, 'result', msg);
    END LOOP;
  END LOOP;
  RAISE EXCEPTION 'ROLLED BACK. results=%', jsonb_pretty(r);
END $fx$;

ROLLBACK;
