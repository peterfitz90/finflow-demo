-- GEO-02 interim: the ledger is EUR-only, so a foreign-currency bank line never posts its face
-- value as euro (src/shared/fxGuard.js).
--
-- 1. A line from a non-EUR section that printed a euro amount on every line posts that euro
--    amount (bank_transactions.amount, currency 'EUR') and records what was printed. All three
--    columns are set together or not at all.
ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS original_currency  text,
  ADD COLUMN IF NOT EXISTS original_amount    numeric(14,2),
  ADD COLUMN IF NOT EXISTS printed_eur_amount numeric(14,2);

ALTER TABLE public.bank_transactions DROP CONSTRAINT IF EXISTS bank_transactions_original_fx_complete;
ALTER TABLE public.bank_transactions ADD CONSTRAINT bank_transactions_original_fx_complete CHECK (
  (original_currency IS NULL AND original_amount IS NULL AND printed_eur_amount IS NULL)
  OR (original_currency IS NOT NULL AND original_amount IS NOT NULL AND printed_eur_amount IS NOT NULL
      AND printed_eur_amount = amount AND coalesce(currency, 'EUR') = 'EUR')
);

COMMENT ON COLUMN public.bank_transactions.original_currency  IS 'GEO-02: currency of the statement section this euro line came from';
COMMENT ON COLUMN public.bank_transactions.original_amount    IS 'GEO-02: the line''s amount in original_currency, as printed';
COMMENT ON COLUMN public.bank_transactions.printed_eur_amount IS 'GEO-02: the euro amount printed on the line, which is what posted';

-- 2. confirm_settlement refuses a foreign-currency line (invoice, bill or on account). Patched
--    in place so the rest of the live definition, its owner and its grants are unchanged.
DO $$
DECLARE
  d   text := pg_get_functiondef('public.confirm_settlement(uuid,uuid,text,jsonb,text,text)'::regprocedure);
  anchor text := E'  v_is_receipt := v_bt.amount > 0;\n';
BEGIN
  IF position('GEO-02' IN d) > 0 THEN RETURN; END IF;   -- already applied
  IF (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'confirm_settlement: anchor not found exactly once; not patched';
  END IF;
  d := replace(d, anchor,
    E'  -- GEO-02: the ledger is EUR-only; a foreign-currency line is not settled.\n'
 || E'  IF coalesce(v_bt.currency, ''EUR'') <> ''EUR'' THEN\n'
 || E'    RAISE EXCEPTION ''Foreign-currency lines can''''t be settled against an invoice or bill yet; multi-currency posting is planned.'';\n'
 || E'  END IF;\n\n'
 || anchor);
  EXECUTE d;
END $$;
