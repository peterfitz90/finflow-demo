// Chart of accounts — the static GL list, the per-company seed sets, and the hook that loads
// (and on first use seeds) a company's chart_of_accounts. Shared by the full app and /mobile.
import { useState, useEffect } from 'react';
import { supabase } from '../supabase.js';

export const GL_ACCOUNTS = [
  // Assets
  { code: "1000", name: "Bank — Current Account",  type: "Asset" },
  { code: "1100", name: "Trade Debtors",            type: "Asset" },
  { code: "1200", name: "Prepayments",              type: "Asset" },
  { code: "1300", name: "Stripe Clearing",          type: "Asset" },
  { code: "1500", name: "Fixed Assets",             type: "Asset" },
  { code: "1501", name: "Accum Dep — Fixed Assets",           type: "Asset" },
  { code: "1510", name: "Plant & Machinery",                  type: "Asset" },
  { code: "1511", name: "Accum Dep — Plant & Machinery",      type: "Asset" },
  { code: "1520", name: "Fixtures & Fittings",                type: "Asset" },
  { code: "1521", name: "Accum Dep — Fixtures & Fittings",   type: "Asset" },
  { code: "1530", name: "Computer Equipment",                 type: "Asset" },
  { code: "1531", name: "Accum Dep — Computer Equipment",    type: "Asset" },
  { code: "1540", name: "Motor Vehicles",                     type: "Asset" },
  { code: "1541", name: "Accum Dep — Motor Vehicles",         type: "Asset" },
  { code: "1600", name: "VAT Receivable",           type: "Asset" },
  // Liabilities
  { code: "2000", name: "Trade Creditors",          type: "Liability" },
  { code: "2100", name: "VAT Control",              type: "Liability" },
  { code: "1250", name: "Supplier Prepayments",     type: "Asset" },
  { code: "2200", name: "PAYE & PRSI Payable",      type: "Liability" },
  { code: "2250", name: "Net Wages Payable",        type: "Liability" },
  { code: "2260", name: "Pension Payable",          type: "Liability" },
  { code: "2300", name: "Accruals",                 type: "Liability" },
  { code: "2350", name: "Customer Advance Payments",type: "Liability" },
  { code: "2400", name: "Directors Loan Account",   type: "Liability" },
  { code: "2500", name: "Bank Loan",                type: "Liability" },
  // Capital
  { code: "3000", name: "Share Capital",            type: "Equity" },
  { code: "3100", name: "Retained Earnings",        type: "Equity" },
  // Income
  { code: "4000", name: "Sales Revenue",            type: "Income" },
  { code: "4100", name: "Service Income",           type: "Income" },
  { code: "4200", name: "Other Income",             type: "Income" },
  { code: "4300", name: "Interest Received",        type: "Income" },
  // Cost of Sales
  { code: "5000", name: "Cost of Sales",            type: "Expense" },
  { code: "5100", name: "Materials & Supplies",     type: "Expense" },
  { code: "5200", name: "Subcontractor Costs",      type: "Expense" },
  { code: "5300", name: "Direct Labour",            type: "Expense" },
  // Overheads
  { code: "6000", name: "Payroll & PAYE",           type: "Expense" },
  { code: "6100", name: "Rent & Rates",             type: "Expense" },
  { code: "6200", name: "Motor & Travel",           type: "Expense" },
  { code: "6300", name: "Telecoms & IT",            type: "Expense" },
  { code: "6400", name: "Professional Fees",        type: "Expense" },
  { code: "6500", name: "Bank Charges & Interest",  type: "Expense" },
  { code: "6600", name: "Sundry Expenses",          type: "Expense" },
  { code: "6750", name: "Settlement Rounding",      type: "Expense" },
  { code: "6700", name: "Marketing & Advertising",  type: "Expense" },
  { code: "6800", name: "Insurance",                type: "Expense" },
  { code: "6900", name: "Repairs & Maintenance",    type: "Expense" },
  { code: "6910", name: "Loss on Disposal of Assets", type: "Expense" },
  { code: "6950", name: "Depreciation",             type: "Expense" },
];

export const COA_SEED = [
  { code: "1000", name: "Bank — Current Account",  account_type: "asset",     category: "Current Assets",        is_system: true },
  { code: "1100", name: "Trade Debtors",            account_type: "asset",     category: "Current Assets",        is_system: true },
  { code: "1200", name: "Prepayments",              account_type: "asset",     category: "Current Assets",        is_system: true },
  { code: "1250", name: "Supplier Prepayments",     account_type: "asset",     category: "Current Assets",        is_system: true },
  { code: "1300", name: "Stripe Clearing",          account_type: "asset",     category: "Current Assets",        is_system: true },
  { code: "1500", name: "Fixed Assets",                          account_type: "asset",   category: "Fixed Assets", is_system: true },
  { code: "1501", name: "Accum Dep — Fixed Assets",           account_type: "asset",   category: "Fixed Assets", is_system: true },
  { code: "1510", name: "Plant & Machinery",                  account_type: "asset",   category: "Fixed Assets", is_system: true },
  { code: "1511", name: "Accum Dep — Plant & Machinery",      account_type: "asset",   category: "Fixed Assets", is_system: true },
  { code: "1520", name: "Fixtures & Fittings",                account_type: "asset",   category: "Fixed Assets", is_system: true },
  { code: "1521", name: "Accum Dep — Fixtures & Fittings",   account_type: "asset",   category: "Fixed Assets", is_system: true },
  { code: "1530", name: "Computer Equipment",                 account_type: "asset",   category: "Fixed Assets", is_system: true },
  { code: "1531", name: "Accum Dep — Computer Equipment",    account_type: "asset",   category: "Fixed Assets", is_system: true },
  { code: "1540", name: "Motor Vehicles",                     account_type: "asset",   category: "Fixed Assets", is_system: true },
  { code: "1541", name: "Accum Dep — Motor Vehicles",         account_type: "asset",   category: "Fixed Assets", is_system: true },
  { code: "1600", name: "VAT Receivable",           account_type: "asset",     category: "Current Assets",        is_system: true },
  { code: "2000", name: "Trade Creditors",          account_type: "liability", category: "Current Liabilities",   is_system: true },
  { code: "2100", name: "VAT Control",              account_type: "liability", category: "Current Liabilities",   is_system: true },
  { code: "2200", name: "PAYE & PRSI Payable",      account_type: "liability", category: "Current Liabilities",   is_system: true },
  { code: "2250", name: "Net Wages Payable",        account_type: "liability", category: "Current Liabilities",   is_system: true },
  { code: "2260", name: "Pension Payable",          account_type: "liability", category: "Current Liabilities",   is_system: true },
  { code: "2300", name: "Accruals",                 account_type: "liability", category: "Current Liabilities",   is_system: true },
  { code: "2350", name: "Customer Advance Payments",account_type: "liability", category: "Current Liabilities",   is_system: true },
  { code: "2400", name: "Directors Loan Account",   account_type: "liability", category: "Current Liabilities",   is_system: true },
  { code: "2500", name: "Bank Loan",                account_type: "liability", category: "Long-term Liabilities", is_system: true },
  { code: "3000", name: "Share Capital",            account_type: "equity",    category: "Equity",                is_system: true },
  { code: "3100", name: "Retained Earnings",        account_type: "equity",    category: "Equity",                is_system: true },
  { code: "4000", name: "Sales Revenue",            account_type: "income",    category: "Income",                is_system: true },
  { code: "4100", name: "Service Income",           account_type: "income",    category: "Income",                is_system: true },
  { code: "4200", name: "Other Income",             account_type: "income",    category: "Income",                is_system: true },
  { code: "4300", name: "Interest Received",        account_type: "income",    category: "Income",                is_system: true },
  { code: "5000", name: "Cost of Sales",            account_type: "expense",   category: "Cost of Sales",         is_system: true },
  { code: "5100", name: "Materials & Supplies",     account_type: "expense",   category: "Cost of Sales",         is_system: true },
  { code: "5200", name: "Subcontractor Costs",      account_type: "expense",   category: "Cost of Sales",         is_system: true },
  { code: "5300", name: "Direct Labour",            account_type: "expense",   category: "Cost of Sales",         is_system: true },
  { code: "6000", name: "Payroll & PAYE",           account_type: "expense",   category: "Overheads",             is_system: true },
  { code: "6100", name: "Rent & Rates",             account_type: "expense",   category: "Overheads",             is_system: true },
  { code: "6200", name: "Motor & Travel",           account_type: "expense",   category: "Overheads",             is_system: true },
  { code: "6300", name: "Telecoms & IT",            account_type: "expense",   category: "Overheads",             is_system: true },
  { code: "6400", name: "Professional Fees",        account_type: "expense",   category: "Overheads",             is_system: true },
  { code: "6500", name: "Bank Charges & Interest",  account_type: "expense",   category: "Overheads",             is_system: true },
  { code: "6600", name: "Sundry Expenses",          account_type: "expense",   category: "Overheads",             is_system: true },
  { code: "6750", name: "Settlement Rounding",      account_type: "expense",   category: "Overheads",             is_system: true },
  { code: "6700", name: "Marketing & Advertising",  account_type: "expense",   category: "Overheads",             is_system: true },
  { code: "6800", name: "Insurance",                account_type: "expense",   category: "Overheads",             is_system: true },
  { code: "6900", name: "Repairs & Maintenance",       account_type: "expense",   category: "Overheads",  is_system: true },
  { code: "6910", name: "Loss on Disposal of Assets", account_type: "expense",   category: "Overheads",  is_system: true },
  { code: "6950", name: "Depreciation",                account_type: "expense",   category: "Overheads",  is_system: true },
];

// Sole Trader default chart — identical to COA_SEED except: Directors Loan Account (2400) is
// excluded (a sole trader and their business aren't legally distinct persons, so there's no one
// to "loan" money to — that relationship's entire economic substance is just Capital Account
// movements), and the equity pair is replaced with Capital Account (3200) / Drawings (3300)
// instead of Share Capital (3000) / Retained Earnings (3100) — new codes, not the same codes
// relabeled, since GL Reports' Balance Sheet tab has hardcoded "Share Capital"/"Retained
// Earnings" labels keyed off those exact code ranges regardless of the account's actual name
// (tracked as a separate, not-yet-built gap — see Stage 3 write-up).
export const COA_SEED_SOLE_TRADER = [
  { code: "1000", name: "Bank — Current Account",  account_type: "asset",     category: "Current Assets",        is_system: true },
  { code: "1100", name: "Trade Debtors",            account_type: "asset",     category: "Current Assets",        is_system: true },
  { code: "1200", name: "Prepayments",              account_type: "asset",     category: "Current Assets",        is_system: true },
  { code: "1250", name: "Supplier Prepayments",     account_type: "asset",     category: "Current Assets",        is_system: true },
  { code: "1300", name: "Stripe Clearing",          account_type: "asset",     category: "Current Assets",        is_system: true },
  { code: "1500", name: "Fixed Assets",                          account_type: "asset",   category: "Fixed Assets", is_system: true },
  { code: "1501", name: "Accum Dep — Fixed Assets",           account_type: "asset",   category: "Fixed Assets", is_system: true },
  { code: "1510", name: "Plant & Machinery",                  account_type: "asset",   category: "Fixed Assets", is_system: true },
  { code: "1511", name: "Accum Dep — Plant & Machinery",      account_type: "asset",   category: "Fixed Assets", is_system: true },
  { code: "1520", name: "Fixtures & Fittings",                account_type: "asset",   category: "Fixed Assets", is_system: true },
  { code: "1521", name: "Accum Dep — Fixtures & Fittings",   account_type: "asset",   category: "Fixed Assets", is_system: true },
  { code: "1530", name: "Computer Equipment",                 account_type: "asset",   category: "Fixed Assets", is_system: true },
  { code: "1531", name: "Accum Dep — Computer Equipment",    account_type: "asset",   category: "Fixed Assets", is_system: true },
  { code: "1540", name: "Motor Vehicles",                     account_type: "asset",   category: "Fixed Assets", is_system: true },
  { code: "1541", name: "Accum Dep — Motor Vehicles",         account_type: "asset",   category: "Fixed Assets", is_system: true },
  { code: "1600", name: "VAT Receivable",           account_type: "asset",     category: "Current Assets",        is_system: true },
  { code: "2000", name: "Trade Creditors",          account_type: "liability", category: "Current Liabilities",   is_system: true },
  { code: "2100", name: "VAT Control",              account_type: "liability", category: "Current Liabilities",   is_system: true },
  { code: "2200", name: "PAYE & PRSI Payable",      account_type: "liability", category: "Current Liabilities",   is_system: true },
  { code: "2250", name: "Net Wages Payable",        account_type: "liability", category: "Current Liabilities",   is_system: true },
  { code: "2260", name: "Pension Payable",          account_type: "liability", category: "Current Liabilities",   is_system: true },
  { code: "2300", name: "Accruals",                 account_type: "liability", category: "Current Liabilities",   is_system: true },
  { code: "2350", name: "Customer Advance Payments",account_type: "liability", category: "Current Liabilities",   is_system: true },
  { code: "2500", name: "Bank Loan",                account_type: "liability", category: "Long-term Liabilities", is_system: true },
  { code: "3200", name: "Capital Account",          account_type: "equity",    category: "Equity",                is_system: true },
  { code: "3300", name: "Drawings",                 account_type: "equity",    category: "Equity",                is_system: true },
  { code: "4000", name: "Sales Revenue",            account_type: "income",    category: "Income",                is_system: true },
  { code: "4100", name: "Service Income",           account_type: "income",    category: "Income",                is_system: true },
  { code: "4200", name: "Other Income",             account_type: "income",    category: "Income",                is_system: true },
  { code: "4300", name: "Interest Received",        account_type: "income",    category: "Income",                is_system: true },
  { code: "5000", name: "Cost of Sales",            account_type: "expense",   category: "Cost of Sales",         is_system: true },
  { code: "5100", name: "Materials & Supplies",     account_type: "expense",   category: "Cost of Sales",         is_system: true },
  { code: "5200", name: "Subcontractor Costs",      account_type: "expense",   category: "Cost of Sales",         is_system: true },
  { code: "5300", name: "Direct Labour",            account_type: "expense",   category: "Cost of Sales",         is_system: true },
  { code: "6000", name: "Payroll & PAYE",           account_type: "expense",   category: "Overheads",             is_system: true },
  { code: "6100", name: "Rent & Rates",             account_type: "expense",   category: "Overheads",             is_system: true },
  { code: "6200", name: "Motor & Travel",           account_type: "expense",   category: "Overheads",             is_system: true },
  { code: "6300", name: "Telecoms & IT",            account_type: "expense",   category: "Overheads",             is_system: true },
  { code: "6400", name: "Professional Fees",        account_type: "expense",   category: "Overheads",             is_system: true },
  { code: "6500", name: "Bank Charges & Interest",  account_type: "expense",   category: "Overheads",             is_system: true },
  { code: "6600", name: "Sundry Expenses",          account_type: "expense",   category: "Overheads",             is_system: true },
  { code: "6750", name: "Settlement Rounding",      account_type: "expense",   category: "Overheads",             is_system: true },
  { code: "6700", name: "Marketing & Advertising",  account_type: "expense",   category: "Overheads",             is_system: true },
  { code: "6800", name: "Insurance",                account_type: "expense",   category: "Overheads",             is_system: true },
  { code: "6900", name: "Repairs & Maintenance",       account_type: "expense",   category: "Overheads",  is_system: true },
  { code: "6910", name: "Loss on Disposal of Assets", account_type: "expense",   category: "Overheads",  is_system: true },
  { code: "6950", name: "Depreciation",                account_type: "expense",   category: "Overheads",  is_system: true },
];

export const COA_STATIC_FALLBACK = COA_SEED.map((a, i) => ({
  ...a, id: `static-${i}`, company_id: null, is_active: true, created_at: null, _static: true,
}));

export function useChartOfAccounts(companyId) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [version, setVersion]   = useState(0);
  useEffect(() => {
    if (!companyId) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const db = supabase;
        console.log('[CoA] loading for company:', companyId);
        const { data, error } = await db
          .from("chart_of_accounts").select("*").eq("company_id", companyId).order("code");
        console.log('[CoA] fetch →', data?.length ?? 'null', 'rows | error:', error?.message ?? 'none');
        if (cancelled) return;

        if (error) {
          console.warn('[CoA] fetch failed — showing static fallback. Run the chart_of_accounts SQL migration. Error:', error.message);
          setAccounts(COA_STATIC_FALLBACK);
        } else if (data && data.length > 0) {
          setAccounts(data);
        } else {
          // Empty table — first real use for this company. Look up company_type here (not
          // added to the hook's own params) so all existing call sites are unaffected; this
          // query only ever runs on this rare first-seed path, never on a normal load.
          const { data: co } = await db.from("companies").select("company_type").eq("id", companyId).single();
          const seedSet = co?.company_type === 'Sole Trader' ? COA_SEED_SOLE_TRADER : COA_SEED;
          console.log('[CoA] empty table — seeding', seedSet.length, `system accounts (${co?.company_type || 'unknown type'}) via upsert`);
          const { data: seeded, error: seedErr } = await db
            .from("chart_of_accounts")
            .upsert(seedSet.map(a => ({ ...a, company_id: companyId })), { onConflict: 'company_id,code' })
            .select();
          console.log('[CoA] seed →', seeded?.length ?? 'null', 'rows | error:', seedErr?.message ?? 'none');
          if (cancelled) return;
          if (seedErr) {
            console.warn('[CoA] seed failed — showing static fallback. Check RLS policy on chart_of_accounts. Error:', seedErr.message);
            setAccounts(COA_STATIC_FALLBACK);
          } else if (seeded) {
            setAccounts(seeded.sort((a, b) => a.code.localeCompare(b.code)));
          }
        }
      } catch (e) {
        console.error('[CoA] unexpected error:', e);
        if (!cancelled) setAccounts(COA_STATIC_FALLBACK);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [companyId, version]);
  return { accounts, loading, refetch: () => setVersion(v => v + 1) };
}
