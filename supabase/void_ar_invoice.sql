-- void_ar_invoice: atomically reverses the journals posted by a finalised AR invoice
-- or credit note, then marks it void. Safe to call on any 'sent' or 'overdue' doc.
--
-- Blocks if:
--   • status is 'draft'       → use the delete path instead
--   • status is already 'void'
--   • status is 'paid'/'part_paid' → reverse settlements first
--   • issue_date falls in a filed VAT return period
--
-- On success: posts reversal journals (swapped DR/CR, same amount + vat_code + date),
-- marks journals is_accrual_reversal=true, updates invoices.status='void'.
-- Returns: { ok: true, reversal_ids: [uuid...] }
--
-- VAT effect: reversal journals appear in the same period's salesJournals with
-- opposite sign, netting T1 (and T2 for cost-side CNs) to zero for that document.

CREATE OR REPLACE FUNCTION void_ar_invoice(
  p_company_id UUID,
  p_invoice_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_inv     RECORD;
  v_now     TIMESTAMPTZ := now();
  v_jid     UUID;
  v_jnl     RECORD;
  v_rev_id  UUID;
  v_rev_ids UUID[] := ARRAY[]::UUID[];
BEGIN
  -- Fetch + lock the invoice (company-scoped)
  SELECT * INTO v_inv
  FROM invoices
  WHERE id = p_invoice_id AND company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  -- Guard: wrong status
  IF v_inv.status = 'draft' THEN
    RAISE EXCEPTION 'Draft invoices must be deleted, not voided';
  END IF;
  IF v_inv.status = 'void' THEN
    RAISE EXCEPTION 'Already void';
  END IF;
  IF v_inv.status IN ('paid', 'part_paid') THEN
    RAISE EXCEPTION 'This document has payments against it — reverse the payments before voiding';
  END IF;

  -- Guard: period lock — block if issue_date falls inside a filed VAT return
  IF v_inv.issue_date IS NOT NULL AND EXISTS (
    SELECT 1 FROM vat_returns
    WHERE company_id   = p_company_id
      AND status       = 'filed'
      AND period_start <= v_inv.issue_date
      AND period_end   >= v_inv.issue_date
  ) THEN
    RAISE EXCEPTION 'Period locked — this document''s period has already been filed and cannot be voided';
  END IF;

  -- Reverse each posted journal (swap DR/CR, same amount + vat_code + date)
  IF v_inv.journal_ids IS NOT NULL AND array_length(v_inv.journal_ids, 1) > 0 THEN
    FOREACH v_jid IN ARRAY v_inv.journal_ids LOOP
      SELECT * INTO v_jnl
      FROM journals
      WHERE id = v_jid AND company_id = p_company_id;

      IF FOUND THEN
        INSERT INTO journals (
          company_id, date, description,
          debit_account, credit_account,
          amount, vat_code, reference,
          source_recurring_id, is_accrual_reversal
        ) VALUES (
          p_company_id,
          coalesce(v_inv.issue_date, current_date),
          'VOID — ' || v_jnl.description,
          v_jnl.credit_account,   -- swap: original credit becomes new debit
          v_jnl.debit_account,    -- swap: original debit becomes new credit
          v_jnl.amount,
          v_jnl.vat_code,
          'VOID-' || coalesce(v_inv.invoice_number, v_inv.invoice_ref, ''),
          NULL,
          true   -- is_accrual_reversal marks this as a reversal entry
        ) RETURNING id INTO v_rev_id;

        v_rev_ids := v_rev_ids || v_rev_id;
      END IF;
    END LOOP;
  END IF;

  -- Stamp the document void
  UPDATE invoices
  SET status = 'void', updated_at = v_now
  WHERE id = p_invoice_id AND company_id = p_company_id;

  RETURN jsonb_build_object('ok', true, 'reversal_ids', v_rev_ids);
END;
$$;

GRANT EXECUTE ON FUNCTION void_ar_invoice(UUID, UUID) TO anon;
