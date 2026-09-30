// Bank / cash balance from the ledger — shared by the full app (Overview, Cash Flow, Practice
// Dashboard, AI chat context) and /mobile, so every screen shows the same cash figure.
import { supabase } from "../supabase.js";

// The bank nominal every import path (Yapily, CSV, Stripe default) posts against — see
// api/yapily/ingest.js and the CSV BankImport pipeline. Not configurable per-account today.
export const BANK_NOMINAL_CODE = '1000';

// Cumulative balance of one or more nominal accounts, from inception up to and including
// `asOfDate` — the same inception-unbounded, debit-normal approach the Balance Sheet fix uses
// for Asset/Liability/Equity accounts (see GLReport's bsJournals/tbRows). Used here so Cash
// Flow's opening balance always agrees with the Balance Sheet's bank balance as at that date,
// rather than recomputing it a different way.
//
// Item 2 / balance-consolidation: nominalCodeOrCodes accepts a single code (unchanged
// behavior, byte-identical query/result to before this change) or an array, so a company with
// more than one real bank account can get its combined cash balance in one call instead of
// every caller hardcoding a single nominal. A transfer between two of the summed accounts nets
// to zero in the combined total, which is correct — total cash doesn't move.
//
// Summed server-side by the nominal_balance_as_of RPC (supabase/add_nominal_balance_rpc.sql),
// not by fetching raw journal rows: PostgREST silently caps every response at 1,000 rows, so a
// client-side sum truncated without error once a company's matching journals passed that (the
// largest company sat at 992). Same debit-normal semantics; returns exact cents rather than the
// float-accumulated sum the old reduce produced.
export async function fetchNominalBalanceAsOf(companyId, nominalCodeOrCodes, asOfDate) {
  const codes = Array.isArray(nominalCodeOrCodes) ? nominalCodeOrCodes : [nominalCodeOrCodes];
  if (!codes.length) return 0;
  const { data, error } = await supabase.rpc('nominal_balance_as_of', {
    p_company_id: companyId, p_codes: codes, p_as_of: asOfDate,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

// Item 2 — a company's active bank_accounts nominal codes, so balance lookups can sum across
// every real account instead of assuming a single hardcoded nominal. Plain async function (not
// a hook) so it can also be called per-company inside a loop (Practice Dashboard) where hooks
// rules forbid calling useActiveBankNominals itself.
export async function fetchActiveBankNominals(companyId) {
  if (!companyId) return [];
  const { data } = await supabase.from('bank_accounts').select('nominal_code').eq('company_id', companyId).eq('is_active', true);
  return (data || []).map(a => a.nominal_code).filter(Boolean);
}

// Combined ledger balance of a company's active bank accounts (falling back to the default bank
// nominal) as at `asOfDate` (YYYY-MM-DD). Throws on RPC error.
export async function fetchCashBalance(companyId, asOfDate) {
  const codes = await fetchActiveBankNominals(companyId);
  return fetchNominalBalanceAsOf(companyId, codes.length ? codes : [BANK_NOMINAL_CODE], asOfDate);
}
