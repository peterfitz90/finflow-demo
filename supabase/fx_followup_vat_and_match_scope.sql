-- Follow-up to fx_guard_db.sql (12 Oct 2026). Safe to re-run. Do not re-run fx_guard_db.sql after
-- this: its older categorise_bank_line (no VAT code) would replace the one below.
--
-- 1. categorise_bank_line takes the account's default VAT code, as the bank import does: the
--    journal's vat_code is chart_of_accounts.default_vat_code of the categorised account (the
--    leg that is not the line's own bank nominal), or null when the company's chart has none.
--    Before, Categorise never set a VAT code, so input VAT on a VAT-coded account was not counted.
--    Same signature: grants (authenticated only) are kept.
--
-- 2. A match belongs to one company: its bank line and its matched entry must be in the
--    match's own company. Before, only bank_transaction_id's foreign key held, so a user could
--    write a match in their own company that pointed at another company's line or journal id.
--    No existing match crosses companies (0 of 2,680 on 12 Oct 2026), so both checks apply to
--    every row now.
--    a. The line: a composite foreign key (company_id, bank_transaction_id) to
--       bank_transactions (company_id, id). Its error is the same whether the line is in
--       another company or does not exist, so it reveals nothing.
--    b. The matched entry (a journal, or a sales or supplier invoice; matched_id has no foreign
--       key, being one of several tables): a trigger, run as the caller, that refuses an entry
--       not found in the match's company, with one message for "elsewhere" and "nowhere". A
--       caller with no access to the match's company gets the table's own RLS refusal first.
--
-- 3. A held transfer stops being held once it is reconciled, however that happens: a trigger
--    clears hold_reason when a line becomes reconciled. Covers Categorise (categorise_bank_line)
--    and Settle (confirm_settlement), which left it set, and the transfer release, which already
--    cleared it from the app; also confirming a suggested match. A line that is not becoming
--    reconciled keeps its hold. Existing rows are not changed (one on 12 Oct 2026: a TEST line
--    on Fitzsimons Test, reconciled with hold_reason still 'transfer').

-- ── 1 ─────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.categorise_bank_line(
  p_company_id uuid, p_bt_id uuid, p_date date, p_description text,
  p_debit_account text, p_credit_account text, p_amount numeric, p_reference text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_bt   record;
  v_bank text;
  v_code text;
  v_vat  text;
  v_jnl  uuid;
  v_now  timestamptz := now();
BEGIN
  SELECT id, currency, reconciled, amount, bank_account_id INTO v_bt
  FROM public.bank_transactions WHERE id = p_bt_id AND company_id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transaction not found'; END IF;
  IF v_bt.currency IS NOT NULL AND v_bt.currency <> '' AND upper(v_bt.currency) <> 'EUR' THEN
    RAISE EXCEPTION 'Foreign-currency lines can''t be settled against an invoice or bill yet; multi-currency posting is planned.';
  END IF;
  IF v_bt.reconciled THEN RAISE EXCEPTION 'This transaction is already reconciled'; END IF;

  -- the categorised account: the leg that is not this line's bank nominal (as the form
  -- pre-fills it); if the accountant replaced both, the expense leg for money out, the income
  -- leg for money in
  v_bank := coalesce((SELECT nominal_code FROM public.bank_accounts WHERE id = v_bt.bank_account_id), '1000');
  v_code := CASE WHEN p_debit_account = v_bank THEN p_credit_account
                 WHEN p_credit_account = v_bank THEN p_debit_account
                 WHEN v_bt.amount < 0 THEN p_debit_account
                 ELSE p_credit_account END;
  SELECT default_vat_code INTO v_vat FROM public.chart_of_accounts
  WHERE company_id = p_company_id AND code = v_code;

  INSERT INTO public.journals (company_id, date, description, debit_account, credit_account, amount, reference, vat_code)
  VALUES (p_company_id, p_date, p_description, p_debit_account, p_credit_account, p_amount, p_reference, v_vat)
  RETURNING id INTO v_jnl;

  INSERT INTO public.bank_matches (company_id, bank_transaction_id, matched_type, matched_id,
    confidence, status, matched_by, confirmed_at, suggestion_kept)
  VALUES (p_company_id, p_bt_id, 'journal', v_jnl, 100, 'confirmed', 'user', v_now, false);

  UPDATE public.bank_transactions
  SET reconciled = true, reconciled_at = v_now, settlement_type = 'categorise'
  WHERE id = p_bt_id AND company_id = p_company_id;

  RETURN jsonb_build_object('ok', true, 'journal_id', v_jnl, 'vat_code', v_vat);
END $$;

-- ── 2a ────────────────────────────────────────────────────────────────────────────────────
-- re-runnable: the constraints are dropped first if present (sections 2a and 2b were applied
-- on their own once, on 12 Oct 2026)
ALTER TABLE public.bank_matches DROP CONSTRAINT IF EXISTS bank_matches_line_same_company;
ALTER TABLE public.bank_transactions DROP CONSTRAINT IF EXISTS bank_transactions_company_id_id_key;
ALTER TABLE public.bank_transactions
  ADD CONSTRAINT bank_transactions_company_id_id_key UNIQUE (company_id, id);
ALTER TABLE public.bank_matches
  ADD CONSTRAINT bank_matches_line_same_company
  FOREIGN KEY (company_id, bank_transaction_id) REFERENCES public.bank_transactions (company_id, id) ON DELETE CASCADE;

-- ── 2b ────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bank_match_entry_same_company()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.matched_id IS NOT DISTINCT FROM OLD.matched_id
     AND NEW.matched_type IS NOT DISTINCT FROM OLD.matched_type AND NEW.company_id IS NOT DISTINCT FROM OLD.company_id THEN
    RETURN NEW;
  END IF;
  -- no access to the match's company: let the table's RLS refuse it
  IF current_user IN ('anon', 'authenticated')
     AND NOT (NEW.company_id IN (SELECT public.user_company_ids())) THEN
    RETURN NEW;
  END IF;
  IF NOT (
       (NEW.matched_type = 'journal' AND EXISTS (SELECT 1 FROM public.journals j WHERE j.id = NEW.matched_id AND j.company_id = NEW.company_id))
    OR (NEW.matched_type = 'invoice' AND (
          EXISTS (SELECT 1 FROM public.invoices i    WHERE i.id = NEW.matched_id AND i.company_id = NEW.company_id)
       OR EXISTS (SELECT 1 FROM public.ap_invoices a WHERE a.id = NEW.matched_id AND a.company_id = NEW.company_id)))
  ) THEN
    RAISE EXCEPTION 'The matched entry was not found in this company.' USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.bank_match_entry_same_company() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS bank_matches_entry_same_company ON public.bank_matches;
CREATE TRIGGER bank_matches_entry_same_company BEFORE INSERT OR UPDATE ON public.bank_matches
  FOR EACH ROW EXECUTE FUNCTION public.bank_match_entry_same_company();

-- ── 3 ─────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bank_line_clear_hold_on_reconcile()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  -- reads only the row being written: no lookup
  IF NEW.reconciled AND NOT coalesce(OLD.reconciled, false) AND NEW.hold_reason IS NOT NULL THEN
    NEW.hold_reason := NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.bank_line_clear_hold_on_reconcile() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS bank_transactions_clear_hold_on_reconcile ON public.bank_transactions;
CREATE TRIGGER bank_transactions_clear_hold_on_reconcile BEFORE UPDATE ON public.bank_transactions
  FOR EACH ROW EXECUTE FUNCTION public.bank_line_clear_hold_on_reconcile();
