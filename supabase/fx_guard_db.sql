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
