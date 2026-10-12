-- APPLIED 12 Oct 2026. Do not re-run: fx_followup_vat_and_match_scope.sql replaces
-- categorise_bank_line with a newer version (VAT code), and re-running this file would put the
-- older one back (this happened once, on 12 Oct 2026).
--
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
