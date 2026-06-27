-- ────────────────────────────────────────────────────────────────────────────
-- supabase/verify_rpcs.sql
--
-- PREREQUISITE: atomic_mutations.sql must already be applied.
--
-- Paste the whole file into the Supabase SQL Editor and run once.
-- At the end a single grid prints every scenario's PASS/FAIL side by side.
-- Nothing is persisted — the final ROLLBACK undoes everything.
--
-- MECHANISM
--   One outer transaction (BEGIN … ROLLBACK).
--   _vr is a temp table scoped to this transaction.
--   Each scenario runs inside a PL/pgSQL BEGIN…EXCEPTION sub-block, which
--   PostgreSQL backs with an implicit savepoint.  On RAISE EXCEPTION 'done'
--   the savepoint unwinds all table writes (fixtures + RPC side-effects).
--   PL/pgSQL variable assignments are NOT rolled back by a savepoint, so
--   values captured before the RAISE survive for the INSERT into _vr.
--   Those _vr inserts sit in the outer transaction scope, unaffected by the
--   inner savepoint, and are visible to the final SELECT.
--
-- CONFIRMED NOT-NULL / FK ORDER (live schema probes 2026-06-24):
--   companies         clerk_user_id, name (NOT NULL, no FK)
--   bank_transactions company_id FK→companies  (date/amount supplied for RPCs)
--   ap_invoices       company_id FK→companies, invoice_ref, supplier, amount NOT NULL
--   invoices          company_id FK→companies, client, amount, invoice_date NOT NULL
--                     + invoice_ref required by CHECK when status ≠ 'draft'
--   journals          company_id FK→companies, date, description,
--                     debit_account, credit_account, amount NOT NULL
--   bank_matches      company_id NOT NULL, bank_transaction_id FK→bank_transactions,
--                     matched_type NOT NULL, matched_id NOT NULL
--
-- FIXTURE UUIDs (all-zeros prefix — cannot collide with gen_random_uuid()):
--   company  00000000-0000-0000-0000-0000000000aa
--   bt       00000000-0000-0000-0000-000000000010
--   invoice  00000000-0000-0000-0000-000000000020
--   ap bill  00000000-0000-0000-0000-000000000030
--   journal  00000000-0000-0000-0000-000000000040
--   match    00000000-0000-0000-0000-000000000050
--   missing  00000000-0000-0000-0000-000000000099  (block 8 only; never inserted)
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TEMP TABLE _vr (
  id       SERIAL PRIMARY KEY,
  scenario TEXT    NOT NULL,
  expected TEXT    NOT NULL,
  actual   TEXT    NOT NULL,
  pass     BOOLEAN NOT NULL
);

DO $$
DECLARE
  c   CONSTANT UUID := '00000000-0000-0000-0000-0000000000aa';
  bt  CONSTANT UUID := '00000000-0000-0000-0000-000000000010';
  inv CONSTANT UUID := '00000000-0000-0000-0000-000000000020';
  ap  CONSTANT UUID := '00000000-0000-0000-0000-000000000030';
  jnl CONSTANT UUID := '00000000-0000-0000-0000-000000000040';
  bm  CONSTANT UUID := '00000000-0000-0000-0000-000000000050';

  -- Working variables.  Savepoint rollbacks unwind table data only;
  -- these memory variables retain whatever was last assigned.
  v1 TEXT;    v2 TEXT;    v3 TEXT;
  n1 NUMERIC; n2 NUMERIC; n3 NUMERIC;
  b1 BOOLEAN; b2 BOOLEAN;
  i1 INT;     i2 INT;
  jr JSONB;
  act TEXT;   ok BOOLEAN;
BEGIN

  ---------------------------------------------------------------------------
  -- 1. approve_ap_bill
  --    EXPECT  journal: Dr 6100 / Cr 2000, 1230.00, is_accrual_reversal=false
  --    EXPECT  bill: status=pending, approved_at IS NOT NULL
  ---------------------------------------------------------------------------
  BEGIN
    INSERT INTO companies (id, clerk_user_id, name)
      VALUES (c, 'u', '__t__');
    INSERT INTO ap_invoices (
        id, company_id, invoice_ref, supplier, amount,
        gross_amount, net_amount, vat_amount, vat_code,
        nominal_code, suggested_nominal, invoice_date, status)
      VALUES (ap, c, 'IV-1', 'ACME', 1230,
              1230, 1000, 230, 'STD23', '6100', '6100', '2026-05-15', 'needs_review');
    PERFORM approve_ap_bill(c, ap, 1230, '6100', 'STD23',
      '2026-05-15'::date, 'ACME', 'IV-1', 1000, 230, '2026-06-15'::date);
    SELECT debit_account, credit_account, amount, is_accrual_reversal
      INTO v1, v2, n1, b1
      FROM journals WHERE company_id = c;
    SELECT status INTO v3 FROM ap_invoices WHERE id = ap;
    act := format('Dr %s/Cr %s %s accrual=%s bill=%s',
                  v1, v2, to_char(n1,'FM99990.00'), b1, v3);
    RAISE EXCEPTION 'done';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  ok := v1='6100' AND v2='2000' AND n1=1230 AND b1=false AND v3='pending';
  INSERT INTO _vr(scenario,expected,actual,pass) VALUES
    ('1. AP approve',
     'Dr 6100/Cr 2000 1230.00 accrual=false bill=pending',
     act, ok);

  ---------------------------------------------------------------------------
  -- 2. mark_ap_bill_paid
  --    EXPECT  journal: Dr 2000 / Cr 1000, 1230.00
  --    EXPECT  bill: status=paid, amount_paid=1230.00
  ---------------------------------------------------------------------------
  BEGIN
    INSERT INTO companies (id, clerk_user_id, name)
      VALUES (c, 'u', '__t__');
    INSERT INTO ap_invoices (
        id, company_id, invoice_ref, supplier, amount,
        gross_amount, vat_code, nominal_code, invoice_date, status)
      VALUES (ap, c, 'IV-2', 'ACME', 1230, 1230, 'STD23', '6100', '2026-05-15', 'pending');
    PERFORM mark_ap_bill_paid(c, ap, 1230, '2026-05-20'::date);
    SELECT debit_account, credit_account, amount INTO v1, v2, n1
      FROM journals WHERE company_id = c;
    SELECT status, amount_paid INTO v3, n2 FROM ap_invoices WHERE id = ap;
    act := format('Dr %s/Cr %s %s bill=%s paid=%s',
                  v1, v2, to_char(n1,'FM99990.00'), v3, to_char(n2,'FM99990.00'));
    RAISE EXCEPTION 'done';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  ok := v1='2000' AND v2='1000' AND n1=1230 AND v3='paid' AND n2=1230;
  INSERT INTO _vr(scenario,expected,actual,pass) VALUES
    ('2. Mark paid',
     'Dr 2000/Cr 1000 1230.00 bill=paid paid=1230.00',
     act, ok);

  ---------------------------------------------------------------------------
  -- 3. confirm_settlement — AR full settlement €1,230
  --    Pre-loaded suggested match → suggestion_kept=true on confirmed row.
  --    EXPECT  journal: Dr 1000 / Cr 1100, 1230.00
  --    EXPECT  invoice: status=paid, reconciled=true, suggestion_kept=true
  ---------------------------------------------------------------------------
  BEGIN
    INSERT INTO companies (id, clerk_user_id, name)
      VALUES (c, 'u', '__t__');
    INSERT INTO bank_transactions (id, company_id, date, description, amount, reconciled)
      VALUES (bt, c, '2026-05-15', 'Receipt', 1230, false);
    INSERT INTO invoices (
        id, company_id, invoice_ref, client, amount,
        invoice_date, total, amount_paid, status)
      VALUES (inv, c, 'INV-1', 'Client', 1230, '2026-05-01', 1230, 0, 'sent');
    INSERT INTO bank_matches (
        id, company_id, bank_transaction_id, matched_type, matched_id,
        confidence, status, matched_by)
      VALUES (bm, c, bt, 'invoice', inv, 90, 'suggested', 'auto');
    PERFORM confirm_settlement(c, bt, 'invoice',
      format('[{"invoice_id":"%s","invoice_type":"ar",'
             '"allocated_amount":1230,"difference_amount":0,'
             '"difference_nominal":"6500"}]', inv)::jsonb,
      NULL, NULL);
    SELECT debit_account, credit_account, amount INTO v1, v2, n1
      FROM journals WHERE company_id = c;
    SELECT status, amount_paid INTO v3, n2 FROM invoices WHERE id = inv;
    SELECT reconciled INTO b1 FROM bank_transactions WHERE id = bt;
    SELECT suggestion_kept INTO b2
      FROM bank_matches WHERE company_id = c AND status = 'confirmed';
    act := format('Dr %s/Cr %s %s inv=%s recon=%s kept=%s',
                  v1, v2, to_char(n1,'FM99990.00'), v3, b1, b2);
    RAISE EXCEPTION 'done';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  ok := v1='1000' AND v2='1100' AND n1=1230 AND v3='paid' AND b1=true AND b2=true;
  INSERT INTO _vr(scenario,expected,actual,pass) VALUES
    ('3. AR settle full',
     'Dr 1000/Cr 1100 1230.00 inv=paid recon=true kept=true',
     act, ok);

  ---------------------------------------------------------------------------
  -- 4. confirm_settlement — AR partial €2,000 of €5,000
  --    EXPECT  invoice: status=part_paid, amount_paid=2000, outstanding=3000
  ---------------------------------------------------------------------------
  BEGIN
    INSERT INTO companies (id, clerk_user_id, name)
      VALUES (c, 'u', '__t__');
    INSERT INTO bank_transactions (id, company_id, date, description, amount, reconciled)
      VALUES (bt, c, '2026-05-15', 'Partial receipt', 2000, false);
    INSERT INTO invoices (
        id, company_id, invoice_ref, client, amount,
        invoice_date, total, amount_paid, status)
      VALUES (inv, c, 'INV-2', 'Client', 5000, '2026-05-01', 5000, 0, 'sent');
    PERFORM confirm_settlement(c, bt, 'invoice',
      format('[{"invoice_id":"%s","invoice_type":"ar",'
             '"allocated_amount":2000,"difference_amount":0,'
             '"difference_nominal":"6500"}]', inv)::jsonb,
      NULL, NULL);
    SELECT status, amount_paid, total - amount_paid INTO v3, n2, n3
      FROM invoices WHERE id = inv;
    act := format('inv=%s paid=%s outstanding=%s',
                  v3, to_char(n2,'FM99990.00'), to_char(n3,'FM99990.00'));
    RAISE EXCEPTION 'done';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  ok := v3='part_paid' AND n2=2000 AND n3=3000;
  INSERT INTO _vr(scenario,expected,actual,pass) VALUES
    ('4. AR partial',
     'inv=part_paid paid=2000.00 outstanding=3000.00',
     act, ok);

  ---------------------------------------------------------------------------
  -- 5. confirm_settlement — tolerance write-off (€0.50 surplus)
  --    Bank received €1,000.50 for a €1,000 invoice.
  --    allocated=1000, difference=0.50  →  total=1000.50=bankAbs ✓
  --    (The write-off direction is always surplus: bank got MORE than the invoice.
  --     allocated+difference must equal bankAbs exactly.)
  --    EXPECT  2 journals: Dr 1000/Cr 1100 1000.00 + Dr 6500/Cr 1100 0.50
  --    EXPECT  invoice: status=paid, amount_paid=1000.50
  ---------------------------------------------------------------------------
  BEGIN
    INSERT INTO companies (id, clerk_user_id, name)
      VALUES (c, 'u', '__t__');
    INSERT INTO bank_transactions (id, company_id, date, description, amount, reconciled)
      VALUES (bt, c, '2026-05-15', 'Receipt surplus', 1000.50, false);
    INSERT INTO invoices (
        id, company_id, invoice_ref, client, amount,
        invoice_date, total, amount_paid, status)
      VALUES (inv, c, 'INV-3', 'Client', 1000, '2026-05-01', 1000, 0, 'sent');
    PERFORM confirm_settlement(c, bt, 'invoice',
      format('[{"invoice_id":"%s","invoice_type":"ar",'
             '"allocated_amount":1000,"difference_amount":0.50,'
             '"difference_nominal":"6500"}]', inv)::jsonb,
      NULL, NULL);
    SELECT count(*) INTO i1 FROM journals WHERE company_id = c;
    SELECT string_agg(
        format('Dr %s/Cr %s %s', debit_account, credit_account, to_char(amount,'FM99990.00')),
        ' + ' ORDER BY amount DESC
      ) INTO v1
      FROM journals WHERE company_id = c;
    SELECT status, amount_paid INTO v3, n2 FROM invoices WHERE id = inv;
    act := format('%s jnls: %s inv=%s paid=%s',
                  i1, v1, v3, to_char(n2,'FM99990.00'));
    RAISE EXCEPTION 'done';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  ok := i1=2 AND v3='paid' AND n2=1000.50;
  INSERT INTO _vr(scenario,expected,actual,pass) VALUES
    ('5. Tolerance write-off',
     '2 jnls: Dr 1000/Cr 1100 1000.00 + Dr 6500/Cr 1100 0.50 inv=paid paid=1000.50',
     act, ok);

  ---------------------------------------------------------------------------
  -- 6. confirm_journal_match — categorise-confirm
  --    bt.amount=-50 (payment) → RPC checks debit_account vs suggested_nominal
  --    journal.debit_account='6100' = suggested_nominal_code='6100' → kept=true
  --    EXPECT  bt: reconciled=true, settlement_type=categorise
  --    EXPECT  match: suggestion_kept=true
  ---------------------------------------------------------------------------
  BEGIN
    INSERT INTO companies (id, clerk_user_id, name)
      VALUES (c, 'u', '__t__');
    INSERT INTO bank_transactions (id, company_id, date, description, amount, reconciled)
      VALUES (bt, c, '2026-05-15', 'Office supplies', -50, false);
    INSERT INTO journals (
        id, company_id, date, description,
        debit_account, credit_account, amount,
        vat_code, reference, is_accrual_reversal)
      VALUES (jnl, c, '2026-05-15', 'Office supplies',
              '6100', '1000', 50, 'STD23', 'CAT-1', false);
    INSERT INTO bank_matches (
        id, company_id, bank_transaction_id, matched_type, matched_id,
        confidence, status, matched_by, suggested_nominal_code)
      VALUES (bm, c, bt, 'journal', jnl, 85, 'suggested', 'auto', '6100');
    PERFORM confirm_journal_match(c, bm, bt);
    SELECT reconciled, settlement_type INTO b1, v1
      FROM bank_transactions WHERE id = bt;
    SELECT suggestion_kept INTO b2 FROM bank_matches WHERE id = bm;
    act := format('recon=%s stype=%s kept=%s', b1, v1, b2);
    RAISE EXCEPTION 'done';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  ok := b1=true AND v1='categorise' AND b2=true;
  INSERT INTO _vr(scenario,expected,actual,pass) VALUES
    ('6. Categorise-confirm',
     'recon=true stype=categorise kept=true',
     act, ok);

  ---------------------------------------------------------------------------
  -- 7. Idempotency
  --    7A: approve_ap_bill on already-pending bill → {idempotent:true}, 0 journals
  --    7B: confirm_journal_match on already-reconciled bt → {idempotent:true},
  --        bank_match still 'suggested'
  --    EXPECT  combined: approve idempotent=true jnls=0; confirm idempotent=true match=suggested
  ---------------------------------------------------------------------------

  -- 7A ─────────────────────────────────────────────────────────────────────
  BEGIN
    INSERT INTO companies (id, clerk_user_id, name)
      VALUES (c, 'u', '__t__');
    INSERT INTO ap_invoices (
        id, company_id, invoice_ref, supplier, amount,
        gross_amount, vat_code, nominal_code, invoice_date, status)
      VALUES (ap, c, 'IV-IDM', 'ACME', 1230, 1230, 'STD23', '6100', '2026-05-15', 'pending');
    SELECT approve_ap_bill(c, ap, 1230, '6100', 'STD23',
      '2026-05-15'::date, 'ACME', 'IV-IDM', 1000, 230, NULL) INTO jr;
    SELECT count(*) INTO i1 FROM journals WHERE company_id = c;
    -- Capture before RAISE so value survives the savepoint rollback
    v1 := format('approve idempotent=%s jnls=%s', jr->>'idempotent', i1);
    RAISE EXCEPTION 'done';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- 7B ─────────────────────────────────────────────────────────────────────
  BEGIN
    INSERT INTO companies (id, clerk_user_id, name)
      VALUES (c, 'u', '__t__');
    INSERT INTO bank_transactions (id, company_id, date, description, amount, reconciled)
      VALUES (bt, c, '2026-05-15', 'Reconciled', -50, true);
    INSERT INTO journals (
        id, company_id, date, description,
        debit_account, credit_account, amount,
        vat_code, reference, is_accrual_reversal)
      VALUES (jnl, c, '2026-05-15', 'x', '6100', '1000', 50, 'STD23', 'IDM-1', false);
    INSERT INTO bank_matches (
        id, company_id, bank_transaction_id, matched_type, matched_id,
        confidence, status, matched_by)
      VALUES (bm, c, bt, 'journal', jnl, 85, 'suggested', 'auto');
    SELECT confirm_journal_match(c, bm, bt) INTO jr;
    SELECT status INTO v2 FROM bank_matches WHERE id = bm;
    v1 := v1 || format('; confirm idempotent=%s match=%s', jr->>'idempotent', v2);
    RAISE EXCEPTION 'done';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  act := v1;
  ok  := act = 'approve idempotent=true jnls=0; confirm idempotent=true match=suggested';
  INSERT INTO _vr(scenario,expected,actual,pass) VALUES
    ('7. Idempotency',
     'approve idempotent=true jnls=0; confirm idempotent=true match=suggested',
     act, ok);

  ---------------------------------------------------------------------------
  -- 8. Forced failure — atomicity proof
  --    bt=500, inv1=300 (exists), inv2 missing (id ...099, never inserted).
  --    Allocation total 300+200=500=bankAbs → passes validation.
  --    Loop writes journal+allocation for inv1, then raises on inv2.
  --    Inner BEGIN…EXCEPTION catches the raise and rolls back to the implicit
  --    savepoint at the start of that inner block, undoing ALL RPC writes.
  --    Outer scenario block is still intact; we can read the (clean) tables.
  --    EXPECT  journals=0, reconciled=false, allocs=0, inv_paid=0.00
  ---------------------------------------------------------------------------
  BEGIN
    INSERT INTO companies (id, clerk_user_id, name)
      VALUES (c, 'u', '__t__');
    INSERT INTO bank_transactions (id, company_id, date, description, amount, reconciled)
      VALUES (bt, c, '2026-05-15', 'Atomicity test', 500, false);
    INSERT INTO invoices (
        id, company_id, invoice_ref, client, amount,
        invoice_date, total, amount_paid, status)
      VALUES (inv, c, 'INV-ATM', 'Client', 300, '2026-05-01', 300, 0, 'sent');

    -- Inner block: RPC will raise on missing inv2; all its writes roll back here.
    BEGIN
      PERFORM confirm_settlement(c, bt, 'invoice',
        format(
          '[{"invoice_id":"%s","invoice_type":"ar","allocated_amount":300,"difference_amount":0,"difference_nominal":"6500"},'
          '{"invoice_id":"00000000-0000-0000-0000-000000000099","invoice_type":"ar","allocated_amount":200,"difference_amount":0,"difference_nominal":"6500"}]',
          inv)::jsonb,
        NULL, NULL);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- All four counters must be zero — proving the atomicity rollback was complete.
    SELECT count(*) INTO i1 FROM journals            WHERE company_id = c;
    SELECT reconciled INTO b1 FROM bank_transactions WHERE id = bt;
    SELECT count(*) INTO i2 FROM settlement_allocations WHERE company_id = c;
    SELECT amount_paid INTO n1 FROM invoices         WHERE id = inv;
    act := format('jnls=%s recon=%s allocs=%s inv_paid=%s',
                  i1, b1, i2, to_char(n1,'FM99990.00'));
    RAISE EXCEPTION 'done';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  ok := i1=0 AND b1=false AND i2=0 AND n1=0;
  INSERT INTO _vr(scenario,expected,actual,pass) VALUES
    ('8. Forced failure (atomicity)',
     'jnls=0 recon=false allocs=0 inv_paid=0.00',
     act, ok);

END $$;

-- ── Single combined results grid ──────────────────────────────────────────
SELECT
  id                                              AS "#",
  scenario,
  expected,
  actual,
  CASE WHEN pass THEN 'PASS' ELSE '*** FAIL ***' END AS result
FROM _vr
ORDER BY id;

ROLLBACK;
-- DB is now unchanged: ROLLBACK undoes the CREATE TEMP TABLE, all _vr inserts,
-- and any table writes that might have escaped an exception block.
