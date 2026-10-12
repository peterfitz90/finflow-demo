import sys
root = sys.argv[1]
mig = open(root + '/supabase/fx_followup_vat_and_match_scope.sql', encoding='utf-8').read()
FZ = "5f4e4585-8937-4624-b0fc-079a8379a160"; SP = "1d4bf5bd-3f2f-4919-b972-b00b2b9cac99"; EL = "e1599dfc-9988-4d10-aeef-33de252b9c02"
EURL = "00000000-0000-0000-0000-0000000f0202"          # fixture: unreconciled EUR line on Fitzsimons
AP = "00000000-0000-0000-0000-0000000f0203"            # fixture: supplier bill on Fitzsimons
FZJ = "32d24760-5fce-47df-94dd-20bc44afc7ff"; FZINV = "698ae270-ea45-48e5-9271-65119681b7ba"
SPJ = "ae0943c0-cf3b-4ea6-a591-209881d9d367"; SPL = "3da66a02-fd1d-42a3-b4ee-4d8545fb08c8"
OK1 = "^ok, 1 row"; RLS = "row-level security"; NF = "Transaction not found"; DENIED = "permission denied"
ELSEWHERE = "not found in this company"; FK = "bank_matches_line_same_company"
def match(co, line, typ, mid):
    return f"INSERT INTO bank_matches(company_id, bank_transaction_id, matched_type, matched_id, confidence, status, matched_by) VALUES ('{co}','{line}','{typ}','{mid}',75,'suggested','user')"
# name, sql, expected for (accountant and business owner of Fitzsimons, S&P's accountant, anon)
T = [
 ("M1 match: Fitzsimons line, Fitzsimons journal", match(FZ, EURL, 'journal', FZJ), OK1, RLS, RLS),
 ("M2 match: Fitzsimons line, Fitzsimons sales invoice", match(FZ, EURL, 'invoice', FZINV), OK1, RLS, RLS),
 ("M3 match: Fitzsimons line, Fitzsimons supplier bill", match(FZ, EURL, 'invoice', AP), OK1, RLS, RLS),
 ("M4 match in Fitzsimons on an S&P journal", match(FZ, EURL, 'journal', SPJ), ELSEWHERE, RLS, RLS),
 ("M5 match in Fitzsimons on an S&P bank line", match(FZ, SPL, 'journal', FZJ), FK, RLS, RLS),
 ("M6 match in S&P on a Fitzsimons bank line (case 13)", match(SP, EURL, 'journal', SPJ), RLS, FK, RLS),
 ("M7 match in S&P on a Fitzsimons journal", match(SP, SPL, 'journal', FZJ), RLS, ELSEWHERE, RLS),
 ("M8 match on a journal id that does not exist", match(FZ, EURL, 'journal', '00000000-0000-0000-0000-0000000f0999'), ELSEWHERE, RLS, RLS),
 ("M9 settle on account (confirm_settlement writes a match)", f"SELECT confirm_settlement('{FZ}','{EURL}','on_account',NULL,'supplier','FX test')", OK1, NF, DENIED),
 ("M10 categorise the EUR line (categorise_bank_line writes a match)", f"SELECT categorise_bank_line('{FZ}','{EURL}',current_date,'x','6600','1000',12.5,'REC-FXT')", OK1, NF, DENIED),
]
q = lambda s: "$q$" + s + "$q$"
e = lambda s: "'" + s + "'"
rows = ",\n      ".join(f"({e(n)}, {q(sql)}, {e(a)}, {e(o)}, {e(an)})" for n, sql, a, o, an in T)
# VAT cases, as Fitzsimons' and Elevate's accountant: source line (copied unreconciled), debit, credit, expected VAT code
V = [
 ("V1 Elevate money out to 6600 (STD23)", "6e7fc2de-70bd-445a-a784-2d3ee19cccf9", "6600", "1000", "STD23"),
 ("V2 Elevate money out to 6500 (EXEMPT)", "6e7fc2de-70bd-445a-a784-2d3ee19cccf9", "6500", "1000", "EXEMPT"),
 ("V3 Elevate money in to 4000 (STD23)", "9a4e8bef-6c56-4703-9035-0e0c95084659", "1000", "4000", "STD23"),
 ("V4 Fitzsimons money out to 6600 (no defaults in its chart)", "ca59361e-ffbb-4f84-8f0d-bfb9337e0523", "6600", "1000", None),
 ("V5 Elevate, both legs replaced, money out: debit 6500", "6e7fc2de-70bd-445a-a784-2d3ee19cccf9", "6500", "2000", "EXEMPT"),
 ("V6 Elevate, legs entered the other way round: bank on the debit", "6e7fc2de-70bd-445a-a784-2d3ee19cccf9", "1000", "6600", "STD23"),
]
vrows = ",\n      ".join(f"({e(n)}, '{src}'::uuid, '{dr}', '{cr}', {e(x) if x else 'NULL'})" for n, src, dr, cr, x in V)
tests = """
-- ── Tests (same transaction as the migration above; all undone) ───────────────────────────
-- Matches: as Fitzsimons' accountant and business owner, S&P's accountant, and anon. VAT: as
-- an accountant of Fitzsimons and Elevate, Categorise on unreconciled copies of real lines.
-- Nothing persists: the block ends by raising its results, which aborts the transaction.
DO $fu$
DECLARE
  r jsonb := '[]'::jsonb; msg text; who record; t record; n bigint; exp text; fails int := 0; tgt uuid; res jsonb;
BEGIN
  INSERT INTO user_company_access(user_id, company_id, role) VALUES
    ('fxtest_accountant', '__FZ__', 'accountant'), ('fxtest_owner', '__FZ__', 'business_owner'),
    ('fxtest_other', '__SP__', 'accountant'), ('fxtest_accountant', '__EL__', 'accountant');
  INSERT INTO bank_transactions(id, company_id, revolut_id, date, description, amount, currency, reconciled)
  VALUES ('__EURL__', '__FZ__', 'FXT-EUR-2', current_date, 'follow-up EUR line', -12.50, 'EUR', false);
  INSERT INTO ap_invoices(id, company_id, invoice_ref, supplier, amount) VALUES ('__AP__', '__FZ__', 'FXT-AP', 'Follow-up test supplier', 12.50);

  FOR who IN SELECT * FROM (VALUES ('accountant','authenticated','fxtest_accountant'), ('business_owner','authenticated','fxtest_owner'),
                                   ('other_company','authenticated','fxtest_other'), ('anon','anon',NULL)) v(label, role, sub) LOOP
    FOR t IN SELECT * FROM (VALUES
      __ROWS__
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
      __VROWS__
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
"""
for k, v in {'__FZ__': FZ, '__SP__': SP, '__EL__': EL, '__EURL__': EURL, '__AP__': AP, '__ROWS__': rows, '__VROWS__': vrows}.items():
    tests = tests.replace(k, v)
out = ("-- Rolled-back test of supabase/fx_followup_vat_and_match_scope.sql against the live schema.\n"
       "-- Nothing persists: the test block ends by raising its results, aborting the whole transaction\n"
       "-- (the migration's DDL included). The error's first line reads \"N failure(s)\".\nBEGIN;\n\n" + mig + tests + "\nROLLBACK;\n")
open(root + '/supabase/fx_followup_test.sql', 'w', encoding='utf-8').write(out)
if len(sys.argv) > 2: open(sys.argv[2], 'w', encoding='utf-8').write(out)
print(len(out))
