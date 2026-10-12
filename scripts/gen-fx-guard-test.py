import sys
root = sys.argv[1]
mig = open(root + '/supabase/fx_guard_db.sql', encoding='utf-8').read()
FZ = "5f4e4585-8937-4624-b0fc-079a8379a160"; OC = "1d4bf5bd-3f2f-4919-b972-b00b2b9cac99"
GBP = "00000000-0000-0000-0000-0000000f0101"; EUR = "00000000-0000-0000-0000-0000000f0102"
# expected-result patterns (POSIX regex, matched against the error or "ok, N row(s)")
POSTED = "can''t be posted yet"; SETTLED = "can''t be settled against"; MATCHED = "can''t be matched yet"; TOEUR = "can''t be changed to EUR"
RLS = "row-level security"; ZERO = "^ok, 0 row"; ONE = "^ok, 1 row"; DENIED = "permission denied"; NF = "Transaction not found"
# test name, sql, expected for (accountant and business owner, another company's user, anon)
T = [
 ("01 insert GBP line, reconciled (import posting)", f"INSERT INTO bank_transactions(company_id, revolut_id, date, description, amount, currency, reconciled) VALUES ('{FZ}','FXT-NEW-GBP',current_date,'x',-5,'GBP',true)", POSTED, RLS, RLS),
 ("02 insert GBP line, unreconciled (reference only)", f"INSERT INTO bank_transactions(company_id, revolut_id, date, description, amount, currency, reconciled) VALUES ('{FZ}','FXT-NEW-GBP2',current_date,'x',-5,'GBP',false)", ONE, RLS, RLS),
 ("03 reconcile the GBP line (Categorise / transfer)", f"UPDATE bank_transactions SET reconciled = true WHERE id = '{GBP}'", SETTLED, ZERO, ZERO),
 ("04 switch the GBP line to EUR", f"UPDATE bank_transactions SET currency = 'EUR' WHERE id = '{GBP}'", TOEUR, ZERO, ZERO),
 ("05 journal referencing the GBP line (its company)", f"INSERT INTO journals(company_id, date, description, debit_account, credit_account, amount, reference) VALUES ('{FZ}',current_date,'x','6600','1000',12.5,'FXT-GBP')", POSTED, RLS, RLS),
 ("06 confirmed match on the GBP line (its company)", f"INSERT INTO bank_matches(company_id, bank_transaction_id, matched_type, matched_id, confidence, status, matched_by) VALUES ('{FZ}','{GBP}','journal',gen_random_uuid(),100,'confirmed','user')", MATCHED, RLS, RLS),
 ("07 settle the GBP line (confirm_settlement)", f"SELECT confirm_settlement('{FZ}','{GBP}','on_account',NULL,'supplier','FX test')", SETTLED, NF, DENIED),
 ("08 control: insert EUR line, reconciled", f"INSERT INTO bank_transactions(company_id, revolut_id, date, description, amount, currency, reconciled) VALUES ('{FZ}','FXT-NEW-EUR',current_date,'x',-5,'EUR',true)", ONE, RLS, RLS),
 ("09 control: euro-printed line, reconciled", f"INSERT INTO bank_transactions(company_id, revolut_id, date, description, amount, currency, reconciled, original_currency, original_amount, printed_eur_amount) VALUES ('{FZ}','FXT-NEW-EP',current_date,'x',-5.8,'EUR',true,'GBP',-5,-5.8)", ONE, RLS, RLS),
 ("10 control: journal referencing the EUR line", f"INSERT INTO journals(company_id, date, description, debit_account, credit_account, amount, reference) VALUES ('{FZ}',current_date,'x','6600','1000',12.5,'FXT-EUR')", ONE, RLS, RLS),
 ("11 control: reconcile the EUR line", f"UPDATE bank_transactions SET reconciled = true WHERE id = '{EUR}'", ONE, ZERO, ZERO),
 # the caller's own company (S&P, for another company's user) with the Fitzsimons GBP line as the reference
 ("12 journal in S&P referencing the Fitzsimons GBP line", f"INSERT INTO journals(company_id, date, description, debit_account, credit_account, amount, reference) VALUES ('{OC}',current_date,'x','6600','1000',12.5,'FXT-GBP')", RLS, ONE, RLS),
 ("13 confirmed match in S&P on the Fitzsimons GBP line id", f"INSERT INTO bank_matches(company_id, bank_transaction_id, matched_type, matched_id, confidence, status, matched_by) VALUES ('{OC}','{GBP}','journal',gen_random_uuid(),100,'confirmed','user')", RLS, ONE + "|bank_matches_line_same_company|not found in this company", RLS),  # refused once fx_followup_vat_and_match_scope.sql is live
 ("14 categorise_bank_line on the EUR line", f"SELECT categorise_bank_line('{FZ}','{EUR}',current_date,'x','6600','1000',12.5,'REC-FXT')", ONE, NF, DENIED),
 ("15 categorise_bank_line on the GBP line", f"SELECT categorise_bank_line('{FZ}','{GBP}',current_date,'x','6600','1000',12.5,'REC-FXT')", SETTLED, NF, DENIED),
]
q = lambda s: "$q$" + s + "$q$"
e = lambda s: "'" + s + "'"
rows = ",\n      ".join(f"({e(n)}, {q(sql)}, {e(a)}, {e(o)}, {e(an)})" for n, sql, a, o, an in T)
tests = """
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
  c   uuid := '__FZ__';
  oc  uuid := '__OC__';
  r jsonb := '[]'::jsonb; msg text; who record; t record; n bigint; exp text; fails int := 0;
BEGIN
  INSERT INTO user_company_access(user_id, company_id, role) VALUES
    ('fxtest_accountant', c, 'accountant'), ('fxtest_owner', c, 'business_owner'), ('fxtest_other', oc, 'accountant');
  INSERT INTO bank_transactions(id, company_id, revolut_id, date, description, amount, currency, reconciled)
  VALUES ('__GBP__', c, 'FXT-GBP', current_date, 'fx guard GBP line', -12.50, 'GBP', false),
         ('__EUR__', c, 'FXT-EUR', current_date, 'fx guard EUR line', -12.50, 'EUR', false);

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
      IF who.label IN ('other_company', 'anon') AND msg ~ 'can''t be (posted|settled|matched|changed)' THEN fails := fails + 1; END IF;
      r := r || jsonb_build_object('who', who.label, 'test', t.name, 'pass', msg ~ exp, 'result', msg);
    END LOOP;
  END LOOP;
  RAISE EXCEPTION 'ROLLED BACK. % failure(s). results=%', fails, r::text;
END $fx$;
""".replace('__FZ__', FZ).replace('__OC__', OC).replace('__GBP__', GBP).replace('__EUR__', EUR).replace('__ROWS__', rows)
out = ("-- Rolled-back test of supabase/fx_guard_db.sql (guard + categorise_bank_line) against the live\n"
       "-- schema. Nothing persists: the test block ends by raising its results, which aborts the whole\n"
       "-- transaction (the guard's DDL included). The error's first line reads \"N failure(s)\".\n"
       "-- Generated from fx_guard_db.sql by the session's generator; keep the two in step.\nBEGIN;\n\n" + mig + tests + "\nROLLBACK;\n")
open(root + '/supabase/fx_guard_db_test.sql', 'w', encoding='utf-8').write(out)
print(len(out))
