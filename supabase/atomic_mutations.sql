-- Atomic mutation RPCs
-- Replaces multi-step sequential awaits (no rollback on mid-chain failure) with
-- single-transaction Postgres functions. Each function either commits everything
-- or rolls back everything — no half-posted journals, no orphaned bank_match rows.
--
-- Schema confirmed from live DB (2026-06-24):
--   bank_matches:          id, company_id, bank_transaction_id, matched_type (invoice/ap_invoice/journal),
--                          matched_id, confidence, status, matched_by, created_at, confirmed_at,
--                          suggestion_kept, suggested_nominal_code
--   bank_transactions:     id, company_id, revolut_id, date, description, amount, reconciled,
--                          reconciled_at, settlement_type, nominal_account, ...
--   journals:              id, company_id, date, description, debit_account, credit_account,
--                          amount, vat_code, reference, source_recurring_id, is_accrual_reversal, ...
--   ap_invoices:           id, company_id, invoice_ref, supplier, amount, gross_amount, net_amount,
--                          vat_amount, vat_code, nominal_code, suggested_nominal, status,
--                          amount_paid, invoice_date, due_date, approved_at, ...
--   invoices:              id, company_id, invoice_ref, invoice_number, client, amount, total,
--                          amount_paid, status, issue_date, invoice_date, updated_at, ...
--   settlement_allocations: id, company_id, bank_transaction_id, invoice_id, invoice_type (ar/ap),
--                           allocated_amount, difference_amount, difference_nominal,
--                           settlement_journal_id, created_at
--   on_account_entries:    id, company_id, bank_transaction_id, party_type, party_name, amount,
--                          settlement_journal_id, ...
--   vat_returns:           id, company_id, period_start (DATE), period_end (DATE), status, ...
--
-- All four functions use SECURITY INVOKER (run as anon, consistent with current app-layer access).
-- Period-lock guard is server-side and atomic in every function.
-- Idempotency: reconciled/approved/paid checks prevent double-posting on double-submit.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. confirm_journal_match
--    Replaces: confirmJournalMatch (App.jsx) + confirmBankTxn (shared/approvals.js)
--    Confirms a journal-type bank_match, marks bank_transaction reconciled,
--    and rejects all other suggestions for the same transaction.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION confirm_journal_match(
  p_company_id UUID,
  p_match_id   UUID,
  p_bt_id      UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_bt_reconciled   BOOLEAN;
  v_bt_date         DATE;
  v_bt_amount       NUMERIC;
  v_matched_id      UUID;
  v_suggested_nom   TEXT;
  v_jnl_debit       TEXT;
  v_jnl_credit      TEXT;
  v_suggestion_kept BOOLEAN := true;
  v_now             TIMESTAMPTZ := now();
BEGIN
  -- Fetch bank transaction (company-scoped)
  SELECT reconciled, date, amount
  INTO v_bt_reconciled, v_bt_date, v_bt_amount
  FROM bank_transactions
  WHERE id = p_bt_id AND company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;

  -- Idempotency: already reconciled → succeed without re-posting
  IF v_bt_reconciled THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true);
  END IF;

  -- Period lock: reject if transaction date falls in a filed VAT return
  IF EXISTS (
    SELECT 1 FROM vat_returns
    WHERE company_id = p_company_id
      AND status     = 'filed'
      AND period_start <= v_bt_date
      AND period_end   >= v_bt_date
  ) THEN
    RAISE EXCEPTION 'Period is locked — this date falls inside a filed VAT return';
  END IF;

  -- Fetch match (company-scoped)
  SELECT matched_id, suggested_nominal_code
  INTO v_matched_id, v_suggested_nom
  FROM bank_matches
  WHERE id = p_match_id AND company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match not found';
  END IF;

  -- Compute suggestion_kept: mirrors JS logic exactly.
  -- true  = journal's current nominal == AI's originally suggested nominal (or no suggestion stored)
  -- false = user changed the nominal before confirming
  IF v_suggested_nom IS NOT NULL THEN
    SELECT debit_account, credit_account
    INTO v_jnl_debit, v_jnl_credit
    FROM journals
    WHERE id = v_matched_id;

    IF FOUND THEN
      IF v_bt_amount >= 0 THEN
        v_suggestion_kept := v_jnl_credit = v_suggested_nom;
      ELSE
        v_suggestion_kept := v_jnl_debit = v_suggested_nom;
      END IF;
    END IF;
  END IF;

  -- All writes are atomic below this point ─────────────────────────────────

  UPDATE bank_matches
  SET status = 'confirmed', confirmed_at = v_now, suggestion_kept = v_suggestion_kept
  WHERE id = p_match_id AND company_id = p_company_id;

  UPDATE bank_transactions
  SET reconciled = true, reconciled_at = v_now, settlement_type = 'categorise'
  WHERE id = p_bt_id AND company_id = p_company_id;

  -- Reject every other suggested match for this bank transaction
  UPDATE bank_matches
  SET status = 'rejected'
  WHERE bank_transaction_id = p_bt_id
    AND company_id           = p_company_id
    AND status               = 'suggested'
    AND id                  <> p_match_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION confirm_journal_match(UUID, UUID, UUID) TO anon;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. confirm_settlement
--    Replaces: confirmSettlement (App.jsx) — covers invoice, on_account, and
--    tolerance (difference_amount) variants.
--
--    p_allocations: JSONB array, each element:
--      { "invoice_id": "uuid", "invoice_type": "ar"|"ap",
--        "allocated_amount": 123.45, "difference_amount": 0.00,
--        "difference_nominal": "6500" }
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION confirm_settlement(
  p_company_id            UUID,
  p_bt_id                 UUID,
  p_mode                  TEXT,    -- 'invoice' | 'on_account'
  p_allocations           JSONB,   -- array; NULL for on_account mode
  p_on_account_party_type TEXT DEFAULT NULL,
  p_on_account_party_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_bt              RECORD;
  v_now             TIMESTAMPTZ := now();
  v_bank_acc        TEXT        := '1000';
  v_is_receipt      BOOLEAN;
  v_bank_abs        NUMERIC;
  v_jnl_id          UUID;
  v_first_jnl_id    UUID;
  v_kept_suggestion BOOLEAN     := false;
  v_settle_type     TEXT;
  v_on_acc_nominal  TEXT;
  v_total_alloc     NUMERIC     := 0;
  v_n               INTEGER;
  v_i               INTEGER;
  v_alloc_elem      JSONB;
  -- per-allocation loop variables
  v_inv_id_l        UUID;
  v_inv_type_l      TEXT;
  v_alloc_amt_l     NUMERIC;
  v_is_ar_l         BOOLEAN;
  v_diff_amt_l      NUMERIC;
  v_diff_nom_l      TEXT;
  v_inv_ref_l       TEXT;
  v_party_l         TEXT;
  v_inv_total_l     NUMERIC;
  v_inv_paid_l      NUMERIC;
  v_new_paid_l      NUMERIC;
  v_new_status_l    TEXT;
BEGIN
  -- Fetch bank transaction
  SELECT * INTO v_bt FROM bank_transactions WHERE id = p_bt_id AND company_id = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;

  -- Idempotency
  IF v_bt.reconciled THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true);
  END IF;

  -- Period lock
  IF EXISTS (
    SELECT 1 FROM vat_returns
    WHERE company_id   = p_company_id
      AND status       = 'filed'
      AND period_start <= v_bt.date::date
      AND period_end   >= v_bt.date::date
  ) THEN
    RAISE EXCEPTION 'Period is locked — this date falls inside a filed VAT return';
  END IF;

  v_is_receipt := v_bt.amount > 0;
  v_bank_abs   := abs(v_bt.amount);

  -- ── On-account path ──────────────────────────────────────────────────────
  IF p_mode = 'on_account' THEN
    IF p_on_account_party_name IS NULL OR trim(p_on_account_party_name) = '' THEN
      RAISE EXCEPTION 'Party name required';
    END IF;

    -- Customer Advances (2350) for receipt; Supplier Prepayments (1250) for payment
    v_on_acc_nominal := CASE WHEN v_is_receipt THEN '2350' ELSE '1250' END;

    INSERT INTO journals (
      company_id, date, description,
      debit_account, credit_account,
      amount, vat_code, reference,
      source_recurring_id, is_accrual_reversal
    ) VALUES (
      p_company_id, v_bt.date,
      'On account — ' || p_on_account_party_name,
      CASE WHEN v_is_receipt THEN v_bank_acc ELSE v_on_acc_nominal END,
      CASE WHEN v_is_receipt THEN v_on_acc_nominal ELSE v_bank_acc END,
      v_bank_abs, 'NONE',
      coalesce(v_bt.description, 'On Account'),
      NULL, false
    ) RETURNING id INTO v_jnl_id;

    INSERT INTO on_account_entries (
      company_id, bank_transaction_id,
      party_type, party_name, amount, settlement_journal_id
    ) VALUES (
      p_company_id, p_bt_id,
      p_on_account_party_type, p_on_account_party_name,
      v_bank_abs, v_jnl_id
    );

    UPDATE bank_transactions
    SET reconciled = true, reconciled_at = v_now, settlement_type = 'on_account'
    WHERE id = p_bt_id AND company_id = p_company_id;

    INSERT INTO bank_matches (
      company_id, bank_transaction_id, matched_type, matched_id,
      confidence, status, matched_by, confirmed_at, suggestion_kept
    ) VALUES (
      p_company_id, p_bt_id, 'journal', v_jnl_id,
      100, 'confirmed', 'user', v_now, false
    );

    RETURN jsonb_build_object('ok', true);
  END IF;

  -- ── Invoice path ─────────────────────────────────────────────────────────
  v_n := jsonb_array_length(coalesce(p_allocations, '[]'::jsonb));
  IF v_n = 0 THEN
    RAISE EXCEPTION 'Add at least one invoice to settle';
  END IF;

  -- Validate: sum of allocated_amount + difference_amount must equal bank line
  FOR v_i IN 0 .. v_n - 1
  LOOP
    v_alloc_elem  := p_allocations->v_i;
    v_total_alloc := v_total_alloc
      + round((v_alloc_elem->>'allocated_amount')::numeric, 2)
      + round(coalesce((v_alloc_elem->>'difference_amount')::numeric, 0), 2);
  END LOOP;

  IF abs(v_total_alloc - v_bank_abs) > 0.005 THEN
    RAISE EXCEPTION 'Allocation total (%) does not match bank line amount (%)',
      v_total_alloc, v_bank_abs;
  END IF;

  v_settle_type := CASE WHEN v_is_receipt THEN 'ar' ELSE 'ap' END;

  -- keptSuggestion: true iff exactly 1 alloc and the invoice was AI-suggested
  IF v_n = 1 THEN
    v_kept_suggestion := EXISTS (
      SELECT 1 FROM bank_matches
      WHERE bank_transaction_id = p_bt_id
        AND company_id           = p_company_id
        AND status               = 'suggested'
        AND matched_type        IN ('invoice', 'ap_invoice')
        AND matched_id           = (p_allocations->0->>'invoice_id')::uuid
    );
  END IF;

  -- Process each allocation
  FOR v_i IN 0 .. v_n - 1
  LOOP
    v_alloc_elem  := p_allocations->v_i;
    v_inv_id_l    := (v_alloc_elem->>'invoice_id')::uuid;
    v_inv_type_l  := v_alloc_elem->>'invoice_type';
    v_alloc_amt_l := round((v_alloc_elem->>'allocated_amount')::numeric, 2);
    v_is_ar_l     := v_inv_type_l = 'ar';
    v_diff_amt_l  := round(coalesce((v_alloc_elem->>'difference_amount')::numeric, 0), 2);
    v_diff_nom_l  := coalesce(nullif(v_alloc_elem->>'difference_nominal', ''), '6500');

    IF v_is_ar_l THEN
      SELECT coalesce(invoice_number, invoice_ref, '') AS inv_ref,
             coalesce(client, '')                      AS party,
             coalesce(total, amount, 0)                AS inv_total,
             coalesce(amount_paid, 0)                  AS inv_paid
      INTO v_inv_ref_l, v_party_l, v_inv_total_l, v_inv_paid_l
      FROM invoices
      WHERE id = v_inv_id_l AND company_id = p_company_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'AR invoice % not found', v_inv_id_l;
      END IF;
    ELSE
      SELECT coalesce(invoice_ref, '') AS inv_ref,
             coalesce(supplier, '')    AS party,
             coalesce(gross_amount, amount, 0) AS inv_total,
             coalesce(amount_paid, 0)  AS inv_paid
      INTO v_inv_ref_l, v_party_l, v_inv_total_l, v_inv_paid_l
      FROM ap_invoices
      WHERE id = v_inv_id_l AND company_id = p_company_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'AP invoice % not found', v_inv_id_l;
      END IF;
    END IF;

    -- Core settlement journal: Dr Bank/Cr 1100 (AR receipt) or Dr 2000/Cr Bank (AP payment)
    INSERT INTO journals (
      company_id, date, description,
      debit_account, credit_account,
      amount, vat_code, reference,
      source_recurring_id, is_accrual_reversal
    ) VALUES (
      p_company_id, v_bt.date,
      CASE WHEN v_is_ar_l THEN 'Receipt' ELSE 'Payment' END
        || ' ' || v_inv_ref_l
        || CASE WHEN v_party_l <> '' THEN ' — ' || v_party_l ELSE '' END,
      CASE WHEN v_is_ar_l THEN v_bank_acc ELSE '2000' END,
      CASE WHEN v_is_ar_l THEN '1100'     ELSE v_bank_acc END,
      v_alloc_amt_l, 'NONE', v_inv_ref_l,
      NULL, false
    ) RETURNING id INTO v_jnl_id;

    IF v_first_jnl_id IS NULL THEN v_first_jnl_id := v_jnl_id; END IF;

    -- Tolerance write-off: Dr Rounding/Cr 1100 (AR) or Dr 2000/Cr Rounding (AP)
    IF v_diff_amt_l > 0.004 THEN
      INSERT INTO journals (
        company_id, date, description,
        debit_account, credit_account,
        amount, vat_code, reference,
        source_recurring_id, is_accrual_reversal
      ) VALUES (
        p_company_id, v_bt.date,
        'Settlement rounding — ' || v_inv_ref_l,
        CASE WHEN v_is_ar_l THEN v_diff_nom_l ELSE '2000' END,
        CASE WHEN v_is_ar_l THEN '1100'       ELSE v_diff_nom_l END,
        round(abs(v_diff_amt_l), 2), 'NONE', v_inv_ref_l,
        NULL, false
      );
    END IF;

    -- Update invoice amount_paid + status
    v_new_paid_l   := round(v_inv_paid_l + v_alloc_amt_l + v_diff_amt_l, 2);
    v_new_status_l := CASE WHEN v_new_paid_l >= v_inv_total_l - 0.005 THEN 'paid' ELSE 'part_paid' END;

    IF v_is_ar_l THEN
      UPDATE invoices
      SET amount_paid = v_new_paid_l, status = v_new_status_l, updated_at = v_now
      WHERE id = v_inv_id_l AND company_id = p_company_id;
    ELSE
      UPDATE ap_invoices
      SET amount_paid = v_new_paid_l, status = v_new_status_l
      WHERE id = v_inv_id_l AND company_id = p_company_id;
    END IF;

    -- Record allocation
    INSERT INTO settlement_allocations (
      company_id, bank_transaction_id, invoice_id, invoice_type,
      allocated_amount, difference_amount, difference_nominal,
      settlement_journal_id
    ) VALUES (
      p_company_id, p_bt_id, v_inv_id_l, v_inv_type_l,
      v_alloc_amt_l, v_diff_amt_l, nullif(v_diff_nom_l, ''),
      v_jnl_id
    );
  END LOOP;

  -- Reconcile bank transaction
  UPDATE bank_transactions
  SET reconciled = true, reconciled_at = v_now, settlement_type = v_settle_type
  WHERE id = p_bt_id AND company_id = p_company_id;

  -- Record bank_match pointing to the first settlement journal
  IF v_first_jnl_id IS NOT NULL THEN
    INSERT INTO bank_matches (
      company_id, bank_transaction_id, matched_type, matched_id,
      confidence, status, matched_by, confirmed_at, suggestion_kept
    ) VALUES (
      p_company_id, p_bt_id, 'journal', v_first_jnl_id,
      100, 'confirmed', 'user', v_now, v_kept_suggestion
    );
  END IF;

  -- Reject all remaining suggestions for this transaction
  UPDATE bank_matches
  SET status = 'rejected'
  WHERE bank_transaction_id = p_bt_id
    AND company_id           = p_company_id
    AND status               = 'suggested';

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION confirm_settlement(UUID, UUID, TEXT, JSONB, TEXT, TEXT) TO anon;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. approve_ap_bill
--    Replaces: approveReview (App.jsx) + approveApBill (shared/approvals.js)
--    Atomically: updates ap_invoices fields + inserts accrual journal
--    Dr expense nominal / Cr 2000 Trade Creditors
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION approve_ap_bill(
  p_company_id  UUID,
  p_bill_id     UUID,
  p_gross       NUMERIC,
  p_nom_code    TEXT,
  p_vat_code    TEXT,
  p_date        DATE,
  p_supplier    TEXT,
  p_invoice_ref TEXT,
  p_net_amount  NUMERIC DEFAULT NULL,
  p_vat_amount  NUMERIC DEFAULT NULL,
  p_due_date    DATE    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_status TEXT;
  v_now    TIMESTAMPTZ := now();
BEGIN
  SELECT status INTO v_status
  FROM ap_invoices
  WHERE id = p_bill_id AND company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found';
  END IF;

  -- Idempotency: already approved/paid → succeed without re-posting
  IF v_status <> 'needs_review' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true);
  END IF;

  -- Period lock on invoice date
  IF EXISTS (
    SELECT 1 FROM vat_returns
    WHERE company_id   = p_company_id
      AND status       = 'filed'
      AND period_start <= p_date
      AND period_end   >= p_date
  ) THEN
    RAISE EXCEPTION 'Period is locked — this invoice date falls inside a filed VAT return';
  END IF;

  -- Atomic: update bill metadata + post accrual journal
  UPDATE ap_invoices SET
    status            = 'pending',
    approved_at       = v_now,
    supplier          = p_supplier,
    invoice_ref       = p_invoice_ref,
    invoice_date      = p_date,
    due_date          = p_due_date,
    amount            = p_gross,
    gross_amount      = p_gross,
    net_amount        = p_net_amount,
    vat_amount        = p_vat_amount,
    suggested_nominal = p_nom_code,
    nominal_code      = p_nom_code
  WHERE id = p_bill_id AND company_id = p_company_id;

  IF p_gross > 0 THEN
    INSERT INTO journals (
      company_id, date, description,
      debit_account, credit_account,
      amount, vat_code, reference,
      source_recurring_id, is_accrual_reversal
    ) VALUES (
      p_company_id, p_date,
      'Bill ' || p_invoice_ref || ' — ' || p_supplier,
      p_nom_code, '2000',
      p_gross, p_vat_code, p_invoice_ref,
      NULL, false
    );
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION approve_ap_bill(UUID, UUID, NUMERIC, TEXT, TEXT, DATE, TEXT, TEXT, NUMERIC, NUMERIC, DATE) TO anon;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. mark_ap_bill_paid
--    Replaces: markPaid (APInvoices component in App.jsx)
--    Atomically: updates ap_invoices status + inserts payment journal
--    Dr 2000 Trade Creditors / Cr 1000 Bank
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION mark_ap_bill_paid(
  p_company_id UUID,
  p_bill_id    UUID,
  p_paid_amt   NUMERIC,
  p_date       DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_inv RECORD;
  v_now TIMESTAMPTZ := now();
BEGIN
  SELECT * INTO v_inv
  FROM ap_invoices
  WHERE id = p_bill_id AND company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found';
  END IF;

  -- Idempotency: already paid
  IF v_inv.status = 'paid' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true);
  END IF;

  -- Period lock on payment date
  IF EXISTS (
    SELECT 1 FROM vat_returns
    WHERE company_id   = p_company_id
      AND status       = 'filed'
      AND period_start <= p_date
      AND period_end   >= p_date
  ) THEN
    RAISE EXCEPTION 'Period is locked — this payment date falls inside a filed VAT return';
  END IF;

  -- Atomic: update bill + post payment journal
  UPDATE ap_invoices
  SET status = 'paid', amount_paid = p_paid_amt
  WHERE id = p_bill_id AND company_id = p_company_id;

  IF p_paid_amt > 0 THEN
    INSERT INTO journals (
      company_id, date, description,
      debit_account, credit_account,
      amount, vat_code, reference,
      source_recurring_id, is_accrual_reversal
    ) VALUES (
      p_company_id, p_date,
      'Payment ' || coalesce(v_inv.invoice_ref, '') || ' — ' || coalesce(v_inv.supplier, ''),
      '2000', '1000',
      p_paid_amt, 'NONE', coalesce(v_inv.invoice_ref, ''),
      NULL, false
    );
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION mark_ap_bill_paid(UUID, UUID, NUMERIC, DATE) TO anon;
