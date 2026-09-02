-- Grant service_role read access to tables the Yapily ingest reads server-side.
-- anon and authenticated have these grants already; service_role does not.
-- Without these, ingest.js silently gets null from both queries → txRules = []
-- (no rules fire) and coaMap = {} (no VAT codes) → everything categorised as Sundry.

GRANT SELECT ON public.transaction_rules  TO service_role;
GRANT SELECT ON public.chart_of_accounts  TO service_role;
