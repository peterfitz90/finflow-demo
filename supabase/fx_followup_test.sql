-- Rolled-back test of supabase/fx_followup_vat_and_match_scope.sql against the live schema.
-- Nothing persists: the test block ends by raising its results, aborting the whole transaction
-- (the migration's DDL included). The error's first line reads "N failure(s)".
BEGIN;

-- Follow-up to fx_guard_db.sql (12 Oct 2026).
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

-- ── Tests (same transaction as the migration above; all undone) ───────────────────────────
-- Matches: as Fitzsimons' accountant and business owner, S&P's accountant, and anon. VAT: as
-- an accountant of Fitzsimons and Elevate, Categorise on unreconciled copies of real lines.
-- Nothing persists: the block ends by raising its results, which aborts the transaction.
DO $fu$
DECLARE
  r jsonb := '[]'::jsonb; msg text; who record; t record; n bigint; exp text; fails int := 0; tgt uuid; res jsonb;
BEGIN
  INSERT INTO user_company_access(user_id, company_id, role) VALUES
    ('fxtest_accountant', '5f4e4585-8937-4624-b0fc-079a8379a160', 'accountant'), ('fxtest_owner', '5f4e4585-8937-4624-b0fc-079a8379a160', 'business_owner'),
    ('fxtest_other', '1d4bf5bd-3f2f-4919-b972-b00b2b9cac99', 'accountant'), ('fxtest_accountant', 'e1599dfc-9988-4d10-aeef-33de252b9c02', 'accountant');
  INSERT INTO bank_transactions(id, company_id, revolut_id, date, description, amount, currency, reconciled)
  VALUES ('00000000-0000-0000-0000-0000000f0202', '5f4e4585-8937-4624-b0fc-079a8379a160', 'FXT-EUR-2', current_date, 'follow-up EUR line', -12.50, 'EUR', false);
  INSERT INTO ap_invoices(id, company_id, invoice_ref, supplier, amount) VALUES ('00000000-0000-0000-0000-0000000f0203', '5f4e4585-8937-4624-b0fc-079a8379a160', 'FXT-AP', 'Follow-up test supplier', 12.50);

  FOR who IN SELECT * FROM (VALUES ('accountant','authenticated','fxtest_accountant'), ('business_owner','authenticated','fxtest_owner'),
                                   ('other_company','authenticated','fxtest_other'), ('anon','anon',NULL)) v(label, role, sub) LOOP
    FOR t IN SELECT * FROM (VALUES
      ('M1 match: Fitzsimons line, Fitzsimons journal', $q$INSERT INTO bank_matches(company_id, bank_transaction_id, matched_type, matched_id, confidence, status, matched_by) VALUES ('5f4e4585-8937-4624-b0fc-079a8379a160','00000000-0000-0000-0000-0000000f0202','journal','32d24760-5fce-47df-94dd-20bc44afc7ff',75,'suggested','user')$q$, '^ok, 1 row', 'row-level security', 'row-level security'),
      ('M2 match: Fitzsimons line, Fitzsimons sales invoice', $q$INSERT INTO bank_matches(company_id, bank_transaction_id, matched_type, matched_id, confidence, status, matched_by) VALUES ('5f4e4585-8937-4624-b0fc-079a8379a160','00000000-0000-0000-0000-0000000f0202','invoice','698ae270-ea45-48e5-9271-65119681b7ba',75,'suggested','user')$q$, '^ok, 1 row', 'row-level security', 'row-level security'),
      ('M3 match: Fitzsimons line, Fitzsimons supplier bill', $q$INSERT INTO bank_matches(company_id, bank_transaction_id, matched_type, matched_id, confidence, status, matched_by) VALUES ('5f4e4585-8937-4624-b0fc-079a8379a160','00000000-0000-0000-0000-0000000f0202','invoice','00000000-0000-0000-0000-0000000f0203',75,'suggested','user')$q$, '^ok, 1 row', 'row-level security', 'row-level security'),
      ('M4 match in Fitzsimons on an S&P journal', $q$INSERT INTO bank_matches(company_id, bank_transaction_id, matched_type, matched_id, confidence, status, matched_by) VALUES ('5f4e4585-8937-4624-b0fc-079a8379a160','00000000-0000-0000-0000-0000000f0202','journal','ae0943c0-cf3b-4ea6-a591-209881d9d367',75,'suggested','user')$q$, 'not found in this company', 'row-level security', 'row-level security'),
      ('M5 match in Fitzsimons on an S&P bank line', $q$INSERT INTO bank_matches(company_id, bank_transaction_id, matched_type, matched_id, confidence, status, matched_by) VALUES ('5f4e4585-8937-4624-b0fc-079a8379a160','3da66a02-fd1d-42a3-b4ee-4d8545fb08c8','journal','32d24760-5fce-47df-94dd-20bc44afc7ff',75,'suggested','user')$q$, 'bank_matches_line_same_company', 'row-level security', 'row-level security'),
      ('M6 match in S&P on a Fitzsimons bank line (case 13)', $q$INSERT INTO bank_matches(company_id, bank_transaction_id, matched_type, matched_id, confidence, status, matched_by) VALUES ('1d4bf5bd-3f2f-4919-b972-b00b2b9cac99','00000000-0000-0000-0000-0000000f0202','journal','ae0943c0-cf3b-4ea6-a591-209881d9d367',75,'suggested','user')$q$, 'row-level security', 'bank_matches_line_same_company', 'row-level security'),
      ('M7 match in S&P on a Fitzsimons journal', $q$INSERT INTO bank_matches(company_id, bank_transaction_id, matched_type, matched_id, confidence, status, matched_by) VALUES ('1d4bf5bd-3f2f-4919-b972-b00b2b9cac99','3da66a02-fd1d-42a3-b4ee-4d8545fb08c8','journal','32d24760-5fce-47df-94dd-20bc44afc7ff',75,'suggested','user')$q$, 'row-level security', 'not found in this company', 'row-level security'),
      ('M8 match on a journal id that does not exist', $q$INSERT INTO bank_matches(company_id, bank_transaction_id, matched_type, matched_id, confidence, status, matched_by) VALUES ('5f4e4585-8937-4624-b0fc-079a8379a160','00000000-0000-0000-0000-0000000f0202','journal','00000000-0000-0000-0000-0000000f0999',75,'suggested','user')$q$, 'not found in this company', 'row-level security', 'row-level security'),
      ('M9 settle on account (confirm_settlement writes a match)', $q$SELECT confirm_settlement('5f4e4585-8937-4624-b0fc-079a8379a160','00000000-0000-0000-0000-0000000f0202','on_account',NULL,'supplier','FX test')$q$, '^ok, 1 row', 'Transaction not found', 'permission denied'),
      ('M10 categorise the EUR line (categorise_bank_line writes a match)', $q$SELECT categorise_bank_line('5f4e4585-8937-4624-b0fc-079a8379a160','00000000-0000-0000-0000-0000000f0202',current_date,'x','6600','1000',12.5,'REC-FXT')$q$, '^ok, 1 row', 'Transaction not found', 'permission denied')
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
      r := r || jsonb_build_object('who', who.label, 't', split_part(t.name, ' ', 1), 'pass', msg ~ exp, 'result', left(msg, 70));
    END LOOP;
  END LOOP;

  FOR t IN SELECT * FROM (VALUES
      ('V1 Elevate money out to 6600 (STD23)', '6e7fc2de-70bd-445a-a784-2d3ee19cccf9'::uuid, '6600', '1000', 'STD23'),
      ('V2 Elevate money out to 6500 (EXEMPT)', '6e7fc2de-70bd-445a-a784-2d3ee19cccf9'::uuid, '6500', '1000', 'EXEMPT'),
      ('V3 Elevate money in to 4000 (STD23)', '9a4e8bef-6c56-4703-9035-0e0c95084659'::uuid, '1000', '4000', 'STD23'),
      ('V4 Fitzsimons money out to 6600 (no defaults in its chart)', 'ca59361e-ffbb-4f84-8f0d-bfb9337e0523'::uuid, '6600', '1000', NULL),
      ('V5 Elevate, both legs replaced, money out: debit 6500', '6e7fc2de-70bd-445a-a784-2d3ee19cccf9'::uuid, '6500', '2000', 'EXEMPT'),
      ('V6 Elevate, legs entered the other way round: bank on the debit', '6e7fc2de-70bd-445a-a784-2d3ee19cccf9'::uuid, '1000', '6600', 'STD23')
    ) v(name, src, dr, cr, expected) LOOP
    tgt := gen_random_uuid();
    INSERT INTO bank_transactions(id, company_id, revolut_id, date, description, amount, currency, bank_account_id, reconciled)
    SELECT tgt, company_id, revolut_id || '-VAT-' || left(tgt::text, 8), date, description, amount, currency, bank_account_id, false FROM bank_transactions WHERE id = t.src;
    BEGIN
      PERFORM set_config('request.jwt.claims', json_build_object('sub', 'fxtest_accountant', 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      res := categorise_bank_line((SELECT company_id FROM bank_transactions WHERE id = tgt), tgt, (SELECT date FROM bank_transactions WHERE id = tgt),
                                  'vat test', t.dr, t.cr, 1.00, 'REC-VAT');
      msg := (SELECT coalesce(vat_code, '(null)') FROM journals WHERE id = (res->>'journal_id')::uuid);
      RAISE EXCEPTION 'undo:%', msg;
    EXCEPTION WHEN OTHERS THEN
      msg := regexp_replace(SQLERRM, '^undo:', '');
    END;
    RESET ROLE;
    IF msg IS DISTINCT FROM coalesce(t.expected, '(null)') THEN fails := fails + 1; END IF;
    r := r || jsonb_build_object('t', split_part(t.name, ' ', 1), 'case', t.name, 'vat_code', msg, 'pass', msg = coalesce(t.expected, '(null)'));
  END LOOP;
  RAISE EXCEPTION 'ROLLED BACK. % failure(s). results=%', fails, r::text;
END $fu$;

ROLLBACK;
