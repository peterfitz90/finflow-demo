import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useUser, useOrganizationList } from "@clerk/clerk-react";
import { AuthGate, UserChip } from "./auth.jsx"
import { supabase } from "./supabase.js"
import { InboxZeroCelebration } from './shared/InboxZeroCelebration.jsx';
import { useHealthy } from './shared/useHealthy.js';
import { AutomationHero, HealthPulseDot } from './shared/AutomationHero.jsx';
import { confirmBankTxn, approveApBill, markApBillPaid } from './shared/approvals.js';
import { computeDeadlines } from './shared/computeDeadlines.js';


const GL_ACCOUNTS = [
  // Assets
  { code: "1000", name: "Bank — Current Account",  type: "Asset" },
  { code: "1100", name: "Trade Debtors",            type: "Asset" },
  { code: "1200", name: "Prepayments",              type: "Asset" },
  { code: "1300", name: "Stripe Clearing",          type: "Asset" },
  { code: "1500", name: "Fixed Assets",             type: "Asset" },
  { code: "1600", name: "VAT Receivable",           type: "Asset" },
  // Liabilities
  { code: "2000", name: "Trade Creditors",          type: "Liability" },
  { code: "2100", name: "VAT Control",              type: "Liability" },
  { code: "1250", name: "Supplier Prepayments",     type: "Asset" },
  { code: "2200", name: "PAYE & PRSI Payable",      type: "Liability" },
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
  { code: "6950", name: "Depreciation",             type: "Expense" },
];

const COA_SEED = [
  { code: "1000", name: "Bank — Current Account",  account_type: "asset",     category: "Current Assets",        is_system: true },
  { code: "1100", name: "Trade Debtors",            account_type: "asset",     category: "Current Assets",        is_system: true },
  { code: "1200", name: "Prepayments",              account_type: "asset",     category: "Current Assets",        is_system: true },
  { code: "1250", name: "Supplier Prepayments",     account_type: "asset",     category: "Current Assets",        is_system: true },
  { code: "1300", name: "Stripe Clearing",          account_type: "asset",     category: "Current Assets",        is_system: true },
  { code: "1500", name: "Fixed Assets",             account_type: "asset",     category: "Fixed Assets",          is_system: true },
  { code: "1600", name: "VAT Receivable",           account_type: "asset",     category: "Current Assets",        is_system: true },
  { code: "2000", name: "Trade Creditors",          account_type: "liability", category: "Current Liabilities",   is_system: true },
  { code: "2100", name: "VAT Control",              account_type: "liability", category: "Current Liabilities",   is_system: true },
  { code: "2200", name: "PAYE & PRSI Payable",      account_type: "liability", category: "Current Liabilities",   is_system: true },
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
  { code: "6900", name: "Repairs & Maintenance",    account_type: "expense",   category: "Overheads",             is_system: true },
  { code: "6950", name: "Depreciation",             account_type: "expense",   category: "Overheads",             is_system: true },
];

const COA_STATIC_FALLBACK = COA_SEED.map((a, i) => ({
  ...a, id: `static-${i}`, company_id: null, is_active: true, created_at: null, _static: true,
}));

// Irish VAT rates used in back-calculation (amounts are VAT-inclusive from bank imports)
const VAT_RATES = { STD23: 23, RED13: 13.5, RED9: 9 };
// Returns { vat, net } from a gross VAT-inclusive amount
function calcJournalVAT(amount, vatCode) {
  const rate = VAT_RATES[vatCode];
  if (!rate) return { vat: 0, net: Math.abs(Number(amount)) };
  const abs = Math.abs(Number(amount));
  const vat = abs * rate / (100 + rate);
  return { vat, net: abs - vat };
}

function useChartOfAccounts(companyId) {
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
          console.log('[CoA] empty table — seeding', COA_SEED.length, 'system accounts via upsert');
          const { data: seeded, error: seedErr } = await db
            .from("chart_of_accounts")
            .upsert(COA_SEED.map(a => ({ ...a, company_id: companyId })), { onConflict: 'company_id,code' })
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

function usePriorYearBalances(companyId) {
  const [balances, setBalances] = useState([]);
  const [meta,     setMeta]     = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [version,  setVersion]  = useState(0);
  useEffect(() => {
    if (!companyId) { setLoading(false); return; }
    setLoading(true);
    supabase.from('prior_year_balances').select('*')
      .eq('company_id', companyId).order('year_end_date', { ascending: false })
      .then(({ data, error }) => {
        if (!error && data && data.length > 0) {
          const latestDate = data[0].year_end_date;
          const latest = data.filter(r => r.year_end_date === latestDate);
          setBalances(latest);
          setMeta({ year_end_date: latestDate, created_at: data[0].created_at, count: latest.length });
        } else {
          setBalances([]); setMeta(null);
        }
        setLoading(false);
      });
  }, [companyId, version]);
  return { balances, meta, loading, refetch: () => setVersion(v => v + 1) };
}

// ── System rule seed (mirrors SQL seed — used for client-side auto-seeding if table is empty) ──
const SYSTEM_RULES_SEED = [
  { pattern: 'wages',            match_type: 'contains',   direction: 'out',  nominal_code: '6000', nominal_name: 'Payroll & PAYE',          confidence: 'high' },
  { pattern: 'salary',           match_type: 'contains',   direction: 'out',  nominal_code: '6000', nominal_name: 'Payroll & PAYE',          confidence: 'high' },
  { pattern: 'payroll',          match_type: 'contains',   direction: 'out',  nominal_code: '6000', nominal_name: 'Payroll & PAYE',          confidence: 'high' },
  { pattern: 'bwages',           match_type: 'contains',   direction: 'both', nominal_code: '6000', nominal_name: 'Payroll & PAYE',          confidence: 'high' },
  { pattern: 'lwages',           match_type: 'contains',   direction: 'both', nominal_code: '6000', nominal_name: 'Payroll & PAYE',          confidence: 'high' },
  { pattern: 'swages',           match_type: 'contains',   direction: 'both', nominal_code: '6000', nominal_name: 'Payroll & PAYE',          confidence: 'high' },
  { pattern: 'wwages',           match_type: 'contains',   direction: 'both', nominal_code: '6000', nominal_name: 'Payroll & PAYE',          confidence: 'high' },
  { pattern: 'inet.*wag',        match_type: 'regex',      direction: 'both', nominal_code: '6000', nominal_name: 'Payroll & PAYE',          confidence: 'high' },
  { pattern: 'revenue commis',   match_type: 'contains',   direction: 'out',  nominal_code: '2100', nominal_name: 'VAT Control',             confidence: 'high' },
  { pattern: 'collector general',match_type: 'contains',   direction: 'out',  nominal_code: '2100', nominal_name: 'VAT Control',             confidence: 'high' },
  { pattern: 'd/d revenue',      match_type: 'contains',   direction: 'out',  nominal_code: '2100', nominal_name: 'VAT Control',             confidence: 'high' },
  { pattern: 'stamp duty',       match_type: 'contains',   direction: 'out',  nominal_code: '2100', nominal_name: 'VAT Control',             confidence: 'high' },
  { pattern: 'fee-qtr',          match_type: 'startswith', direction: 'out',  nominal_code: '6500', nominal_name: 'Bank Charges',            confidence: 'high' },
  { pattern: 'bank charge',      match_type: 'contains',   direction: 'out',  nominal_code: '6500', nominal_name: 'Bank Charges',            confidence: 'high' },
  { pattern: 'bank fee',         match_type: 'contains',   direction: 'out',  nominal_code: '6500', nominal_name: 'Bank Charges',            confidence: 'high' },
  { pattern: 'monthly fee',      match_type: 'contains',   direction: 'out',  nominal_code: '6500', nominal_name: 'Bank Charges',            confidence: 'high' },
  { pattern: 'cgs fee',          match_type: 'contains',   direction: 'out',  nominal_code: '6500', nominal_name: 'Bank Charges',            confidence: 'high' },
  { pattern: 'pymt fee',         match_type: 'contains',   direction: 'out',  nominal_code: '6500', nominal_name: 'Bank Charges',            confidence: 'high' },
  { pattern: 'quarterly fee',    match_type: 'contains',   direction: 'out',  nominal_code: '6500', nominal_name: 'Bank Charges',            confidence: 'high' },
  { pattern: 'close brothers',   match_type: 'contains',   direction: 'out',  nominal_code: '2500', nominal_name: 'Bank Loan',               confidence: 'high' },
  { pattern: 'naps loan',        match_type: 'contains',   direction: 'out',  nominal_code: '2500', nominal_name: 'Bank Loan',               confidence: 'high' },
  { pattern: 'inet.*loan',       match_type: 'regex',      direction: 'out',  nominal_code: '2500', nominal_name: 'Bank Loan',               confidence: 'high' },
  { pattern: 'inet.*rent',       match_type: 'regex',      direction: 'out',  nominal_code: '6100', nominal_name: 'Rent & Rates',            confidence: 'high' },
  { pattern: 'herorent',         match_type: 'contains',   direction: 'out',  nominal_code: '6100', nominal_name: 'Rent & Rates',            confidence: 'high' },
  { pattern: 'eir',              match_type: 'exact',      direction: 'out',  nominal_code: '6300', nominal_name: 'Telecoms & IT',           confidence: 'high' },
  { pattern: 'vodafone',         match_type: 'contains',   direction: 'out',  nominal_code: '6300', nominal_name: 'Telecoms & IT',           confidence: 'high' },
  { pattern: 'three mobile',     match_type: 'contains',   direction: 'out',  nominal_code: '6300', nominal_name: 'Telecoms & IT',           confidence: 'high' },
  { pattern: 'google',           match_type: 'contains',   direction: 'out',  nominal_code: '6300', nominal_name: 'Telecoms & IT',           confidence: 'high' },
  { pattern: 'gsuite',           match_type: 'contains',   direction: 'out',  nominal_code: '6300', nominal_name: 'Telecoms & IT',           confidence: 'high' },
  { pattern: 'microsoft',        match_type: 'contains',   direction: 'out',  nominal_code: '6300', nominal_name: 'Telecoms & IT',           confidence: 'high' },
  { pattern: 'adobe',            match_type: 'contains',   direction: 'out',  nominal_code: '6300', nominal_name: 'Telecoms & IT',           confidence: 'high' },
  { pattern: 'zoom',             match_type: 'contains',   direction: 'out',  nominal_code: '6300', nominal_name: 'Telecoms & IT',           confidence: 'high' },
  { pattern: 'slack',            match_type: 'contains',   direction: 'out',  nominal_code: '6300', nominal_name: 'Telecoms & IT',           confidence: 'high' },
  { pattern: 'wix',              match_type: 'contains',   direction: 'out',  nominal_code: '6300', nominal_name: 'Telecoms & IT',           confidence: 'high' },
  { pattern: 'spotify',          match_type: 'contains',   direction: 'out',  nominal_code: '6300', nominal_name: 'Telecoms & IT',           confidence: 'high' },
  { pattern: 'hubfit',           match_type: 'contains',   direction: 'out',  nominal_code: '6300', nominal_name: 'Telecoms & IT',           confidence: 'high' },
  { pattern: 'glofox',           match_type: 'contains',   direction: 'out',  nominal_code: '6300', nominal_name: 'Telecoms & IT',           confidence: 'high' },
  { pattern: 'glofox',           match_type: 'contains',   direction: 'in',   nominal_code: '4000', nominal_name: 'Sales Revenue',           confidence: 'high' },
  { pattern: 'stripe',           match_type: 'contains',   direction: 'in',   nominal_code: '4000', nominal_name: 'Sales Revenue',           confidence: 'high' },
  { pattern: 'paypal',           match_type: 'contains',   direction: 'in',   nominal_code: '4000', nominal_name: 'Sales Revenue',           confidence: 'high' },
  { pattern: 'insurance',        match_type: 'contains',   direction: 'both', nominal_code: '6800', nominal_name: 'Insurance',               confidence: 'high' },
  { pattern: 'allianz',          match_type: 'contains',   direction: 'out',  nominal_code: '6800', nominal_name: 'Insurance',               confidence: 'high' },
  { pattern: 'axa',              match_type: 'contains',   direction: 'out',  nominal_code: '6800', nominal_name: 'Insurance',               confidence: 'high' },
  { pattern: 'aviva',            match_type: 'contains',   direction: 'out',  nominal_code: '6800', nominal_name: 'Insurance',               confidence: 'high' },
  { pattern: 'fbd',              match_type: 'contains',   direction: 'out',  nominal_code: '6800', nominal_name: 'Insurance',               confidence: 'high' },
  { pattern: 'zurich',           match_type: 'contains',   direction: 'out',  nominal_code: '6800', nominal_name: 'Insurance',               confidence: 'high' },
  { pattern: 'circle k',         match_type: 'contains',   direction: 'out',  nominal_code: '6200', nominal_name: 'Motor & Travel',          confidence: 'high' },
  { pattern: 'applegreen',       match_type: 'contains',   direction: 'out',  nominal_code: '6200', nominal_name: 'Motor & Travel',          confidence: 'high' },
  { pattern: 'maxol',            match_type: 'contains',   direction: 'out',  nominal_code: '6200', nominal_name: 'Motor & Travel',          confidence: 'high' },
  { pattern: 'texaco',           match_type: 'contains',   direction: 'out',  nominal_code: '6200', nominal_name: 'Motor & Travel',          confidence: 'high' },
  { pattern: 'apcoa',            match_type: 'contains',   direction: 'out',  nominal_code: '6200', nominal_name: 'Motor & Travel',          confidence: 'high' },
  { pattern: 'parking',          match_type: 'contains',   direction: 'out',  nominal_code: '6200', nominal_name: 'Motor & Travel',          confidence: 'high' },
  { pattern: 'ryanair',          match_type: 'contains',   direction: 'out',  nominal_code: '6200', nominal_name: 'Motor & Travel',          confidence: 'high' },
  { pattern: 'uber',             match_type: 'contains',   direction: 'out',  nominal_code: '6200', nominal_name: 'Motor & Travel',          confidence: 'high' },
  { pattern: 'taxi',             match_type: 'contains',   direction: 'out',  nominal_code: '6200', nominal_name: 'Motor & Travel',          confidence: 'high' },
  { pattern: 'imro',             match_type: 'contains',   direction: 'out',  nominal_code: '6400', nominal_name: 'Professional Fees',       confidence: 'high' },
  { pattern: 'solicitor',        match_type: 'contains',   direction: 'out',  nominal_code: '6400', nominal_name: 'Professional Fees',       confidence: 'high' },
  { pattern: 'legal fee',        match_type: 'contains',   direction: 'out',  nominal_code: '6400', nominal_name: 'Professional Fees',       confidence: 'high' },
  { pattern: 'accountant fee',   match_type: 'contains',   direction: 'out',  nominal_code: '6400', nominal_name: 'Professional Fees',       confidence: 'high' },
  { pattern: 'google ads',       match_type: 'contains',   direction: 'out',  nominal_code: '6700', nominal_name: 'Marketing & Advertising', confidence: 'high' },
  { pattern: 'facebook ads',     match_type: 'contains',   direction: 'out',  nominal_code: '6700', nominal_name: 'Marketing & Advertising', confidence: 'high' },
  { pattern: 'linkedin',         match_type: 'contains',   direction: 'out',  nominal_code: '6700', nominal_name: 'Marketing & Advertising', confidence: 'high' },
  { pattern: 'wix.com',          match_type: 'contains',   direction: 'out',  nominal_code: '6700', nominal_name: 'Marketing & Advertising', confidence: 'high' },
  { pattern: 'electric ireland', match_type: 'contains',   direction: 'out',  nominal_code: '6900', nominal_name: 'Repairs & Maintenance',   confidence: 'high' },
  { pattern: 'bord gais',        match_type: 'contains',   direction: 'out',  nominal_code: '6900', nominal_name: 'Repairs & Maintenance',   confidence: 'high' },
  { pattern: 'sse airtricity',   match_type: 'contains',   direction: 'out',  nominal_code: '6900', nominal_name: 'Repairs & Maintenance',   confidence: 'high' },
  { pattern: 'irish water',      match_type: 'contains',   direction: 'out',  nominal_code: '6900', nominal_name: 'Repairs & Maintenance',   confidence: 'high' },
  { pattern: 'equipment',        match_type: 'contains',   direction: 'out',  nominal_code: '5100', nominal_name: 'Materials & Supplies',    confidence: 'high' },
  { pattern: 'fitness equip',    match_type: 'contains',   direction: 'out',  nominal_code: '5100', nominal_name: 'Materials & Supplies',    confidence: 'high' },
];

function useTransactionRules(companyId) {
  const [rules,   setRules]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!companyId) { setLoading(false); return; }
    const db = supabase;
    db.from('transaction_rules').select('*')
      .or(`company_id.is.null,company_id.eq.${companyId}`)
      .eq('is_active', true)
      .order('created_at')
      .then(async ({ data, error }) => {
        if (error) {
          console.warn('[useTransactionRules] fetch error:', error.message, '— falling back to in-memory seed');
          setRules(SYSTEM_RULES_SEED.map((r, i) => ({ ...r, id: `seed-${i}`, company_id: null, source: 'system', is_active: true, usage_count: 0 })));
          setLoading(false);
          return;
        }
        const hasSystemRules = data?.some(r => r.company_id === null || r.source === 'system');
        if (!hasSystemRules) {
          console.log('[useTransactionRules] no system rules found — seeding defaults');
          await db.from('transaction_rules').insert(
            SYSTEM_RULES_SEED.map(r => ({ ...r, company_id: null, source: 'system' }))
          );
          const { data: seeded } = await db.from('transaction_rules').select('*')
            .or(`company_id.is.null,company_id.eq.${companyId}`).eq('is_active', true).order('created_at');
          setRules(seeded || []);
        } else {
          setRules(data || []);
        }
        setLoading(false);
      });
  }, [companyId, version]);
  return { rules, loading, refetch: () => setVersion(v => v + 1) };
}

const GL_TB = [];

const CHECKLIST_TEMPLATE = [
  { section: "Bank & Cash", items: [
    "Download bank statements for the period",
    "Complete bank reconciliation",
    "Clear all reconciling items",
    "Review and post bank charges / interest",
  ]},
  { section: "Accounts Receivable", items: [
    "Review aged debtors report",
    "Chase invoices 30+ days overdue",
    "Chase invoices 60+ days overdue",
    "Post all outstanding sales invoices",
  ]},
  { section: "Accounts Payable", items: [
    "Post all outstanding supplier invoices",
    "Review aged creditors report",
    "Reconcile supplier statements",
  ]},
  { section: "Payroll", items: [
    "Confirm payroll journals posted",
    "Reconcile payroll control account",
    "P30 filed with Revenue (if due this period)",
  ]},
  { section: "VAT", items: [
    "Reconcile VAT control account",
    "Prepare VAT3 return (if bimonthly period end)",
    "Review input VAT reclaim amounts",
  ]},
  { section: "Reporting", items: [
    "Run and review trial balance",
    "Review and approve all journal entries",
    "Confirm all accruals and prepayments posted",
    "Review AI-suggested journals",
    "Prepare management accounts pack",
  ]},
];

// Conditions evaluated by runChecklistAutoEval(); keyed by item_label
const CONDITION_MAP = {
  "Complete bank reconciliation":                  "bank_recon_complete",
  "Confirm payroll journals posted":               "payroll_journals_posted",
  "Prepare VAT3 return (if bimonthly period end)": "vat3_return_prepared",
};

const CHECKLIST_ADVANCED = [
  { section: "1. Bank & Cash", items: [
    "Download all bank statements for the period",
    "Complete bank reconciliation",
    "Complete reconciliation — deposit / savings accounts",
    "Reconcile petty cash and post any differences",
    "Post bank charges and interest received / paid",
    "Clear all outstanding reconciling items",
  ]},
  { section: "2. Accounts Receivable", items: [
    "Post all outstanding sales invoices",
    "Apply customer receipts to open invoices",
    "Review aged debtors report",
    "Chase invoices 30+ days overdue",
    "Chase invoices 60+ days overdue",
    "Review bad debt provisions — create or release",
    "Reconcile debtors control account to subsidiary ledger",
  ]},
  { section: "3. Accounts Payable & Cutoff", items: [
    "Post all outstanding supplier invoices received",
    "Review goods received but not invoiced (GRNI accruals)",
    "Review unmatched purchase orders for cutoff",
    "Review aged creditors report",
    "Reconcile key supplier statements",
    "Reconcile creditors control account to subsidiary ledger",
  ]},
  { section: "4. Accruals", items: [
    "Review recurring accruals schedule",
    "Post month-end accruals (rent, utilities, professional fees)",
    "Reverse prior-month accruals",
    "Post lease interest and depreciation (FRS 102 / IFRS 16 if applicable)",
  ]},
  { section: "5. Prepayments", items: [
    "Review prepayments schedule",
    "Release monthly portion of prepayments to P&L",
    "Post prepayment amortisation journals",
    "Confirm prepayment balance sheet balance is reasonable",
  ]},
  { section: "6. Fixed Assets & Depreciation", items: [
    "Post depreciation for the period",
    "Record new asset additions with supporting documentation",
    "Record asset disposals and calculate profit / loss on disposal",
    "Reconcile fixed asset register to general ledger",
    "Review capital WIP accounts for any completions to place in service",
  ]},
  { section: "7. Payroll", items: [
    "Confirm payroll journals posted",
    "Reconcile gross payroll to payroll bureau report",
    "Post employer PRSI journal",
    "Reconcile payroll control account to nil",
    "P30 filed with Revenue (if due this period)",
    "Confirm pension contributions posted and control account cleared",
  ]},
  { section: "8. VAT & Revenue", items: [
    "Reconcile VAT output (T1) to sales ledger",
    "Reconcile VAT input (T2) to purchase ledger",
    "Post VAT adjustments arising from prior return",
    "Prepare VAT3 return (if bimonthly period end)",
    "Review ECSL / Intrastat obligations (if applicable)",
    "Reconcile VAT control account balance",
  ]},
  { section: "9. Balance Sheet Reconciliations", items: [
    "Reconcile all bank accounts to general ledger",
    "Reconcile debtors control account",
    "Reconcile creditors control account",
    "Reconcile PAYE / PRSI liability account",
    "Reconcile director loan account",
    "Confirm all balance sheet accounts have valid reconciliations on file",
  ]},
  { section: "10. Intercompany (if applicable)", items: [
    "Post intercompany charges and management fees",
    "Confirm intercompany balances agree with counterparty",
    "Eliminate intercompany transactions for consolidation",
  ]},
  { section: "11. Review & Sign-off", items: [
    "Run trial balance — confirm debits equal credits",
    "Review P&L vs prior period — explain variances > 10%",
    "Review balance sheet — confirm all balances are reasonable",
    "Review and approve all manual journal entries",
    "Review AI-suggested journals",
    "Prepare management accounts pack",
    "Director / manager sign-off on month-end close",
  ]},
];

const CHECKLIST_TEMPLATES_MAP = {
  basic:    { label: "Basic",    description: "20 items · 6 sections",  template: CHECKLIST_TEMPLATE  },
  advanced: { label: "Advanced", description: "60 items · 11 sections", template: CHECKLIST_ADVANCED  },
};

const PNL = { revenue: [], cos: [], opex: [] };

const JOURNAL_TYPES = ["Accrual", "Prepayment", "Depreciation", "Payroll", "Correction", "Intercompany", "Other"];


const GL_EXTRACT = {};

const fmt = (n) => `€${Math.abs(n).toLocaleString("en-IE")}`;
const fmtK = (n) => n >= 1000 ? `€${(n / 1000).toFixed(0)}k` : fmt(n);

// ── Company-ID guard — throws rather than silently using the wrong company ────
function requireCompanyId(id) {
  if (!id) throw new Error('[Ledgrly] No active company — select a company before proceeding');
  return id;
}

// ── Currency-aware formatters ─────────────────────────────────────────────────
// Components that have access to company.base_currency shadow fmt/fmtK/fmtEUR
// with these helpers. Everything else keeps the EUR-hardcoded module-level versions.
const CURRENCY_SYMBOLS = { EUR: "€", GBP: "£", USD: "$" };
function fmtCurrency(n, currency) {
  const sym = CURRENCY_SYMBOLS[currency] ?? (currency + " ");
  return `${sym}${Math.abs(Number(n) || 0).toLocaleString("en-IE")}`;
}
function fmtCurrencyFull(n, currency) {
  const sym = CURRENCY_SYMBOLS[currency] ?? (currency + " ");
  const v = Number(n) || 0;
  return `${sym}${Math.abs(v).toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${v < 0 ? " CR" : ""}`;
}
function fmtCurrencyK(n, currency) {
  const abs = Math.abs(Number(n) || 0);
  const sym = CURRENCY_SYMBOLS[currency] ?? (currency + " ");
  return abs >= 1000 ? `${sym}${(abs / 1000).toFixed(0)}k` : fmtCurrency(n, currency);
}
let jnlCounter = 4;

const fmtIE = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

const fmtEUR = (n) => {
  const v = Number(n) || 0;
  return `€${Math.abs(v).toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${v < 0 ? " CR" : ""}`;
};

function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ExportDropdown({ onCSV, onPrint }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const item = (label, fn) => (
    <button
      style={{ display: "block", width: "100%", padding: "9px 14px", textAlign: "left", background: "none", border: "none", fontSize: 13, cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif", color: "var(--text)" }}
      onMouseEnter={e => e.currentTarget.style.background = "var(--surface2)"}
      onMouseLeave={e => e.currentTarget.style.background = "none"}
      onClick={() => { fn(); setOpen(false); }}
    >{label}</button>
  );
  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button className="btn btn-s btn-sm" onClick={() => setOpen(v => !v)} style={{ display: "flex", alignItems: "center", gap: 5 }}>
        Export <span style={{ fontSize: 9, opacity: 0.55 }}>▾</span>
      </button>
      {open && (
        <div style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", background: "var(--white)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", boxShadow: "var(--shadow)", minWidth: 172, zIndex: 200, overflow: "hidden" }}>
          {item("⬇  Download CSV", onCSV)}
          {item("🖨  Print / Save PDF", onPrint)}
        </div>
      )}
    </div>
  );
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&family=Inter:wght@300;400;500;600&family=Source+Code+Pro:wght@400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    /* — design tokens — dark-only — */
    --bg: #0c1210; --surface: #141b18; --surface-2: #1a2320;
    --border: rgba(255,255,255,0.07);
    --text: #e8edeb; --text-muted: #8b9591; --text-faint: #5c6662;
    --accent: #34d399; --accent-dim: rgba(52,211,153,0.12);
    --warn: #fbbf24; --warn-dim: rgba(251,191,36,0.12);
    --danger: #f87171; --danger-dim: rgba(248,113,113,0.12);
    --info: #60a5fa;
    --radius-card: 14px; --radius-pill: 999px;
    /* — legacy aliases so existing CSS classes keep working — */
    --surface2: #1a2320; --surface3: #1f2a27;
    --border2: rgba(255,255,255,0.12);
    --sidebar: #0c1210; --sidebar2: #111916;
    --teal: #34d399; --teal2: #5ee8b2;
    --gold: #fbbf24; --gold2: #fcd34d;
    --red: #f87171; --green: #34d399; --white: #141b18;
    --muted: #8b9591; --dim: #5c6662;
    --shadow-sm: 0 1px 4px rgba(0,0,0,0.3);
    --shadow: 0 4px 12px rgba(0,0,0,0.4);
    --radius: 8px; --radius-sm: 6px; --radius-lg: 14px;
  }
  .f-input, .l-input, .ob-input, .ob-toggle-btn:not(.active),
  .bi-nom-sel, .login-input, .gl-extract-select,
  .chat-inp { background: var(--surface2); color: var(--text); border-color: var(--border2); }
  .chk-box { background: var(--surface2); }
  .gl-table tr:hover td { background: rgba(255,255,255,0.04); }
  .gl-table tr:nth-child(even) td { background: rgba(255,255,255,0.025); }
  .pnl-row:hover { background: rgba(255,255,255,0.03); }
  .jnl-head:hover { background: rgba(255,255,255,0.04); }
  .gl-tab:hover:not(.active) { background: rgba(255,255,255,0.06); }
  .inv-row:hover { background: rgba(255,255,255,0.04); }
  .chk-item:hover { background: rgba(255,255,255,0.04); }
  .jl-row:hover { background: rgba(255,255,255,0.03); }
  .theme-toggle { background: none; border: 1px solid var(--border); border-radius: 20px; padding: 5px 10px; cursor: pointer; font-size: 13px; line-height: 1; transition: all 0.15s; display: flex; align-items: center; }
  .theme-toggle:hover { background: var(--surface2); border-color: var(--border2); }
  body { background: var(--bg); color: var(--text); font-family: 'Inter', system-ui, -apple-system, sans-serif; font-size: 14px; -webkit-font-smoothing: antialiased; }
  ::-webkit-scrollbar { width: 5px; height: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 10px; }
  .app { display: flex; height: 100vh; overflow: hidden; }
  .sidebar { width: 220px; min-width: 220px; background: var(--bg); display: flex; flex-direction: column; border-right: 1px solid var(--border); }
  .sidebar-logo { padding: 18px 16px 14px; border-bottom: 1px solid var(--border); }
  .logo-lockup { display: flex; align-items: center; gap: 9px; }
  .logo-icon { flex-shrink: 0; }
  .logo-text-wrap { display: flex; flex-direction: column; gap: 1px; }
  .logo-wordmark { font-size: 16px; font-weight: 700; color: var(--text); letter-spacing: -0.02em; font-family: 'Inter', system-ui, sans-serif; }
  .logo-sub { font-size: 9px; color: var(--text-faint); letter-spacing: 0.1em; text-transform: uppercase; font-family: 'Inter', system-ui, sans-serif; font-weight: 500; }
  .nav { padding: 8px 8px 0; flex: 1; overflow-y: auto; }
  .nav-label { font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-faint); padding: 10px 10px 3px; font-weight: 600; font-family: 'Inter', system-ui, sans-serif; }
  .nav-item { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: var(--radius-pill); cursor: pointer; font-size: 13px; font-weight: 500; color: var(--text-muted); transition: all 0.13s; margin-bottom: 1px; border: none; background: none; width: 100%; text-align: left; font-family: 'Inter', system-ui, sans-serif; }
  .nav-item:hover { background: var(--surface-2); color: var(--text); }
  .nav-item.active { background: var(--surface-2); color: var(--text); font-weight: 600; border: 1px solid var(--border); }
  .nav-icon { font-size: 13px; width: 18px; text-align: center; flex-shrink: 0; opacity: 0.75; }
  .nav-item.active .nav-icon { opacity: 1; }
  .nav-badge { margin-left: auto; background: var(--danger); color: white; font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: var(--radius-pill); }
  .nav-section-hdr { display: flex; align-items: center; width: 100%; background: none; border: none; cursor: pointer; padding: 8px 10px; gap: 0; }
  .nav-section-label { font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-faint); transition: color 0.13s; flex: 1; text-align: left; font-weight: 600; font-family: 'Inter', system-ui, sans-serif; }
  .nav-chevron { font-size: 10px; color: var(--text-faint); transition: color 0.13s; flex-shrink: 0; }
  .nav-section-hdr:hover .nav-section-label { color: var(--text-muted); }
  .nav-section-hdr:hover .nav-chevron { color: var(--text-muted); }
  .nav-section-items { overflow: hidden; transition: max-height 0.22s ease; }
  .sidebar-footer { padding: 12px 14px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 4px; }
  .sidebar-footer-btn { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: var(--radius-pill); cursor: pointer; font-size: 12px; font-weight: 500; color: var(--text-muted); transition: all 0.13s; border: none; background: none; width: 100%; text-align: left; font-family: 'Inter', system-ui, sans-serif; }
  .sidebar-footer-btn:hover { background: var(--surface-2); color: var(--text); }
  .co-pill { display: flex; align-items: center; gap: 8px; }
  .co-dot { width: 7px; height: 7px; border-radius: 50%; background: #34d399; animation: blink-d 2.5s infinite; }
  @keyframes blink-d { 0%,100%{opacity:1} 50%{opacity:0.3} }
  .co-name { font-size: 12px; color: rgba(255,255,255,0.38); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .topbar { height: 60px; min-height: 60px; background: var(--surface); border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; padding: 0 24px; gap: 16px; }
  .topbar-greeting { font-size: 14px; font-weight: 600; color: var(--text); white-space: nowrap; }
  .topbar-sub { font-size: 12px; color: var(--text-muted); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 380px; }
  .topbar-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .bank-pill { display: flex; align-items: center; gap: 5px; border-radius: var(--radius-pill); padding: 5px 11px; font-size: 11px; font-weight: 600; border: 1px solid; cursor: default; white-space: nowrap; }
  .bank-pill-ok { background: var(--accent-dim); border-color: rgba(52,211,153,0.25); color: var(--accent); }
  .bank-pill-warn { background: var(--warn-dim); border-color: rgba(251,191,36,0.25); color: var(--warn); }
  .bank-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: blink-d 2.5s infinite; flex-shrink: 0; }
  .period-pill { display: flex; align-items: center; gap: 6px; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-pill); padding: 5px 12px; font-size: 11px; font-weight: 500; color: var(--text-muted); cursor: pointer; white-space: nowrap; font-family: 'Inter', system-ui, sans-serif; transition: all 0.13s; }
  .period-pill:hover { border-color: rgba(52,211,153,0.4); color: var(--accent); background: var(--accent-dim); }
  .notif-btn { position: relative; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-pill); width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 14px; color: var(--text-muted); transition: all 0.13s; }
  .notif-btn:hover { background: var(--surface); color: var(--text); border-color: var(--border2); }
  .notif-count { position: absolute; top: -3px; right: -3px; background: var(--danger); color: white; font-size: 9px; font-weight: 700; padding: 1px 4px; border-radius: var(--radius-pill); min-width: 15px; text-align: center; line-height: 1.4; }
  /* keep legacy period-badge for any page that still uses it */
  .period-badge { background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-pill); padding: 4px 14px; font-size: 11px; color: var(--text-muted); }
  .content { flex: 1; overflow: auto; padding: 20px 24px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card); }
  .card-header { padding: 11px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; min-height: 40px; }
  .card-title { font-size: 11px; font-weight: 600; letter-spacing: 0.07em; text-transform: uppercase; color: var(--text-muted); }
  .card-count { background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-pill); padding: 2px 8px; font-size: 10px; font-weight: 600; color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .card-body { padding: 14px 16px; }
  .card-footer-link { display: block; padding: 9px 16px; font-size: 11px; font-weight: 500; color: var(--accent); cursor: pointer; border-top: 1px solid var(--border); transition: background 0.12s; text-decoration: none; }
  .card-footer-link:hover { background: var(--surface-2); }
  .kpi-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 12px; margin-bottom: 16px; }
  .kpi-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card); padding: 18px 20px; position: relative; overflow: hidden; }
  .kpi-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: var(--tc, var(--teal)); border-radius: var(--radius) var(--radius) 0 0; }
  .kpi-label { font-size: 11px; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; color: var(--dim); margin-bottom: 10px; }
  .kpi-value { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; line-height: 1; font-variant-numeric: tabular-nums; }
  .kpi-sub { font-size: 11px; color: var(--muted); margin-top: 6px; }
  .pill { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 20px; font-size: 10px; font-weight: 600; font-family: 'Inter', system-ui, sans-serif; text-transform: uppercase; letter-spacing: 0.04em; }
  .digest { background: var(--white); border: 1px solid var(--border); border-left: 4px solid var(--teal); border-radius: var(--radius); padding: 14px 18px; margin-bottom: 14px; display: flex; gap: 14px; box-shadow: var(--shadow-sm); }
  .digest-label { font-size: 10px; font-family: 'Source Code Pro', monospace; letter-spacing: 0.1em; text-transform: uppercase; color: var(--teal); margin-bottom: 4px; font-weight: 600; }
  .digest-text { font-size: 13px; color: var(--muted); line-height: 1.6; }
  .anomaly { border-radius: var(--radius-sm); padding: 9px 13px; margin-bottom: 6px; display: flex; align-items: center; gap: 9px; font-size: 12px; }
  .a-high { background: rgba(220,38,38,0.06); border-left: 3px solid var(--red); color: var(--red); }
  .a-med { background: rgba(184,134,11,0.06); border-left: 3px solid var(--gold); color: var(--gold); }
  .inv-row { display: flex; align-items: center; justify-content: space-between; padding: 9px 12px; border-radius: var(--radius-sm); margin-bottom: 4px; transition: background 0.1s; }
  .inv-row:hover { background: var(--surface2); }
  .inv-id { font-size: 10px; font-family: 'Source Code Pro', monospace; color: var(--dim); margin-top: 2px; }
  .comp-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-radius: var(--radius-sm); margin-bottom: 6px; background: var(--surface2); border: 1px solid var(--border); }
  .comp-days { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .bar-track { height: 4px; background: var(--border); border-radius: 4px; overflow: hidden; margin-top: 5px; }
  .bar-fill { height: 100%; border-radius: 4px; transition: width 1.2s ease; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
  .full-col { margin-bottom: 14px; }
  .pb-track { height: 5px; background: var(--border); border-radius: 4px; overflow: hidden; width: 180px; }
  .pb-fill { height: 100%; background: var(--teal); border-radius: 4px; transition: width 0.5s ease; }
  .sec-title { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); padding: 10px 18px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; background: var(--surface-2); border-radius: var(--radius) var(--radius) 0 0; }
  .sec-count { font-size: 11px; color: var(--dim); font-family: 'Source Code Pro', monospace; font-weight: 400; }
  .chk-item { display: flex; align-items: flex-start; gap: 10px; padding: 10px 18px; cursor: pointer; transition: background 0.1s; border-bottom: 1px solid var(--border); }
  .chk-item:last-child { border-bottom: none; }
  .chk-item:hover { background: var(--surface2); }
  .chk-item.done { opacity: 0.5; }
  .chk-box { width: 17px; height: 17px; border-radius: 4px; flex-shrink: 0; border: 1.5px solid var(--border2); background: var(--white); display: flex; align-items: center; justify-content: center; transition: all 0.12s; margin-top: 2px; }
  .chk-item.done .chk-box { background: var(--teal); border-color: var(--teal); }
  .chk-tick { color: white; font-size: 10px; font-weight: 700; }
  .chk-label { font-size: 13px; line-height: 1.5; }
  .chk-item.done .chk-label { text-decoration: line-through; color: var(--dim); }
  .ai-badge { margin-left: auto; flex-shrink: 0; font-size: 9px; font-family: 'Source Code Pro', monospace; color: var(--teal); background: rgba(29,107,114,0.08); padding: 2px 8px; border-radius: 20px; letter-spacing: 0.06em; margin-top: 3px; border: 1px solid rgba(29,107,114,0.15); }
  .chk-item.edit { cursor: default; }
  .chk-item.edit:hover { background: none; }
  .chk-ord-btn { background: none; border: 1px solid var(--border); border-radius: 3px; cursor: pointer; color: var(--dim); font-size: 8px; line-height: 1; padding: 1px 3px; min-width: 16px; text-align: center; display: block; }
  .chk-ord-btn:disabled { opacity: 0.2; cursor: not-allowed; }
  .chk-ord-btn:hover:not(:disabled) { background: var(--surface-2); color: var(--text); }
  .chk-del-btn { background: none; border: 1px solid transparent; border-radius: 3px; cursor: pointer; color: var(--dim); font-size: 15px; line-height: 1; padding: 0 5px; transition: all 0.1s; }
  .chk-del-btn:hover { color: var(--danger, #dc2626); border-color: rgba(220,38,38,0.25); background: rgba(220,38,38,0.06); }
  .chk-rename-input { font-family: inherit; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; background: var(--white); border: 1px solid var(--teal); border-radius: 4px; padding: 2px 6px; outline: none; min-width: 130px; color: var(--text); }
  .chk-edit-label { cursor: text; border-bottom: 1px dashed var(--border); padding-bottom: 1px; transition: border-color 0.1s; }
  .chk-edit-label:hover { border-bottom-color: var(--teal); }
  .chk-meta-input { font-family: 'Source Code Pro', monospace; font-size: 11px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 4px; padding: 2px 6px; color: var(--muted); width: 88px; outline: none; }
  .chk-meta-input:focus { border-color: var(--teal); }

  /* ── Dashboard tile layout editor ── */
  .tile-wrap { border-radius: var(--radius-card); transition: opacity 0.15s, outline 0.1s; }
  .tile-wrap.dragging { opacity: 0.3; }
  .tile-wrap.drag-over { outline: 2px dashed var(--teal); outline-offset: 2px; }
  .tile-wrap.hidden-tile { opacity: 0.38; }
  .tile-edit-bar { display: flex; align-items: center; gap: 4px; padding: 5px 10px 4px; background: rgba(29,107,114,0.07); border: 1px solid rgba(29,107,114,0.18); border-radius: var(--radius-card) var(--radius-card) 0 0; user-select: none; }
  .tile-drag-handle { cursor: grab; color: var(--text-faint); font-size: 14px; padding: 0 3px; line-height: 1; }
  .tile-drag-handle:active { cursor: grabbing; }
  .tile-ord-btn { background: none; border: 1px solid var(--border); border-radius: 3px; cursor: pointer; color: var(--dim); font-size: 9px; line-height: 1; padding: 2px 5px; }
  .tile-ord-btn:disabled { opacity: 0.2; cursor: not-allowed; }
  .tile-ord-btn:hover:not(:disabled) { background: var(--surface-2); color: var(--text); }
  .tile-vis-btn { background: none; border: 1px solid transparent; border-radius: 4px; cursor: pointer; color: var(--dim); font-size: 13px; line-height: 1; padding: 1px 5px; margin-left: auto; transition: all 0.1s; }
  .tile-vis-btn:hover { color: var(--text); background: var(--surface-2); border-color: var(--border); }
  .tile-edit-bar + .card { border-top-left-radius: 0; border-top-right-radius: 0; }
  .gl-tabs { display: flex; gap: 2px; margin-bottom: 16px; background: var(--white); border: 1px solid var(--border); border-radius: var(--radius); padding: 4px; box-shadow: var(--shadow-sm); }
  .gl-tab { padding: 8px 20px; cursor: pointer; font-size: 12px; font-weight: 500; border: none; background: transparent; color: var(--muted); transition: all 0.13s; flex: 1; text-align: center; font-family: 'Inter', system-ui, sans-serif; border-radius: var(--radius-sm); }
  .gl-tab.active { background: var(--teal); color: white; font-weight: 600; box-shadow: var(--shadow-sm); }
  .gl-tab:hover:not(.active) { background: var(--surface2); color: var(--text); }
  .gl-table { width: 100%; border-collapse: collapse; }
  .gl-table th { font-size: 10px; font-family: 'Source Code Pro', monospace; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); padding: 10px 16px; text-align: left; background: var(--surface2); border-bottom: 1px solid var(--border); font-weight: 600; }
  .gl-table th.r { text-align: right; }
  .gl-table td { padding: 9px 16px; font-size: 13px; border-bottom: 1px solid var(--border); }
  .gl-table tr:nth-child(even) td { background: var(--surface2); }
  .gl-table tr:hover td { background: rgba(255,255,255,0.04); }
  .gl-table .mono { font-family: 'Source Code Pro', monospace; font-size: 12px; }
  .gl-table .r { text-align: right; }
  .gl-table .tot td { font-weight: 700; border-top: 2px solid var(--border2); border-bottom: none; background: var(--surface2); }
  .pnl-row { display: flex; align-items: center; padding: 9px 18px; font-size: 13px; border-bottom: 1px solid var(--border); }
  .pnl-row:hover { background: var(--surface2); }
  .pnl-n { flex: 1; }
  .pnl-v { width: 100px; text-align: right; font-family: 'Source Code Pro', monospace; font-size: 12px; }
  .pnl-var { width: 70px; text-align: right; font-size: 11px; font-family: 'Source Code Pro', monospace; }
  .pnl-sec { background: var(--surface2); }
  .pnl-sec .pnl-n { font-weight: 600; font-size: 13px; color: var(--text); }
  .pnl-tot { background: var(--surface2); }
  .pnl-tot .pnl-n { font-weight: 600; }
  .vp { color: var(--green); } .vn { color: var(--red); } .vz { color: var(--dim); }
  .jnl-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }
  .jnl-card { background: var(--white); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; box-shadow: var(--shadow-sm); }
  .jnl-head { display: flex; align-items: center; justify-content: space-between; padding: 13px 18px; cursor: pointer; transition: background 0.1s; }
  .jnl-head:hover { background: var(--surface2); }
  .jnl-ref { font-family: 'Source Code Pro', monospace; font-size: 11px; color: var(--teal); font-weight: 600; }
  .jnl-desc { font-size: 13px; color: var(--text); margin-top: 2px; font-weight: 500; }
  .jnl-meta { font-size: 11px; color: var(--dim); font-family: 'Source Code Pro', monospace; margin-top: 3px; }
  .jl-hdr { display: flex; padding: 6px 18px; background: var(--surface2); border-bottom: 1px solid var(--border); }
  .jl-hdr span { font-size: 10px; font-family: 'Source Code Pro', monospace; text-transform: uppercase; letter-spacing: 0.08em; color: var(--dim); font-weight: 600; }
  .jl-row { display: flex; padding: 9px 18px; border-bottom: 1px solid var(--border); font-size: 13px; }
  .jl-row:last-child { border-bottom: none; }
  .jl-row:hover { background: var(--surface2); }
  .jl-code { width: 55px; font-family: 'Source Code Pro', monospace; font-size: 11px; color: var(--dim); }
  .jl-name { flex: 1; }
  .jl-dr, .jl-cr { width: 110px; text-align: right; font-family: 'Source Code Pro', monospace; font-size: 12px; color: var(--text); }
  .jnl-form { background: var(--white); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; margin-bottom: 14px; box-shadow: var(--shadow); }
  .jnl-fh { padding: 14px 18px; background: var(--surface-2); border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
  .jnl-ft { font-size: 14px; font-weight: 600; color: var(--text); }
  .jnl-fb { padding: 18px; }
  .att-zone { display: flex; align-items: center; justify-content: center; padding: 12px 16px; border: 1.5px dashed var(--border); border-radius: var(--radius-sm); cursor: pointer; transition: border-color 0.15s, background 0.15s; user-select: none; }
  .att-zone:hover { border-color: rgba(52,211,153,0.5); }
  .att-zone.drag-over { border-color: var(--accent); background: var(--accent-dim); }
  .att-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--border); }
  .att-row:last-child { border-bottom: none; }
  .att-icon { font-size: 14px; flex-shrink: 0; line-height: 1; }
  .att-name { flex: 1; font-size: 12px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .att-size { color: var(--text-faint); font-family: 'Source Code Pro', monospace; font-size: 11px; flex-shrink: 0; }
  .att-btn { background: none; border: none; cursor: pointer; font-size: 11px; padding: 2px 8px; border-radius: 3px; color: var(--accent); font-family: 'Inter', system-ui, sans-serif; transition: background 0.1s; }
  .att-btn:hover { background: var(--accent-dim); }
  .att-btn-del { color: var(--text-faint); }
  .att-btn-del:hover { color: var(--danger); background: rgba(248,113,113,0.08); }
  .f-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; margin-bottom: 14px; }
  .f-group { display: flex; flex-direction: column; gap: 5px; }
  .f-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
  .f-input { background: var(--white); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 8px 12px; font-size: 13px; font-family: 'Inter', system-ui, sans-serif; color: var(--text); outline: none; transition: border-color 0.14s, box-shadow 0.14s; }
  .f-input:focus { border-color: var(--teal); box-shadow: 0 0 0 3px rgba(29,107,114,0.1); }
  .lines-tbl { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  .lines-tbl th { font-size: 10px; font-family: 'Source Code Pro', monospace; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); padding: 8px 10px; text-align: left; background: var(--surface2); border-bottom: 1px solid var(--border); font-weight: 600; }
  .lines-tbl th.r { text-align: right; }
  .lines-tbl td { padding: 4px 4px; border-bottom: 1px solid var(--border); }
  .l-input { width: 100%; background: var(--white); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 6px 9px; font-size: 12px; font-family: 'Inter', system-ui, sans-serif; color: var(--text); outline: none; }
  .l-input:focus { border-color: var(--teal); box-shadow: 0 0 0 2px rgba(29,107,114,0.1); }
  .l-input.num { text-align: right; font-family: 'Source Code Pro', monospace; }
  .bal-row { display: flex; justify-content: flex-end; align-items: center; gap: 20px; padding: 8px 4px; border-top: 2px solid var(--border2); margin-bottom: 14px; font-family: 'Source Code Pro', monospace; font-size: 12px; }
  .bal-ok { color: var(--green); font-weight: 600; }
  .bal-err { color: var(--red); font-weight: 600; }
  .btn { padding: 8px 18px; border-radius: var(--radius-sm); font-size: 13px; font-weight: 600; font-family: 'Inter', system-ui, sans-serif; cursor: pointer; border: none; transition: all 0.15s; }
  .btn-p { background: var(--teal); color: white; }
  .btn-p:hover { background: var(--teal2); box-shadow: 0 4px 12px rgba(29,107,114,0.3); }
  .btn-s { background: var(--white); color: var(--muted); border: 1px solid var(--border); }
  .btn-s:hover { background: var(--surface2); color: var(--text); }
  .btn-sm { padding: 5px 12px; font-size: 12px; }
  .btn-d { background: rgba(220,38,38,0.07); color: var(--red); border: 1px solid rgba(220,38,38,0.2); }
  .btn-d:hover { background: rgba(220,38,38,0.12); }
  /* chat-panel fills the dock container — dock handles positioning/sizing */
  .chat-panel { flex: 1; display: flex; flex-direction: column; overflow: hidden; background: var(--surface); min-width: 0; }
  /* ── CHAT DOCK ── */
  .chat-dock {
    position: fixed; top: 60px; right: 0; bottom: 0; width: 400px;
    background: var(--surface); border-left: 1px solid var(--border);
    display: flex; flex-direction: column; z-index: 200;
    transform: translateX(100%); visibility: hidden;
    transition: transform 0.15s ease, visibility 0s linear 0.15s;
  }
  .chat-dock.chat-dock-open {
    transform: translateX(0); visibility: visible;
    transition: transform 0.15s ease, visibility 0s linear 0s;
  }
  /* ≥ 1280px: shrink main content instead of overlaying */
  @media (min-width: 1280px) {
    .app.chat-is-open .main { margin-right: 400px; transition: margin-right 0.15s ease; }
    .app:not(.chat-is-open) .main { margin-right: 0; transition: margin-right 0.15s ease; }
  }
  .chat-dock-trigger {
    display: flex; align-items: center; gap: 6px;
    background: var(--surface-2); border: 1px solid var(--border);
    border-radius: var(--radius-pill); padding: 5px 12px;
    font-size: 11px; font-weight: 600; font-family: 'Inter', system-ui, sans-serif;
    color: var(--text-muted); cursor: pointer; white-space: nowrap; transition: all 0.13s;
  }
  .chat-dock-trigger:hover { border-color: rgba(52,211,153,0.4); color: var(--accent); background: var(--accent-dim); }
  .chat-dock-close {
    margin-left: auto; background: none; border: none; cursor: pointer;
    color: var(--text-faint); font-size: 15px; padding: 2px 6px; border-radius: var(--radius-sm);
    transition: all 0.12s; flex-shrink: 0; line-height: 1;
  }
  .chat-dock-close:hover { background: var(--surface-2); color: var(--text); }
  .chat-hdr { padding: 12px 14px; border-bottom: 1px solid var(--border); background: var(--surface); display: flex; align-items: center; gap: 10px; }
  .chat-av { width: 30px; height: 30px; border-radius: var(--radius-sm); background: rgba(29,107,114,0.12); border: 1px solid rgba(29,107,114,0.25); display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; }
  .chat-ttl { font-family: 'Playfair Display', serif; font-size: 13px; color: var(--text); font-weight: 600; }
  .chat-st { font-size: 10px; color: var(--teal); font-family: 'Source Code Pro', monospace; }
  .chat-msgs { flex: 1; overflow: auto; padding: 11px 11px; display: flex; flex-direction: column; gap: 8px; }
  .msg { max-width: 93%; padding: 8px 11px; border-radius: var(--radius-sm); font-size: 12px; line-height: 1.62; }
  .msg-a { background: var(--surface2); color: var(--muted); border: 1px solid var(--border); align-self: flex-start; }
  .msg-u { background: var(--teal); color: rgba(255,255,255,0.92); align-self: flex-end; }
  .dot { width: 5px; height: 5px; border-radius: 50%; background: var(--dim); display: inline-block; margin: 0 2px; }
  .dot:nth-child(1){animation:blink 1.2s 0s infinite} .dot:nth-child(2){animation:blink 1.2s .2s infinite} .dot:nth-child(3){animation:blink 1.2s .4s infinite}
  @keyframes blink{0%,100%{opacity:0.2}50%{opacity:1}}
  .chat-sugg { padding: 7px 11px; display: flex; flex-direction: column; gap: 4px; }
  .sugg { background: var(--surface2); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 5px 9px; font-size: 11px; color: var(--muted); cursor: pointer; transition: all 0.11s; text-align: left; }
  .sugg:hover { border-color: var(--teal); color: var(--teal); background: rgba(29,107,114,0.04); }
  .chat-inp-area { padding: 9px 11px; border-top: 1px solid var(--border); display: flex; gap: 6px; }
  .chat-inp { flex: 1; background: var(--white); border: 1px solid var(--border2); border-radius: var(--radius-sm); color: var(--text); padding: 6px 9px; font-size: 12px; font-family: 'Inter', system-ui, sans-serif; outline: none; transition: border-color 0.13s; }
  .chat-inp:focus { border-color: var(--teal); box-shadow: 0 0 0 3px rgba(29,107,114,0.1); }
  .send-btn { background: var(--teal); border: none; border-radius: var(--radius-sm); color: white; padding: 6px 11px; cursor: pointer; font-size: 13px; transition: background 0.12s; }
  .send-btn:hover { background: var(--teal2); }
  @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  .fade-up{animation:fadeUp 0.32s ease forwards}
  /* ── MAGIC MOMENT ── */
  .mm-wrap { min-height: 100vh; background: var(--sidebar); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 20px; position: relative; overflow: hidden; }
  .mm-grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px); background-size: 48px 48px; pointer-events: none; }
  .mm-glow { position: absolute; width: 600px; height: 600px; border-radius: 50%; background: radial-gradient(circle, rgba(29,107,114,0.18) 0%, transparent 70%); top: 50%; left: 50%; transform: translate(-50%,-50%); pointer-events: none; }
  .mm-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: var(--radius-lg); width: 100%; max-width: 640px; padding: 40px; position: relative; z-index: 10; backdrop-filter: blur(8px); }
  /* idle state */
  .mm-idle-logo { font-family: 'Playfair Display', serif; font-size: 32px; font-weight: 700; color: white; margin-bottom: 6px; }
  .mm-idle-logo span { color: var(--gold2); }
  .mm-idle-sub { font-size: 12px; font-family: 'Source Code Pro', monospace; color: rgba(255,255,255,0.3); letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 40px; }
  .mm-company { font-family: 'Playfair Display', serif; font-size: 22px; font-weight: 600; color: white; margin-bottom: 6px; }
  .mm-period { font-size: 12px; font-family: 'Source Code Pro', monospace; color: var(--gold2); margin-bottom: 48px; }
  .mm-btn { width: 100%; background: linear-gradient(135deg, var(--teal) 0%, #15555c 100%); border: none; border-radius: 10px; padding: 20px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 14px; transition: all 0.2s; position: relative; overflow: hidden; }
  .mm-btn::before { content: ''; position: absolute; inset: 0; background: linear-gradient(135deg, rgba(255,255,255,0.06), transparent); }
  .mm-btn:hover { transform: translateY(-2px); box-shadow: 0 12px 40px rgba(29,107,114,0.5); }
  .mm-btn:active { transform: translateY(0); }
  .mm-btn-icon { font-size: 28px; }
  .mm-btn-text { text-align: left; }
  .mm-btn-label { font-family: 'Playfair Display', serif; font-size: 18px; font-weight: 700; color: white; }
  .mm-btn-hint { font-size: 11px; font-family: 'Source Code Pro', monospace; color: rgba(255,255,255,0.5); margin-top: 3px; }
  .mm-features { display: flex; gap: 8px; margin-top: 28px; flex-wrap: wrap; }
  .mm-feat { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 6px 12px; font-size: 10px; font-family: 'Source Code Pro', monospace; color: rgba(255,255,255,0.4); letter-spacing: 0.06em; }
  /* processing state */
  .mm-processing { display: flex; flex-direction: column; gap: 0; }
  .mm-proc-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; }
  .mm-proc-title { font-family: 'Playfair Display', serif; font-size: 18px; font-weight: 600; color: white; }
  .mm-proc-pct { font-family: 'Source Code Pro', monospace; font-size: 28px; font-weight: 700; color: var(--teal2); }
  .mm-arc-wrap { display: flex; justify-content: center; margin-bottom: 24px; }
  .mm-arc { transform: rotate(-90deg); }
  .mm-arc-bg { fill: none; stroke: rgba(255,255,255,0.07); stroke-width: 6; }
  .mm-arc-fill { fill: none; stroke: var(--teal2); stroke-width: 6; stroke-linecap: round; transition: stroke-dashoffset 0.4s ease; }
  .mm-arc-text { transform: rotate(90deg); }
  .mm-feed-list { display: flex; flex-direction: column; gap: 6px; max-height: 220px; overflow: hidden; }
  .mm-feed-item { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 6px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); animation: feedIn 0.3s ease forwards; opacity: 0; }
  @keyframes feedIn { from { opacity:0; transform: translateX(-8px); } to { opacity:1; transform: translateX(0); } }
  .mm-feed-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .mm-feed-dot.auto { background: var(--teal2); box-shadow: 0 0 6px var(--teal2); }
  .mm-feed-dot.review { background: var(--gold2); box-shadow: 0 0 6px var(--gold2); }
  .mm-feed-dot.proc { background: rgba(255,255,255,0.25); animation: pulse-dot 1s infinite; }
  @keyframes pulse-dot { 0%,100%{opacity:0.3} 50%{opacity:1} }
  .mm-feed-ref { font-family: 'Source Code Pro', monospace; font-size: 10px; color: rgba(255,255,255,0.35); width: 72px; flex-shrink: 0; }
  .mm-feed-narr { font-size: 12px; color: rgba(255,255,255,0.65); flex: 1; }
  .mm-feed-badge { font-size: 9px; font-family: 'Source Code Pro', monospace; padding: 2px 7px; border-radius: 2px; flex-shrink: 0; }
  .mm-feed-badge.auto { background: rgba(29,107,114,0.2); color: var(--teal2); }
  .mm-feed-badge.review { background: rgba(184,134,11,0.2); color: var(--gold2); }
  .mm-sources { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
  .mm-src { display: flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 5px 10px; font-size: 10px; font-family: 'Source Code Pro', monospace; color: rgba(255,255,255,0.5); }
  .mm-src-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--teal2); animation: pulse-dot 1.5s infinite; }
  .mm-src-dot.done { background: var(--teal2); animation: none; }
  /* results state */
  .mm-results { display: flex; flex-direction: column; gap: 0; }
  .mm-score-row { display: flex; align-items: center; gap: 20px; margin-bottom: 28px; }
  .mm-score-circle { width: 90px; height: 90px; flex-shrink: 0; }
  .mm-score-arc-bg { fill: none; stroke: rgba(255,255,255,0.07); stroke-width: 7; }
  .mm-score-arc { fill: none; stroke: var(--teal2); stroke-width: 7; stroke-linecap: round; stroke-dasharray: 245; stroke-dashoffset: 25; transition: stroke-dashoffset 1s ease; }
  .mm-score-pct { font-family: 'Playfair Display', serif; font-size: 28px; font-weight: 700; color: white; }
  .mm-score-label { font-size: 11px; font-family: 'Source Code Pro', monospace; color: rgba(255,255,255,0.4); margin-top: 3px; }
  .mm-score-detail { font-family: 'Playfair Display', serif; font-size: 20px; font-weight: 600; color: white; }
  .mm-score-sub { font-size: 12px; color: rgba(255,255,255,0.45); margin-top: 5px; font-family: 'Source Code Pro', monospace; }
  .mm-auto-posted { background: rgba(29,107,114,0.08); border: 1px solid rgba(29,107,114,0.2); border-radius: 10px; padding: 14px 16px; margin-bottom: 16px; }
  .mm-auto-hdr { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .mm-auto-title { font-size: 11px; font-family: 'Source Code Pro', monospace; color: var(--teal2); text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600; }
  .mm-auto-count { font-family: 'Source Code Pro', monospace; font-size: 11px; color: rgba(255,255,255,0.3); }
  .mm-auto-item { display: flex; align-items: center; gap: 8px; padding: 5px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 12px; color: rgba(255,255,255,0.55); }
  .mm-auto-item:last-child { border-bottom: none; }
  .mm-auto-check { color: var(--teal2); font-size: 12px; flex-shrink: 0; }
  .mm-review-section { margin-bottom: 20px; }
  .mm-review-hdr { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .mm-review-title { font-size: 11px; font-family: 'Source Code Pro', monospace; color: var(--gold2); text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600; }
  .mm-review-item { background: rgba(184,134,11,0.06); border: 1px solid rgba(184,134,11,0.18); border-radius: 8px; padding: 12px 14px; margin-bottom: 8px; display: flex; align-items: flex-start; gap: 12px; }
  .mm-review-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
  .mm-review-body { flex: 1; }
  .mm-review-ref { font-family: 'Source Code Pro', monospace; font-size: 10px; color: var(--gold2); margin-bottom: 3px; }
  .mm-review-narr { font-size: 13px; color: rgba(255,255,255,0.75); margin-bottom: 4px; }
  .mm-review-reason { font-size: 11px; color: rgba(255,255,255,0.35); font-style: italic; }
  .mm-review-actions { display: flex; gap: 6px; flex-shrink: 0; }
  .mm-approve { background: rgba(29,107,114,0.15); border: 1px solid rgba(29,107,114,0.3); color: var(--teal2); border-radius: 5px; padding: 5px 11px; font-size: 11px; font-family: 'Source Code Pro', monospace; cursor: pointer; transition: all 0.15s; }
  .mm-approve:hover { background: rgba(29,107,114,0.3); }
  .mm-reject { background: rgba(139,32,32,0.1); border: 1px solid rgba(139,32,32,0.25); color: #e07070; border-radius: 5px; padding: 5px 11px; font-size: 11px; font-family: 'Source Code Pro', monospace; cursor: pointer; transition: all 0.15s; }
  .mm-reject:hover { background: rgba(139,32,32,0.2); }
  .mm-approved-badge { background: rgba(29,107,114,0.15); border: 1px solid rgba(29,107,114,0.3); color: var(--teal2); border-radius: 5px; padding: 5px 11px; font-size: 11px; font-family: 'Source Code Pro', monospace; }
  .mm-cta { width: 100%; background: linear-gradient(135deg, var(--sidebar2) 0%, var(--sidebar) 100%); border: 1px solid rgba(255,255,255,0.12); border-radius: var(--radius-lg); padding: 16px; color: white; font-family: 'Playfair Display', serif; font-size: 16px; font-weight: 600; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 10px; }
  .mm-cta:hover { border-color: var(--gold2); box-shadow: 0 8px 32px rgba(0,0,0,0.4); }
  .mm-cta-disabled { opacity: 0.4; pointer-events: none; }
  .mm-stat-pills { display: flex; gap: 8px; margin-bottom: 24px; flex-wrap: wrap; }
  .mm-stat { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 10px 14px; flex: 1; min-width: 100px; }
  .mm-stat-val { font-family: 'Source Code Pro', monospace; font-size: 18px; font-weight: 700; color: white; }
  .mm-stat-lbl { font-size: 10px; font-family: 'Source Code Pro', monospace; color: rgba(255,255,255,0.35); margin-top: 3px; text-transform: uppercase; letter-spacing: 0.06em; }
  /* ── LOGIN ── */
  .login-wrap { min-height: 100vh; background: var(--sidebar); display: flex; align-items: center; justify-content: center; }
  .login-card { background: var(--surface); width: 380px; border-radius: var(--radius-lg); overflow: hidden; box-shadow: 0 24px 64px rgba(0,0,0,0.35); }
  .login-hdr { background: var(--sidebar); padding: 28px 30px 24px; border-bottom: 3px solid var(--teal); }
  .login-logo { font-family: 'Playfair Display', serif; font-size: 26px; font-weight: 700; color: white; }
  .login-logo span { color: var(--gold2); }
  .login-tagline { font-size: 11px; color: rgba(255,255,255,0.35); font-family: 'Source Code Pro', monospace; letter-spacing: 0.12em; text-transform: uppercase; margin-top: 4px; }
  .login-body { padding: 28px 30px; }
  .login-title { font-family: 'Playfair Display', serif; font-size: 18px; font-weight: 600; color: var(--text); margin-bottom: 6px; }
  .login-sub { font-size: 12px; color: var(--dim); margin-bottom: 22px; }
  .login-field { margin-bottom: 14px; }
  .login-label { display: block; font-size: 10px; font-family: 'Source Code Pro', monospace; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); margin-bottom: 5px; font-weight: 600; }
  .login-input { width: 100%; background: var(--white); border: 1px solid var(--border2); border-radius: var(--radius-sm); padding: 10px 13px; font-size: 13px; font-family: 'Inter', system-ui, sans-serif; color: var(--text); outline: none; transition: border-color 0.14s; }
  .login-input:focus { border-color: var(--teal); box-shadow: 0 0 0 3px rgba(29,107,114,0.1); }
  .login-btn { width: 100%; background: var(--teal); color: white; border: none; border-radius: var(--radius-sm); padding: 11px; font-size: 14px; font-weight: 600; font-family: 'Inter', system-ui, sans-serif; cursor: pointer; margin-top: 6px; transition: background 0.14s; letter-spacing: 0.02em; }
  .login-btn:hover { background: var(--teal2); }
  .login-demo-hint { text-align: center; margin-top: 13px; font-size: 11px; color: var(--dim); }
  .login-demo-hint span { color: var(--teal); font-weight: 600; cursor: pointer; text-decoration: underline; }
  .login-footer { padding: 12px 30px; background: var(--surface2); border-top: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
  .login-badges { display: flex; gap: 8px; }
  .login-badge { font-size: 9px; font-family: 'Source Code Pro', monospace; color: var(--dim); background: var(--surface3); padding: 2px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border); }
  /* ── TOPBAR EXTRAS ── */
  .feed-pill { display: flex; align-items: center; gap: 5px; background: rgba(22,163,74,0.07); border: 1px solid rgba(22,163,74,0.2); border-radius: 20px; padding: 4px 10px; font-size: 10px; font-family: 'Source Code Pro', monospace; color: var(--green); }
  .feed-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); animation: blink-d 2.5s infinite; flex-shrink: 0; }
  .user-chip { display: flex; align-items: center; gap: 8px; padding: 4px 10px; border: 1px solid var(--border); border-radius: 20px; background: var(--surface2); cursor: pointer; }
  .user-av { width: 24px; height: 24px; border-radius: var(--radius-sm); background: var(--teal); color: white; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; font-family: 'Source Code Pro', monospace; }
  .user-name { font-size: 11px; color: var(--muted); font-family: 'Inter', system-ui, sans-serif; }
  /* ── CASH FLOW PAGE ── */
  .cf-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 11px; margin-bottom: 13px; }
  .cf-chart { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; box-shadow: var(--shadow-sm); }
  .cf-bar-wrap { display: flex; align-items: flex-end; gap: 7px; height: 100px; margin-top: 12px; }
  .cf-bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .cf-bar { width: 100%; border-radius: var(--radius-sm) var(--radius-sm) 0 0; transition: height 1s ease; }
  .cf-bar-label { font-size: 10px; font-family: 'Source Code Pro', monospace; color: var(--dim); }
  .cf-bar-val { font-size: 10px; font-family: 'Source Code Pro', monospace; color: var(--teal); font-weight: 600; }
  .ap-sched-row { display: flex; align-items: center; padding: 8px 14px; border-bottom: 1px solid var(--border); font-size: 12px; }
  .ap-sched-row:last-child { border-bottom: none; }
  /* ── INVOICES PAGE ── */
  .inv-page-row { display: flex; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--border); font-size: 12px; gap: 10px; cursor: pointer; transition: background 0.1s; }
  .inv-page-row:hover { background: var(--surface2); }
  .inv-days-bar { height: 3px; background: var(--surface3); border-radius: 2px; overflow: hidden; margin-top: 3px; width: 80px; }
  .inv-days-fill { height: 100%; border-radius: 2px; }
  /* ── COMPLIANCE PAGE ── */
  .comp-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; margin-bottom: 9px; display: flex; align-items: center; gap: 14px; box-shadow: var(--shadow-sm); }
  .comp-icon { width: 36px; height: 36px; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
  .comp-deadline-ring { width: 48px; height: 48px; flex-shrink: 0; position: relative; }
  .ros-tag { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; font-family: 'Source Code Pro', monospace; color: white; background: var(--teal); padding: 2px 8px; border-radius: 20px; margin-top: 4px; }
  .gl-extract-toolbar { display: flex; align-items: center; gap: 10px; padding: 11px 15px; background: var(--surface2); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
  .gl-extract-select { background: var(--white); border: 1px solid var(--border2); border-radius: var(--radius-sm); padding: 5px 9px; font-size: 12px; font-family: 'Inter', system-ui, sans-serif; color: var(--text); outline: none; cursor: pointer; }
  .gl-extract-select:focus { border-color: var(--teal); box-shadow: 0 0 0 2px rgba(29,107,114,0.1); }
  .gl-acct-header { padding: 9px 15px; background: var(--surface2); border-bottom: 1px solid var(--border); display: flex; align-items: baseline; gap: 10px; }
  .gl-acct-code { font-family: 'Source Code Pro', monospace; font-size: 12px; color: var(--dim); }
  .gl-acct-name { font-size: 14px; font-weight: 600; color: var(--text); }
  .gl-acct-type { font-size: 10px; font-family: 'Source Code Pro', monospace; color: var(--dim); margin-left: auto; }
  .glex-table { width: 100%; border-collapse: collapse; }
  .glex-table th { font-size: 10px; font-family: 'Source Code Pro', monospace; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); padding: 7px 12px; text-align: left; background: var(--surface2); border-bottom: 2px solid var(--border2); font-weight: 600; }
  .glex-table th.r { text-align: right; }
  .glex-table td { padding: 7px 12px; font-size: 12px; border-bottom: 1px solid var(--border); vertical-align: middle; }
  .glex-table tr:hover td { background: var(--surface2); }
  .glex-table .mono { font-family: 'Source Code Pro', monospace; font-size: 11px; }
  .glex-table .r { text-align: right; }
  .glex-table .dr { color: var(--text); }
  .glex-table .cr { color: var(--teal); }
  .glex-table .bal-pos { color: var(--text); font-weight: 600; }
  .glex-table .bal-neg { color: var(--red); font-weight: 600; }
  .glex-type-pill { display: inline-block; font-size: 9px; font-family: 'Source Code Pro', monospace; text-transform: uppercase; letter-spacing: 0.05em; padding: 1px 6px; border-radius: 20px; background: var(--surface3); color: var(--muted); }
  .glex-type-receipt { background: rgba(22,163,74,0.08); color: var(--green); }
  .glex-type-payment { background: rgba(220,38,38,0.08); color: var(--red); }
  .glex-type-accrual { background: rgba(184,134,11,0.08); color: var(--gold); }
  .glex-type-invoice  { background: rgba(29,107,114,0.08); color: var(--teal); }
  .glex-type-vat      { background: rgba(29,107,114,0.08); color: var(--teal); }
  .glex-type-payroll  { background: rgba(83,74,183,0.08); color: #534ab7; }
  .glex-totrow td { font-weight: 700; border-top: 2px solid var(--border2); border-bottom: none; background: var(--surface2); }
  .gl-no-data { padding: 40px; text-align: center; color: var(--dim); font-size: 13px; }
  /* ── ONBOARDING ── */
  .ob-wrap { position: fixed; inset: 0; background: var(--sidebar); display: flex; align-items: center; justify-content: center; z-index: 9999; padding: 24px; }
  .ob-card { background: var(--surface); width: 100%; max-width: 560px; border-radius: var(--radius-lg); overflow: hidden; box-shadow: 0 32px 80px rgba(0,0,0,0.5); }
  .ob-header { background: var(--sidebar); padding: 28px 30px 24px; border-bottom: 3px solid var(--teal); }
  .ob-logo { font-family: 'Playfair Display', serif; font-size: 26px; font-weight: 700; color: white; }
  .ob-logo span { color: var(--gold2); }
  .ob-tagline { font-size: 11px; color: rgba(255,255,255,0.35); font-family: 'Source Code Pro', monospace; letter-spacing: 0.12em; text-transform: uppercase; margin-top: 4px; }
  .ob-body { padding: 28px 30px 24px; }
  .ob-step { font-size: 9px; font-family: 'Source Code Pro', monospace; letter-spacing: 0.14em; text-transform: uppercase; color: var(--teal); margin-bottom: 18px; font-weight: 600; }
  .ob-title { font-family: 'Playfair Display', serif; font-size: 20px; font-weight: 600; color: var(--text); margin: 0 0 4px; }
  .ob-sub { font-size: 12px; color: var(--dim); margin: 0 0 22px; }
  .ob-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px; }
  .ob-row.full { grid-template-columns: 1fr; }
  .ob-group { display: flex; flex-direction: column; gap: 5px; }
  .ob-label { font-size: 10px; font-family: 'Source Code Pro', monospace; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-weight: 600; }
  .ob-input { background: var(--white); border: 1px solid var(--border2); border-radius: var(--radius-sm); padding: 9px 11px; font-size: 13px; font-family: 'Inter', system-ui, sans-serif; color: var(--text); outline: none; transition: border-color 0.14s; }
  .ob-input:focus { border-color: var(--teal); box-shadow: 0 0 0 3px rgba(29,107,114,0.1); }
  .ob-toggle { display: flex; border: 1px solid var(--border2); border-radius: var(--radius-sm); overflow: hidden; }
  .ob-toggle-btn { flex: 1; padding: 9px; font-size: 12px; font-weight: 600; font-family: 'Inter', system-ui, sans-serif; border: none; cursor: pointer; background: var(--white); color: var(--muted); transition: all 0.12s; }
  .ob-toggle-btn.active { background: var(--teal); color: white; }
  .ob-submit { width: 100%; background: var(--teal); color: white; border: none; border-radius: var(--radius-sm); padding: 13px; font-size: 14px; font-weight: 600; font-family: 'Inter', system-ui, sans-serif; cursor: pointer; margin-top: 6px; transition: background 0.14s; letter-spacing: 0.02em; }
  .ob-submit:hover:not(:disabled) { background: var(--teal2); }
  .ob-submit:disabled { opacity: 0.45; cursor: not-allowed; }
  .ob-footer { padding: 12px 30px; background: var(--surface2); border-top: 1px solid var(--border); font-size: 10px; color: var(--dim); font-family: 'Source Code Pro', monospace; }
  .ob-card--wide { max-width: 760px; }
  .ob-skip { display: block; width: 100%; background: none; border: none; color: var(--dim); cursor: pointer; font-size: 12px; font-family: 'Inter', system-ui, sans-serif; text-align: center; margin-top: 10px; padding: 4px; }
  .ob-skip:hover { color: var(--muted); text-decoration: underline; }
  /* ── BANK IMPORT ── */
  .bi-drop { border: 2px dashed var(--border2); border-radius: var(--radius); padding: 36px 24px; text-align: center; cursor: pointer; transition: all 0.15s; background: var(--surface); margin-bottom: 14px; }
  .bi-drop:hover, .bi-drop.over { border-color: var(--teal); background: rgba(29,107,114,0.04); }
  .bi-drop-icon { font-size: 30px; color: var(--dim); margin-bottom: 10px; }
  .bi-drop-label { font-family: 'Playfair Display', serif; font-size: 15px; font-weight: 600; color: var(--text); margin-bottom: 5px; }
  .bi-drop-sub { font-size: 11px; color: var(--dim); font-family: 'Source Code Pro', monospace; }
  .bi-drop-btn { margin-top: 14px; display: inline-block; background: var(--teal); color: white; padding: 7px 20px; border-radius: var(--radius-sm); font-size: 12px; font-weight: 600; font-family: 'Inter', system-ui, sans-serif; }
  .bi-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
  .bi-fname { font-size: 11px; font-family: 'Source Code Pro', monospace; color: var(--teal); background: rgba(29,107,114,0.07); padding: 3px 10px; border-radius: 20px; border: 1px solid rgba(29,107,114,0.18); }
  .bi-count { font-size: 11px; font-family: 'Source Code Pro', monospace; color: var(--dim); }
  .bi-tbl { width: 100%; border-collapse: collapse; }
  .bi-tbl th { font-size: 10px; font-family: 'Source Code Pro', monospace; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); padding: 8px 10px; text-align: left; background: var(--surface2); border-bottom: 2px solid var(--border2); font-weight: 600; }
  .bi-tbl th.r { text-align: right; }
  .bi-tbl td { padding: 7px 10px; font-size: 12px; border-bottom: 1px solid var(--border); vertical-align: middle; }
  .bi-tbl tr.bi-imported td { opacity: 0.4; }
  .bi-tbl tr.bi-sel td { background: rgba(29,107,114,0.05); }
  .bi-tbl tr:not(.bi-imported):hover td { background: var(--surface2); cursor: pointer; }
  .bi-chk { width: 14px; height: 14px; accent-color: var(--teal); cursor: pointer; }
  .bi-amt-pos { color: var(--green); font-family: 'Source Code Pro', monospace; font-size: 11px; font-weight: 600; }
  .bi-amt-neg { color: var(--red); font-family: 'Source Code Pro', monospace; font-size: 11px; font-weight: 600; }
  .bi-bal { font-family: 'Source Code Pro', monospace; font-size: 11px; color: var(--dim); }
  .bi-tag { display: inline-block; font-size: 9px; font-family: 'Source Code Pro', monospace; text-transform: uppercase; letter-spacing: 0.06em; padding: 2px 7px; border-radius: 20px; font-weight: 600; }
  .bi-tag-new { background: rgba(22,163,74,0.09); color: var(--green); }
  .bi-tag-imp { background: rgba(107,101,96,0.09); color: var(--dim); }
  .bi-nom-sel { font-size: 11px; font-family: 'Inter', system-ui, sans-serif; background: var(--white); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 3px 6px; color: var(--text); outline: none; width: 100%; }
  .bi-nom-sel:focus { border-color: var(--teal); box-shadow: 0 0 0 2px rgba(29,107,114,0.1); }
  .bi-alert { padding: 9px 13px; border-radius: var(--radius-sm); font-size: 12px; margin-bottom: 12px; }
  .bi-alert-ok { background: rgba(22,163,74,0.07); border: 1px solid rgba(22,163,74,0.2); color: var(--green); }
  .bi-alert-err { background: rgba(220,38,38,0.06); border: 1px solid rgba(220,38,38,0.2); color: var(--red); }
  .bi-toast { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--teal); background: rgba(29,107,114,0.08); border: 1px solid rgba(29,107,114,0.2); border-radius: 20px; padding: 3px 11px; font-family: 'Source Code Pro', monospace; animation: fadeIn 0.15s ease; }
  .bi-categorising { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-family: 'Source Code Pro', monospace; color: var(--teal); }
  .bi-categorising .dot { background: var(--teal); }
  @media print {
    .sidebar, .topbar, .chat-panel, .gl-tabs, .btn, .btn-p, .btn-s, .btn-sm { display: none !important; }
    .app { display: block !important; }
    .main { width: 100% !important; overflow: visible !important; }
    .content { padding: 12px 20px !important; overflow: visible !important; }
    .card { box-shadow: none !important; break-inside: avoid; page-break-inside: avoid; }
    .print-only { display: block !important; }
    body { background: white !important; }
  }
  .print-only { display: none; padding-bottom: 14px; border-bottom: 2px solid var(--text); margin-bottom: 16px; }
  .print-title { font-family: 'Playfair Display', serif; font-size: 18px; font-weight: 700; color: var(--text); margin-bottom: 3px; }
  .print-meta { font-size: 11px; color: var(--muted); font-family: 'Source Code Pro', monospace; }
  /* ── COMPANY SWITCHER ── */
  .co-switcher { position: relative; }
  .co-switcher-btn { display: flex; align-items: center; gap: 8px; background: none; border: none; cursor: pointer; width: 100%; text-align: left; padding: 0; }
  .co-switcher-btn .co-name { flex: 1; }
  .co-switcher-btn .co-caret { font-size: 9px; color: rgba(255,255,255,0.3); }
  .co-menu { position: absolute; bottom: calc(100% + 6px); left: 0; right: 0; background: var(--sidebar2); border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; overflow: hidden; z-index: 300; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
  .co-menu-item { display: block; width: 100%; padding: 9px 13px; background: none; border: none; font-size: 12px; font-family: 'Inter', system-ui, sans-serif; color: rgba(255,255,255,0.55); cursor: pointer; text-align: left; transition: background 0.1s; }
  .co-menu-item:hover { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.9); }
  .co-menu-item.active { color: white; font-weight: 600; }
  .co-menu-item.practice { color: var(--gold2); border-bottom: 1px solid rgba(255,255,255,0.08); font-family: 'Source Code Pro', monospace; font-size: 11px; letter-spacing: 0.04em; }
  .co-menu-item.practice:hover { background: rgba(212,160,23,0.08); }
  /* ── PRACTICE DASHBOARD ── */
  .prac-table-wrap { overflow-x: auto; }
  .prac-table { width: 100%; border-collapse: collapse; }
  .prac-th { padding: 8px 12px; text-align: left; font-family: 'Source Code Pro', monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); border-bottom: 1px solid var(--border); white-space: nowrap; cursor: pointer; user-select: none; background: none; border-top: none; border-left: none; border-right: none; }
  .prac-th:hover { color: var(--text); }
  .prac-th.sort-asc::after { content: ' ▲'; font-size: 8px; }
  .prac-th.sort-desc::after { content: ' ▼'; font-size: 8px; }
  .prac-tr { border-bottom: 1px solid var(--border); cursor: pointer; transition: background 0.1s; }
  .prac-tr:hover { background: var(--white); }
  .prac-td { padding: 10px 12px; vertical-align: middle; font-size: 13px; color: var(--text); }
  .prac-status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .prac-compact { display: none; }
  .prac-compact-row { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--border); cursor: pointer; }
  .prac-compact-row:hover { opacity: 0.8; }
  @media (max-width: 680px) { .prac-table-wrap { display: none; } .prac-compact { display: block; } }
  /* ── READ-ONLY BADGE ── */
  .ro-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 9px; font-family: 'Source Code Pro', monospace; color: var(--gold); background: rgba(184,134,11,0.08); padding: 2px 8px; border-radius: 20px; border: 1px solid rgba(184,134,11,0.2); letter-spacing: 0.06em; text-transform: uppercase; }
`;

// ─── MAGIC MOMENT ─────────────────────────────────────────────────────────────
const FEED_ITEMS = [
  { ref: "RCP-041", narr: "Murphy Retail — receipt on account", status: "auto", amount: "€12,000" },
  { ref: "PAY-019", narr: "Payroll run — April gross salaries", status: "auto", amount: "€32,000" },
  { ref: "INV-0089", narr: "Sales invoice — Murphy Retail", status: "auto", amount: "€4,800" },
  { ref: "RCP-042", narr: "Clancy Engineering — INV-0082", status: "auto", amount: "€5,600" },
  { ref: "PAY-020", narr: "PAYE/PRSI — March P30 payment", status: "auto", amount: "€4,880" },
  { ref: "JNL-001", narr: "Depreciation — Plant & Machinery", status: "auto", amount: "€8,500" },
  { ref: "INV-0091", narr: "Sales invoice — Clancy Engineering", status: "auto", amount: "€2,200" },
  { ref: "PAY-021", narr: "VAT3 payment — Feb/Mar period", status: "auto", amount: "€5,820" },
  { ref: "JNL-002", narr: "Accrual — legal fees outstanding", status: "auto", amount: "€3,200" },
  { ref: "RCP-043", narr: "West Cork Meats — INV-0088", status: "auto", amount: "€3,200" },
  { ref: "PAY-022", narr: "Office lease — April payment", status: "auto", amount: "€2,400" },
  { ref: "INV-0092", narr: "Sales invoice — West Cork Meats", status: "auto", amount: "€960" },
  { ref: "JNL-003", narr: "Prepayment — annual insurance", status: "auto", amount: "€4,200" },
  { ref: "RCP-044", narr: "Aoife Design — part payment", status: "auto", amount: "€8,620" },
  { ref: "INV-0094", narr: "Sales invoice — O'Brien Logistics", status: "auto", amount: "€14,390" },
];

const REVIEW_ITEMS = [
  { ref: "PAY-023/024", narr: "Limerick Supplies — two payments same amount", reason: "Possible duplicate · €340 each · 27 & 28 Apr", icon: "⚠" },
  { ref: "PUR-031", narr: "Arthur Cox — legal invoice unmatched PO", reason: "No purchase order on file · €1,800 · recommend approval", icon: "❓" },
  { ref: "JNL-EXT", narr: "Contractor cost up 34% vs last quarter", reason: "AI flagged variance · review before sign-off", icon: "📊" },
];

const AUTO_POSTED_SUMMARY = [
  "47 bank transactions categorised and matched",
  "12 sales invoices posted to debtors ledger",
  "8 supplier payments allocated to creditors",
  "3 month-end journals posted (depreciation, accrual, prepayment)",
  "VAT T1/T2 workings auto-prepared from transactions",
  "Trial balance confirmed — debits equal credits ✓",
];

const SOURCES = ["AIB Open Banking", "Invoice OCR", "Payroll feed", "Manual journals"];

function MagicMoment({ onComplete }) {
  const [phase, setPhase] = useState("idle"); // idle → processing → results
  const [progress, setProgress] = useState(0);
  const [visibleFeed, setVisibleFeed] = useState([]);
  const [srcDone, setSrcDone] = useState([false, false, false, false]);
  const [reviewed, setReviewed] = useState({});
  const [allApproved, setAllApproved] = useState(false);

  const circumference = 2 * Math.PI * 52;

  useEffect(() => {
    if (phase !== "processing") return;
    // Progress ticker
    let prog = 0;
    const ticker = setInterval(() => {
      prog += Math.random() * 4 + 1;
      if (prog >= 100) { prog = 100; clearInterval(ticker); }
      setProgress(Math.min(Math.round(prog), 100));
    }, 120);
    // Feed items appear one by one
    let idx = 0;
    const feeder = setInterval(() => {
      if (idx < FEED_ITEMS.length) {
        setVisibleFeed(v => [...v, FEED_ITEMS[idx]]);
        idx++;
      } else {
        clearInterval(feeder);
      }
    }, 220);
    // Source pills go done progressively
    [800, 1600, 2800, 4000].forEach((ms, i) => {
      setTimeout(() => setSrcDone(s => { const n=[...s]; n[i]=true; return n; }), ms);
    });
    // Transition to results
    const done = setTimeout(() => setPhase("results"), 5200);
    return () => { clearInterval(ticker); clearInterval(feeder); clearTimeout(done); };
  }, [phase]);

  useEffect(() => {
    const allDone = REVIEW_ITEMS.every((_, i) => reviewed[i] !== undefined);
    setAllApproved(allDone);
  }, [reviewed]);

  const dashOffset = circumference - (progress / 100) * circumference;

  // ── IDLE ──
  if (phase === "idle") return (
    <div className="mm-wrap">
      <div className="mm-grid" />
      <div className="mm-glow" />
      <div className="mm-card" style={{ animation: "fadeUp 0.5s ease forwards" }}>
        <div className="mm-idle-logo">Ledgr<span>ly</span></div>
        <div className="mm-idle-sub">Finance OS · Ireland · {PERIOD}</div>
        <div className="mm-company">{COMPANY}</div>
        <div className="mm-period">▸ Month end close ready · {PERIOD}</div>
        <button className="mm-btn" onClick={() => setPhase("processing")}>
          <span className="mm-btn-icon">⚡</span>
          <div className="mm-btn-text">
            <div className="mm-btn-label">Run Month End Close</div>
            <div className="mm-btn-hint">AI will process all transactions · takes ~10 seconds</div>
          </div>
          <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 20 }}>→</span>
        </button>
        <div className="mm-features">
          {["AIB Open Banking", "Invoice OCR", "Auto-reconciliation", "ROS prep", "AI categorisation"].map(f => (
            <span key={f} className="mm-feat">{f}</span>
          ))}
        </div>
      </div>
    </div>
  );

  // ── PROCESSING ──
  if (phase === "processing") return (
    <div className="mm-wrap">
      <div className="mm-grid" />
      <div className="mm-glow" />
      <div className="mm-card">
        <div className="mm-proc-header">
          <div>
            <div className="mm-proc-title">AI processing month end…</div>
            <div style={{ fontSize: 11, fontFamily: "'Source Code Pro', monospace", color: "rgba(255,255,255,0.3)", marginTop: 4 }}>
              {COMPANY} · {PERIOD}
            </div>
          </div>
          <div className="mm-proc-pct">{progress}%</div>
        </div>

        {/* Arc progress */}
        <div className="mm-arc-wrap">
          <svg className="mm-arc" width="120" height="120" viewBox="0 0 120 120">
            <circle className="mm-arc-bg" cx="60" cy="60" r="52" />
            <circle className="mm-arc-fill" cx="60" cy="60" r="52"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset} />
            <text className="mm-arc-text" x="60" y="60" textAnchor="middle" dominantBaseline="central"
              style={{ fill: "white", fontSize: 11, fontFamily: "'Source Code Pro', monospace", fontWeight: 700 }}>
              {visibleFeed.length} posted
            </text>
          </svg>
        </div>

        {/* Source pills */}
        <div className="mm-sources">
          {SOURCES.map((s, i) => (
            <div key={s} className="mm-src">
              <div className={`mm-src-dot ${srcDone[i] ? "done" : ""}`} />
              {s} {srcDone[i] ? "✓" : ""}
            </div>
          ))}
        </div>

        {/* Live feed */}
        <div className="mm-feed-list">
          {[...visibleFeed].filter(Boolean).reverse().slice(0, 7).map((item, i) => (
            <div key={i} className="mm-feed-item" style={{ animationDelay: `${i * 0.02}s` }}>
              <div className={`mm-feed-dot ${item.status}`} />
              <span className="mm-feed-ref">{item.ref}</span>
              <span className="mm-feed-narr">{item.narr}</span>
              <span style={{ fontFamily: "'Source Code Pro', monospace", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{item.amount}</span>
              <span className={`mm-feed-badge ${item.status}`}>
                {item.status === "auto" ? "AUTO" : "REVIEW"}
              </span>
            </div>
          ))}
          {progress < 100 && (
            <div className="mm-feed-item">
              <div className="mm-feed-dot proc" />
              <span className="mm-feed-narr" style={{ color: "rgba(255,255,255,0.3)", fontStyle: "italic" }}>Analysing transactions…</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // ── RESULTS ──
  if (phase !== "results") return null;

  const pendingCount = REVIEW_ITEMS.filter((_, i) => reviewed[i] === undefined).length;

  return (
    <div className="mm-wrap">
      <div className="mm-grid" />
      <div className="mm-glow" style={{ background: "radial-gradient(circle, rgba(29,107,114,0.25) 0%, transparent 70%)" }} />
      <div className="mm-card" style={{ animation: "fadeUp 0.4s ease forwards" }}>

        {/* Score */}
        <div className="mm-score-row">
          <svg className="mm-score-circle" viewBox="0 0 100 100">
            <circle className="mm-score-arc-bg" cx="50" cy="50" r="39" />
            <circle className="mm-score-arc" cx="50" cy="50" r="39"
              style={{ transform: "rotate(-90deg)", transformOrigin: "50% 50%" }} />
            <text x="50" y="47" textAnchor="middle" dominantBaseline="central"
              style={{ fill: "white", fontSize: 18, fontFamily: "'Playfair Display', serif", fontWeight: 700 }}>
              90%
            </text>
            <text x="50" y="62" textAnchor="middle" dominantBaseline="central"
              style={{ fill: "rgba(255,255,255,0.35)", fontSize: 8, fontFamily: "'Source Code Pro', monospace" }}>
              AUTO
            </text>
          </svg>
          <div>
            <div className="mm-score-detail">Month end 90% complete</div>
            <div className="mm-score-sub">47 of 50 entries posted automatically · 3 need your review</div>
          </div>
        </div>

        {/* Stat pills */}
        <div className="mm-stat-pills">
          {[
            { val: "47", lbl: "Auto-posted" },
            { val: "3", lbl: "Need review" },
            { val: "€0", lbl: "Discrepancies" },
            { val: "✓", lbl: "TB balanced" },
          ].map(s => (
            <div key={s.lbl} className="mm-stat">
              <div className="mm-stat-val">{s.val}</div>
              <div className="mm-stat-lbl">{s.lbl}</div>
            </div>
          ))}
        </div>

        {/* Auto-posted summary */}
        <div className="mm-auto-posted">
          <div className="mm-auto-hdr">
            <span className="mm-auto-title">⚡ Auto-posted by AI</span>
            <span className="mm-auto-count">47 entries</span>
          </div>
          {AUTO_POSTED_SUMMARY.map((item, i) => (
            <div key={i} className="mm-auto-item">
              <span className="mm-auto-check">✓</span>
              <span>{item}</span>
            </div>
          ))}
        </div>

        {/* Review items */}
        <div className="mm-review-section">
          <div className="mm-review-hdr">
            <span className="mm-review-title">⚠ Needs your review ({pendingCount} remaining)</span>
          </div>
          {REVIEW_ITEMS.map((item, i) => (
            <div key={i} className="mm-review-item"
              style={{ opacity: reviewed[i] !== undefined ? 0.55 : 1, transition: "opacity 0.3s" }}>
              <span className="mm-review-icon">{reviewed[i] === "approved" ? "✓" : item.icon}</span>
              <div className="mm-review-body">
                <div className="mm-review-ref">{item.ref}</div>
                <div className="mm-review-narr">{item.narr}</div>
                <div className="mm-review-reason">{item.reason}</div>
              </div>
              {reviewed[i] === undefined ? (
                <div className="mm-review-actions">
                  <button className="mm-approve" onClick={() => setReviewed(r => ({ ...r, [i]: "approved" }))}>Approve</button>
                  <button className="mm-reject" onClick={() => setReviewed(r => ({ ...r, [i]: "rejected" }))}>Flag</button>
                </div>
              ) : (
                <span className="mm-approved-badge">{reviewed[i] === "approved" ? "Approved" : "Flagged"}</span>
              )}
            </div>
          ))}
        </div>

        {/* CTA */}
        <button
          className={`mm-cta ${!allApproved ? "mm-cta-disabled" : ""}`}
          onClick={onComplete}>
          {allApproved ? "Open Dashboard →" : `Review ${pendingCount} remaining item${pendingCount !== 1 ? "s" : ""} to continue`}
        </button>
        {!allApproved && (
          <div style={{ textAlign: "center", marginTop: 10, fontSize: 10, fontFamily: "'Source Code Pro', monospace", color: "rgba(255,255,255,0.25)" }}>
            Approve or flag all items above to unlock the dashboard
          </div>
        )}
      </div>
    </div>
  );
}

function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const attempt = () => {
    if ((email === "demo@finflow.ie" && pass === "demo") || (email === "" && pass === "")) {
      onLogin();
    } else {
      setErr("Invalid credentials. Use the demo login below.");
    }
  };
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-hdr">
          <div className="login-logo">Ledgr<span>ly</span></div>
          <div className="login-tagline">Finance OS · Ireland</div>
        </div>
        <div className="login-body">
          <div className="login-title">Sign in to your workspace</div>
          <div className="login-sub">{COMPANY} · Irish SME Finance OS</div>
          <div className="login-field">
            <label className="login-label">Email address</label>
            <input className="login-input" type="email" placeholder="demo@finflow.ie" value={email} onChange={e => { setEmail(e.target.value); setErr(""); }} onKeyDown={e => e.key === "Enter" && attempt()} />
          </div>
          <div className="login-field">
            <label className="login-label">Password</label>
            <input className="login-input" type="password" placeholder="••••••••" value={pass} onChange={e => { setPass(e.target.value); setErr(""); }} onKeyDown={e => e.key === "Enter" && attempt()} />
          </div>
          {err && <div style={{ fontSize: 11, color: "var(--red)", marginBottom: 10 }}>{err}</div>}
          <button className="login-btn" onClick={attempt}>Sign in →</button>
          <div className="login-demo-hint">
            Demo access: <span onClick={() => { setEmail("demo@finflow.ie"); setPass("demo"); }}>use demo credentials</span>
          </div>
        </div>
        <div className="login-footer">
          <div className="login-badges">
            <span className="login-badge">Irish GAAP</span>
            <span className="login-badge">ROS API</span>
            <span className="login-badge">SOC 2</span>
            <span className="login-badge">GDPR</span>
          </div>
          <span style={{ fontSize: 10, color: "var(--dim)", fontFamily: "Source Code Pro, monospace" }}>v0.1 beta</span>
        </div>
      </div>
    </div>
  );
}

// ─── ONBOARDING WIZARD ───────────────────────────────────────────────────────
const OB_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const OB_CURRENCIES = ["EUR","GBP","USD"];
const OB_TYPES = ["Limited Company","Sole Trader","Partnership"];
const OB_STEP_LABELS = ["Company", "Tax", "Accounts", "Checklist", "Bank"];

function GettingStartedCard({ company, onOpenStep, onDismiss }) {
  const STEPS = [
    { key: 'company_profile',   num: 1, label: 'Company profile' },
    { key: 'tax_profile',       num: 2, label: 'Tax profile' },
    { key: 'chart_of_accounts', num: 3, label: 'Chart of accounts' },
    { key: 'checklist',         num: 4, label: 'Month-end checklist' },
    { key: 'bank_import',       num: 5, label: 'Bank import' },
  ];
  const done = company?.onboarding_steps || {};
  const doneCount = STEPS.filter(s => done[s.key]).length;
  return (
    <div className="card" style={{ marginBottom: 18, border: "1px solid rgba(52,211,153,0.2)" }}>
      <div className="card-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="card-title">Getting started</span>
          <span style={{ fontSize: 11, color: "var(--text-muted)", background: "var(--surface-2)", padding: "2px 7px", borderRadius: 10 }}>{doneCount} / 5 steps</span>
        </div>
        <button onClick={onDismiss} style={{ background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", fontSize: 12, fontFamily: "Inter, system-ui, sans-serif" }}>Dismiss</button>
      </div>
      <div style={{ padding: "4px 15px 12px" }}>
        {STEPS.map((s, i) => {
          const isDone = !!done[s.key];
          return (
            <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: i < 4 ? "1px solid var(--border)" : "none" }}>
              <div style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, background: isDone ? "var(--accent-dim)" : "var(--surface-2)", border: `1px solid ${isDone ? "var(--accent)" : "var(--border)"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: isDone ? "var(--accent)" : "var(--text-faint)" }}>
                {isDone ? "✓" : s.num}
              </div>
              <span style={{ flex: 1, fontSize: 13, color: isDone ? "var(--text-faint)" : "var(--text)", textDecoration: isDone ? "line-through" : "none" }}>{s.label}</span>
              {!isDone && <button onClick={() => onOpenStep(s.num)} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "Inter, system-ui, sans-serif", padding: 0 }}>Continue →</button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OnboardingWizard({ user, company, onComplete, onUpdate, onDismiss, initStep = 1 }) {
  const [step, setStep]               = useState(initStep);
  const [wCo, setWCo]                 = useState(company);
  const [saving, setSaving]           = useState(false);
  const [err, setErr]                 = useState(null);
  const [chkLoading, setChkLoading]   = useState(false);

  const [s1, setS1] = useState({
    name:           company?.name           || (user?.firstName ? `${user.firstName} ${user.lastName ?? ""}`.trim() : ""),
    company_type:   company?.company_type   || "Limited Company",
    year_end_month: company?.year_end_month || 12,
    currency:       company?.currency       || "EUR",
  });
  const [s2, setS2] = useState({
    vat_registered:  company?.vat_registered  ?? false,
    vat_number:      company?.vat_number      || "",
    vat_period:      company?.vat_period      || "bimonthly",
    ros_efiler:      company?.ros_efiler      ?? false,
    cro_number:      company?.cro_number      || "",
    paye_registered: company?.paye_registered ?? false,
  });

  const advance = (n, updated) => {
    setErr(null);
    if (updated) { setWCo(updated); onUpdate?.(updated); }
    setStep(n);
  };

  const doStep1 = async () => {
    if (!s1.name.trim() || saving) return;
    setSaving(true); setErr(null);
    try {
      if (!wCo) {
        const { data, error } = await supabase.from('companies').insert({
          clerk_user_id:        user.id,
          name:                 s1.name.trim(),
          company_type:         s1.company_type,
          year_end_month:       Number(s1.year_end_month),
          currency:             s1.currency,
          vat_registered:       false,
          period_start:         1,
          onboarding_completed: false,
          onboarding_steps:     { company_profile: true },
        }).select().single();
        if (error) throw error;
        supabase.rpc('claim_mailbox_slug', { p_company_id: data.id, p_name: data.name });
        try {
          const r = await fetch('/api/create-org', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ companyId: data.id, companyName: data.name, userId: user.id }),
          });
          if (r.ok) {
            const { orgId } = await r.json();
            if (orgId) {
              await supabase.from('companies').update({ clerk_org_id: orgId }).eq('id', data.id);
              advance(2, { ...data, clerk_org_id: orgId });
              setSaving(false); return;
            }
          }
        } catch (_) {}
        advance(2, data);
      } else {
        const steps = { ...(wCo.onboarding_steps || {}), company_profile: true };
        const { data, error } = await supabase.from('companies').update({
          name:             s1.name.trim(),
          company_type:     s1.company_type,
          year_end_month:   Number(s1.year_end_month),
          currency:         s1.currency,
          onboarding_steps: steps,
        }).eq('id', wCo.id).select().single();
        if (error) throw error;
        advance(2, data);
      }
    } catch (e) { setErr(e.message); }
    setSaving(false);
  };

  const doStep2 = async () => {
    if (!wCo?.id || saving) return;
    setSaving(true); setErr(null);
    try {
      const steps = { ...(wCo.onboarding_steps || {}), tax_profile: true };
      const { data, error } = await supabase.from('companies').update({
        vat_registered:   s2.vat_registered,
        vat_number:       s2.vat_registered ? (s2.vat_number.trim() || null) : null,
        vat_period:       s2.vat_period,
        ros_efiler:       s2.ros_efiler,
        cro_number:       s2.cro_number.trim() || null,
        paye_registered:  s2.paye_registered,
        onboarding_steps: steps,
      }).eq('id', wCo.id).select().single();
      if (error) throw error;
      advance(3, data);
    } catch (e) { setErr(e.message); }
    setSaving(false);
  };

  const doStep3 = async () => {
    if (!wCo?.id) return;
    const steps = { ...(wCo.onboarding_steps || {}), chart_of_accounts: true };
    const { data } = await supabase.from('companies').update({ onboarding_steps: steps }).eq('id', wCo.id).select().single();
    advance(4, data || { ...wCo, onboarding_steps: steps });
  };

  const doStep4 = async () => {
    if (!wCo?.id) return;
    setChkLoading(true); setErr(null);
    try {
      const now = new Date();
      const periodKey = now.toLocaleDateString('en-IE', { month: 'long', year: 'numeric' });
      const { count } = await supabase.from('checklists')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', wCo.id).eq('period', periodKey);
      if (!count) {
        const rows = CHECKLIST_TEMPLATE.flatMap(({ section, items }) =>
          items.map(item_label => ({
            company_id: wCo.id, section, item_label, is_auto: false, checked: false, period: periodKey,
            completion_condition: CONDITION_MAP[item_label] || null,
          }))
        );
        await supabase.from('checklists').insert(rows);
      }
      const steps = { ...(wCo.onboarding_steps || {}), checklist: true };
      const { data } = await supabase.from('companies').update({ onboarding_steps: steps }).eq('id', wCo.id).select().single();
      advance(5, data || { ...wCo, onboarding_steps: steps });
    } catch (e) { setErr(e.message); }
    setChkLoading(false);
  };

  const finish = async (bankDone = false) => {
    if (!wCo?.id || saving) return;
    setSaving(true); setErr(null);
    try {
      const steps = { ...(wCo.onboarding_steps || {}) };
      if (bankDone) steps.bank_import = true;
      const { data, error } = await supabase.from('companies').update({
        onboarding_completed: true,
        onboarding_steps:     steps,
      }).eq('id', wCo.id).select().single();
      if (error) throw error;
      onComplete(data);
    } catch (e) { setErr(e.message); setSaving(false); }
  };

  const coaCategories = [...new Set(COA_SEED.map(a => a.category))];
  const isNewSignup   = !company;
  const isWide        = step === 3 || step === 5;

  const stepBar = (
    <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 20, alignItems: "center" }}>
      {OB_STEP_LABELS.map((lbl, i) => {
        const n = i + 1;
        const isDone = n < step;
        const isAct  = n === step;
        return (
          <div key={n} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            <div style={{
              width: isAct ? 28 : 8, height: 8, borderRadius: 4,
              background: isDone || isAct ? "var(--accent)" : "var(--surface-2)",
              opacity: isDone ? 0.45 : 1, transition: "all 0.2s",
            }} />
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="ob-wrap">
      <div className={`ob-card${isWide ? " ob-card--wide" : ""}`}>
        <div className="ob-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div className="ob-logo">Ledgr<span>ly</span></div>
            <div className="ob-tagline">Finance OS · Ireland</div>
          </div>
          {!isNewSignup && (
            <button onClick={onDismiss} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 4px" }}>✕</button>
          )}
        </div>
        <div className="ob-body">
          {stepBar}
          <div className="ob-step">Step {step} of 5 — {OB_STEP_LABELS[step - 1]}</div>

          {step === 1 && (
            <>
              <p className="ob-title">Welcome to Ledgrly</p>
              <p className="ob-sub">Let's set up your workspace. You can update everything later in Settings.</p>
              <div className="ob-row full">
                <div className="ob-group">
                  <label className="ob-label">Company / Trading Name</label>
                  <input className="ob-input" value={s1.name}
                    onChange={e => setS1(p => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. Brennan & Sons Ltd"
                    onKeyDown={e => e.key === "Enter" && doStep1()} />
                </div>
              </div>
              <div className="ob-row">
                <div className="ob-group">
                  <label className="ob-label">Company Type</label>
                  <select className="ob-input" value={s1.company_type}
                    onChange={e => setS1(p => ({ ...p, company_type: e.target.value }))}>
                    {OB_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div className="ob-group">
                  <label className="ob-label">Accounting Year End</label>
                  <select className="ob-input" value={s1.year_end_month}
                    onChange={e => setS1(p => ({ ...p, year_end_month: Number(e.target.value) }))}>
                    {OB_MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                  </select>
                </div>
              </div>
              <div className="ob-row">
                <div className="ob-group">
                  <label className="ob-label">Base Currency</label>
                  <select className="ob-input" value={s1.currency}
                    onChange={e => setS1(p => ({ ...p, currency: e.target.value }))}>
                    {OB_CURRENCIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              {err && <div style={{ marginBottom: 12, fontSize: 12, color: "var(--red)", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 4, padding: "8px 12px" }}>{err}</div>}
              <button className="ob-submit" onClick={doStep1} disabled={!s1.name.trim() || saving}>
                {saving ? "Setting up…" : "Get started →"}
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <p className="ob-title">Tax & registration</p>
              <p className="ob-sub">Ledgrly configures your compliance calendar from these settings.</p>
              <div className="ob-row">
                <div className="ob-group">
                  <label className="ob-label">VAT Registered?</label>
                  <div className="ob-toggle">
                    <button className={`ob-toggle-btn${!s2.vat_registered ? " active" : ""}`}
                      onClick={() => setS2(p => ({ ...p, vat_registered: false, vat_number: "" }))}>No</button>
                    <button className={`ob-toggle-btn${s2.vat_registered ? " active" : ""}`}
                      onClick={() => setS2(p => ({ ...p, vat_registered: true }))}>Yes</button>
                  </div>
                </div>
                <div className="ob-group">
                  <label className="ob-label">PAYE Registered?</label>
                  <div className="ob-toggle">
                    <button className={`ob-toggle-btn${!s2.paye_registered ? " active" : ""}`}
                      onClick={() => setS2(p => ({ ...p, paye_registered: false }))}>No</button>
                    <button className={`ob-toggle-btn${s2.paye_registered ? " active" : ""}`}
                      onClick={() => setS2(p => ({ ...p, paye_registered: true }))}>Yes</button>
                  </div>
                </div>
              </div>
              {s2.vat_registered && (
                <>
                  <div className="ob-row">
                    <div className="ob-group">
                      <label className="ob-label">VAT Number</label>
                      <input className="ob-input" value={s2.vat_number}
                        onChange={e => setS2(p => ({ ...p, vat_number: e.target.value }))}
                        placeholder="IE 1234567A" />
                    </div>
                    <div className="ob-group">
                      <label className="ob-label">Filing Frequency</label>
                      <select className="ob-input" value={s2.vat_period}
                        onChange={e => setS2(p => ({ ...p, vat_period: e.target.value }))}>
                        <option value="bimonthly">Bi-monthly</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    </div>
                  </div>
                  <div className="ob-row">
                    <div className="ob-group">
                      <label className="ob-label">ROS eFiler?</label>
                      <div className="ob-toggle">
                        <button className={`ob-toggle-btn${!s2.ros_efiler ? " active" : ""}`}
                          onClick={() => setS2(p => ({ ...p, ros_efiler: false }))}>No</button>
                        <button className={`ob-toggle-btn${s2.ros_efiler ? " active" : ""}`}
                          onClick={() => setS2(p => ({ ...p, ros_efiler: true }))}>Yes</button>
                      </div>
                    </div>
                  </div>
                </>
              )}
              <div className="ob-row full">
                <div className="ob-group">
                  <label className="ob-label">CRO Number <span style={{ fontWeight: 400, opacity: 0.6 }}>(if registered)</span></label>
                  <input className="ob-input" value={s2.cro_number}
                    onChange={e => setS2(p => ({ ...p, cro_number: e.target.value }))}
                    placeholder="e.g. 123456" />
                </div>
              </div>
              {err && <div style={{ marginBottom: 12, fontSize: 12, color: "var(--red)", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 4, padding: "8px 12px" }}>{err}</div>}
              <button className="ob-submit" onClick={doStep2} disabled={saving}>
                {saving ? "Saving…" : "Save & continue →"}
              </button>
              <button className="ob-skip" onClick={() => advance(3)}>Skip for now →</button>
            </>
          )}

          {step === 3 && (
            <>
              <p className="ob-title">Default chart of accounts</p>
              <p className="ob-sub">Ledgrly uses an Irish GAAP chart of accounts. Customise anytime in Settings.</p>
              <div style={{ maxHeight: 280, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 6, marginBottom: 16 }}>
                {coaCategories.map(cat => (
                  <div key={cat}>
                    <div style={{ padding: "6px 12px", fontSize: 9, fontFamily: "Source Code Pro, monospace", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--accent)", background: "var(--surface-2)", fontWeight: 600, position: "sticky", top: 0 }}>{cat}</div>
                    {COA_SEED.filter(a => a.category === cat).map(a => (
                      <div key={a.code} style={{ display: "flex", alignItems: "center", padding: "5px 12px", borderBottom: "1px solid var(--border)", gap: 10 }}>
                        <span style={{ fontFamily: "Source Code Pro, monospace", color: "var(--text-faint)", fontSize: 10, width: 38, flexShrink: 0 }}>{a.code}</span>
                        <span style={{ color: "var(--text)", fontSize: 12, flex: 1 }}>{a.name}</span>
                        <span style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "capitalize" }}>{a.account_type}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <button className="ob-submit" onClick={doStep3}>Use this chart of accounts →</button>
              <button className="ob-skip" onClick={() => advance(4)}>Customise later →</button>
            </>
          )}

          {step === 4 && (
            <>
              <p className="ob-title">Month-end close checklist</p>
              <p className="ob-sub">Load the default checklist. It auto-completes items like bank reconciliation and VAT returns as you work.</p>
              <div style={{ maxHeight: 220, overflowY: "auto", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 6, padding: "12px 14px", marginBottom: 18 }}>
                {CHECKLIST_TEMPLATE.map(({ section, items }) => (
                  <div key={section} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 9, fontFamily: "Source Code Pro, monospace", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--accent)", fontWeight: 600, marginBottom: 4 }}>{section}</div>
                    {items.map(lbl => (
                      <div key={lbl} style={{ fontSize: 12, color: "var(--text-muted)", padding: "2px 0", display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ color: "var(--text-faint)", fontSize: 10 }}>○</span>{lbl}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              {err && <div style={{ marginBottom: 12, fontSize: 12, color: "var(--red)", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 4, padding: "8px 12px" }}>{err}</div>}
              <button className="ob-submit" onClick={doStep4} disabled={chkLoading}>
                {chkLoading ? "Loading…" : "Load checklist →"}
              </button>
              <button className="ob-skip" onClick={() => advance(5)}>Skip for now →</button>
            </>
          )}

          {step === 5 && (
            <>
              <p className="ob-title">Import bank transactions</p>
              <p className="ob-sub">Upload a Revolut Business CSV to populate cash flow and kick-start automation. Skip and do this later from Bank Import.</p>
              {wCo?.id && <BankImport companyId={wCo.id} />}
              {err && <div style={{ marginBottom: 12, marginTop: 8, fontSize: 12, color: "var(--red)", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 4, padding: "8px 12px" }}>{err}</div>}
              <button className="ob-submit" onClick={() => finish(true)} disabled={saving} style={{ marginTop: 14 }}>
                {saving ? "Finishing…" : "Open your dashboard →"}
              </button>
              <button className="ob-skip" onClick={() => finish(false)}>Skip bank import →</button>
            </>
          )}
        </div>
        <div className="ob-footer">
          {user?.emailAddresses?.[0]?.emailAddress ? `Signed in as ${user.emailAddresses[0].emailAddress} · ` : ""}Irish GAAP · SOC 2 · GDPR
        </div>
      </div>
    </div>
  );
}

// ─── CASH FLOW PAGE ───────────────────────────────────────────────────────────
function CashFlow({ selPeriod, onNavigate, companyId, company }) {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const baseCurrency = company?.base_currency || company?.currency || "EUR";
  const fmt  = (n) => fmtCurrency(n, baseCurrency);
  const fmtK = (n) => fmtCurrencyK(n, baseCurrency);

  const [loading, setLoading]     = useState(true);
  const [txns, setTxns]           = useState([]);
  const [allInvoices, setAllInvoices] = useState([]);

  useEffect(() => {
    if (!companyId) { setLoading(false); return; }
    (async () => {
      setLoading(true);
      const db = supabase;
      const [txRes, invRes] = await Promise.all([
        db.from('bank_transactions').select('*').eq('company_id', companyId).order('date', { ascending: true }),
        db.from('invoices').select('*').eq('company_id', companyId)
          .in('status', ['pending', 'chased']).order('due_date', { ascending: true }),
      ]);
      if (txRes.data)  setTxns(txRes.data);
      if (invRes.data) setAllInvoices(invRes.data);
      setLoading(false);
    })();
  }, [companyId]); // eslint-disable-line

  // ── Empty state ──
  if (!loading && txns.length === 0) return (
    <div className="fade-up" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 340, textAlign: "center", padding: 48 }}>
      <div style={{ fontSize: 38, marginBottom: 16, color: "var(--text-faint)" }}>⟁</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>No bank data imported yet</div>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 24, maxWidth: 400, lineHeight: 1.7 }}>
        Upload a Revolut Business CSV in Bank Import to populate your cash flow forecast, account balances, and AP schedule.
      </div>
      <button className="btn btn-p" onClick={() => onNavigate("bank-import")}>Go to Bank Import</button>
    </div>
  );

  // ── Period bounds ──
  const isCurrentPeriod = selPeriod === currentMonth;
  const [py, pm] = selPeriod.split('-').map(Number);
  const periodStart    = `${selPeriod}-01`;
  const periodEndDate  = isCurrentPeriod ? now : new Date(py, pm, 0);
  const periodEndStr   = periodEndDate.toISOString().slice(0, 10);
  const daysInPeriod   = isCurrentPeriod ? now.getDate() : new Date(py, pm, 0).getDate();

  // ── Derived figures ──
  const txnsUpToEnd = txns.filter(t => t.date <= periodEndStr);
  const latestTxn   = txnsUpToEnd[txnsUpToEnd.length - 1];
  const currentBal  = latestTxn ? Number(latestTxn.balance) : 0;

  const periodTxns  = txns.filter(t => t.date >= periodStart && t.date <= periodEndStr);
  const periodNet   = periodTxns.reduce((s, t) => s + Number(t.amount), 0);
  const avgDaily    = daysInPeriod > 0 ? periodNet / daysInPeriod : 0;

  // When the selected period has no transactions, fall back to the most recent period that does
  const effectiveAvgDaily = (() => {
    if (periodTxns.length > 0 || txns.length === 0) return avgDaily;
    const lastTxnDate = txns[txns.length - 1].date; // txns ordered ascending
    const [ly, lm] = lastTxnDate.split('-').map(Number);
    const fbStart = `${ly}-${String(lm).padStart(2, '0')}-01`;
    const fbEnd   = new Date(ly, lm, 0).toISOString().slice(0, 10);
    const fbTxns  = txns.filter(t => t.date >= fbStart && t.date <= fbEnd);
    const fbNet   = fbTxns.reduce((s, t) => s + Number(t.amount), 0);
    const fbDays  = new Date(ly, lm, 0).getDate();
    return fbDays > 0 ? fbNet / fbDays : 0;
  })();

  const fmtBal  = v => `${v < 0 ? '-' : ''}€${Math.abs(v).toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = d => new Date(d + 'T12:00:00').toLocaleDateString("en-IE", { day: "2-digit", month: "short" });

  const baseLabel = isCurrentPeriod ? "Today" : fmtDate(periodEndStr);
  const forecast = [
    { label: baseLabel, days: 0,  val: currentBal },
    { label: "+30d",    days: 30, val: currentBal + effectiveAvgDaily * 30 },
    { label: "+60d",    days: 60, val: currentBal + effectiveAvgDaily * 60 },
    { label: "+90d",    days: 90, val: currentBal + effectiveAvgDaily * 90 },
  ];

  const maxAbs  = Math.max(...forecast.map(f => Math.abs(f.val)), 1);
  const barH    = v => Math.max((Math.abs(v) / maxAbs) * 80, 4);

  const recent10 = [...periodTxns].reverse().slice(0, 10);

  const recurringPayments = useMemo(() => {
    const getBasePayee = desc => (desc || '')
      .replace(/\s+IE\d{14,}.*$/i, '')
      .replace(/\s+\*\d+.*$/, '')
      .replace(/\s+TxnDate:.*$/i, '')
      .replace(/\s+P[0-9A-F]{5,}.*$/i, '')
      .trim()
      .toLowerCase();
    const groups = {};
    txns.filter(t => Number(t.amount) < 0).forEach(t => {
      const key = getBasePayee(t.description);
      if (!key || key.length < 2) return;
      if (!groups[key]) groups[key] = { key, txns: [], display: key };
      groups[key].txns.push(t);
    });
    return Object.values(groups)
      .filter(g => g.txns.length >= 3)
      .map(g => {
        const amounts = g.txns.map(t => Math.abs(Number(t.amount))).sort((a, b) => a - b);
        const medAmt  = amounts[Math.floor(amounts.length / 2)];
        const dates   = g.txns.map(t => new Date(t.date + 'T12:00:00')).sort((a, b) => a - b);
        const gaps    = dates.slice(1).map((d, i) => (d - dates[i]) / 86400000);
        const medGap  = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 0;
        const freq    = medGap < 9 ? 'Weekly' : medGap < 20 ? 'Fortnightly' : medGap < 50 ? 'Monthly' : medGap < 110 ? 'Quarterly' : 'Irregular';
        const lastDate = dates[dates.length - 1];
        const nextDate = medGap > 0 ? new Date(lastDate.getTime() + medGap * 86400000).toISOString().slice(0, 10) : null;
        return { key: g.key, example: g.display, count: g.txns.length, medAmt, freq, nextDate };
      })
      .sort((a, b) => b.medAmt - a.medAmt);
  }, [txns]);

  // AP: invoices due in the 30 days after the period end
  const ap30End = new Date(periodEndDate.getTime() + 30 * 86400000).toISOString().slice(0, 10);
  const upcomingAP = allInvoices.filter(inv => inv.due_date > periodEndStr && inv.due_date <= ap30End);

  return (
    <div className="fade-up">
      {loading && <div style={{ padding: "32px 0", textAlign: "center", color: "var(--dim)", fontSize: 12, fontFamily: "Source Code Pro, monospace" }}>Loading cash flow data…</div>}

      {!loading && (
        <>

          {/* ── KPI row ── */}
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3,1fr)", marginBottom: 13 }}>
            <div className="kpi-card" style={{ "--tc": "var(--teal)" }}>
              <div className="kpi-label">Balance at Period End</div>
              <div className="kpi-value" style={{ color: currentBal >= 0 ? "var(--teal)" : "var(--red)", fontSize: 20 }}>{fmtBal(currentBal)}</div>
              <div className="kpi-sub">{latestTxn ? `Last transaction ${fmtDate(latestTxn.date)}` : "No transactions in period"}</div>
            </div>
            <div className="kpi-card" style={{ "--tc": avgDaily >= 0 ? "var(--green)" : "var(--red)" }}>
              <div className="kpi-label">Avg Daily Flow</div>
              <div className="kpi-value" style={{ color: avgDaily >= 0 ? "var(--green)" : "var(--red)", fontSize: 20 }}>{avgDaily >= 0 ? "+" : ""}{fmtBal(avgDaily)}</div>
              <div className="kpi-sub">{periodTxns.length} transaction{periodTxns.length !== 1 ? "s" : ""} · {daysInPeriod} days</div>
            </div>
            <div className="kpi-card" style={{ "--tc": "var(--gold)" }}>
              <div className="kpi-label">AP Due Next 30d</div>
              <div className="kpi-value" style={{ color: "var(--gold)", fontSize: 20 }}>{fmt(upcomingAP.reduce((s, i) => s + Number(i.amount), 0))}</div>
              <div className="kpi-sub">{upcomingAP.length} invoice{upcomingAP.length !== 1 ? "s" : ""} after period end</div>
            </div>
          </div>

          {/* ── Forecast + AP columns ── */}
          <div className="cf-grid" style={{ marginBottom: 13 }}>
            {/* Forecast chart */}
            <div className="cf-chart card" style={{ padding: 0, overflow: "hidden" }}>
              <div className="card-header">
                <span className="card-title">90-Day Cash Forecast</span>
                <span style={{ fontSize: 10, fontFamily: "Source Code Pro, monospace", color: "var(--dim)" }}>
                  From {isCurrentPeriod ? "today" : fmtDate(periodEndStr)} · {avgDaily >= 0 ? "+" : ""}{fmtBal(avgDaily)}/day
                </span>
              </div>
              <div style={{ padding: "16px 20px 20px" }}>
                <div className="cf-bar-wrap" style={{ alignItems: "flex-end", height: 110 }}>
                  {forecast.map((f, i) => (
                    <div key={i} className="cf-bar-col">
                      <span className="cf-bar-val" style={{ color: f.val >= 0 ? "var(--accent)" : "var(--danger)", fontSize: 10 }}>{fmtBal(f.val)}</span>
                      <div className="cf-bar"
                        style={{ height: barH(f.val), background: f.val >= 0 ? "var(--teal)" : "var(--red)", opacity: 0.75 + i * 0.07 }} />
                      <span className="cf-bar-label">{f.label}</span>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 6 }}>
                  {forecast.slice(1).map((f, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)" }}>
                      <span style={{ fontFamily: "Source Code Pro, monospace", fontSize: 10 }}>{f.label}</span>
                      <span style={{ fontFamily: "Source Code Pro, monospace", fontWeight: 600, color: f.val >= 0 ? "var(--teal)" : "var(--red)" }}>{fmtBal(f.val)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Upcoming AP */}
            <div className="card" style={{ overflow: "hidden" }}>
              <div className="card-header">
                <span className="card-title">AP — 30 Days After Period</span>
              </div>
              {upcomingAP.length === 0 ? (
                <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--dim)", fontSize: 12 }}>No invoices due in this window.</div>
              ) : (
                <table className="gl-table">
                  <thead><tr><th>Client</th><th className="r">Amount</th><th className="r">Due</th></tr></thead>
                  <tbody>
                    {upcomingAP.map((inv, i) => {
                      const daysAfter = Math.floor((new Date(inv.due_date + 'T12:00:00') - periodEndDate) / 86400000);
                      return (
                        <tr key={i}>
                          <td style={{ fontWeight: 500 }}>{inv.client}</td>
                          <td className="r mono" style={{ color: "var(--gold)", fontWeight: 600 }}>{fmt(inv.amount)}</td>
                          <td className="r" style={{ fontFamily: "Source Code Pro, monospace", fontSize: 11, color: daysAfter <= 7 ? "var(--red)" : "var(--muted)" }}>
                            {fmtDate(inv.due_date)}<br />
                            <span style={{ fontSize: 10, color: daysAfter <= 7 ? "var(--red)" : "var(--dim)" }}>+{daysAfter}d</span>
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="tot">
                      <td style={{ fontFamily: "Playfair Display, serif", fontSize: 12 }}>Total Due</td>
                      <td className="r mono" colSpan={2} style={{ fontWeight: 700 }}>{fmt(upcomingAP.reduce((s, i) => s + Number(i.amount), 0))}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* ── Recent Transactions ── */}
          <div className="card full-col">
            <div className="card-header">
              <span className="card-title">Transactions</span>
              <span style={{ fontSize: 10, fontFamily: "Source Code Pro, monospace", color: "var(--dim)" }}>
                Last 10 in period · {periodTxns.length} total
              </span>
            </div>
            {recent10.length === 0 ? (
              <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--dim)", fontSize: 12 }}>No transactions in this period.</div>
            ) : (
              <table className="gl-table">
                <thead>
                  <tr><th style={{ width: 80 }}>Date</th><th>Description</th><th style={{ width: 120 }}>Nominal</th><th className="r" style={{ width: 110 }}>Amount</th><th className="r" style={{ width: 120 }}>Balance</th></tr>
                </thead>
                <tbody>
                  {recent10.map((t, i) => {
                    const amt  = Number(t.amount);
                    const bal  = Number(t.balance);
                    const acct = GL_ACCOUNTS.find(a => a.code === t.nominal_account);
                    return (
                      <tr key={i}>
                        <td className="mono" style={{ color: "var(--dim)" }}>{t.date}</td>
                        <td style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.description}</td>
                        <td style={{ fontSize: 11, color: "var(--muted)" }}>{acct ? `${acct.code} · ${acct.name}` : t.nominal_account || "—"}</td>
                        <td className="r mono" style={{ fontWeight: 600, color: amt >= 0 ? "var(--green)" : "var(--red)" }}>
                          {amt >= 0 ? "+" : ""}{amt.toLocaleString("en-IE", { minimumFractionDigits: 2 })}
                        </td>
                        <td className="r mono" style={{ color: bal >= 0 ? "var(--muted)" : "var(--red)" }}>
                          {fmtBal(bal)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* ── Recurring Payments ── */}
          {recurringPayments.length > 0 && (
            <div className="card full-col">
              <div className="card-header">
                <span className="card-title">Recurring Payments</span>
                <span style={{ fontSize: 10, fontFamily: "Source Code Pro, monospace", color: "var(--dim)" }}>
                  3+ occurrences · all-time · sorted by amount
                </span>
              </div>
              <table className="gl-table">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th className="r" style={{ width: 70 }}>Count</th>
                    <th className="r" style={{ width: 120 }}>Median Amount</th>
                    <th style={{ width: 110 }}>Frequency</th>
                    <th style={{ width: 110 }}>Next Expected</th>
                  </tr>
                </thead>
                <tbody>
                  {recurringPayments.map((r, i) => (
                    <tr key={i}>
                      <td style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.example}</td>
                      <td className="r mono" style={{ color: "var(--muted)" }}>{r.count}×</td>
                      <td className="r mono" style={{ fontWeight: 600, color: "var(--red)" }}>{fmtBal(-r.medAmt)}</td>
                      <td style={{ fontSize: 11, color: "var(--dim)" }}>{r.freq}</td>
                      <td style={{ fontSize: 11, fontFamily: "Source Code Pro, monospace", color: r.nextDate && r.nextDate <= new Date().toISOString().slice(0, 10) ? "var(--red)" : "var(--muted)" }}>
                        {r.nextDate ? fmtDate(r.nextDate) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── AR INVOICES & CREDIT NOTES ──────────────────────────────────────────────

const INV_VAT_RATES  = { STD23: 23, RED13: 13.5, RED9: 9, ZERO: 0, EXEMPT: 0, RCT: 0, RC_EU: 0 };
const INV_VAT_LABELS = { STD23: '23%', RED13: '13.5%', RED9: '9%', ZERO: '0% (Zero-rated)', EXEMPT: 'Exempt', RCT: 'RCT – Reverse Charge', RC_EU: 'Reverse Charge (EU B2B)' };

function calcLineAmounts(line) {
  const qty       = Number(line.quantity)   || 0;
  const unitPrice = Number(line.unit_price) || 0;
  const line_total  = Math.round(qty * unitPrice * 100) / 100;
  const noVat       = line.vat_code === 'EXEMPT' || line.vat_code === 'RCT' || line.vat_code === 'RC_EU';
  const rate        = noVat ? 0 : (INV_VAT_RATES[line.vat_code] ?? 0);
  const vat_amount  = noVat ? 0 : Math.round(line_total * rate) / 100;
  const gross_total = Math.round((line_total + vat_amount) * 100) / 100;
  return { ...line, line_total, vat_amount, gross_total };
}

function calcInvTotals(lines) {
  const subtotal  = lines.reduce((s, l) => s + (Number(l.line_total)  || 0), 0);
  const vat_total = lines.reduce((s, l) => s + (Number(l.vat_amount)  || 0), 0);
  const total     = lines.reduce((s, l) => s + (Number(l.gross_total) || 0), 0);
  return {
    subtotal:  Math.round(subtotal  * 100) / 100,
    vat_total: Math.round(vat_total * 100) / 100,
    total:     Math.round(total     * 100) / 100,
  };
}

function buildARInvoiceHTML(inv, lines, customer, settings, companyName) {
  const isCN    = inv.type === 'credit_note';
  const accent  = isCN ? '#b91c1c' : '#1d6b72';
  const fmtM    = v => '€' + Number(v || 0).toFixed(2);
  const vatLbl  = { STD23: '23%', RED13: '13.5%', RED9: '9%', ZERO: '0%', EXEMPT: 'Exempt', RCT: 'RCT – Reverse Charge', RC_EU: 'Reverse Charge (EU B2B)' };
  const vatRows = {};
  const hasRCT    = lines.some(l => l.vat_code === 'RCT');
  const hasRC_EU  = lines.some(l => l.vat_code === 'RC_EU');
  const hasExempt = lines.some(l => l.vat_code === 'EXEMPT');
  for (const l of lines) {
    const vc = l.vat_code || 'ZERO';
    if (!vatRows[vc]) vatRows[vc] = { net: 0, vat: 0, gross: 0 };
    vatRows[vc].net   += Number(l.line_total)  || 0;
    vatRows[vc].vat   += Number(l.vat_amount)  || 0;
    vatRows[vc].gross += Number(l.gross_total) || 0;
  }
  const compAddr = (settings?.address     || '').replace(/\n/g, '<br>');
  const custAddr = (customer?.address     || '').replace(/\n/g, '<br>');
  const bankDet  = (settings?.bank_details || '').replace(/\n/g, '<br>');
  const footer   = settings?.footer_notes || inv.footer || '';
  const bizName  = settings?.trading_name || companyName || '';
  const docNoun    = isCN ? 'credit note' : 'invoice';
  const stmtRCT    = (settings?.stmt_rct   || 'This invoice is subject to Relevant Contracts Tax (RCT). VAT is to be accounted for by the principal contractor under the reverse charge mechanism in accordance with Section 16(3) of the VAT Consolidation Act 2010.').replace('This invoice', `This ${docNoun}`);
  const stmtRC_EU  = settings?.stmt_rc_eu  || 'Reverse charge applies – VAT to be accounted for by the recipient under Articles 44 and 196 of the EU VAT Directive';
  const stmtExempt = settings?.stmt_exempt || 'VAT exempt supply under Section 34 of the VAT Consolidation Act 2010';
  const stmts = [];
  if (hasRCT)    stmts.push(stmtRCT);
  if (hasRC_EU)  stmts.push(stmtRC_EU);
  if (hasExempt) stmts.push(stmtExempt);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>${isCN ? 'Credit Note' : 'Invoice'} ${inv.invoice_number || ''}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',sans-serif;color:#1a1a2e;background:#fff;font-size:13px}
.pg{max-width:800px;margin:0 auto;padding:48px 52px}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:36px}
.logo{max-height:60px;max-width:160px;object-fit:contain}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-bottom:32px}
.meta h4{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:6px}
.meta p{font-size:12.5px;line-height:1.7;color:#333}
table.lines{width:100%;border-collapse:collapse;margin-bottom:20px}
table.lines th{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#888;padding:5px 7px;border-bottom:2px solid ${accent};text-align:left}
table.lines th.r,table.lines td.r{text-align:right}
table.lines td{padding:8px 7px;border-bottom:1px solid #f0f0f0;font-size:12px}
.totals{display:flex;justify-content:flex-end;margin-bottom:24px}
.totals table{width:240px;font-size:12.5px}
.totals td{padding:3px 0}
.totals td:last-child{text-align:right;font-weight:600}
.tot-final{border-top:2px solid #1a1a2e;font-size:14px;font-weight:700}
.tot-final td{padding-top:8px}
.vat-tbl{width:100%;border-collapse:collapse;background:#f8f9fa;border-radius:5px;margin-bottom:24px;font-size:11.5px}
.vat-tbl th,.vat-tbl td{padding:5px 10px;text-align:right}
.vat-tbl th:first-child,.vat-tbl td:first-child{text-align:left}
.vat-tbl th{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#888}
.vat-tbl td{border-top:1px solid #e8e8e8}
.bank{background:#f8f9fa;border-radius:5px;padding:13px;margin-bottom:20px;font-size:12px;color:#444;line-height:1.8}
.bank h4{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:5px}
.ft{border-top:1px solid #e8e8e8;padding-top:14px;font-size:11px;color:#999;text-align:center;line-height:1.7}
.doc-type{font-size:26px;font-weight:800;color:${accent};letter-spacing:-.5px}
.doc-num{font-size:14px;font-weight:600;color:#1a1a2e;margin-top:3px}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
<div class="pg">
  <div class="hdr">
    <div>
      ${settings?.logo_url ? `<img class="logo" src="${settings.logo_url}" alt="logo" style="display:block;margin-bottom:10px">` : ''}
      <div style="font-size:17px;font-weight:700">${bizName}</div>
      ${compAddr ? `<div style="font-size:11px;color:#666;line-height:1.6;margin-top:4px">${compAddr}</div>` : ''}
      ${settings?.vat_number ? `<div style="font-size:11px;color:#888;margin-top:3px">VAT: ${settings.vat_number}</div>` : ''}
      ${settings?.reg_number ? `<div style="font-size:11px;color:#888">CRN: ${settings.reg_number}</div>` : ''}
    </div>
    <div style="text-align:right">
      ${isCN ? `<div style="display:inline-block;background:#fef2f2;border:1.5px solid #fca5a5;color:#b91c1c;padding:3px 10px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:.06em;margin-bottom:6px">CREDIT NOTE</div><br>` : ''}
      <div class="doc-type">${isCN ? 'Credit Note' : 'Invoice'}</div>
      <div class="doc-num">${inv.invoice_number || ''}</div>
      ${inv.credit_note_for_number ? `<div style="font-size:11px;color:#888;margin-top:3px">Against: ${inv.credit_note_for_number}</div>` : ''}
    </div>
  </div>
  <div class="meta">
    <div>
      <h4>Bill To</h4>
      <p><strong>${customer?.name || ''}</strong></p>
      ${customer?.vat_number ? `<p>VAT: ${customer.vat_number}</p>` : ''}
      ${custAddr ? `<p>${custAddr}</p>` : ''}
      ${customer?.email ? `<p>${customer.email}</p>` : ''}
    </div>
    <div style="text-align:right">
      <table style="width:100%;font-size:12px"><tbody>
        <tr><td style="color:#888">${isCN ? 'Credit Note Date' : 'Invoice Date'}:</td><td style="text-align:right;font-weight:600">${inv.issue_date || ''}</td></tr>
        ${inv.due_date_calc || inv.due_date ? `<tr><td style="color:#888">Due Date:</td><td style="text-align:right;font-weight:600">${inv.due_date_calc || inv.due_date}</td></tr>` : ''}
        ${inv.reference ? `<tr><td style="color:#888">Reference:</td><td style="text-align:right;font-weight:600">${inv.reference}</td></tr>` : ''}
        ${inv.payment_terms ? `<tr><td style="color:#888">Terms:</td><td style="text-align:right;font-weight:600">Net ${inv.payment_terms} days</td></tr>` : ''}
      </tbody></table>
    </div>
  </div>
  <table class="lines">
    <thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit Price</th><th class="r">VAT</th><th class="r">Net</th><th class="r">VAT Amt</th><th class="r">Gross</th></tr></thead>
    <tbody>${lines.map(l => { const sv = l.vat_code !== 'RCT' && l.vat_code !== 'RC_EU' && l.vat_code !== 'EXEMPT'; return `<tr>
      <td>${l.description || ''}</td>
      <td class="r">${Number(l.quantity).toLocaleString('en-IE', { maximumFractionDigits: 4 })}</td>
      <td class="r">${fmtM(l.unit_price)}</td>
      <td class="r" style="color:#888;font-size:11px">${vatLbl[l.vat_code] || l.vat_code}</td>
      <td class="r">${fmtM(l.line_total)}</td>
      <td class="r" style="color:${sv ? '#888' : '#aaa'}">${sv ? fmtM(l.vat_amount) : 'N/A'}</td>
      <td class="r" style="font-weight:600">${fmtM(l.gross_total)}</td>
    </tr>`; }).join('')}</tbody>
  </table>
  ${Object.keys(vatRows).length > 0 ? `<table class="vat-tbl">
    <thead><tr><th>VAT Rate</th><th>Net</th><th>VAT</th><th>Gross</th></tr></thead>
    <tbody>${Object.entries(vatRows).map(([vc, r]) => `<tr><td>${vatLbl[vc] || vc}</td><td>${fmtM(r.net)}</td><td>${fmtM(r.vat)}</td><td>${fmtM(r.gross)}</td></tr>`).join('')}</tbody>
  </table>` : ''}
  <div class="totals"><table><tbody>
    <tr><td style="color:#666">Subtotal (ex. VAT)</td><td>${fmtM(inv.subtotal)}</td></tr>
    <tr><td style="color:#666">VAT</td><td>${fmtM(inv.vat_total)}</td></tr>
    <tr class="tot-final"><td>${isCN ? 'Credit Total' : 'Total Due'}</td><td style="color:${accent}">${fmtM(inv.total)}</td></tr>
  </tbody></table></div>
  ${stmts.length > 0 ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:4px;padding:10px 13px;margin-bottom:16px;font-size:11.5px;color:#78350f;line-height:1.6">${stmts.join('<br><br>')}</div>` : ''}
  ${bankDet && !isCN ? `<div class="bank"><h4>Payment Details</h4>${bankDet}</div>` : ''}
  ${inv.notes ? `<div style="font-size:12px;color:#555;margin-bottom:18px;line-height:1.7">${inv.notes}</div>` : ''}
  ${footer ? `<div class="ft">${footer}</div>` : ''}
</div></body></html>`;
}

const AR_STATUS_LABELS = { draft: 'Draft', sent: 'Sent', part_paid: 'Part Paid', paid: 'Paid', overdue: 'Overdue', void: 'Void', credited: 'Credited' };
const AR_STATUS_COLORS = { draft: 'var(--muted)', sent: 'var(--accent)', part_paid: 'var(--gold)', paid: 'var(--teal)', overdue: 'var(--danger)', void: 'var(--dim)', credited: 'var(--dim)' };

function Invoices({ companyName, companyId: propCid, company }) {
  const cid          = propCid;
  const baseCurrency = company?.base_currency || 'EUR';
  const fmtC = v => new Intl.NumberFormat('en-IE', { style: 'currency', currency: baseCurrency }).format(Number(v) || 0);
  const fmtN = v => Number(v || 0).toFixed(2);
  const todayStr = new Date().toISOString().slice(0, 10);

  // ── Data ──────────────────────────────────────────────────────────────────
  const [allDocs,     setAllDocs]     = useState([]);
  const [customers,   setCustomers]   = useState([]);
  const [invSettings, setInvSettings] = useState(null);
  const [loading,     setLoading]     = useState(true);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [tab,    setTab]    = useState('invoices');
  const [filter, setFilter] = useState('all');
  const [modal,  setModal]  = useState(null); // 'invoice'|'cn'|'customer'|'mark_paid'|null
  const [saving, setSaving] = useState(false);
  const [saveErr,setSaveErr]= useState(null);

  // ── Form state (shared for invoice + CN modal) ────────────────────────────
  const blankLine = (vc) => calcLineAmounts({ _id: Date.now().toString(36) + Math.random().toString(36).slice(2), description: '', quantity: 1, unit_price: '', vat_code: vc || 'STD23', line_total: 0, vat_amount: 0, gross_total: 0 });
  const [formInv,        setFormInv]        = useState({});
  const [formLines,      setFormLines]      = useState([]);
  const [formForInvoice, setFormForInvoice] = useState(null);
  const [formCust,       setFormCust]       = useState({});
  const [markPaidAmt,    setMarkPaidAmt]    = useState('');

  // ── Load data ─────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!cid) return;
    setLoading(true);
    const [docsRes, custRes, setRes] = await Promise.all([
      supabase.from('invoices').select('*').eq('company_id', cid).order('issue_date', { ascending: false }),
      supabase.from('customers').select('*').eq('company_id', cid).eq('is_active', true).order('name'),
      supabase.from('invoice_settings').select('*').eq('company_id', cid).maybeSingle(),
    ]);
    if (docsRes.data) setAllDocs(docsRes.data);
    if (custRes.data) setCustomers(custRes.data);
    if (setRes.data)  setInvSettings(setRes.data);
    setLoading(false);
  }, [cid]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Derived data ──────────────────────────────────────────────────────────
  const invoices    = allDocs.filter(d => d.type === 'invoice');
  const creditNotes = allDocs.filter(d => d.type === 'credit_note');
  const today       = new Date();

  const cnByInvoice = {};
  for (const cn of creditNotes) {
    if (cn.credit_note_for && cn.status !== 'draft' && cn.status !== 'void') {
      cnByInvoice[cn.credit_note_for] = (cnByInvoice[cn.credit_note_for] || 0) + Number(cn.total || 0);
    }
  }

  const outstanding = inv => Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid || 0) - (cnByInvoice[inv.id] || 0));

  const daysDue = inv => {
    const due = inv.due_date_calc || inv.due_date;
    if (!due) return 0;
    return Math.floor((today - new Date(due + 'T00:00:00')) / 86400000);
  };

  const statusOf = inv => {
    if (inv.status === 'void' || inv.status === 'credited') return inv.status;
    if (inv.status === 'draft') return 'draft';
    const owed = outstanding(inv);
    if (owed <= 0.005) return 'paid';
    if (daysDue(inv) > 0) return 'overdue';
    if (owed < Number(inv.total) - 0.005) return 'part_paid';
    return inv.status || 'sent';
  };

  const agedRows = invoices
    .filter(inv => !['draft', 'void', 'credited'].includes(statusOf(inv)))
    .map(inv => ({ inv, owed: outstanding(inv), days: daysDue(inv), cust: customers.find(c => c.id === inv.customer_id) }))
    .filter(r => r.owed > 0.005);

  const agedByCust = {};
  for (const r of agedRows) {
    const key = r.cust?.name || r.inv.client || 'Unknown';
    if (!agedByCust[key]) agedByCust[key] = { current: 0, b1_30: 0, b31_60: 0, b61_90: 0, b90p: 0 };
    const b = agedByCust[key];
    if      (r.days <= 0)  b.current += r.owed;
    else if (r.days <= 30) b.b1_30   += r.owed;
    else if (r.days <= 60) b.b31_60  += r.owed;
    else if (r.days <= 90) b.b61_90  += r.owed;
    else                   b.b90p    += r.owed;
  }

  const totalOutstanding  = agedRows.reduce((s, r) => s + r.owed, 0);
  const totalOverdue      = agedRows.filter(r => r.days > 0).reduce((s, r) => s + r.owed, 0);
  const invoicesThisMonth = invoices.filter(inv => inv.issue_date?.startsWith(todayStr.slice(0, 7)));
  const revenueThisMonth  = invoicesThisMonth.reduce((s, inv) => s + Number(inv.total || 0), 0);

  const filterList = docs => filter === 'all' ? docs : docs.filter(d => statusOf(d) === filter);

  // ── Operations ────────────────────────────────────────────────────────────
  const postJournals = async (inv, lines) => {
    const isCN = inv.type === 'credit_note';
    const cust = customers.find(c => c.id === inv.customer_id);
    const groups = {};
    for (const l of lines) { const vc = l.vat_code || 'STD23'; groups[vc] = (groups[vc] || 0) + (Number(l.gross_total) || 0); }
    const rows = Object.entries(groups).map(([vc, gross]) => ({
      company_id: cid, date: inv.issue_date,
      description: `${isCN ? 'Credit Note' : 'Invoice'} ${inv.invoice_number}${cust ? ' — ' + cust.name : ''}`,
      debit_account:  isCN ? '4000' : '1100',
      credit_account: isCN ? '1100' : '4000',
      amount: Math.abs(Math.round(gross * 100) / 100),
      vat_code: vc, reference: inv.invoice_number,
      source_recurring_id: null, is_accrual_reversal: false,
    }));
    const { data: inserted } = await supabase.from('journals').insert(rows).select('id');
    return (inserted || []).map(j => j.id);
  };

  const finaliseDoc = async () => {
    if (!cid) return;
    setSaving(true); setSaveErr(null);
    try {
      const inv   = formInv;
      const lines = formLines;
      const isCN  = modal === 'cn';
      const { data: numStr, error: numErr } = await supabase.rpc('claim_invoice_number', { p_company_id: cid, p_type: isCN ? 'cn' : 'inv' });
      if (numErr) throw new Error('Numbering failed: ' + numErr.message);
      const totals = calcInvTotals(lines);
      if (!inv.id) throw new Error('Save draft first');
      // canFinalise guards require customer_id; verify it's in the loaded list before issuing.
      const finalCust = customers.find(c => c.id === inv.customer_id);
      if (!finalCust) throw new Error('Customer not found — please close this form, reload, and try again');
      await supabase.from('invoice_lines').delete().eq('invoice_id', inv.id);
      if (lines.length) await supabase.from('invoice_lines').insert(lines.map((l, i) => ({
        invoice_id: inv.id, sort_order: i,
        description: l.description, quantity: Number(l.quantity) || 1,
        unit_price: Number(l.unit_price) || 0, vat_code: l.vat_code,
        line_total: Number(l.line_total) || 0, vat_amount: Number(l.vat_amount) || 0,
        gross_total: Number(l.gross_total) || 0,
      })));
      const jids = await postJournals({ ...inv, invoice_number: numStr, ...totals }, lines);
      const terms = Number(inv.payment_terms ?? invSettings?.payment_terms ?? 30);
      const issueD = new Date(inv.issue_date + 'T00:00:00');
      issueD.setDate(issueD.getDate() + terms);
      const { error: updErr } = await supabase.from('invoices').update({
        invoice_ref: numStr, invoice_number: numStr, status: 'sent', ...totals,
        client: finalCust.name,
        amount: totals.total,
        invoice_date: inv.issue_date || new Date().toISOString().slice(0, 10),
        due_date_calc: !isCN ? issueD.toISOString().slice(0, 10) : null,
        payment_terms: terms, journal_ids: jids, updated_at: new Date().toISOString(),
      }).eq('id', inv.id);
      if (updErr) throw new Error(updErr.message);
      await loadData();
      setModal(null);
    } catch (err) { setSaveErr(err.message); }
    setSaving(false);
  };

  const saveDraft = async () => {
    if (!cid) return;
    setSaving(true); setSaveErr(null);
    try {
      const inv    = formInv;
      const lines  = formLines;
      const totals = calcInvTotals(lines);

      // Resolve client name — null is fine for drafts (constraint only enforces on finalised rows).
      // Error early if customer_id is set but not present in the loaded list.
      let clientName = null;
      if (inv.customer_id) {
        const cust = customers.find(c => c.id === inv.customer_id);
        if (!cust) throw new Error('Selected customer not found — please reload the page and try again');
        clientName = cust.name;
      }

      // Legacy columns (pre-AR-core) that are NOT NULL with no default.
      // invoice_date mirrors issue_date; amount mirrors total (0 for empty drafts).
      const invoice_date = inv.issue_date || new Date().toISOString().slice(0, 10);
      const amount       = totals.total;

      let invId = inv.id;
      if (!invId) {
        const { data: ni, error: ie } = await supabase.from('invoices').insert({
          company_id: cid, type: inv.type || (modal === 'cn' ? 'credit_note' : 'invoice'),
          customer_id: inv.customer_id || null,
          client: clientName,
          status: 'draft',
          issue_date: inv.issue_date, invoice_date,
          amount, reference: inv.reference || null,
          notes: inv.notes || null,
          payment_terms: Number(inv.payment_terms ?? invSettings?.payment_terms ?? 30),
          credit_note_for: inv.credit_note_for || null,
          currency: baseCurrency, ...totals,
        }).select('id').single();
        if (ie) throw new Error(ie.message);
        invId = ni.id;
        setFormInv(p => ({ ...p, id: invId }));
      } else {
        await supabase.from('invoices').update({
          customer_id: inv.customer_id || null,
          client: clientName,
          issue_date: inv.issue_date, invoice_date,
          amount,
          reference: inv.reference || null, notes: inv.notes || null,
          payment_terms: Number(inv.payment_terms ?? invSettings?.payment_terms ?? 30),
          currency: baseCurrency, ...totals, updated_at: new Date().toISOString(),
        }).eq('id', invId);
      }
      await supabase.from('invoice_lines').delete().eq('invoice_id', invId);
      if (lines.length) await supabase.from('invoice_lines').insert(lines.map((l, i) => ({
        invoice_id: invId, sort_order: i,
        description: l.description, quantity: Number(l.quantity) || 1,
        unit_price: Number(l.unit_price) || 0, vat_code: l.vat_code,
        line_total: Number(l.line_total) || 0, vat_amount: Number(l.vat_amount) || 0,
        gross_total: Number(l.gross_total) || 0,
      })));
      await loadData();
      setModal(null);
    } catch (err) { setSaveErr(err.message); }
    setSaving(false);
  };

  const markPaid = async (inv, amount) => {
    const newPaid   = Math.min(Number(inv.amount_paid || 0) + Number(amount), Number(inv.total));
    const newStatus = newPaid >= Number(inv.total) - 0.005 ? 'paid' : 'part_paid';
    await supabase.from('invoices').update({ amount_paid: newPaid, status: newStatus, updated_at: new Date().toISOString() }).eq('id', inv.id);
    await loadData();
  };

  const voidDoc = async (inv) => {
    if (!window.confirm(`Void ${inv.invoice_number}? This cannot be undone.`)) return;
    await supabase.from('invoices').update({ status: 'void', updated_at: new Date().toISOString() }).eq('id', inv.id);
    await loadData();
  };

  const handlePrint = async (inv) => {
    const r = await fetch('/api/invoice-pdf', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoice_id: inv.id, company_id: cid }),
    });
    if (!r.ok) { alert('PDF generation failed — check console'); return; }
    const blob = await r.blob();
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: `${inv.invoice_number || 'invoice'}.pdf` });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const handleEmail = async (inv) => {
    const cust = customers.find(c => c.id === inv.customer_id);
    if (!cust?.email) { alert('Customer has no email address on file'); return; }
    const r = await fetch('/api/send-invoice', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoice_id: inv.id, company_id: cid }),
    });
    if (!r.ok) { const err = await r.json().catch(() => ({})); alert('Email failed: ' + (err.error || 'unknown')); return; }
    const d = await r.json();
    if (d.ok && !inv.sent_at) await loadData();
    alert(`Sent to ${cust.email}${d.pdf_attached ? ' with PDF attached' : ''}`);
  };

  // ── Open form helpers ─────────────────────────────────────────────────────
  const openInvoiceForm = async (inv = null, isCN = false, forInv = null) => {
    setSaveErr(null);
    const defaultVc = vatCodeForRate(company?.sales_vat_rate) || 'STD23';
    let lines = [];
    if (inv?.id) {
      const { data } = await supabase.from('invoice_lines').select('*').eq('invoice_id', inv.id).order('sort_order');
      lines = (data || []).map(l => ({ ...l, _id: l.id }));
    } else if (isCN && forInv?.id) {
      const { data } = await supabase.from('invoice_lines').select('*').eq('invoice_id', forInv.id).order('sort_order');
      lines = (data || []).map(l => ({ ...l, id: undefined, invoice_id: undefined, _id: Math.random().toString(36).slice(2) }));
    }
    if (!lines.length) lines = [blankLine(defaultVc)];
    setFormLines(lines);
    setFormForInvoice(forInv || null);
    setFormInv(inv || {
      type: isCN ? 'credit_note' : 'invoice',
      customer_id: forInv?.customer_id || '',
      issue_date: todayStr, reference: '', notes: '',
      payment_terms: invSettings?.payment_terms ?? 30,
      credit_note_for: forInv?.id || null,
      credit_note_for_number: forInv?.invoice_number || null,
    });
    setModal(isCN ? 'cn' : 'invoice');
  };

  const openCustomerForm = (cust = null) => {
    setFormCust(cust || { name: '', email: '', address: '', vat_number: '', phone: '', contact_name: '' });
    setSaveErr(null);
    setModal('customer');
  };

  const saveCustomer = async () => {
    if (!formCust.name?.trim()) { setSaveErr('Customer name required'); return; }
    setSaving(true); setSaveErr(null);
    if (formCust.id) {
      await supabase.from('customers').update({ ...formCust }).eq('id', formCust.id);
    } else {
      await supabase.from('customers').insert({ ...formCust, company_id: cid });
    }
    await loadData(); setModal(null); setSaving(false);
  };

  const updateLine = (i, field, val) => {
    setFormLines(prev => {
      const next = [...prev];
      next[i] = calcLineAmounts({ ...next[i], [field]: val });
      return next;
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const tabList    = [{ id: 'invoices', label: 'Invoices' }, { id: 'credit_notes', label: 'Credit Notes' }, { id: 'customers', label: 'Customers' }, { id: 'aged', label: 'Aged Debtors' }];
  const FILTERS    = ['all', 'draft', 'sent', 'overdue', 'part_paid', 'paid', 'void'];
  const invTotals  = calcInvTotals(formLines);
  const isCNModal  = modal === 'cn';
  const isExisting = !!formInv.id;
  const isDraft    = !formInv.status || formInv.status === 'draft';
  const canFinalise = formInv.customer_id && formInv.issue_date && formLines.some(l => l.description && Number(l.unit_price) !== 0);

  const SPillAR = ({ inv }) => {
    const st = statusOf(inv);
    return <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 20, background: (AR_STATUS_COLORS[st] || 'var(--muted)') + '22', color: AR_STATUS_COLORS[st] || 'var(--muted)', border: `1px solid ${AR_STATUS_COLORS[st] || 'var(--muted)'}44`, whiteSpace: 'nowrap' }}>{AR_STATUS_LABELS[st] || st}</span>;
  };

  return (
    <div className="fade-up">
      {/* KPIs */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginBottom: 16 }}>
        {[
          { label: 'Outstanding AR',              value: fmtC(totalOutstanding),  sub: `${agedRows.length} open invoice${agedRows.length !== 1 ? 's' : ''}`, c: 'var(--text)' },
          { label: 'Overdue',                      value: fmtC(totalOverdue),      sub: agedRows.filter(r => r.days > 0).length + ' past due',                c: 'var(--danger)' },
          { label: `Revenue ${todayStr.slice(0,7)}`, value: fmtC(revenueThisMonth), sub: `${invoicesThisMonth.length} invoice${invoicesThisMonth.length !== 1 ? 's' : ''} raised`, c: 'var(--teal)' },
        ].map((k, i) => (
          <div key={i} className="kpi-card" style={{ '--tc': k.c }}>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value" style={{ color: k.c }}>{k.value}</div>
            <div className="kpi-sub">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Tabs + new buttons */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 3 }}>
          {tabList.map(t => (
            <button key={t.id} onClick={() => { setTab(t.id); setFilter('all'); }} style={{ padding: '5px 14px', fontSize: 12, fontWeight: tab === t.id ? 700 : 400, borderRadius: 4, border: '1px solid ' + (tab === t.id ? 'var(--accent)' : 'var(--border)'), background: tab === t.id ? 'rgba(80,140,255,0.1)' : 'var(--surface-2)', color: tab === t.id ? 'var(--accent)' : 'var(--muted)', cursor: 'pointer' }}>
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {tab === 'invoices'      && <button className="btn btn-p btn-sm" onClick={() => openInvoiceForm(null, false)}>+ New Invoice</button>}
          {tab === 'credit_notes'  && <button className="btn btn-p btn-sm" style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => openInvoiceForm(null, true)}>+ New Credit Note</button>}
          {tab === 'customers'     && <button className="btn btn-p btn-sm" onClick={() => openCustomerForm()}>+ New Customer</button>}
        </div>
      </div>

      {/* Status filter pills */}
      {(tab === 'invoices' || tab === 'credit_notes') && (
        <div style={{ display: 'flex', gap: 5, marginBottom: 10, flexWrap: 'wrap' }}>
          {FILTERS.map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{ padding: '3px 10px', fontSize: 11, borderRadius: 20, border: '1px solid ' + (filter === f ? 'var(--accent)' : 'var(--border)'), background: filter === f ? 'rgba(80,140,255,0.12)' : 'transparent', color: filter === f ? 'var(--accent)' : 'var(--muted)', cursor: 'pointer' }}>
              {f === 'all' ? 'All' : (AR_STATUS_LABELS[f] || f)}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div style={{ padding: '40px 0', textAlign: 'center', fontSize: 13, color: 'var(--dim)' }}>Loading…</div>
      ) : (
        <>
          {/* ── Invoices list ── */}
          {tab === 'invoices' && (
            <div className="card full-col">
              <div className="card-header"><span className="card-title">Sales Invoices</span></div>
              {filterList(invoices).length === 0 ? (
                <div style={{ padding: '36px 0', textAlign: 'center', fontSize: 13, color: 'var(--dim)' }}>
                  {filter === 'all' ? 'No invoices yet — click + New Invoice to start.' : `No ${AR_STATUS_LABELS[filter] || filter} invoices.`}
                </div>
              ) : (
                <table className="gl-table">
                  <thead><tr><th>Number</th><th>Customer</th><th>Date</th><th>Due</th><th>Status</th><th className="r">Total</th><th className="r">Outstanding</th><th></th></tr></thead>
                  <tbody>
                    {filterList(invoices).map(inv => {
                      const cust = customers.find(c => c.id === inv.customer_id);
                      const owed = outstanding(inv);
                      const days = daysDue(inv);
                      const st   = statusOf(inv);
                      return (
                        <tr key={inv.id}>
                          <td className="mono" style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 12 }}>{inv.invoice_number || <span style={{ color: 'var(--dim)' }}>Draft</span>}</td>
                          <td style={{ fontWeight: 500 }}>{cust?.name || inv.client || '—'}</td>
                          <td className="mono" style={{ fontSize: 12 }}>{inv.issue_date || '—'}</td>
                          <td className="mono" style={{ fontSize: 12, color: days > 0 && !['paid','void','credited'].includes(st) ? 'var(--danger)' : 'var(--text-muted)' }}>{inv.due_date_calc || inv.due_date || '—'}</td>
                          <td><SPillAR inv={inv} /></td>
                          <td className="r mono" style={{ fontWeight: 500 }}>{fmtC(inv.total)}</td>
                          <td className="r mono" style={{ fontWeight: 600, color: owed > 0.005 ? (days > 0 ? 'var(--danger)' : 'var(--text)') : 'var(--dim)' }}>{owed > 0.005 ? fmtC(owed) : '—'}</td>
                          <td style={{ paddingRight: 8 }}>
                            <div style={{ display: 'flex', gap: 3, flexWrap: 'nowrap' }}>
                              {(st === 'draft') && <button className="btn btn-s btn-sm" onClick={() => openInvoiceForm(inv)}>Edit</button>}
                              {st !== 'draft' && st !== 'void' && (
                                <>
                                  <button className="btn btn-s btn-sm" onClick={() => handlePrint(inv)}>PDF</button>
                                  <button className="btn btn-s btn-sm" onClick={() => handleEmail(inv)}>Email</button>
                                </>
                              )}
                              {['sent', 'part_paid', 'overdue'].includes(st) && (
                                <button className="btn btn-s btn-sm" onClick={() => { setMarkPaidAmt(outstanding(inv).toFixed(2)); setFormInv(inv); setModal('mark_paid'); }}>Paid</button>
                              )}
                              {['sent', 'part_paid', 'overdue'].includes(st) && (
                                <button className="btn btn-s btn-sm" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }} onClick={() => openInvoiceForm(null, true, inv)}>CN</button>
                              )}
                              {st === 'draft' && (
                                <button className="btn btn-s btn-sm" style={{ borderColor: 'var(--dim)', color: 'var(--dim)' }} onClick={() => voidDoc(inv)}>Void</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ── Credit Notes list ── */}
          {tab === 'credit_notes' && (
            <div className="card full-col">
              <div className="card-header"><span className="card-title">Credit Notes</span></div>
              {filterList(creditNotes).length === 0 ? (
                <div style={{ padding: '36px 0', textAlign: 'center', fontSize: 13, color: 'var(--dim)' }}>No credit notes yet.</div>
              ) : (
                <table className="gl-table">
                  <thead><tr><th>Number</th><th>Customer</th><th>Date</th><th>Against</th><th>Status</th><th className="r">Amount</th><th></th></tr></thead>
                  <tbody>
                    {filterList(creditNotes).map(cn => {
                      const cust   = customers.find(c => c.id === cn.customer_id);
                      const srcInv = allDocs.find(d => d.id === cn.credit_note_for);
                      return (
                        <tr key={cn.id}>
                          <td className="mono" style={{ color: 'var(--danger)', fontWeight: 600, fontSize: 12 }}>{cn.invoice_number || <span style={{ color: 'var(--dim)' }}>Draft CN</span>}</td>
                          <td style={{ fontWeight: 500 }}>{cust?.name || '—'}</td>
                          <td className="mono" style={{ fontSize: 12 }}>{cn.issue_date || '—'}</td>
                          <td className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>{srcInv?.invoice_number || '—'}</td>
                          <td><SPillAR inv={cn} /></td>
                          <td className="r mono" style={{ fontWeight: 600, color: 'var(--danger)' }}>{fmtC(cn.total)}</td>
                          <td style={{ paddingRight: 8 }}>
                            <div style={{ display: 'flex', gap: 3 }}>
                              {cn.status === 'draft' && <button className="btn btn-s btn-sm" onClick={() => openInvoiceForm(cn, true)}>Edit</button>}
                              {cn.status !== 'draft' && (
                                <>
                                  <button className="btn btn-s btn-sm" onClick={() => handlePrint(cn)}>PDF</button>
                                  <button className="btn btn-s btn-sm" onClick={() => handleEmail(cn)}>Email</button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ── Customers ── */}
          {tab === 'customers' && (
            <div className="card full-col">
              <div className="card-header"><span className="card-title">Customers</span></div>
              {customers.length === 0 ? (
                <div style={{ padding: '36px 0', textAlign: 'center', fontSize: 13, color: 'var(--dim)' }}>No customers yet — click + New Customer.</div>
              ) : (
                <table className="gl-table">
                  <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>VAT Number</th><th className="r">Total Invoiced</th><th></th></tr></thead>
                  <tbody>
                    {customers.map(cust => {
                      const custTotal = invoices.filter(inv => inv.customer_id === cust.id && inv.invoice_number).reduce((s, inv) => s + Number(inv.total || 0), 0);
                      return (
                        <tr key={cust.id}>
                          <td style={{ fontWeight: 600 }}>{cust.name}</td>
                          <td style={{ color: 'var(--muted)', fontSize: 12 }}>{cust.email || '—'}</td>
                          <td style={{ color: 'var(--muted)', fontSize: 12 }}>{cust.phone || '—'}</td>
                          <td className="mono" style={{ fontSize: 12 }}>{cust.vat_number || '—'}</td>
                          <td className="r mono" style={{ fontWeight: 500 }}>{custTotal > 0 ? fmtC(custTotal) : '—'}</td>
                          <td style={{ paddingRight: 8 }}><button className="btn btn-s btn-sm" onClick={() => openCustomerForm(cust)}>Edit</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ── Aged Debtors ── */}
          {tab === 'aged' && (
            <div className="card full-col">
              <div className="card-header"><span className="card-title">Aged Debtors</span></div>
              {Object.keys(agedByCust).length === 0 ? (
                <div style={{ padding: '36px 0', textAlign: 'center', fontSize: 13, color: 'var(--dim)' }}>No outstanding debtors.</div>
              ) : (
                <table className="gl-table">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th className="r">Current</th>
                      <th className="r" style={{ color: 'var(--warn)' }}>1–30 days</th>
                      <th className="r" style={{ color: 'var(--gold)' }}>31–60 days</th>
                      <th className="r" style={{ color: 'var(--red)' }}>61–90 days</th>
                      <th className="r" style={{ color: 'var(--danger)' }}>90+ days</th>
                      <th className="r" style={{ fontWeight: 700 }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(agedByCust).sort(([a], [b]) => a.localeCompare(b)).map(([name, b]) => {
                      const rowTotal = b.current + b.b1_30 + b.b31_60 + b.b61_90 + b.b90p;
                      return (
                        <tr key={name}>
                          <td style={{ fontWeight: 600 }}>{name}</td>
                          <td className="r mono" style={{ color: 'var(--text-muted)' }}>{b.current  > 0 ? fmtC(b.current)  : '—'}</td>
                          <td className="r mono" style={{ color: b.b1_30  > 0 ? 'var(--warn)'   : 'var(--dim)' }}>{b.b1_30  > 0 ? fmtC(b.b1_30)  : '—'}</td>
                          <td className="r mono" style={{ color: b.b31_60 > 0 ? 'var(--gold)'   : 'var(--dim)' }}>{b.b31_60 > 0 ? fmtC(b.b31_60) : '—'}</td>
                          <td className="r mono" style={{ color: b.b61_90 > 0 ? 'var(--red)'    : 'var(--dim)' }}>{b.b61_90 > 0 ? fmtC(b.b61_90) : '—'}</td>
                          <td className="r mono" style={{ color: b.b90p   > 0 ? 'var(--danger)' : 'var(--dim)', fontWeight: b.b90p > 0 ? 700 : 400 }}>{b.b90p > 0 ? fmtC(b.b90p) : '—'}</td>
                          <td className="r mono" style={{ fontWeight: 600 }}>{fmtC(rowTotal)}</td>
                        </tr>
                      );
                    })}
                    {(() => {
                      const tots = Object.values(agedByCust).reduce((acc, b) => ({ current: acc.current + b.current, b1_30: acc.b1_30 + b.b1_30, b31_60: acc.b31_60 + b.b31_60, b61_90: acc.b61_90 + b.b61_90, b90p: acc.b90p + b.b90p }), { current: 0, b1_30: 0, b31_60: 0, b61_90: 0, b90p: 0 });
                      return (
                        <tr className="tot">
                          <td style={{ fontWeight: 600 }}>Total</td>
                          <td className="r mono">{tots.current > 0 ? fmtC(tots.current) : '—'}</td>
                          <td className="r mono" style={{ color: tots.b1_30  > 0 ? 'var(--warn)'   : undefined }}>{tots.b1_30  > 0 ? fmtC(tots.b1_30)  : '—'}</td>
                          <td className="r mono" style={{ color: tots.b31_60 > 0 ? 'var(--gold)'   : undefined }}>{tots.b31_60 > 0 ? fmtC(tots.b31_60) : '—'}</td>
                          <td className="r mono" style={{ color: tots.b61_90 > 0 ? 'var(--red)'    : undefined }}>{tots.b61_90 > 0 ? fmtC(tots.b61_90) : '—'}</td>
                          <td className="r mono" style={{ color: tots.b90p   > 0 ? 'var(--danger)' : undefined, fontWeight: tots.b90p > 0 ? 700 : 400 }}>{tots.b90p > 0 ? fmtC(tots.b90p) : '—'}</td>
                          <td className="r mono" style={{ fontWeight: 700, color: 'var(--teal)' }}>{fmtC(tots.current + tots.b1_30 + tots.b31_60 + tots.b61_90 + tots.b90p)}</td>
                        </tr>
                      );
                    })()}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Invoice / CN form modal ── */}
      {(modal === 'invoice' || modal === 'cn') && createPortal(
        <div style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.52)', zIndex: 9000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: 24 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 6, width: 'min(720px, 95vw)', maxHeight: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column', flexShrink: 0, boxShadow: '0 8px 40px rgba(0,0,0,0.32)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 20px', borderBottom: '1px solid var(--border)', background: isCNModal ? 'rgba(185,28,28,0.07)' : 'var(--surface-2)', flexShrink: 0, borderRadius: '6px 6px 0 0' }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: isCNModal ? 'var(--danger)' : 'var(--text)' }}>
                {isCNModal ? (isExisting ? 'Edit Credit Note' : 'New Credit Note') : (isExisting ? (isDraft ? 'Edit Draft Invoice' : 'Invoice') : 'New Invoice')}
                {formForInvoice && <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400, marginLeft: 8 }}>against {formForInvoice.invoice_number}</span>}
              </span>
              <button style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }} onClick={() => setModal(null)}>✕</button>
            </div>

            <div style={{ padding: '18px 20px 14px', flex: '1 1 auto', overflowY: 'auto', minHeight: 0 }}>
              {/* Header row */}
              <div className="f-row" style={{ marginBottom: 10 }}>
                <div className="f-group">
                  <label className="f-label">Customer *</label>
                  <select className="f-input" value={formInv.customer_id || ''} onChange={e => {
                    if (e.target.value === '__new__') { openCustomerForm(); return; }
                    setFormInv(p => ({ ...p, customer_id: e.target.value }));
                  }}>
                    <option value="">— select —</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    <option value="__new__">+ Add new customer…</option>
                  </select>
                </div>
                <div className="f-group">
                  <label className="f-label">{isCNModal ? 'CN Date' : 'Invoice Date'} *</label>
                  <input className="f-input" type="date" value={formInv.issue_date || ''} onChange={e => setFormInv(p => ({ ...p, issue_date: e.target.value }))} />
                </div>
                {!isCNModal && (
                  <div className="f-group">
                    <label className="f-label">Terms (days)</label>
                    <input className="f-input" type="number" min="0" value={formInv.payment_terms ?? invSettings?.payment_terms ?? 30} onChange={e => setFormInv(p => ({ ...p, payment_terms: e.target.value }))} />
                  </div>
                )}
                <div className="f-group">
                  <label className="f-label">Your Reference</label>
                  <input className="f-input" value={formInv.reference || ''} onChange={e => setFormInv(p => ({ ...p, reference: e.target.value }))} placeholder="PO number, project…" />
                </div>
              </div>

              {/* Line items */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', marginBottom: 5 }}>Line Items</div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--border)' }}>
                      {['Description', 'Qty', 'Unit Price (ex. VAT)', 'VAT', 'Net', 'VAT Amt', 'Gross', ''].map((h, i) => (
                        <th key={i} style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--muted)', padding: '4px 5px', textAlign: i > 0 && i < 7 ? 'right' : 'left' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {formLines.map((line, i) => (
                      <tr key={line._id || i} style={{ borderBottom: '1px solid var(--surface-2)' }}>
                        <td style={{ padding: '3px 3px' }}>
                          <input className="f-input" style={{ padding: '4px 6px', fontSize: 12 }} value={line.description} onChange={e => updateLine(i, 'description', e.target.value)} placeholder="Description" />
                        </td>
                        <td style={{ padding: '3px 3px', width: 64 }}>
                          <input className="f-input" style={{ padding: '4px 5px', fontSize: 12, width: '100%', textAlign: 'right' }} type="number" min="0" step="any" value={line.quantity} onChange={e => updateLine(i, 'quantity', e.target.value)} />
                        </td>
                        <td style={{ padding: '3px 3px', width: 100 }}>
                          <input className="f-input" style={{ padding: '4px 5px', fontSize: 12, width: '100%', textAlign: 'right' }} type="number" min="0" step="0.0001" value={line.unit_price} onChange={e => updateLine(i, 'unit_price', e.target.value)} placeholder="0.00" />
                        </td>
                        <td style={{ padding: '3px 3px', width: 88 }}>
                          <select className="f-input" style={{ padding: '4px 4px', fontSize: 11, width: '100%' }} value={line.vat_code} onChange={e => updateLine(i, 'vat_code', e.target.value)}>
                            {Object.entries(INV_VAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: '3px 5px', textAlign: 'right', fontFamily: 'Source Code Pro, monospace', fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmtN(line.line_total)}</td>
                        <td style={{ padding: '3px 5px', textAlign: 'right', fontFamily: 'Source Code Pro, monospace', fontSize: 11, color: 'var(--dim)', whiteSpace: 'nowrap' }}>{fmtN(line.vat_amount)}</td>
                        <td style={{ padding: '3px 5px', textAlign: 'right', fontFamily: 'Source Code Pro, monospace', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtN(line.gross_total)}</td>
                        <td style={{ padding: '3px 3px', width: 22, textAlign: 'center' }}>
                          <button style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }} onClick={() => setFormLines(l => l.filter((_, j) => j !== i))}>✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button className="btn btn-s btn-sm" style={{ marginTop: 7 }} onClick={() => setFormLines(l => [...l, blankLine(vatCodeForRate(company?.sales_vat_rate) || 'STD23')])}>+ Add line</button>
              </div>

              {/* Notes + totals */}
              <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', paddingTop: 8, marginBottom: 14 }}>
                <div style={{ flex: 1 }}>
                  <label className="f-label">Notes</label>
                  <textarea className="f-input" rows={3} style={{ resize: 'vertical', fontSize: 12 }} value={formInv.notes || ''} onChange={e => setFormInv(p => ({ ...p, notes: e.target.value }))} placeholder="Payment info, project details…" />
                </div>
                <div style={{ minWidth: 210 }}>
                  {[['Subtotal (ex. VAT)', invTotals.subtotal], ['VAT', invTotals.vat_total], ['Total', invTotals.total]].map(([lbl, val], ri) => (
                    <div key={ri} style={{ display: 'flex', justifyContent: 'space-between', padding: ri === 2 ? '8px 0 0' : '3px 0', borderTop: ri === 2 ? '2px solid var(--border)' : 'none', fontWeight: ri === 2 ? 700 : 400, fontSize: ri === 2 ? 14 : 12 }}>
                      <span style={{ color: ri === 2 ? 'var(--text)' : 'var(--muted)' }}>{lbl}</span>
                      <span style={{ fontFamily: 'Source Code Pro, monospace', color: ri === 2 ? (isCNModal ? 'var(--danger)' : 'var(--teal)') : 'var(--text-muted)' }}>{fmtC(val)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ flexShrink: 0 }}>
              {saveErr && <div style={{ margin: '8px 20px 0', padding: '8px 12px', background: 'rgba(185,28,28,0.06)', border: '1px solid rgba(185,28,28,0.2)', borderRadius: 4, fontSize: 12, color: 'var(--danger)' }}>{saveErr}</div>}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 20px 14px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)', gap: 8, borderRadius: '0 0 6px 6px' }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-s" onClick={() => setModal(null)}>Cancel</button>
                  {(isDraft || !isExisting) && <button className="btn btn-s" disabled={saving} onClick={saveDraft}>{saving ? 'Saving…' : 'Save Draft'}</button>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {isExisting && !isDraft && (
                    <>
                      <button className="btn btn-s btn-sm" onClick={() => handlePrint(formInv)}>Print / PDF</button>
                      <button className="btn btn-s btn-sm" onClick={() => handleEmail(formInv)}>Email</button>
                    </>
                  )}
                  {(isDraft || !isExisting) && (
                    <button className="btn btn-p" disabled={saving || !canFinalise} style={{ opacity: canFinalise ? 1 : 0.45 }} onClick={finaliseDoc}>
                      {saving ? 'Saving…' : `Finalise & ${isCNModal ? 'Issue CN' : 'Send Invoice'}`}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Customer modal ── */}
      {modal === 'customer' && createPortal(
        <div style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.48)', zIndex: 9000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: 24 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 6, width: 'min(460px, 95vw)', maxHeight: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column', flexShrink: 0, boxShadow: '0 8px 32px rgba(0,0,0,0.28)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0, borderRadius: '6px 6px 0 0' }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>{formCust.id ? 'Edit Customer' : 'New Customer'}</span>
              <button style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 16, cursor: 'pointer' }} onClick={() => setModal(null)}>✕</button>
            </div>
            <div style={{ padding: '16px 18px', flex: '1 1 auto', overflowY: 'auto', minHeight: 0 }}>
              {[['name', 'Name *', 'text'], ['email', 'Email', 'email'], ['phone', 'Phone', 'text'], ['vat_number', 'VAT Number', 'text'], ['contact_name', 'Contact Name', 'text']].map(([field, label, type]) => (
                <div key={field} className="f-group" style={{ marginBottom: 9 }}>
                  <label className="f-label">{label}</label>
                  <input className="f-input" type={type} value={formCust[field] || ''} onChange={e => setFormCust(p => ({ ...p, [field]: e.target.value }))} />
                </div>
              ))}
              <div className="f-group">
                <label className="f-label">Address</label>
                <textarea className="f-input" rows={3} style={{ resize: 'vertical', fontSize: 12 }} value={formCust.address || ''} onChange={e => setFormCust(p => ({ ...p, address: e.target.value }))} />
              </div>
              {saveErr && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--danger)' }}>{saveErr}</div>}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 18px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)', flexShrink: 0, borderRadius: '0 0 6px 6px' }}>
              <button className="btn btn-s" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-p" disabled={saving} onClick={saveCustomer}>{saving ? 'Saving…' : 'Save Customer'}</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Mark paid modal ── */}
      {modal === 'mark_paid' && createPortal(
        <div style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.45)', zIndex: 9000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: 24 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 6, width: 'min(340px, 95vw)', maxHeight: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column', flexShrink: 0, boxShadow: '0 8px 32px rgba(0,0,0,0.25)' }}>
            <div style={{ padding: '13px 18px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14, flexShrink: 0, borderRadius: '6px 6px 0 0' }}>Mark Payment Received</div>
            <div style={{ padding: '16px 18px', flex: '1 1 auto', overflowY: 'auto', minHeight: 0 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>Invoice {formInv.invoice_number} — Outstanding: {fmtC(outstanding(formInv))}</div>
              <div className="f-group">
                <label className="f-label">Amount received</label>
                <input className="f-input" type="number" min="0" step="0.01" value={markPaidAmt} onChange={e => setMarkPaidAmt(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 18px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)', flexShrink: 0, borderRadius: '0 0 6px 6px' }}>
              <button className="btn btn-s" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-p" onClick={async () => { await markPaid(formInv, markPaidAmt); setModal(null); }}>Record Payment</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ─── AP INVOICES PAGE ────────────────────────────────────────────────────────
function APInvoices({ companyName = "Company", company }) {
  const { user } = useUser();
  const [invoices, setInvoices]             = useState([]);
  const [reviewInvoices, setReviewInvoices] = useState([]);
  const [reviewEdits,    setReviewEdits]    = useState({});
  const [copied,         setCopied]         = useState(false);
  const [loading, setLoading]         = useState(true);
  const [selected, setSelected]       = useState(null);
  const [showForm, setShowForm]       = useState(false);
  const [saveError, setSaveError]     = useState(null);
  const [justCleared, setJustCleared] = useState(false);

  useEffect(() => { if (reviewInvoices.length > 0) setJustCleared(false); }, [reviewInvoices.length]);

  const companyId = company?.id ?? null;
  const { accounts: coaAccounts } = useChartOfAccounts(companyId);
  const apEmail      = company?.mailbox_slug ? `bills-${company.mailbox_slug}@inbound.ledgrly.ie` : null;
  const baseCurrency = company?.base_currency || company?.currency || "EUR";
  const fmt    = (n) => fmtCurrency(n, baseCurrency);
  const fmtK   = (n) => fmtCurrencyK(n, baseCurrency);
  const fmtEUR = (n) => fmtCurrencyFull(n, baseCurrency);

  const today = new Date();
  const daysFromToday = (d) => Math.floor((today - new Date(d)) / 86400000);
  const fmtDate = (d) => new Date(d).toLocaleDateString("en-IE", { day: "2-digit", month: "short" });
  const daysCol = (d) => d > 0 ? "var(--red)" : d >= -14 ? "var(--gold)" : "var(--teal)";

  const emptyForm = () => ({
    supplier: "", invoice_ref: "", amount: "",
    invoice_date: today.toISOString().slice(0, 10),
    due_date: "", status: "pending", payment_method: "bank transfer", notes: "",
    nominal_code: "6600", vat_code: "STD23",
  });
  const [form, setForm] = useState(emptyForm());
  const ff = (f) => (e) => setForm((p) => ({ ...p, [f]: e.target.value }));

  useEffect(() => {
    if (!companyId) { setInvoices([]); setReviewInvoices([]); return; }
    async function init() {
      setLoading(true);
      try {
        const { data: rows, error } = await supabase
          .from("ap_invoices").select("*").eq("company_id", companyId).order("due_date", { ascending: true });
        if (error) throw new Error(error.message);
        if (rows) {
          setInvoices(rows.filter(r => r.status !== "needs_review" && r.status !== "rejected"));
          setReviewInvoices(rows.filter(r => r.status === "needs_review"));
        }
      } catch (err) {
        console.error("[ap-invoices] init failed:", err.message);
      }
      setLoading(false);
    }
    init();
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const formValid = !!(form.supplier && form.invoice_ref && form.amount &&
    parseFloat(form.amount) > 0 && form.invoice_date && form.due_date);

  const save = async () => {
    if (!formValid) return;
    setSaveError(null);
    let cid;
    try { cid = requireCompanyId(companyId); } catch (err) { setSaveError(err.message); return; }
    const nomCode = form.nominal_code || '6600';
    const vatCode = form.vat_code     || 'STD23';
    const billAmt = parseFloat(form.amount);
    const { data: inserted, error } = await supabase.from("ap_invoices").insert({
      company_id: cid,
      supplier: form.supplier,
      invoice_ref: form.invoice_ref,
      amount: billAmt,
      invoice_date: form.invoice_date,
      due_date: form.due_date,
      status: form.status,
      payment_method: form.payment_method,
      notes: form.notes,
      nominal_code: nomCode,
      vat_code: vatCode,
    }).select().single();
    if (error) { setSaveError(`Save failed: ${error.message}`); return; }
    // Post accrual journal: Dr Expense / Cr Trade Creditors (2000)
    await supabase.from('journals').insert({
      company_id: cid, date: form.invoice_date,
      description: `Bill ${form.invoice_ref} — ${form.supplier}`,
      debit_account: nomCode, credit_account: '2000',
      amount: billAmt, vat_code: vatCode,
      reference: form.invoice_ref,
      source_recurring_id: null, is_accrual_reversal: false,
    });
    setInvoices((prev) => [...prev, inserted].sort((a, b) => new Date(a.due_date) - new Date(b.due_date)));
    setForm(emptyForm());
    setShowForm(false);
  };

  // Mark AP bill paid — thin wrapper over mark_ap_bill_paid RPC (atomic)
  const markPaid = async (inv, e) => {
    e.stopPropagation();
    const paidAmt = Number(inv.gross_amount || inv.amount || 0);
    try {
      await markApBillPaid(companyId, inv.id, paidAmt);
      setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, status: 'paid', amount_paid: paidAmt } : i));
      if (selected === inv.id) setSelected(null);
    } catch (err) {
      console.error('[ap] mark paid failed:', err.message);
    }
  };

  const aiAction = (inv) => {
    const d = daysFromToday(inv.due_date);
    if (inv.status === "disputed") return "Disputed — contact supplier to request a revised invoice or credit note";
    if (d > 60) return "60+ days overdue — escalate to management; consider withholding future orders until resolved";
    if (d > 30) return "30–60 days overdue — request a statement from supplier and arrange a payment plan";
    return "Recently overdue — contact supplier to confirm payment date and method";
  };

  const copyEmail = () => {
    if (!apEmail) return;
    navigator.clipboard?.writeText(apEmail).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const viewAttachmentPdf = async (path) => {
    const { data, error } = await supabase.storage
      .from("journal-attachments")
      .createSignedUrl(path, 3600);
    if (!error && data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  // Approve AP bill from needs_review — thin wrapper over approve_ap_bill RPC (atomic)
  const approveReview = async (inv) => {
    const ed      = reviewEdits[inv.id] || {};
    const gross   = parseFloat(ed.gross_amount ?? inv.gross_amount ?? inv.amount ?? 0) || null;
    const nomCode = ed.nominal_code ?? inv.suggested_nominal ?? '6600';
    try {
      await approveApBill({
        id:            inv.id,
        company_id:    inv.company_id,
        gross_amount:  gross,
        nominal_code:  nomCode,
        suggested_nominal: nomCode,
        vat_code:      inv.vat_code || 'STD23',
        invoice_date:  ed.invoice_date ?? inv.invoice_date ?? null,
        due_date:      ed.due_date    ?? inv.due_date    ?? null,
        supplier:      ed.supplier    ?? inv.supplier    ?? '',
        invoice_ref:   ed.invoice_ref ?? inv.invoice_ref ?? '',
        net_amount:    parseFloat(ed.net_amount  ?? inv.net_amount  ?? 0) || null,
        vat_amount:    parseFloat(ed.vat_amount  ?? inv.vat_amount  ?? 0) || null,
      });
    } catch (err) {
      console.error('[ap] approve failed:', err.message);
      return;
    }
    const updates = {
      status: 'pending', supplier: ed.supplier ?? inv.supplier ?? '',
      invoice_ref: ed.invoice_ref ?? inv.invoice_ref ?? '',
      invoice_date: ed.invoice_date ?? inv.invoice_date ?? null,
      due_date: ed.due_date ?? inv.due_date ?? null,
      amount: gross, gross_amount: gross,
      net_amount: parseFloat(ed.net_amount ?? inv.net_amount ?? 0) || null,
      vat_amount: parseFloat(ed.vat_amount ?? inv.vat_amount ?? 0) || null,
      suggested_nominal: nomCode, nominal_code: nomCode,
    };
    const wasLast = reviewInvoices.length === 1;
    setReviewInvoices(prev => prev.filter(i => i.id !== inv.id));
    setInvoices(prev => [...prev, { ...inv, ...updates }].sort((a, b) => new Date(a.due_date) - new Date(b.due_date)));
    setReviewEdits(prev => { const n = { ...prev }; delete n[inv.id]; return n; });
    if (wasLast) setJustCleared(true);
  };

  const rejectReview = async (inv) => {
    const { error } = await supabase.from("ap_invoices")
      .update({ status: "rejected" }).eq("id", inv.id);
    if (error) { console.error("[ap] reject failed:", error.message); return; }
    setReviewInvoices(prev => prev.filter(i => i.id !== inv.id));
  };

  const outstanding = invoices.filter((i) => i.status !== "paid");
  const totalAP     = outstanding.reduce((s, i) => s + (i.amount || 0), 0);
  const overdue30   = outstanding.filter((i) => daysFromToday(i.due_date) > 30);
  const totalOD30   = overdue30.reduce((s, i) => s + (i.amount || 0), 0);
  const dueMonth    = outstanding.filter((i) => { const d = daysFromToday(i.due_date); return d <= 0 && d >= -30; });
  const totalDueMonth = dueMonth.reduce((s, i) => s + (i.amount || 0), 0);

  const ageBuckets = [
    { label: "Current",     desc: "Not yet due",          check: (i) => daysFromToday(i.due_date) <= 0,                                            c: "var(--teal)" },
    { label: "1–30 Days",   desc: "1–30 days overdue",    check: (i) => { const d = daysFromToday(i.due_date); return d > 0 && d <= 30; },         c: "var(--gold)" },
    { label: "31–60 Days",  desc: "31–60 days overdue",   check: (i) => { const d = daysFromToday(i.due_date); return d > 30 && d <= 60; },        c: "#c87a0a" },
    { label: "61–90+ Days", desc: "Over 60 days overdue", check: (i) => daysFromToday(i.due_date) > 60,                                            c: "var(--red)" },
  ].map((b) => ({
    ...b,
    amount: outstanding.filter(b.check).reduce((s, i) => s + (i.amount || 0), 0),
    count:  outstanding.filter(b.check).length,
  }));
  const agedTotal = ageBuckets.reduce((s, b) => s + b.amount, 0);

  const statusPill = (s) => ({
    paid:     ["var(--teal)",  "rgba(29,107,114,0.1)"],
    approved: ["var(--text-muted)",  "var(--surface-2)"],
    pending:  ["var(--gold)",  "rgba(184,134,11,0.1)"],
    disputed: ["var(--red)",   "rgba(139,32,32,0.1)"],
  }[s] || ["var(--dim)", "var(--surface2)"]);

  const selInv = invoices.find((i) => i.id === selected);

  return (
    <div className="fade-up">

      {/* ── AP Mailbox address banner ── */}
      {apEmail && (
        <div style={{ marginBottom: 12, padding: "10px 16px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 10, fontFamily: "Source Code Pro, monospace", color: "var(--dim)", letterSpacing: "0.06em", marginBottom: 3 }}>AP MAILBOX</div>
            <div style={{ fontSize: 13, fontFamily: "Source Code Pro, monospace", color: "var(--text)" }}>{apEmail}</div>
            <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 3 }}>Forward supplier invoices to this address — they appear in the review queue below.</div>
          </div>
          <button className="btn btn-s btn-sm" onClick={copyEmail} style={{ flexShrink: 0, minWidth: 68 }}>
            {copied ? "✓ Copied" : "Copy"}
          </button>
        </div>
      )}

      {/* ── Review Queue ── */}
      {reviewInvoices.length > 0 && (
        <div className="card full-col" style={{ marginBottom: 12, border: "1px solid rgba(184,134,11,0.4)" }}>
          <div className="card-header">
            <span className="card-title">Review Queue</span>
            <span style={{ fontSize: 10, color: "var(--gold)", fontFamily: "Source Code Pro, monospace", fontWeight: 700 }}>
              {reviewInvoices.length} PENDING
            </span>
          </div>
          <div>
            {reviewInvoices.map((inv) => {
              const ed = reviewEdits[inv.id] || {};
              const nomAccounts = coaAccounts.length ? coaAccounts : GL_ACCOUNTS;
              return (
                <div key={inv.id} style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
                  {inv.new_supplier_flag && (
                    <div style={{ marginBottom: 8, padding: "4px 10px", background: "rgba(184,134,11,0.08)", border: "1px solid rgba(184,134,11,0.25)", borderRadius: 3, fontSize: 11, color: "var(--gold)" }}>
                      ⚠ New supplier — not seen in your AP ledger before
                    </div>
                  )}
                  <div className="f-row" style={{ gridTemplateColumns: "1.5fr 1fr 1fr", marginBottom: 8 }}>
                    <div className="f-group">
                      <label className="f-label">Supplier</label>
                      <input className="f-input" value={ed.supplier ?? inv.supplier ?? ""} onChange={e => setReviewEdits(p => ({ ...p, [inv.id]: { ...p[inv.id], supplier: e.target.value } }))} />
                    </div>
                    <div className="f-group">
                      <label className="f-label">Invoice Ref</label>
                      <input className="f-input" value={ed.invoice_ref ?? inv.invoice_ref ?? ""} onChange={e => setReviewEdits(p => ({ ...p, [inv.id]: { ...p[inv.id], invoice_ref: e.target.value } }))} />
                    </div>
                    <div className="f-group">
                      <label className="f-label">Nominal Account</label>
                      <select className="f-input" value={ed.nominal_code ?? inv.suggested_nominal ?? ""} onChange={e => setReviewEdits(p => ({ ...p, [inv.id]: { ...p[inv.id], nominal_code: e.target.value } }))}>
                        <option value="">— select —</option>
                        {nomAccounts.map(a => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="f-row" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", marginBottom: 10 }}>
                    <div className="f-group">
                      <label className="f-label">Invoice Date</label>
                      <input className="f-input" type="date" value={ed.invoice_date ?? inv.invoice_date ?? ""} onChange={e => setReviewEdits(p => ({ ...p, [inv.id]: { ...p[inv.id], invoice_date: e.target.value } }))} />
                    </div>
                    <div className="f-group">
                      <label className="f-label">Due Date</label>
                      <input className="f-input" type="date" value={ed.due_date ?? inv.due_date ?? ""} onChange={e => setReviewEdits(p => ({ ...p, [inv.id]: { ...p[inv.id], due_date: e.target.value } }))} />
                    </div>
                    <div className="f-group">
                      <label className="f-label">Net (€)</label>
                      <input className="f-input" type="number" step="0.01" value={ed.net_amount ?? inv.net_amount ?? ""} onChange={e => setReviewEdits(p => ({ ...p, [inv.id]: { ...p[inv.id], net_amount: e.target.value } }))} />
                    </div>
                    <div className="f-group">
                      <label className="f-label">VAT (€)</label>
                      <input className="f-input" type="number" step="0.01" value={ed.vat_amount ?? inv.vat_amount ?? ""} onChange={e => setReviewEdits(p => ({ ...p, [inv.id]: { ...p[inv.id], vat_amount: e.target.value } }))} />
                    </div>
                    <div className="f-group">
                      <label className="f-label">Gross (€)</label>
                      <input className="f-input" type="number" step="0.01" value={ed.gross_amount ?? inv.gross_amount ?? ""} onChange={e => setReviewEdits(p => ({ ...p, [inv.id]: { ...p[inv.id], gross_amount: e.target.value } }))} />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {inv.attachment_path && (
                      <button className="btn btn-s btn-sm" onClick={() => viewAttachmentPdf(inv.attachment_path)}>⧉ View PDF</button>
                    )}
                    <button className="btn btn-p btn-sm" onClick={() => approveReview(inv)}>✓ Approve</button>
                    <button className="btn btn-s btn-sm" style={{ color: "var(--red)" }} onClick={() => rejectReview(inv)}>✕ Reject</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && companyId && reviewInvoices.length === 0 && (
        <InboxZeroCelebration companyId={companyId} justCleared={justCleared} theme="light" />
      )}

      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
        {[
          { label: "Total Outstanding AP",  value: fmt(totalAP),      sub: `${outstanding.length} open invoice${outstanding.length !== 1 ? "s" : ""}`, c: "var(--text)" },
          { label: "Overdue AP (>30 days)", value: fmt(totalOD30),    sub: `${overdue30.length} invoice${overdue30.length !== 1 ? "s" : ""}`,           c: "var(--red)"  },
          { label: "Due This Month",        value: fmt(totalDueMonth), sub: `${dueMonth.length} invoice${dueMonth.length !== 1 ? "s" : ""}`,            c: "var(--teal)" },
        ].map((k, i) => (
          <div key={i} className="kpi-card" style={{ "--tc": k.c }}>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value" style={{ color: k.c }}>{k.value}</div>
            <div className="kpi-sub">{k.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 10 }}>
        {invoices.length > 0 && (
          <button className="btn btn-s" onClick={() => downloadCSV(`ap-invoices-${fmtIE(today.toISOString().slice(0,10)).replace(/\//g,"-")}.csv`, [
            ["Ledgrly — Accounts Payable", companyName, `Exported ${fmtIE(today.toISOString().slice(0,10))}`],
            [],
            ["AP Ref","Supplier","Invoice Ref","Amount (€)","Invoice Date","Due Date","Status","Payment Method","Notes"],
            ...invoices.map((i) => [i.id, i.supplier, i.invoice_ref, fmtEUR(i.amount), fmtIE(i.invoice_date), fmtIE(i.due_date), i.status, i.payment_method, i.notes || ""]),
          ])}>⬇ Export CSV</button>
        )}
        <button className="btn btn-p" onClick={() => { setShowForm((v) => !v); setSaveError(null); }}>
          {showForm ? "Cancel" : "+ New Invoice"}
        </button>
      </div>

      {showForm && (
        <div className="jnl-form" style={{ marginBottom: 12 }}>
          <div className="jnl-fh">
            <span className="jnl-ft">New AP Invoice</span>
            <button className="btn btn-s btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
          <div className="jnl-fb">
            <div className="f-row">
              <div className="f-group"><label className="f-label">Supplier Name</label><input className="f-input" value={form.supplier} onChange={ff("supplier")} placeholder="Supplier Ltd" /></div>
              <div className="f-group"><label className="f-label">Invoice Ref</label><input className="f-input" value={form.invoice_ref} onChange={ff("invoice_ref")} placeholder="REF-0001" /></div>
              <div className="f-group"><label className="f-label">Amount (€)</label><input className="f-input" type="number" min="0" step="0.01" value={form.amount} onChange={ff("amount")} placeholder="0.00" /></div>
            </div>
            <div className="f-row" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
              <div className="f-group"><label className="f-label">Invoice Date</label><input className="f-input" type="date" value={form.invoice_date} onChange={ff("invoice_date")} /></div>
              <div className="f-group"><label className="f-label">Due Date</label><input className="f-input" type="date" value={form.due_date} onChange={ff("due_date")} /></div>
              <div className="f-group">
                <label className="f-label">Status</label>
                <select className="f-input" value={form.status} onChange={ff("status")}>
                  <option value="pending">Pending</option><option value="approved">Approved</option><option value="disputed">Disputed</option>
                </select>
              </div>
              <div className="f-group">
                <label className="f-label">Payment Method</label>
                <select className="f-input" value={form.payment_method} onChange={ff("payment_method")}>
                  <option value="bank transfer">Bank Transfer</option><option value="cheque">Cheque</option><option value="card">Card</option><option value="direct debit">Direct Debit</option>
                </select>
              </div>
            </div>
            <div className="f-row" style={{ gridTemplateColumns: "2fr 1fr" }}>
              <div className="f-group">
                <label className="f-label">Expense Account</label>
                <select className="f-input" value={form.nominal_code} onChange={ff("nominal_code")}>
                  {(coaAccounts.length ? coaAccounts : GL_ACCOUNTS).filter(a => a.code >= '5000').map(a => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
                </select>
              </div>
              <div className="f-group">
                <label className="f-label">VAT Rate</label>
                <select className="f-input" value={form.vat_code} onChange={ff("vat_code")}>
                  {['STD23','RED13','RED9','ZERO','EXEMPT','NONE'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div style={{ marginBottom: 13 }}>
              <div className="f-group"><label className="f-label">Notes</label><input className="f-input" value={form.notes} onChange={ff("notes")} placeholder="Optional notes…" /></div>
            </div>
            {saveError && (
              <div style={{ marginBottom: 10, fontSize: 12, color: "var(--red)", background: "rgba(139,32,32,0.06)", border: "1px solid rgba(139,32,32,0.2)", borderRadius: 2, padding: "7px 11px" }}>{saveError}</div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-p" onClick={save} disabled={!formValid} style={{ opacity: !formValid ? 0.42 : 1 }}>Save Invoice</button>
              <button className="btn btn-s" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}


      <div className="card full-col">
        <div className="card-header">
          <span className="card-title">Accounts Payable Ledger</span>
          <span style={{ fontSize: 10, color: "var(--dim)", fontFamily: "Source Code Pro, monospace" }}>SORTED BY DUE DATE</span>
        </div>
        {loading ? (
          <div style={{ padding: "20px 16px", fontSize: 13, color: "var(--dim)" }}>Loading invoices…</div>
        ) : invoices.length === 0 ? (
          <div style={{ padding: "32px 16px", fontSize: 13, color: "var(--dim)", textAlign: "center" }}>No AP invoices yet — add one above.</div>
        ) : (
          <table className="gl-table">
            <thead>
              <tr><th>Supplier</th><th>Invoice Ref</th><th>Issued</th><th>Due</th><th>Days</th><th>Status</th><th>Method</th><th className="r">Amount</th><th></th></tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const d = daysFromToday(inv.due_date);
                const [sc, sbg] = statusPill(inv.status);
                return (
                  <tr key={inv.id} style={{ cursor: "pointer", opacity: inv.status === "paid" ? 0.52 : 1 }}
                    onClick={() => setSelected(selected === inv.id ? null : inv.id)}>
                    <td style={{ fontWeight: 500 }}>{inv.supplier}</td>
                    <td className="mono" style={{ color: "var(--accent)", fontWeight: 600 }}>{inv.invoice_ref}</td>
                    <td className="mono">{fmtDate(inv.invoice_date)}</td>
                    <td className="mono">{fmtDate(inv.due_date)}</td>
                    <td>
                      {inv.status === "paid"
                        ? <span style={{ fontSize: 11, color: "var(--text-faint)" }}>paid</span>
                        : <><div style={{ fontFamily: "Source Code Pro, monospace", fontSize: 12, fontWeight: 700, color: daysCol(d) }}>
                            {d > 0 ? `${d}d overdue` : `${Math.abs(d)}d`}
                          </div>
                          <div className="inv-days-bar"><div className="inv-days-fill" style={{ width: `${Math.min(Math.abs(d) / 90 * 100, 100)}%`, background: daysCol(d) }} /></div>
                          </>}
                    </td>
                    <td><span className="pill" style={{ color: sc, background: sbg }}>{inv.status}</span></td>
                    <td style={{ fontSize: 11, color: "var(--dim)" }}>{inv.payment_method}</td>
                    <td className="r mono" style={{ fontWeight: 600 }}>{fmt(inv.amount)}</td>
                    <td onClick={(e) => e.stopPropagation()} style={{ paddingRight: 10 }}>
                      {inv.status !== "paid" && (
                        <button className="btn btn-s btn-sm" style={{ whiteSpace: "nowrap" }} onClick={(e) => markPaid(inv, e)}>Mark Paid</button>
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr className="tot">
                <td colSpan={7} style={{ fontSize: 12, fontWeight: 600, paddingLeft: 12, color: "var(--text-muted)" }}>Total Outstanding</td>
                <td className="r mono" style={{ fontWeight: 700, fontSize: 13 }}>{fmt(totalAP)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        )}
        {selInv && (() => {
          const d = daysFromToday(selInv.due_date);
          return (
            <div style={{ padding: "12px 16px", background: "rgba(26,39,68,0.03)", borderTop: "1px solid var(--border)" }}>
              {d > 0 && selInv.status !== "paid" && (
                <div style={{ marginBottom: 10, padding: "8px 12px", background: d > 30 ? "rgba(139,32,32,0.06)" : "rgba(184,134,11,0.06)", borderLeft: `3px solid ${daysCol(d)}`, borderRadius: 2 }}>
                  <div style={{ fontSize: 10, fontFamily: "Source Code Pro, monospace", color: daysCol(d), fontWeight: 700, marginBottom: 3 }}>AI SUGGESTED ACTION</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{aiAction(selInv)}</div>
                </div>
              )}
              <div style={{ fontSize: 11, color: "var(--dim)", fontFamily: "Source Code Pro, monospace", marginBottom: 8 }}>INVOICE DETAILS — {selInv.invoice_ref}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
                <div><div style={{ fontSize: 10, color: "var(--dim)", fontFamily: "Source Code Pro, monospace", marginBottom: 2 }}>PAYMENT METHOD</div><div style={{ fontSize: 12, textTransform: "capitalize" }}>{selInv.payment_method}</div></div>
                <div><div style={{ fontSize: 10, color: "var(--dim)", fontFamily: "Source Code Pro, monospace", marginBottom: 2 }}>SUPPLIER</div><div style={{ fontSize: 12 }}>{selInv.supplier}</div></div>
                <div><div style={{ fontSize: 10, color: "var(--dim)", fontFamily: "Source Code Pro, monospace", marginBottom: 2 }}>NOTES</div><div style={{ fontSize: 12 }}>{selInv.notes || "—"}</div></div>
              </div>
            </div>
          );
        })()}
      </div>

      <div className="card full-col">
        <div className="card-header">
          <span className="card-title">Aged Creditors Report</span>
          <span style={{ fontSize: 10, color: "var(--dim)", fontFamily: "Source Code Pro, monospace" }}>OUTSTANDING ONLY</span>
        </div>
        {loading ? (
          <div style={{ padding: "20px 16px", fontSize: 13, color: "var(--dim)" }}>Loading…</div>
        ) : (
          <>
            <table className="gl-table">
              <thead>
                <tr><th>Bucket</th><th>Description</th><th>Invoices</th><th className="r">Amount</th><th className="r">% of AP</th></tr>
              </thead>
              <tbody>
                {ageBuckets.map((b, i) => (
                  <tr key={i}>
                    <td>
                      <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: b.c, marginRight: 7, verticalAlign: "middle" }} />
                      <span className="mono" style={{ fontWeight: 600 }}>{b.label}</span>
                    </td>
                    <td style={{ color: "var(--muted)", fontSize: 12 }}>{b.desc}</td>
                    <td className="mono" style={{ color: "var(--dim)" }}>{b.count}</td>
                    <td className="r mono" style={{ fontWeight: 600, color: b.c }}>{fmt(b.amount)}</td>
                    <td className="r mono" style={{ color: "var(--dim)" }}>{agedTotal ? ((b.amount / agedTotal) * 100).toFixed(1) : "0.0"}%</td>
                  </tr>
                ))}
                <tr className="tot">
                  <td colSpan={3} style={{ fontSize: 12, fontWeight: 600, paddingLeft: 12, color: "var(--text-muted)" }}>Total Outstanding AP</td>
                  <td className="r mono" style={{ fontWeight: 700, fontSize: 13 }}>{fmt(agedTotal)}</td>
                  <td className="r mono" style={{ color: "var(--dim)" }}>100.0%</td>
                </tr>
              </tbody>
            </table>
            {agedTotal > 0 && (
              <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
                <div style={{ height: 7, borderRadius: 4, overflow: "hidden", display: "flex" }}>
                  {ageBuckets.map((b, i) => (
                    <div key={i} style={{ width: `${(b.amount / agedTotal) * 100}%`, background: b.c, transition: "width 0.8s ease" }} />
                  ))}
                </div>
                <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
                  {ageBuckets.map((b, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <div style={{ width: 7, height: 7, borderRadius: "50%", background: b.c }} />
                      <span style={{ fontSize: 10, fontFamily: "Source Code Pro, monospace", color: "var(--dim)" }}>{b.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── COMPLIANCE PAGE ──────────────────────────────────────────────────────────
const MONTH_NAMES_LONG  = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTH_NAMES_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function getVATPeriods(vatPeriodType, rosEfiler = false) {
  const dueDay = rosEfiler ? 23 : 19;
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const periods = [];
  if (vatPeriodType === 'monthly') {
    for (let i = 0; i < 6; i++) {
      const d = new Date(year, month - i, 1);
      const y = d.getFullYear(), m = d.getMonth();
      periods.push({
        val:   `m-${y}-${m}`,
        label: `${MONTH_NAMES_LONG[m]} ${y}`,
        start: new Date(y, m, 1).toISOString().slice(0, 10),
        end:   new Date(y, m + 1, 0).toISOString().slice(0, 10),
        due:   new Date(y, m + 1, dueDay).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" }),
      });
    }
  } else {
    const curPair = Math.floor(month / 2);
    for (let i = 0; i < 6; i++) {
      let pair = curPair - i, y = year;
      while (pair < 0) { pair += 6; y--; }
      const sm = pair * 2, em = sm + 1, dm = em + 1;
      const dy = dm > 11 ? y + 1 : y;
      periods.push({
        val:   `b-${y}-${pair}`,
        label: `${MONTH_NAMES_SHORT[sm]}/${MONTH_NAMES_SHORT[em]} ${y}`,
        start: new Date(y, sm, 1).toISOString().slice(0, 10),
        end:   new Date(y, em + 1, 0).toISOString().slice(0, 10),
        due:   new Date(dy, dm % 12, dueDay).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" }),
      });
    }
  }
  return periods;
}

function VATReturns({ company, onNavigate }) {
  const rosEfiler = company?.ros_efiler || false;
  const vatPeriods = getVATPeriods(company?.vat_period || 'bimonthly', rosEfiler);

  const [selVal,       setSelVal]       = useState(vatPeriods[0]?.val ?? '');
  const [journals,     setJournals]     = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [filedMap,     setFiledMap]     = useState({}); // period_val → vat_returns row
  const [e1,  setE1]  = useState('0');
  const [e2,  setE2]  = useState('0');
  const [es1, setEs1] = useState('0');
  const [es2, setEs2] = useState('0');
  const [drillOpen,    setDrillOpen]    = useState(null);
  const [showExc,      setShowExc]      = useState(false);
  const [showRC,          setShowRC]          = useState(false);
  const [pendingBills,    setPendingBills]    = useState([]);
  const [unreconciledBt,  setUnreconciledBt]  = useState([]);
  const [draftArInvoices, setDraftArInvoices] = useState([]);
  const [markingFiled, setMarkingFiled] = useState(false);
  const [markError,    setMarkError]    = useState(null);

  const vatPeriod  = vatPeriods.find(p => p.val === selVal) ?? vatPeriods[0];
  const filedReturn = filedMap[selVal] ?? null;
  const isLocked   = filedReturn?.status === 'filed';

  // Load filed-period index on mount (for badges)
  useEffect(() => {
    if (!company?.id) return;
    supabase.from('vat_returns').select('period_val, status, t1, t2, t3, t4, e1, e2, es1, es2, filed_at')
      .eq('company_id', company.id)
      .then(({ data }) => {
        if (!data) return;
        const m = {};
        data.forEach(r => { m[r.period_val] = r; });
        setFiledMap(m);
      });
  }, [company?.id]); // eslint-disable-line

  // Load journals + pending bills for selected period; restore EU fields from any filed return
  useEffect(() => {
    if (!company?.id || !vatPeriod) return;
    setLoading(true);
    setDrillOpen(null);
    setShowExc(false);
    setShowRC(false);
    Promise.all([
      supabase.from('journals')
        .select('id, date, description, reference, debit_account, credit_account, amount, vat_code')
        .eq('company_id', company.id)
        .gte('date', vatPeriod.start)
        .lte('date', vatPeriod.end)
        .order('date'),
      supabase.from('ap_invoices')
        .select('id, supplier, invoice_ref, invoice_date, amount, status')
        .eq('company_id', company.id)
        .in('status', ['pending', 'needs_review'])
        .gte('invoice_date', vatPeriod.start)
        .lte('invoice_date', vatPeriod.end),
      supabase.from('bank_transactions')
        .select('id, date, description, amount, settlement_type')
        .eq('company_id', company.id)
        .eq('reconciled', false)
        .gte('date', vatPeriod.start)
        .lte('date', vatPeriod.end),
      supabase.from('invoices')
        .select('id, invoice_number, client, issue_date')
        .eq('company_id', company.id)
        .eq('status', 'draft')
        .gte('issue_date', vatPeriod.start)
        .lte('issue_date', vatPeriod.end),
    ]).then(([jRes, apRes, btRes, arRes]) => {
      setJournals(jRes.data || []);
      setPendingBills(apRes.data || []);
      setUnreconciledBt(btRes.data || []);
      setDraftArInvoices(arRes.data || []);
      const fr = filedMap[selVal];
      if (fr) { setE1(String(fr.e1 ?? 0)); setE2(String(fr.e2 ?? 0)); setEs1(String(fr.es1 ?? 0)); setEs2(String(fr.es2 ?? 0)); }
      else     { setE1('0'); setE2('0'); setEs1('0'); setEs2('0'); }
      setLoading(false);
    });
  }, [company?.id, selVal]); // eslint-disable-line

  // ── VAT computation ────────────────────────────────────────────────────────
  // Amounts in journals are VAT-INCLUSIVE (sourced from bank transactions).
  // Back-calculate: VAT = gross × rate / (100 + rate).
  // salesJournals covers both sides of 4000-4999:
  //   credit_account in range → normal sale (positive)
  //   debit_account  in range → credit note / reversal (negative)
  const salesJournals    = journals.filter(j =>
    (j.credit_account >= '4000' && j.credit_account < '5000') ||
    (j.debit_account  >= '4000' && j.debit_account  < '5000')
  );
  const purchaseJournals = journals.filter(j => j.debit_account  >= '5000' && j.debit_account  < '7000');

  let t1 = 0;
  for (const j of salesJournals) {
    if (!j.vat_code || j.vat_code === 'NONE' || j.vat_code === 'EXEMPT' || j.vat_code === 'RCT' || j.vat_code === 'RC_EU') continue;
    const isCN = j.debit_account >= '4000' && j.debit_account < '5000';
    const { vat } = calcJournalVAT(j.amount, j.vat_code);
    t1 += (isCN ? -1 : 1) * vat;
  }

  let t2 = 0;
  for (const j of purchaseJournals) {
    if (!j.vat_code || j.vat_code === 'NONE' || j.vat_code === 'EXEMPT' || j.vat_code === 'RCT' || j.vat_code === 'RC_EU') continue;
    const { vat } = calcJournalVAT(j.amount, j.vat_code);
    t2 += vat;
  }

  // PA1: customs value of goods imported under postponed accounting — purchase-side only, never from sales.
  // No PA-import-coded journals → PA1 = 0 (correct for domestic-only data).
  const pa1DrillRows = []; // future: import journals with a dedicated PA vat_code
  const pa1 = 0;
  // Sales-guard: assert no t1 (sales-side) row can ever reach pa1DrillRows
  if (pa1DrillRows.some(r => t1DrillRows.find(s => s.id === r.id))) {
    console.error('[VAT3 PA1-guard] FAIL: sales-side journal in PA1 drill rows — coding error');
  }

  const t3 = Math.max(0, t1 - t2);
  const t4 = Math.max(0, t2 - t1);

  // Annotated drill rows — _acct and _vatSign pre-computed for DrillTable
  const t1DrillRows = salesJournals
    .filter(j => j.vat_code && j.vat_code !== 'NONE' && j.vat_code !== 'EXEMPT' && j.vat_code !== 'RCT' && j.vat_code !== 'RC_EU')
    .map(j => ({
      ...j,
      _acct: j.credit_account,
      _vatSign: (j.debit_account >= '4000' && j.debit_account < '5000') ? -1 : 1,
    }));
  const t2DrillRows = purchaseJournals
    .filter(j => j.vat_code && j.vat_code !== 'NONE' && j.vat_code !== 'EXEMPT' && j.vat_code !== 'RCT' && j.vat_code !== 'RC_EU')
    .map(j => ({ ...j, _acct: j.debit_account, _vatSign: 1 }));

  // RC items: excluded from T1/T2, need manual ROS declaration
  const rcExceptions = [
    ...salesJournals.filter(j => j.vat_code === 'RCT' || j.vat_code === 'RC_EU').map(j => ({ ...j, _side: 'sales' })),
    ...purchaseJournals.filter(j => j.vat_code === 'RCT' || j.vat_code === 'RC_EU').map(j => ({ ...j, _side: 'purchases' })),
  ];
  // Missing/NONE code items: may indicate mis-coded entries
  const codeExceptions = [
    ...salesJournals.filter(j => !j.vat_code || j.vat_code === 'NONE').map(j => ({ ...j, _side: 'sales' })),
    ...purchaseJournals.filter(j => !j.vat_code || j.vat_code === 'NONE').map(j => ({ ...j, _side: 'purchases' })),
  ];

  const round2 = n => Math.round(n * 100) / 100;
  const nomName = code => GL_ACCOUNTS.find(a => a.code === code)?.name || code;
  const hardBlockCount = pendingBills.length + unreconciledBt.length;
  const canFile = !isLocked && hardBlockCount === 0;

  const markFiled = async () => {
    if (!company?.id || !vatPeriod || !canFile) return;
    setMarkingFiled(true); setMarkError(null);
    const payload = {
      company_id: company.id, period_val: selVal,
      period_start: vatPeriod.start, period_end: vatPeriod.end,
      t1: round2(t1), t2: round2(t2), t3: round2(t3), t4: round2(t4),
      e1: Number(e1)||0, e2: Number(e2)||0, es1: Number(es1)||0, es2: Number(es2)||0,
      pa1: round2(pa1),
      figures: { t1, t2, t3, t4, e1, e2, es1, es2, pa1 },
      status: 'filed', filed_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('vat_returns')
      .upsert(payload, { onConflict: 'company_id,period_val' });
    if (error) setMarkError(error.message);
    else setFiledMap(prev => ({ ...prev, [selVal]: payload }));
    setMarkingFiled(false);
  };

  const exportCSV = () => {
    const slug = vatPeriod.label.replace(/\//g, '-').replace(/\s/g, '-');
    downloadCSV(`vat3-${slug}.csv`, [
      ["Ledgrly — VAT3 Return Draft", company?.name || "", vatPeriod.label],
      ["Period", `${vatPeriod.start} to ${vatPeriod.end}`],
      ["Due Date", vatPeriod.due], ["Status", isLocked ? "Filed" : "Draft"],
      [],
      ["Box", "Description", "Amount (€)"],
      ["T1", "VAT on Sales (Output VAT)",            fmtEUR(t1)],
      ["T2", "VAT on Purchases (Input VAT)",          fmtEUR(t2)],
      ["T3", "Net VAT Payable (T1 − T2)",             fmtEUR(t3)],
      ["T4", "Net VAT Repayable (T2 − T1)",           fmtEUR(t4)],
      ["E1", "EU Goods Supplies",                     fmtEUR(Number(e1))],
      ["E2", "EU Goods Acquisitions",                 fmtEUR(Number(e2))],
      ["ES1","EU Services Supplies",                  fmtEUR(Number(es1))],
      ["ES2","EU Services Acquisitions",              fmtEUR(Number(es2))],
      ["PA1","Customs value of goods imported under postponed accounting", fmtEUR(pa1)],
      [],
      ["Note", "Amounts are VAT-inclusive. VAT back-calculated as: amount × rate / (100 + rate)."],
      ["Note", "Verify all figures in your ROS account before filing."],
    ]);
  };

  // ── Sub-components ─────────────────────────────────────────────────────────
  const VATBox = ({ label, title, value, color, sub, drill }) => (
    <div
      onClick={drill ? () => setDrillOpen(d => d === label ? null : label) : undefined}
      style={{
        background: "var(--surface)", border: `1px solid ${drillOpen === label ? color : "var(--border)"}`,
        borderRadius: "var(--radius-card)", padding: "14px 18px", position: "relative", overflow: "hidden",
        cursor: drill ? "pointer" : "default", transition: "border-color 0.15s",
        boxShadow: drillOpen === label ? `0 0 0 1px ${color}` : "none",
      }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: color, borderRadius: "var(--radius-card) var(--radius-card) 0 0" }} />
      <div style={{ fontSize: 10, fontFamily: "'Source Code Pro',monospace", fontWeight: 700, color: "var(--text-faint)", letterSpacing: "0.08em", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8, lineHeight: 1.4 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{fmtEUR(value)}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{sub}</div>}
      {drill && <div style={{ position: "absolute", top: 10, right: 12, fontSize: 10, color: "var(--text-faint)" }}>{drillOpen === label ? "▲" : "▼"}</div>}
    </div>
  );

  const EUField = ({ label, title, value, onChange }) => (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-card)", padding: "14px 18px", position: "relative" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "var(--border)", borderRadius: "var(--radius-card) var(--radius-card) 0 0" }} />
      <div style={{ fontSize: 10, fontFamily: "'Source Code Pro',monospace", fontWeight: 700, color: "var(--text-faint)", letterSpacing: "0.08em", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>{title}</div>
      {isLocked
        ? <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{fmtEUR(Number(value))}</div>
        : <input type="number" value={value} onChange={e => onChange(e.target.value)} disabled={isLocked}
            style={{ width: "100%", fontSize: 18, fontWeight: 700, background: "transparent", border: "none", borderBottom: "1px solid var(--border)", color: "var(--text)", padding: "2px 0", fontVariantNumeric: "tabular-nums", outline: "none" }} />
      }
    </div>
  );

  // Generic drill table: rows must have _acct and _vatSign. mode='vat' asserts VAT sum; mode='net' asserts net sum.
  const DrillTable = ({ title, rows, mode, expectedSum, emptyMsg }) => {
    const computedSum = rows.reduce((acc, j) => {
      const { vat, net } = calcJournalVAT(j.amount, j.vat_code);
      return acc + (j._vatSign ?? 1) * (mode === 'net' ? net : vat);
    }, 0);
    const ok = Math.abs(computedSum - (expectedSum ?? computedSum)) < 0.005;
    return (
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-header">
          <span className="card-title">{title}</span>
          <span style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "Source Code Pro,monospace" }}>{rows.length} journals · click box to close</span>
        </div>
        {rows.length === 0 ? (
          <div style={{ padding: "14px 16px", fontSize: 12, color: "var(--text-muted)" }}>
            {emptyMsg || 'No transactions in this period for this box.'}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="gl-table">
              <thead>
                <tr>
                  <th>Date</th><th>Description</th><th>Nominal</th>
                  <th style={{ textAlign: "center" }}>VAT Code</th>
                  <th className="r">Gross (inc. VAT)</th><th className="r">VAT</th><th className="r">Net</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(j => {
                  const { vat, net } = calcJournalVAT(j.amount, j.vat_code);
                  const sign = j._vatSign ?? 1;
                  return (
                    <tr key={j.id}>
                      <td style={{ fontFamily: "Source Code Pro,monospace", fontSize: 11 }}>{j.date}</td>
                      <td style={{ fontSize: 12, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={j.description}>{j.description}</td>
                      <td style={{ fontSize: 11, fontFamily: "Source Code Pro,monospace" }}>{j._acct} · {nomName(j._acct)}</td>
                      <td style={{ textAlign: "center" }}>
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", padding: "2px 6px", borderRadius: 4, background: "var(--surface-2)", color: "var(--accent)" }}>{j.vat_code || '—'}</span>
                      </td>
                      <td className="r" style={{ fontFamily: "Source Code Pro,monospace", fontSize: 11 }}>{fmtEUR(Math.abs(Number(j.amount)))}</td>
                      <td className="r" style={{ fontFamily: "Source Code Pro,monospace", fontSize: 11, color: sign < 0 ? "var(--warn)" : "var(--accent)" }}>{fmtEUR(sign * vat)}</td>
                      <td className="r" style={{ fontFamily: "Source Code Pro,monospace", fontSize: 11 }}>{fmtEUR(sign * net)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: "var(--surface-2)", fontWeight: 700, borderTop: "2px solid var(--border)" }}>
                  <td colSpan={4} style={{ padding: "8px 10px", fontSize: 11, color: ok ? "var(--text-muted)" : "var(--danger)" }}>
                    {mode === 'net' ? 'Net' : 'VAT'} total {ok ? '✓ matches box' : '⚠ MISMATCH — check journal coding'}
                  </td>
                  <td />
                  <td className="r" style={{ fontFamily: "Source Code Pro,monospace", fontSize: 13, color: ok ? "var(--accent)" : "var(--danger)", padding: "8px 10px" }}>
                    {fmtEUR(round2(computedSum))}
                  </td>
                  <td className="r" style={{ fontFamily: "Source Code Pro,monospace", fontSize: 11, color: "var(--text-muted)", padding: "8px 10px" }}>
                    box: {fmtEUR(round2(expectedSum ?? computedSum))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    );
  };

  // T3/T4: combined output + input rows showing signed VAT contribution
  const T34DrillTable = ({ isT3 }) => {
    const combined = [
      ...t1DrillRows,
      ...t2DrillRows.map(r => ({ ...r, _vatSign: -1, _isInput: true })),
    ];
    const vatSum = round2(combined.reduce((acc, j) => {
      const { vat } = calcJournalVAT(j.amount, j.vat_code);
      return acc + (j._vatSign ?? 1) * vat;
    }, 0));
    const expectedNet = round2(isT3 ? t3 : -t4);
    const ok = Math.abs(vatSum - expectedNet) < 0.005;
    return (
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-header">
          <span className="card-title">{isT3 ? 'T3 — Net VAT Payable Breakdown' : 'T4 — Net VAT Repayable Breakdown'}</span>
          <span style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "Source Code Pro,monospace" }}>T1 − T2 · click box to close</span>
        </div>
        <div style={{ display: "flex", gap: 24, padding: "10px 14px", fontSize: 12, alignItems: "center", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
          <span>T1 Output: <strong style={{ color: "var(--accent)", fontFamily: "Source Code Pro,monospace" }}>{fmtEUR(round2(t1))}</strong></span>
          <span style={{ color: "var(--text-faint)" }}>−</span>
          <span>T2 Input: <strong style={{ color: "var(--warn)", fontFamily: "Source Code Pro,monospace" }}>{fmtEUR(round2(t2))}</strong></span>
          <span style={{ color: "var(--text-faint)" }}>=</span>
          <span>Net: <strong style={{ color: ok ? (isT3 ? "var(--danger)" : "var(--accent)") : "var(--danger)", fontFamily: "Source Code Pro,monospace" }}>{fmtEUR(Math.abs(vatSum))} {ok ? '✓' : '⚠ MISMATCH'}</strong></span>
        </div>
        {combined.length === 0 ? (
          <div style={{ padding: "14px 16px", fontSize: 12, color: "var(--text-muted)" }}>No VAT transactions in this period.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="gl-table">
              <thead>
                <tr>
                  <th>Date</th><th>Description</th><th>Nominal</th>
                  <th style={{ textAlign: "center" }}>VAT Code</th>
                  <th style={{ textAlign: "center" }}>Side</th>
                  <th className="r">Gross</th>
                  <th className="r">Signed VAT</th>
                </tr>
              </thead>
              <tbody>
                {combined.map((j, idx) => {
                  const { vat } = calcJournalVAT(j.amount, j.vat_code);
                  const sign = j._vatSign ?? 1;
                  const isInput = j._isInput;
                  return (
                    <tr key={`${j.id}-${idx}`}>
                      <td style={{ fontFamily: "Source Code Pro,monospace", fontSize: 11 }}>{j.date}</td>
                      <td style={{ fontSize: 12, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={j.description}>{j.description}</td>
                      <td style={{ fontSize: 11, fontFamily: "Source Code Pro,monospace" }}>{j._acct} · {nomName(j._acct)}</td>
                      <td style={{ textAlign: "center" }}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: "var(--surface-2)", color: "var(--accent)" }}>{j.vat_code}</span>
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: isInput ? "rgba(234,179,8,0.12)" : "rgba(52,211,153,0.12)", color: isInput ? "var(--warn)" : "var(--accent)" }}>
                          {isInput ? 'Input' : 'Output'}
                        </span>
                      </td>
                      <td className="r" style={{ fontFamily: "Source Code Pro,monospace", fontSize: 11 }}>{fmtEUR(Math.abs(Number(j.amount)))}</td>
                      <td className="r" style={{ fontFamily: "Source Code Pro,monospace", fontSize: 11, color: sign > 0 ? "var(--accent)" : "var(--warn)" }}>
                        {sign > 0 ? '+' : '−'}{fmtEUR(Math.abs(sign * vat))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: "var(--surface-2)", fontWeight: 700, borderTop: "2px solid var(--border)" }}>
                  <td colSpan={5} style={{ padding: "8px 10px", fontSize: 11, color: ok ? "var(--text-muted)" : "var(--danger)" }}>
                    Net VAT ({isT3 ? 'T1 − T2' : 'T2 − T1'}) {ok ? '✓ matches box' : '⚠ MISMATCH'}
                  </td>
                  <td />
                  <td className="r" style={{ fontFamily: "Source Code Pro,monospace", fontSize: 13, color: ok ? "var(--accent)" : "var(--danger)", padding: "8px 10px" }}>
                    {isT3 ? '+' : '−'}{fmtEUR(Math.abs(vatSum))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fade-up">
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: "Playfair Display, serif", fontSize: 17, fontWeight: 700, color: "var(--text)", marginBottom: 2 }}>VAT Returns</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Irish VAT3 draft · {company?.vat_period === 'monthly' ? 'monthly' : 'bi-monthly'} periods · Revenue filing</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value={selVal}
            onChange={e => setSelVal(e.target.value)}
            style={{ fontSize: 11, fontFamily: "Source Code Pro,monospace", padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", cursor: "pointer" }}
          >
            {vatPeriods.map(p => (
              <option key={p.val} value={p.val}>
                {p.label}{filedMap[p.val]?.status === 'filed' ? ' ✓' : ''}
              </option>
            ))}
          </select>
          {!loading && <ExportDropdown onCSV={exportCSV} onPrint={() => window.print()} />}
        </div>
      </div>

      {/* VAT-inclusive assumption banner */}
      <div style={{ fontSize: 12, background: "rgba(184,134,11,0.07)", border: "1px solid rgba(184,134,11,0.25)", borderLeft: "4px solid var(--warn)", borderRadius: "var(--radius-card)", padding: "10px 14px", marginBottom: 12, color: "var(--text-muted)" }}>
        <strong style={{ color: "var(--warn)" }}>Assumption: amounts are VAT-inclusive.</strong> Journal amounts come from bank transactions (gross figures). VAT is back-calculated as: <code style={{ fontFamily: "Source Code Pro,monospace" }}>VAT = amount × rate / (100 + rate)</code>. Ensure all bank imports are gross before using this draft.
      </div>

      {/* Completeness gate — hard-block */}
      {!isLocked && !loading && hardBlockCount > 0 && (
        <div style={{ fontSize: 12, background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.25)", borderLeft: "4px solid var(--danger)", borderRadius: "var(--radius-card)", padding: "10px 14px", marginBottom: 8, color: "var(--text)" }}>
          <strong style={{ color: "var(--danger)" }}>⚠ Return is not final — {hardBlockCount} item{hardBlockCount !== 1 ? 's' : ''} need attention before filing</strong>
          <div style={{ display: "flex", gap: 16, marginTop: 6, flexWrap: "wrap" }}>
            {unreconciledBt.length > 0 && (
              <span style={{ color: "var(--text-muted)" }}>
                {unreconciledBt.length} unreconciled bank transaction{unreconciledBt.length !== 1 ? 's' : ''}
                {onNavigate && <button className="btn btn-s btn-sm" style={{ fontSize: 10, marginLeft: 6 }} onClick={() => onNavigate('bank-rec')}>Bank Rec →</button>}
              </span>
            )}
            {pendingBills.length > 0 && (
              <span style={{ color: "var(--text-muted)" }}>
                {pendingBills.length} pending/needs-review AP bill{pendingBills.length !== 1 ? 's' : ''}
                {onNavigate && <button className="btn btn-s btn-sm" style={{ fontSize: 10, marginLeft: 6 }} onClick={() => onNavigate('bills')}>Bills →</button>}
              </span>
            )}
          </div>
        </div>
      )}
      {/* Completeness gate — soft-warn (draft AR invoices) */}
      {!isLocked && !loading && draftArInvoices.length > 0 && (
        <div style={{ fontSize: 12, background: "rgba(184,134,11,0.06)", border: "1px solid rgba(184,134,11,0.2)", borderLeft: "4px solid var(--warn)", borderRadius: "var(--radius-card)", padding: "10px 14px", marginBottom: 8, color: "var(--text)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ color: "var(--warn)" }}>⚠</span>
          <span style={{ color: "var(--text-muted)" }}><strong style={{ color: "var(--text)" }}>{draftArInvoices.length} draft AR invoice{draftArInvoices.length !== 1 ? 's' : ''}</strong> dated in this period may not yet be issued — does not block filing.</span>
          {onNavigate && <button className="btn btn-s btn-sm" style={{ fontSize: 10 }} onClick={() => onNavigate('invoices')}>Invoices →</button>}
        </div>
      )}

      {/* Filed banner */}
      {isLocked && (
        <div style={{ fontSize: 12, background: "var(--accent-dim)", border: "1px solid rgba(52,211,153,0.3)", borderRadius: "var(--radius-card)", padding: "10px 14px", marginBottom: 12, color: "var(--accent)" }}>
          ✓ Period locked — filed {new Date(filedReturn.filed_at).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" })}. Figures are read-only.
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "24px 0" }}>Loading VAT data…</div>
      ) : (
        <>
          {/* T1 / T2 / T3 / T4 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
            <VATBox label="T1" title="VAT on Sales (Output)" value={t1} color="var(--accent)" drill
              sub={`${t1DrillRows.length} journals · click to drill down`} />
            <VATBox label="T2" title="VAT on Purchases (Input)" value={t2} color="var(--warn)" drill
              sub={`${t2DrillRows.length} journals · click to drill down`} />
            <VATBox label="T3" title="Net VAT Payable" value={t3} color={t3 > 0 ? "var(--danger)" : "var(--text-faint)"}
              drill={t1DrillRows.length > 0 || t2DrillRows.length > 0}
              sub={t3 > 0 ? "Due to Revenue · click to drill" : "Nothing payable"} />
            <VATBox label="T4" title="Net Repayable" value={t4} color={t4 > 0 ? "var(--accent)" : "var(--text-faint)"}
              drill={t1DrillRows.length > 0 || t2DrillRows.length > 0}
              sub={t4 > 0 ? "Refund from Revenue · click to drill" : "No repayment"} />
          </div>

          {drillOpen === 'T1' && <DrillTable title="T1 — Output VAT Detail" rows={t1DrillRows} mode="vat" expectedSum={t1} />}
          {drillOpen === 'T2' && <DrillTable title="T2 — Input VAT Detail" rows={t2DrillRows} mode="vat" expectedSum={t2} />}
          {drillOpen === 'T3' && <T34DrillTable isT3 />}
          {drillOpen === 'T4' && <T34DrillTable isT3={false} />}

          {/* PA1 — postponed accounting imports only */}
          <div style={{ marginBottom: 12 }}>
            <VATBox label="PA1" title="Customs value of goods imported (postponed accounting)" value={pa1} color="var(--text-muted)" drill
              sub="Import/purchase-side only · €0.00 for domestic-only trading · click to confirm" />
          </div>
          {drillOpen === 'PA1' && (
            <DrillTable title="PA1 — Postponed Accounting Import Detail" rows={pa1DrillRows} mode="vat" expectedSum={pa1}
              emptyMsg="No import journals coded for postponed accounting in this period. PA1 = €0.00 is correct for domestic-only trading. Sales-side journals are excluded by design." />
          )}

          {/* EU fields — always shown, default 0 for domestic-only */}
          <div style={{ marginBottom: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, letterSpacing: "0.04em" }}>INTRA-EU TRANSACTIONS <span style={{ fontWeight: 400, color: "var(--text-faint)" }}>(auto-populates from RC_EU journals; enter manually if applicable — 0 for domestic-only)</span></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
              <EUField label="E1"  title="EU Goods Supplied"         value={e1}  onChange={setE1}  />
              <EUField label="E2"  title="EU Goods Acquired"         value={e2}  onChange={setE2}  />
              <EUField label="ES1" title="EU Services Supplied"      value={es1} onChange={setEs1} />
              <EUField label="ES2" title="EU Services Acquired"      value={es2} onChange={setEs2} />
            </div>
          </div>

          {/* RC / Needs Manual VAT Treatment */}
          {rcExceptions.length > 0 && (
            <div className="card" style={{ marginBottom: 14, borderLeft: "4px solid var(--danger)" }}>
              <div className="card-header" style={{ cursor: "pointer" }} onClick={() => setShowRC(v => !v)}>
                <span className="card-title" style={{ color: "var(--danger)" }}>⚠ Needs Manual VAT Treatment ({rcExceptions.length})</span>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Reverse-charge / RCT items excluded from T1/T2 — declare separately on ROS</span>
                <span style={{ fontSize: 11, color: "var(--text-faint)", marginLeft: "auto" }}>{showRC ? "▲" : "▼"}</span>
              </div>
              {showRC && (
                <div style={{ overflowX: "auto" }}>
                  <table className="gl-table">
                    <thead><tr><th>Date</th><th>Description</th><th>Nominal</th><th style={{ textAlign: "center" }}>VAT Code</th><th className="r">Amount</th><th>Side</th></tr></thead>
                    <tbody>
                      {rcExceptions.map(j => {
                        const acct = j._side === 'sales' ? j.credit_account : j.debit_account;
                        return (
                          <tr key={j.id}>
                            <td style={{ fontFamily: "Source Code Pro,monospace", fontSize: 11 }}>{j.date}</td>
                            <td style={{ fontSize: 12, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={j.description}>{j.description}</td>
                            <td style={{ fontSize: 11, fontFamily: "Source Code Pro,monospace" }}>{acct} · {nomName(acct)}</td>
                            <td style={{ textAlign: "center" }}>
                              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: "rgba(239,68,68,0.1)", color: "var(--danger)" }}>{j.vat_code}</span>
                            </td>
                            <td className="r" style={{ fontFamily: "Source Code Pro,monospace", fontSize: 11 }}>{fmtEUR(Math.abs(Number(j.amount)))}</td>
                            <td>
                              <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "var(--surface-2)", color: "var(--text-muted)" }}>{j._side === 'sales' ? 'Sales' : 'Purchase'}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Missing/NONE code exceptions */}
          {codeExceptions.length > 0 && (
            <div className="card" style={{ marginBottom: 14, borderLeft: "4px solid var(--warn)" }}>
              <div className="card-header" style={{ cursor: "pointer" }} onClick={() => setShowExc(v => !v)}>
                <span className="card-title" style={{ color: "var(--warn)" }}>⚠ Missing VAT Code ({codeExceptions.length})</span>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Journals on VAT-relevant nominals with no VAT code — may affect T1/T2 accuracy</span>
                <span style={{ fontSize: 11, color: "var(--text-faint)", marginLeft: "auto" }}>{showExc ? "▲" : "▼"}</span>
              </div>
              {showExc && (
                <div style={{ overflowX: "auto" }}>
                  <table className="gl-table">
                    <thead><tr><th>Date</th><th>Description</th><th>Nominal</th><th style={{ textAlign: "center" }}>VAT Code</th><th className="r">Amount</th></tr></thead>
                    <tbody>
                      {codeExceptions.map(j => {
                        const acct = j._side === 'sales' ? j.credit_account : j.debit_account;
                        return (
                          <tr key={j.id}>
                            <td style={{ fontFamily: "Source Code Pro,monospace", fontSize: 11 }}>{j.date}</td>
                            <td style={{ fontSize: 12, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={j.description}>{j.description}</td>
                            <td style={{ fontSize: 11, fontFamily: "Source Code Pro,monospace" }}>{acct} · {nomName(acct)}</td>
                            <td style={{ textAlign: "center" }}>
                              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: "var(--warn-dim)", color: "var(--warn)" }}>{j.vat_code || 'missing'}</span>
                            </td>
                            <td className="r" style={{ fontFamily: "Source Code Pro,monospace", fontSize: 11 }}>{fmtEUR(Math.abs(Number(j.amount)))}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Mark as Filed */}
          {!isLocked && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
              {hardBlockCount > 0 && (
                <span style={{ fontSize: 11, color: "var(--danger)" }}>
                  ⚠ {hardBlockCount} item{hardBlockCount !== 1 ? 's' : ''} blocking — see banners above
                </span>
              )}
              {codeExceptions.length > 0 && (
                <span style={{ fontSize: 11, color: "var(--warn)" }}>⚠ {codeExceptions.length} missing VAT code{codeExceptions.length !== 1 ? 's' : ''}</span>
              )}
              {markError && <span style={{ fontSize: 11, color: "var(--danger)" }}>{markError}</span>}
              <button className="btn btn-p btn-sm" onClick={markFiled} disabled={markingFiled || !canFile}>
                {markingFiled ? "Saving…" : "Mark as Filed — Lock Period"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function VATReport({ company, onClose }) {
  const vatPeriods = getVATPeriods(company?.vat_period || 'bimonthly');
  const [loading, setLoading]                   = useState(true);
  const [journals, setJournals]                 = useState([]);
  const [selectedVal, setSelectedVal]           = useState(vatPeriods[0]?.val);
  const [periodLoading, setPeriodLoading]       = useState(false);

  const vatPeriod = vatPeriods.find(p => p.val === selectedVal) || vatPeriods[0];

  useEffect(() => {
    if (!company?.id || !vatPeriod) { setLoading(false); return; }
    (async () => {
      setLoading(true);
      const { data } = await supabase.from('journals')
        .select('*').eq('company_id', company.id)
        .gte('date', vatPeriod.start).lte('date', vatPeriod.end).order('date');
      if (data) setJournals(data);
      setLoading(false);
      setPeriodLoading(false);
    })();
  }, [company?.id, selectedVal]);

  const handleVatPeriodChange = (val) => { setPeriodLoading(true); setSelectedVal(val); };

  let t1 = 0, t2 = 0, e1 = 0, e2 = 0;
  journals.forEach(j => {
    const amt = Number(j.amount);
    if (j.credit_account === '2100') t1 += amt;
    if (j.debit_account  === '2100') t2 += amt;
    if (j.credit_account >= '4000' && j.credit_account < '5000') e1 += amt;
    if (j.debit_account  >= '4000' && j.debit_account  < '5000') e1 -= amt;
    if (j.debit_account  >= '5000' && j.debit_account  < '7000') e2 += amt;
    if (j.credit_account >= '5000' && j.credit_account < '7000') e2 -= amt;
  });
  const t3 = t1 - t2;

  const exportDate = fmtIE(new Date().toISOString().slice(0, 10));
  const slug = vatPeriod.label.replace(/\//g, "-").replace(/ /g, "-");

  const exportCSV = () => downloadCSV(`vat3-${slug}.csv`, [
    ["Ledgrly — VAT3 Return Summary", company?.name || "Company", vatPeriod.label],
    ["VAT Period", `${vatPeriod.start} to ${vatPeriod.end}`],
    ["Due Date", vatPeriod.due],
    ["Exported", exportDate],
    [],
    ["Box", "Description", "Amount (€)"],
    ["T1", "VAT on Sales (Output VAT)", fmtEUR(t1)],
    ["T2", "VAT on Purchases (Input VAT)", fmtEUR(t2)],
    ["T3", "Net VAT Payable (T1 − T2)", fmtEUR(t3)],
    ["E1", "Total Sales (excl. VAT)", fmtEUR(e1)],
    ["E2", "Total Purchases (excl. VAT)", fmtEUR(e2)],
    [],
    ["Note: This is a summary for review purposes. Please verify against your ROS account before filing."],
  ]);

  const VATBox = ({ label, title, value, color, sub }) => (
    <div style={{ background: "var(--white)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "16px 20px", position: "relative", overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: color, borderRadius: "var(--radius) var(--radius) 0 0" }} />
      <div style={{ fontSize: 10, fontFamily: "'Source Code Pro', monospace", fontWeight: 700, color: "var(--dim)", letterSpacing: "0.08em", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 10, lineHeight: 1.4 }}>{title}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{fmtEUR(value)}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>{sub}</div>}
    </div>
  );

  return (
    <div className="card" style={{ marginBottom: 14, borderLeft: "4px solid var(--teal)" }}>
      <div className="card-header">
        <div>
          <span className="card-title">VAT3 Return Summary</span>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, fontFamily: "'Source Code Pro', monospace" }}>
            Due: {vatPeriod.due}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value={selectedVal}
            onChange={e => handleVatPeriodChange(e.target.value)}
            style={{ fontSize: 11, fontFamily: "Source Code Pro, monospace", padding: "3px 7px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", cursor: "pointer" }}
          >
            {vatPeriods.map(p => <option key={p.val} value={p.val}>{p.label}</option>)}
          </select>
          {periodLoading && <span style={{ fontSize: 11, color: "var(--dim)", fontFamily: "Source Code Pro, monospace" }}>…</span>}
          {!loading && <ExportDropdown onCSV={exportCSV} onPrint={() => window.print()} />}
          <button className="btn btn-s btn-sm" onClick={onClose}>✕ Close</button>
        </div>
      </div>
      <div className="print-only card-body">
        <div className="print-title">{company?.name || "Company"} — VAT3 Return</div>
        <div className="print-meta">Period: {vatPeriod.label} · Due: {vatPeriod.due} · Exported: {exportDate}</div>
      </div>
      <div className="card-body">
        {loading ? (
          <div style={{ fontSize: 13, color: "var(--dim)", padding: "16px 0" }}>Loading VAT data…</div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
              <VATBox label="T1" title="VAT on Sales (Output VAT)" value={t1} color="var(--teal)" />
              <VATBox label="T2" title="VAT on Purchases (Input VAT)" value={t2} color="var(--gold)" />
              <VATBox label="T3" title="Net VAT Payable (T1 − T2)" value={t3} color={t3 >= 0 ? "var(--red)" : "var(--green)"} sub={t3 >= 0 ? "Amount due to Revenue" : "Refund due from Revenue"} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <VATBox label="E1" title="Total Sales (excl. VAT)" value={e1} color="var(--teal)" />
              <VATBox label="E2" title="Total Purchases (excl. VAT)" value={e2} color="var(--muted)" />
            </div>
            {journals.length === 0 && (
              <div style={{ fontSize: 13, color: "var(--dim)", marginBottom: 12 }}>
                No journal entries found for {vatPeriod.label}. Post journals to populate VAT figures.
              </div>
            )}
            <div style={{ fontSize: 11, color: "var(--muted)", background: "rgba(184,134,11,0.05)", borderRadius: "var(--radius-sm)", padding: "10px 14px", borderLeft: "3px solid var(--gold)", fontStyle: "italic" }}>
              ⚠ This is a summary for review purposes only. Please verify all figures against your ROS account before filing.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Compliance({ company, onNavigate }) {
  const [settings, setSettings] = useState({
    vat_period:      company?.vat_period      || 'bimonthly',
    year_end_month:  company?.year_end_month  || 12,
    ard_month:       company?.ard_month       || '',
    ard_day:         company?.ard_day         || '',
  });
  const [editing,  setEditing]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [saveErr,  setSaveErr]  = useState(null);
  const [showVAT,  setShowVAT]  = useState(false);
  const [contractRenewals, setContractRenewals] = useState([]);

  useEffect(() => {
    if (!company?.id) return;
    const in90 = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
    supabase
      .from("contracts")
      .select("id,title,counterparty,contract_type,renewal_date,notice_period_days,auto_renews")
      .eq("company_id", company.id)
      .eq("status", "active")
      .not("renewal_date", "is", null)
      .lte("renewal_date", in90)
      .order("renewal_date", { ascending: true })
      .then(({ data }) => { if (data) setContractRenewals(data); })
      .catch(() => {});
  }, [company?.id]);

  const today = new Date(); today.setHours(0,0,0,0);
  const daysDiff  = d => Math.floor((d - today) / 86400000);
  const fmtDate   = d => d.toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });
  const getStatus = d => { const n = daysDiff(d); return n < 0 ? 'overdue' : n <= 14 ? 'soon' : 'upcoming'; };
  const statusCol = s => ({ overdue: 'var(--red)', soon: 'var(--gold)', upcoming: 'var(--teal)' }[s]);
  const statusLbl = s => ({ overdue: 'Overdue', soon: 'Due soon', upcoming: 'Upcoming' }[s]);

  const deadlines = [];

  // P30 — PAYE/PRSI due 14th of following month; show ±2 months (only if PAYE registered)
  if (company?.paye_registered) {
    for (let i = -1; i <= 2; i++) {
      const m = new Date(today.getFullYear(), today.getMonth() + i, 1);
      const due = new Date(today.getFullYear(), today.getMonth() + i + 1, 14);
      if (daysDiff(due) >= -60)
        deadlines.push({ type: "P30", desc: `PAYE/PRSI — ${MONTH_NAMES_LONG[m.getMonth()]} ${m.getFullYear()}`, detail: "Monthly employer payroll return to Revenue", due });
    }
  }

  // VAT3 — bimonthly or monthly (only if VAT registered)
  if (company?.vat_registered) {
    if (settings.vat_period === 'bimonthly') {
      const periods = [
        { m: [0,1], dm: 2 }, { m: [2,3], dm: 4 }, { m: [4,5], dm: 6 },
        { m: [6,7], dm: 8 }, { m: [8,9], dm: 10 }, { m: [10,11], dm: 0, ny: true },
      ];
      for (let y = today.getFullYear() - 1; y <= today.getFullYear() + 1; y++) {
        periods.forEach(p => {
          const due = new Date(p.ny ? y+1 : y, p.dm, 19);
          const d = daysDiff(due);
          if (d >= -60 && d <= 150)
            deadlines.push({ type: "VAT3", desc: `VAT3 Return — ${MONTH_NAMES_SHORT[p.m[0]]}/${MONTH_NAMES_SHORT[p.m[1]]} ${y}`, detail: "Bi-monthly VAT return and payment to Revenue", due });
        });
      }
    } else {
      for (let i = -1; i <= 3; i++) {
        const m = new Date(today.getFullYear(), today.getMonth() + i, 1);
        const due = new Date(today.getFullYear(), today.getMonth() + i + 1, 19);
        const d = daysDiff(due);
        if (d >= -60 && d <= 150)
          deadlines.push({ type: "VAT3", desc: `VAT3 Return — ${MONTH_NAMES_LONG[m.getMonth()]} ${m.getFullYear()}`, detail: "Monthly VAT return and payment to Revenue", due });
      }
    }
  }

  // CT1 — due 23rd day of 9th month after year end
  const yem = Number(settings.year_end_month) || 12;
  for (let y = today.getFullYear() - 1; y <= today.getFullYear() + 1; y++) {
    const due = new Date(y, yem - 1 + 9, 23); // Date handles month overflow
    const d = daysDiff(due);
    if (d >= -60 && d <= 400)
      deadlines.push({ type: "CT1", desc: `Corporation Tax Return — FY${y}`, detail: `Annual CT return for year ending ${MONTH_NAMES_SHORT[yem-1]} ${y}`, due });
  }

  // P35 — Annual employer return due 15 February following the year (only if PAYE registered)
  if (company?.paye_registered) {
    for (let y = today.getFullYear() - 1; y <= today.getFullYear(); y++) {
      const due = new Date(y+1, 1, 15);
      const d = daysDiff(due);
      if (d >= -60 && d <= 365)
        deadlines.push({ type: "P35", desc: `Annual Employer Return — ${y}`, detail: `Annual return of employees and payroll details for ${y}`, due });
    }
  }

  // CRO Annual Return — B1 due 56 days after ARD (only if CRO number set)
  if (company?.cro_number && settings.ard_month && settings.ard_day) {
    const am = Number(settings.ard_month) - 1;
    const ad = Number(settings.ard_day);
    for (let y = today.getFullYear() - 1; y <= today.getFullYear() + 1; y++) {
      const due = new Date(y, am, ad + 56);
      const d = daysDiff(due);
      if (d >= -60 && d <= 400)
        deadlines.push({ type: "CRO B1", desc: `Annual Return — ARD ${ad} ${MONTH_NAMES_SHORT[am]} ${y}`, detail: "B1 Annual Return due 56 days after Annual Return Date", due });
    }
  }

  deadlines.sort((a, b) => a.due - b.due);

  const save = async () => {
    if (!company?.id) return;
    setSaving(true); setSaveErr(null);
    const { error } = await supabase.from('companies').update({
      vat_period: settings.vat_period,
      year_end_month: Number(settings.year_end_month),
      ard_month: settings.ard_month ? Number(settings.ard_month) : null,
      ard_day:   settings.ard_day   ? Number(settings.ard_day)   : null,
    }).eq('id', company.id);
    if (error) setSaveErr(error.message); else setEditing(false);
    setSaving(false);
  };

  return (
    <div className="fade-up">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: "Playfair Display, serif", fontSize: 17, fontWeight: 700, color: "var(--text)", marginBottom: 2 }}>Compliance Calendar</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Irish tax and filing deadlines — VAT3 · P30 · CT1 · P35 · CRO</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-p btn-sm" onClick={() => { setShowVAT(v => !v); setEditing(false); }}>
            {showVAT ? "✕ Close VAT Report" : "⊞ Generate VAT Report"}
          </button>
          <button className="btn btn-s" onClick={() => { setEditing(e => !e); setSaveErr(null); setShowVAT(false); }}>⚙ Settings</button>
        </div>
      </div>

      {editing && (
        <div className="card" style={{ marginBottom: 12, borderLeft: "4px solid var(--teal)" }}>
          <div className="card-header"><span className="card-title" style={{ color: "var(--teal)" }}>Company Tax Settings</span></div>
          <div style={{ padding: "12px 16px 4px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
            <div className="f-group">
              <label className="f-label">VAT Period</label>
              <select className="f-input" value={settings.vat_period} onChange={e => setSettings(p => ({ ...p, vat_period: e.target.value }))}>
                <option value="bimonthly">Bi-monthly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div className="f-group">
              <label className="f-label">Accounting Year End</label>
              <select className="f-input" value={settings.year_end_month} onChange={e => setSettings(p => ({ ...p, year_end_month: e.target.value }))}>
                {MONTH_NAMES_LONG.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
              </select>
            </div>
            <div className="f-group">
              <label className="f-label">CRO ARD Month</label>
              <select className="f-input" value={settings.ard_month} onChange={e => setSettings(p => ({ ...p, ard_month: e.target.value }))}>
                <option value="">Not set</option>
                {MONTH_NAMES_LONG.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
              </select>
            </div>
            <div className="f-group">
              <label className="f-label">CRO ARD Day</label>
              <input className="f-input" type="number" min="1" max="31" value={settings.ard_day} onChange={e => setSettings(p => ({ ...p, ard_day: e.target.value }))} placeholder="e.g. 30" />
            </div>
          </div>
          {saveErr && <div style={{ padding: "0 16px 8px", color: "var(--red)", fontSize: 12 }}>{saveErr}</div>}
          <div style={{ padding: "8px 16px 14px", display: "flex", gap: 8 }}>
            <button className="btn btn-p btn-sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Settings"}</button>
            <button className="btn btn-s btn-sm" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}

      {showVAT && <VATReport company={company} onClose={() => setShowVAT(false)} />}

      <div className="card">
        <div className="card-header">
          <span className="card-title">Upcoming Deadlines</span>
          <div style={{ display: "flex", gap: 14, fontSize: 10, fontFamily: "Source Code Pro, monospace" }}>
            <span style={{ color: "var(--red)" }}>● Overdue</span>
            <span style={{ color: "var(--gold)" }}>● Due ≤14 days</span>
            <span style={{ color: "var(--teal)" }}>● Upcoming</span>
          </div>
        </div>
        <table className="gl-table">
          <thead>
            <tr><th style={{ width: 70 }}>Type</th><th>Description</th><th style={{ width: 200 }}>Detail</th><th className="r" style={{ width: 120 }}>Due Date</th><th className="r" style={{ width: 90 }}>Status</th><th style={{ width: 90 }}></th></tr>
          </thead>
          <tbody>
            {deadlines.map((dl, i) => {
              const s = getStatus(dl.due);
              const diff = daysDiff(dl.due);
              return (
                <tr key={i}>
                  <td><span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)" }}>{dl.type}</span></td>
                  <td style={{ fontWeight: 500 }}>{dl.desc}</td>
                  <td style={{ fontSize: 11, color: "var(--muted)" }}>{dl.detail}</td>
                  <td className="r mono" style={{ color: statusCol(s) }}>{fmtDate(dl.due)}</td>
                  <td className="r" style={{ fontFamily: "Source Code Pro, monospace", fontSize: 10, fontWeight: 700, color: statusCol(s) }}>
                    {diff < 0 ? `${Math.abs(diff)}d overdue` : diff === 0 ? "Today" : `${diff}d`}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {dl.type === 'VAT3' && onNavigate && (
                      <button className="btn btn-s btn-sm" style={{ fontSize: 10 }} onClick={() => onNavigate('vat-returns')}>
                        Open Draft
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {contractRenewals.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-header">
            <span className="card-title">Contract Renewals</span>
            <span style={{ fontSize: 10, color: "var(--gold)", fontFamily: "Source Code Pro, monospace" }}>NEXT 90 DAYS</span>
          </div>
          <table className="gl-table">
            <thead>
              <tr><th>Contract</th><th>Counterparty</th><th>Type</th><th className="r">Renewal Date</th><th className="r">Days</th><th className="r">Notice Period</th><th className="r">Auto-Renews</th></tr>
            </thead>
            <tbody>
              {contractRenewals.map((c, i) => {
                const d = daysDiff(new Date(c.renewal_date));
                const col = d < 0 ? "var(--red)" : d <= 14 ? "var(--red)" : d <= 30 ? "var(--gold)" : "var(--teal)";
                return (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{c.title}</td>
                    <td style={{ color: "var(--muted)", fontSize: 12 }}>{c.counterparty}</td>
                    <td style={{ fontSize: 11, textTransform: "capitalize", color: "var(--dim)" }}>{c.contract_type}</td>
                    <td className="r mono" style={{ color: col }}>{fmtDate(new Date(c.renewal_date))}</td>
                    <td className="r mono" style={{ fontWeight: 700, color: col }}>{d < 0 ? `${Math.abs(d)}d ago` : `${d}d`}</td>
                    <td className="r" style={{ fontSize: 12, color: "var(--muted)" }}>{c.notice_period_days ? `${c.notice_period_days} days` : "—"}</td>
                    <td className="r"><span style={{ fontSize: 10, fontFamily: "Source Code Pro, monospace", color: c.auto_renews ? "var(--teal)" : "var(--dim)" }}>{c.auto_renews ? "YES" : "NO"}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


// ─── CONTRACTS PAGE ──────────────────────────────────────────────────────────
function Contracts({ companyName = "Company", companyId }) {
  const { user } = useUser();
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState(null);
  const [showForm, setShowForm]   = useState(false);
  const [editId, setEditId]       = useState(null);
  const [editForm, setEditForm]   = useState({});
  const [saveError, setSaveError] = useState(null);

  const today = new Date(); today.setHours(0,0,0,0);
  const daysFrom = d => d ? Math.floor((new Date(d) - today) / 86400000) : null;
  const fmtD = d => d ? new Date(d).toLocaleDateString("en-IE", { day: "2-digit", month: "short", year: "numeric" }) : "—";
  const typeIcon = t => ({ supplier:"🏭", customer:"🤝", employment:"👤", lease:"🏢", service:"⚙️", other:"📄" }[t] || "📄");
  const CONTRACT_TYPES = ["supplier","customer","employment","lease","service","other"];
  const CONTRACT_STATUSES = ["active","pending","expired","terminated"];

  const emptyForm = () => ({
    title:"", counterparty:"", contract_type:"supplier", value:"",
    start_date: today.toISOString().slice(0,10), end_date:"",
    renewal_date:"", notice_period_days:"30", status:"active", auto_renews:false, notes:"",
  });
  const [form, setForm] = useState(emptyForm());
  const ff = f => e => setForm(p => ({ ...p, [f]: e.target.value }));

  useEffect(() => {
    if (!companyId) { setContracts([]); return; }
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("contracts").select("*").eq("company_id", companyId)
          .order("renewal_date", { ascending: true, nullsFirst: false });
        if (error) throw error;
        if (data) setContracts(data);
      } catch (err) { console.error("[contracts]", err.message); }
      setLoading(false);
    })();
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const sortedByRenewal = cs => [...cs].sort((a, b) => {
    if (!a.renewal_date) return 1; if (!b.renewal_date) return -1;
    return new Date(a.renewal_date) - new Date(b.renewal_date);
  });

  const save = async () => {
    if (!form.title || !form.counterparty) return;
    setSaveError(null);
    let cid;
    try { cid = requireCompanyId(companyId); } catch (e) { setSaveError(e.message); return; }
    const payload = {
      company_id: cid, title: form.title, counterparty: form.counterparty,
      contract_type: form.contract_type,
      value: form.value ? parseFloat(form.value) : null,
      start_date: form.start_date || null, end_date: form.end_date || null,
      renewal_date: form.renewal_date || null,
      notice_period_days: form.notice_period_days ? parseInt(form.notice_period_days) : null,
      status: form.status, auto_renews: form.auto_renews === true || form.auto_renews === "true",
      notes: form.notes,
    };
    const { data: ins, error } = await supabase.from("contracts").insert(payload).select().single();
    if (error) { setSaveError(`Save failed: ${error.message}`); return; }
    setContracts(p => sortedByRenewal([...p, ins]));
    setForm(emptyForm()); setShowForm(false);
  };

  const saveEdit = async () => {
    if (!editId || !companyId) return;
    const { data: upd, error } = await supabase.from("contracts").update({
      title: editForm.title, counterparty: editForm.counterparty, contract_type: editForm.contract_type,
      value: editForm.value ? parseFloat(editForm.value) : null,
      start_date: editForm.start_date || null, end_date: editForm.end_date || null,
      renewal_date: editForm.renewal_date || null,
      notice_period_days: editForm.notice_period_days ? parseInt(editForm.notice_period_days) : null,
      auto_renews: editForm.auto_renews === true || editForm.auto_renews === "true",
      notes: editForm.notes,
    }).eq("id", editId).select().single();
    if (!error && upd) { setContracts(p => sortedByRenewal(p.map(c => c.id === editId ? upd : c))); setEditId(null); }
  };

  const terminate = async (id, e) => {
    e.stopPropagation();
    const { error } = await supabase.from("contracts").update({ status: "terminated" }).eq("id", id);
    if (!error) { setContracts(p => p.map(c => c.id === id ? { ...c, status: "terminated" } : c)); if (selected === id) setSelected(null); }
  };

  const exportCSV = () => {
    downloadCSV(`contracts-${fmtIE(today.toISOString().slice(0,10)).replace(/\//g,"-")}.csv`, [
      ["Title","Counterparty","Type","Value","Start","End","Renewal","Notice Days","Status","Auto-renews","Notes"],
      ...contracts.map(c => [c.title, c.counterparty, c.contract_type, c.value ?? "", fmtIE(c.start_date), fmtIE(c.end_date), fmtIE(c.renewal_date), c.notice_period_days ?? "", c.status, c.auto_renews ? "Yes" : "No", c.notes || ""]),
    ]);
  };

  const active      = contracts.filter(c => c.status === "active");
  const expiring30  = active.filter(c => { const d = daysFrom(c.end_date); return d !== null && d >= 0 && d <= 30; });
  const expired     = contracts.filter(c => c.status === "expired");
  const totalValue  = active.reduce((s, c) => s + (c.value || 0), 0);
  const renewingSoon = active.filter(c => { const d = daysFrom(c.renewal_date); return d !== null && d >= 0 && d <= 30; });

  const statusPill = s => ({
    active:["var(--teal)","rgba(29,107,114,0.1)"], pending:["var(--gold)","rgba(184,134,11,0.1)"],
    expired:["var(--red)","rgba(220,38,38,0.1)"],  terminated:["var(--dim)","rgba(107,114,128,0.09)"],
  }[s] || ["var(--muted)","var(--surface2)"]);

  const FormRow = ({ c, ef, setEf }) => (
    <>
      <div className="f-row">
        <div className="f-group"><label className="f-label">Title</label><input className="f-input" value={ef.title} onChange={e => setEf(p=>({...p,title:e.target.value}))} placeholder="e.g. Office Lease" /></div>
        <div className="f-group"><label className="f-label">Counterparty</label><input className="f-input" value={ef.counterparty} onChange={e => setEf(p=>({...p,counterparty:e.target.value}))} placeholder="Supplier or client" /></div>
        <div className="f-group"><label className="f-label">Type</label><select className="f-input" value={ef.contract_type} onChange={e => setEf(p=>({...p,contract_type:e.target.value}))}>{CONTRACT_TYPES.map(t=><option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}</select></div>
      </div>
      <div className="f-row" style={{gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr"}}>
        <div className="f-group"><label className="f-label">Value (€)</label><input className="f-input" type="number" value={ef.value} onChange={e => setEf(p=>({...p,value:e.target.value}))} placeholder="0" /></div>
        <div className="f-group"><label className="f-label">Start Date</label><input className="f-input" type="date" value={ef.start_date} onChange={e => setEf(p=>({...p,start_date:e.target.value}))} /></div>
        <div className="f-group"><label className="f-label">End Date</label><input className="f-input" type="date" value={ef.end_date} onChange={e => setEf(p=>({...p,end_date:e.target.value}))} /></div>
        <div className="f-group"><label className="f-label">Renewal Date</label><input className="f-input" type="date" value={ef.renewal_date} onChange={e => setEf(p=>({...p,renewal_date:e.target.value}))} /></div>
        <div className="f-group"><label className="f-label">Notice (days)</label><input className="f-input" type="number" value={ef.notice_period_days} onChange={e => setEf(p=>({...p,notice_period_days:e.target.value}))} placeholder="30" /></div>
      </div>
      <div className="f-row" style={{gridTemplateColumns:"1fr 1fr 2fr"}}>
        {c && <div className="f-group"><label className="f-label">Status</label><select className="f-input" value={ef.status} onChange={e => setEf(p=>({...p,status:e.target.value}))}>{CONTRACT_STATUSES.map(s=><option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}</select></div>}
        <div className="f-group"><label className="f-label">Auto-Renews</label><select className="f-input" value={String(ef.auto_renews)} onChange={e => setEf(p=>({...p,auto_renews:e.target.value==="true"}))}><option value="false">No</option><option value="true">Yes</option></select></div>
        <div className="f-group"><label className="f-label">Notes</label><input className="f-input" value={ef.notes} onChange={e => setEf(p=>({...p,notes:e.target.value}))} placeholder="Optional…" /></div>
      </div>
    </>
  );

  return (
    <div className="fade-up">
      {/* KPIs */}
      <div className="kpi-grid">
        {[
          { label:"Active Contracts",   value: active.length,     sub:"currently active",        c:"var(--teal)"  },
          { label:"Expiring (30 days)", value: expiring30.length, sub:"review or renew",         c:"var(--gold)"  },
          { label:"Expired",            value: expired.length,    sub:"require attention",       c:"var(--red)"   },
          { label:"Total Active Value", value: fmt(totalValue),   sub:"across active contracts", c:"var(--text)"  },
        ].map((k,i) => (
          <div key={i} className="kpi-card" style={{"--tc":k.c}}>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value" style={{color:k.c}}>{k.value}</div>
            <div className="kpi-sub">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Renewal alerts */}
      {renewingSoon.map(c => {
        const d = daysFrom(c.renewal_date);
        const noticeActive = c.notice_period_days && d <= c.notice_period_days;
        return (
          <div key={c.id} style={{padding:"10px 16px",marginBottom:8,background:"rgba(184,134,11,0.07)",border:"1px solid rgba(184,134,11,0.22)",borderLeft:"4px solid var(--gold)",borderRadius:"var(--radius-sm)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:16}}>⚠</span>
              <div>
                <div style={{fontSize:13,fontWeight:600,color:"var(--gold)"}}>{c.title} — renewal in {d} day{d!==1?"s":""}</div>
                <div style={{fontSize:11,color:"var(--muted)",marginTop:2,fontFamily:"Source Code Pro, monospace"}}>
                  {c.counterparty} · {fmtD(c.renewal_date)}
                  {c.notice_period_days ? ` · ${c.notice_period_days}d notice${noticeActive?" ⚠ IN NOTICE WINDOW":""}` : ""}
                </div>
              </div>
            </div>
            {c.auto_renews && <span style={{fontSize:10,fontFamily:"Source Code Pro, monospace",color:"var(--teal)",background:"rgba(29,107,114,0.09)",padding:"2px 9px",borderRadius:20,border:"1px solid rgba(29,107,114,0.18)",whiteSpace:"nowrap"}}>AUTO-RENEWS</span>}
          </div>
        );
      })}

      {/* Toolbar */}
      <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginBottom:10}}>
        {contracts.length > 0 && <button className="btn btn-s" onClick={exportCSV}>⬇ Export CSV</button>}
        <button className="btn btn-p" onClick={() => { setShowForm(v=>!v); setSaveError(null); setEditId(null); }}>
          {showForm ? "Cancel" : "+ Add Contract"}
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="jnl-form" style={{marginBottom:12}}>
          <div className="jnl-fh"><span className="jnl-ft">New Contract</span><button className="btn btn-s btn-sm" onClick={()=>setShowForm(false)}>Cancel</button></div>
          <div className="jnl-fb">
            <FormRow c={null} ef={form} setEf={setForm} />
            <div className="f-row" style={{gridTemplateColumns:"1fr 1fr"}}>
              <div className="f-group"><label className="f-label">Status</label><select className="f-input" value={form.status} onChange={ff("status")}>{CONTRACT_STATUSES.map(s=><option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}</select></div>
            </div>
            {saveError && <div style={{marginBottom:10,fontSize:12,color:"var(--red)",background:"rgba(220,38,38,0.06)",border:"1px solid rgba(220,38,38,0.2)",borderRadius:2,padding:"7px 11px"}}>{saveError}</div>}
            <div style={{display:"flex",gap:8}}>
              <button className="btn btn-p" onClick={save} disabled={!form.title||!form.counterparty} style={{opacity:(!form.title||!form.counterparty)?0.42:1}}>Save Contract</button>
              <button className="btn btn-s" onClick={()=>setShowForm(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Contract list */}
      <div className="card full-col">
        <div className="card-header">
          <span className="card-title">Contracts Ledger</span>
          <span style={{fontSize:10,color:"var(--dim)",fontFamily:"Source Code Pro, monospace"}}>SORTED BY RENEWAL DATE</span>
        </div>
        {loading ? (
          <div style={{padding:"20px 16px",fontSize:13,color:"var(--dim)"}}>Loading contracts…</div>
        ) : contracts.length === 0 ? (
          <div style={{padding:"32px 16px",fontSize:13,color:"var(--dim)",textAlign:"center"}}>No contracts yet — add one above.</div>
        ) : (
          <table className="gl-table">
            <thead>
              <tr><th>Title</th><th>Counterparty</th><th>Type</th><th>Renewal</th><th>End Date</th><th>Days</th><th>Status</th><th className="r">Value</th><th></th></tr>
            </thead>
            <tbody>
              {contracts.map(c => {
                const rd = daysFrom(c.renewal_date), ed = daysFrom(c.end_date);
                const dd = rd !== null ? rd : ed;
                const dc = dd === null ? "var(--dim)" : dd < 0 ? "var(--red)" : dd <= 30 ? "var(--gold)" : "var(--teal)";
                const [sc,sbg] = statusPill(c.status);
                return (
                  <tr key={c.id} style={{cursor:"pointer",opacity:c.status==="terminated"?0.5:1}}
                    onClick={() => setSelected(selected===c.id ? null : c.id)}>
                    <td style={{fontWeight:500}}><span style={{marginRight:6}}>{typeIcon(c.contract_type)}</span>{c.title}</td>
                    <td style={{color:"var(--muted)",fontSize:12}}>{c.counterparty}</td>
                    <td style={{fontSize:11,textTransform:"capitalize",color:"var(--dim)"}}>{c.contract_type}</td>
                    <td className="mono" style={{color:rd!==null&&rd<=30?"var(--gold)":"inherit"}}>{fmtD(c.renewal_date)}</td>
                    <td className="mono" style={{color:ed!==null&&ed<0?"var(--red)":"inherit"}}>{fmtD(c.end_date)}</td>
                    <td>
                      {dd !== null ? (
                        <><div style={{fontFamily:"Source Code Pro, monospace",fontSize:12,fontWeight:700,color:dc}}>{dd<0?`${Math.abs(dd)}d ago`:`${dd}d`}</div>
                        <div className="inv-days-bar"><div className="inv-days-fill" style={{width:`${Math.min(Math.abs(dd)/90*100,100)}%`,background:dc}}/></div></>
                      ) : <span style={{fontSize:11,color:"var(--dim)"}}>—</span>}
                    </td>
                    <td><span className="pill" style={{color:sc,background:sbg}}>{c.status}</span></td>
                    <td className="r mono" style={{fontWeight:600}}>{c.value ? fmt(c.value) : "—"}</td>
                    <td onClick={e=>e.stopPropagation()} style={{paddingRight:10}}>
                      <div style={{display:"flex",gap:5}}>
                        <button className="btn btn-s btn-sm" onClick={() => { setEditId(c.id); setEditForm({...c,value:c.value??"",start_date:c.start_date??"",end_date:c.end_date??"",renewal_date:c.renewal_date??"",notice_period_days:c.notice_period_days??"",notes:c.notes??""}); setSelected(c.id); setShowForm(false); }}>Edit</button>
                        {c.status !== "terminated" && <button className="btn btn-d btn-sm" onClick={e=>terminate(c.id,e)}>Terminate</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Expanded detail / inline edit */}
        {selected && (() => {
          const c = contracts.find(x => x.id === selected);
          if (!c) return null;
          return (
            <div style={{padding:"14px 18px",background:"rgba(26,39,68,0.02)",borderTop:"1px solid var(--border)"}}>
              {editId === c.id ? (
                <>
                  <div style={{fontSize:11,color:"var(--teal)",fontFamily:"Source Code Pro, monospace",fontWeight:700,marginBottom:12}}>EDITING — {c.title}</div>
                  <FormRow c={c} ef={editForm} setEf={setEditForm} />
                  <div style={{display:"flex",gap:8}}>
                    <button className="btn btn-p btn-sm" onClick={saveEdit}>Save Changes</button>
                    <button className="btn btn-s btn-sm" onClick={()=>setEditId(null)}>Cancel</button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{fontSize:11,color:"var(--dim)",fontFamily:"Source Code Pro, monospace",marginBottom:10}}>CONTRACT DETAILS — {c.title}</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:14,marginBottom:c.notes?12:0}}>
                    {[
                      ["TYPE", `${typeIcon(c.contract_type)} ${c.contract_type}`],
                      ["START DATE", fmtD(c.start_date)],
                      ["NOTICE PERIOD", c.notice_period_days ? `${c.notice_period_days} days` : "—"],
                      ["AUTO-RENEWS", c.auto_renews ? "Yes" : "No"],
                    ].map(([lbl,val],i) => (
                      <div key={i}><div style={{fontSize:10,color:"var(--dim)",fontFamily:"Source Code Pro, monospace",marginBottom:2}}>{lbl}</div><div style={{fontSize:12,textTransform:"capitalize",color:lbl==="AUTO-RENEWS"&&c.auto_renews?"var(--teal)":undefined}}>{val}</div></div>
                    ))}
                  </div>
                  {c.notes && <div><div style={{fontSize:10,color:"var(--dim)",fontFamily:"Source Code Pro, monospace",marginBottom:2}}>NOTES</div><div style={{fontSize:12,color:"var(--muted)",lineHeight:1.5}}>{c.notes}</div></div>}
                </>
              )}
            </div>
          );
        })()}
      </div>

      {renewingSoon.length > 0 && (
        <div style={{padding:"11px 16px",background:"rgba(29,107,114,0.05)",border:"1px solid rgba(29,107,114,0.15)",borderRadius:"var(--radius-sm)",fontSize:12,color:"var(--teal)",display:"flex",alignItems:"center",gap:8}}>
          <span>📅</span>
          <span>{renewingSoon.length} contract renewal{renewingSoon.length!==1?"s":""} due within 30 days also appear in the <strong>Compliance</strong> calendar.</span>
        </div>
      )}
    </div>
  );
}

function SPill({ status }) {
  const m = {
    escalated: { bg: "rgba(139,32,32,0.09)", color: "#8b2020" },
    chased: { bg: "rgba(26,92,53,0.09)", color: "#1a5c35" },
    pending: { bg: "rgba(26,39,68,0.07)", color: "#1a2744" },
    "prep-ready": { bg: "rgba(26,92,53,0.09)", color: "#1a5c35" },
    "action-needed": { bg: "rgba(139,32,32,0.09)", color: "#8b2020" },
    upcoming: { bg: "rgba(107,101,96,0.09)", color: "#6b6560" },
    posted: { bg: "rgba(26,92,53,0.09)", color: "#1a5c35" },
    draft: { bg: "rgba(184,134,11,0.09)", color: "#b8860b" },
  };
  const s = m[status] || m.pending;
  return <span className="pill" style={{ background: s.bg, color: s.color }}>{status.replace("-", " ")}</span>;
}

// Fetches all filed VAT return periods for a company (cheap — at most ~24 rows/year).
// Returns array of { period_start, period_end, filed_at }.
async function getLockedPeriods(companyId) {
  const { data } = await supabase
    .from('vat_returns')
    .select('period_start, period_end, filed_at')
    .eq('company_id', companyId)
    .eq('status', 'filed');
  return data || [];
}

// Returns true if `date` (ISO string) falls inside any locked period.
function isDateLocked(date, lockedPeriods) {
  return lockedPeriods.some(p => date >= p.period_start && date <= p.period_end);
}

// Single-date check used by the manual journal form.
async function isPeriodLocked(companyId, date) {
  const { data } = await supabase
    .from('vat_returns')
    .select('filed_at')
    .eq('company_id', companyId)
    .eq('status', 'filed')
    .lte('period_start', date)
    .gte('period_end', date)
    .limit(1);
  if (data?.length) return { locked: true, filedAt: data[0].filed_at };
  return { locked: false, filedAt: null };
}

// Evaluates checklist auto-conditions and updates the DB in-place.
// Returns an updated copy of `items` with checked/completed_by adjusted.
async function runChecklistAutoEval(companyId, periodStart, periodEnd, items) {
  const condItems = items.filter(i => i.completion_condition && !i.pinned_manual);
  if (!condItems.length) return items;

  const [payrollRes, vatRes, reconRes] = await Promise.all([
    supabase.from('journals').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .in('debit_account', ['6000', '5300'])
      .gte('date', periodStart).lte('date', periodEnd),
    supabase.from('vat_returns').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .lte('period_start', periodEnd).gte('period_end', periodStart),
    supabase.from('bank_transactions').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).eq('reconciled', true)
      .gte('date', periodStart).lte('date', periodEnd),
  ]);

  const condResults = {
    payroll_journals_posted: (payrollRes.count ?? 0) > 0,
    vat3_return_prepared:    (vatRes.count ?? 0) > 0,
    bank_recon_complete:     (reconRes.count ?? 0) > 0,
  };

  const dbUpdates = [];
  const updated = items.map(item => {
    if (!item.completion_condition || item.pinned_manual) return item;
    const should = condResults[item.completion_condition] ?? false;
    if (should && !item.checked) {
      dbUpdates.push({ id: item.id, checked: true, completed_by: 'system' });
      return { ...item, checked: true, completed_by: 'system' };
    }
    if (!should && item.checked && item.completed_by === 'system') {
      dbUpdates.push({ id: item.id, checked: false, completed_by: null });
      return { ...item, checked: false, completed_by: null };
    }
    return item;
  });

  await Promise.all(dbUpdates.map(u =>
    supabase.from('checklists')
      .update({ checked: u.checked, completed_by: u.completed_by })
      .eq('id', u.id)
  ));

  return updated;
}

const DEFAULT_DASHBOARD_LAYOUT = [
  { id: 'work-queue',    visible: true },
  { id: 'cash-position', visible: true },
  { id: 'bank-health',   visible: true },
  { id: 'compliance',    visible: true },
  { id: 'month-end',     visible: true },
  { id: 'automation',    visible: true },
  { id: 'ai-insights',   visible: true },
];
const TILE_META = {
  'work-queue':    { label: 'Work Queue',    row: 'large' },
  'cash-position': { label: 'Cash Position', row: 'large' },
  'bank-health':   { label: 'Bank Health',   row: 'small' },
  'compliance':    { label: 'Compliance',    row: 'small' },
  'month-end':     { label: 'Month End',     row: 'small' },
  'automation':    { label: 'Automation',    row: 'small' },
  'ai-insights':   { label: 'AI Insights',   row: 'small' },
};

function Overview({ period, selPeriod, setSelPeriod, appCurPeriod, companyId, company, onNavigate, recurringPosted, recurringSkipped, onOpenWizard, onDismissGetStarted }) {
  const { user } = useUser();
  const [loading, setLoading]               = useState(true);
  const [btSparkline, setBtSparkline]       = useState([]);
  const [currentBalance, setCurrentBalance] = useState(null);
  const [overdueAR, setOverdueAR]           = useState([]);
  const [pendingExpenses, setPendingExpenses] = useState(0);
  const [checklistData, setChecklistData]   = useState({ total: 0, done: 0 });
  const [monthlyBurn, setMonthlyBurn]       = useState(null);
  const [hasJournalData, setHasJournalData] = useState(false);
  const [uncategorised, setUncategorised]   = useState(0);
  const [payrollPct, setPayrollPct]         = useState(0);
  const [aiInsights, setAiInsights]         = useState([]);
  const [checklistItems, setChecklistItems] = useState([]);
  const [automationStats, setAutomationStats] = useState({ total: 0, processed: 0, review: 0 });
  const [reconcStats, setReconcStats]         = useState({ suggested: 0, balance: 0, autoCount: 0, avgConf: 0 });
  const [vatFiledSet, setVatFiledSet]         = useState(new Set());
  const [layout, setLayout]                  = useState(DEFAULT_DASHBOARD_LAYOUT);
  const [editLayout, setEditLayout]          = useState(false);
  const [dragId, setDragId]                  = useState(null);
  const [dragOverId, setDragOverId]          = useState(null);

  const { healthy: bookHealthy } = useHealthy(companyId);

  const baseCurrency = company?.base_currency || company?.currency || "EUR";
  // Shadow module-level fmt/fmtK so all displays in this component respect base_currency.
  const fmt  = (n) => fmtCurrency(n, baseCurrency);
  const fmtK = (n) => fmtCurrencyK(n, baseCurrency);

  const curPeriod    = appCurPeriod;
  const isHistorical = selPeriod !== curPeriod;
  const [selYear, selMo] = selPeriod.split('-').map(Number);
  const periodStart    = `${selPeriod}-01`;
  const periodEnd      = new Date(selYear, selMo, 0).toISOString().slice(0, 10);
  const chkPeriodKey   = new Date(selYear, selMo - 1, 1).toLocaleDateString("en-IE", { month: "long", year: "numeric" });
  const selPeriodLabel = chkPeriodKey;


  useEffect(() => {
    if (!companyId) { setLoading(false); return; }
    (async () => {
      setLoading(true);
      const today = new Date().toISOString().slice(0, 10);

      const [btLatest, btRecent, overdueRes, expRes, chkRes, jnlRes] = await Promise.all([
        // Latest balance as of the end of the selected period
        supabase.from('bank_transactions')
          .select('date, balance, created_at')
          .eq('company_id', companyId)
          .lte('date', periodEnd)
          .order('date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(1),
        // Sparkline: rows within the selected month, chronological
        supabase.from('bank_transactions')
          .select('date, amount, balance, nominal_account')
          .eq('company_id', companyId)
          .gte('date', periodStart)
          .lte('date', periodEnd)
          .order('date', { ascending: false })
          .limit(200),
        supabase.from('invoices')
          .select('id, client, invoice_ref, amount, due_date')
          .eq('company_id', companyId)
          .lt('due_date', isHistorical ? periodEnd : today)
          .neq('status', 'paid')
          .order('due_date'),
        supabase.from('expenses')
          .select('id')
          .eq('company_id', companyId)
          .eq('status', 'pending'),
        // Checklist for the selected period using long-format key
        supabase.from('checklists')
          .select('id, checked, item_label, completion_condition, pinned_manual, completed_by')
          .eq('company_id', companyId)
          .eq('period', chkPeriodKey)
          .order('created_at'),
        // Journals within the selected month for burn rate + insights
        supabase.from('journals')
          .select('debit_account, amount, date')
          .eq('company_id', companyId)
          .gte('date', periodStart)
          .lte('date', periodEnd),
      ]);

      console.log('[Overview] btLatest result:', btLatest.data, 'error:', btLatest.error);
      if (btLatest.data && btLatest.data.length > 0) {
        const bal = Number(btLatest.data[0].balance);
        console.log('[Overview] currentBalance set to:', bal);
        setCurrentBalance(isNaN(bal) ? null : bal);
      } else {
        console.log('[Overview] no bank_transactions rows for company_id:', companyId, 'periodEnd:', periodEnd);
      }

      console.log('[Overview] btRecent rows:', btRecent.data?.length, 'error:', btRecent.error);
      if (btRecent.data && btRecent.data.length > 0) {
        setBtSparkline([...btRecent.data].reverse());
        setUncategorised(btRecent.data.filter(r => r.nominal_account === '6600').length);
      } else {
        setBtSparkline([]);
        setUncategorised(0);
      }

      if (overdueRes.data) setOverdueAR(overdueRes.data.slice(0, 5));
      if (expRes.data)     setPendingExpenses(expRes.data.length);
      if (chkRes.data) {
        // Fire auto-eval silently; update state when it resolves
        runChecklistAutoEval(companyId, periodStart, periodEnd, chkRes.data).then(evaluated => {
          setChecklistData({ total: evaluated.length, done: evaluated.filter(i => i.checked).length });
          setChecklistItems(evaluated);
        });
      }

      if (jnlRes.data) {
        setHasJournalData(true);
        const expJnls     = jnlRes.data.filter(j => j.debit_account >= '5000' && j.debit_account < '7000');
        const payrollJnls = jnlRes.data.filter(j => j.debit_account === '6000');
        const totExp = expJnls.reduce((s, j) => s + Math.abs(Number(j.amount)), 0);
        const totPay = payrollJnls.reduce((s, j) => s + Math.abs(Number(j.amount)), 0);
        setMonthlyBurn(totExp > 0 ? totExp : 0);
        setPayrollPct(totExp > 0 ? (totPay / totExp) * 100 : 0);
      } else {
        setHasJournalData(false);
      }
      setLoading(false);
    })();
  }, [companyId, selPeriod]); // eslint-disable-line react-hooks/exhaustive-deps

  // All-time automation stats (not period-scoped)
  useEffect(() => {
    if (!companyId) return;
    supabase.from('bank_transactions')
      .select('nominal_account')
      .eq('company_id', companyId)
      .then(({ data }) => {
        if (!data) return;
        const total   = data.length;
        const review  = data.filter(r => !r.nominal_account || r.nominal_account === '6600').length;
        setAutomationStats({ total, processed: total - review, review });
      });
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!companyId) return;
    Promise.all([
      supabase.from('bank_matches').select('*', { count: 'exact', head: true }).eq('company_id', companyId).eq('status', 'suggested'),
      supabase.from('bank_transactions').select('amount').eq('company_id', companyId).eq('reconciled', false).gte('date', periodStart).lte('date', periodEnd),
      supabase.from('bank_matches').select('confidence').eq('company_id', companyId).eq('status', 'confirmed').eq('matched_by', 'auto').gte('confirmed_at', periodStart).lte('confirmed_at', periodEnd + 'T23:59:59'),
    ]).then(([{ count: suggested }, { data: unrecTxns }, { data: autoMatches }]) => {
      const balance   = (unrecTxns   || []).reduce((s, t) => s + Math.abs(Number(t.amount || 0)), 0);
      const autoCount = (autoMatches || []).length;
      const avgConf   = autoCount > 0 ? Math.round((autoMatches || []).reduce((s, m) => s + Number(m.confidence || 0), 0) / autoCount) : 0;
      setReconcStats({ suggested: suggested || 0, balance, autoCount, avgConf });
    }).catch(() => {});
  }, [companyId, selPeriod]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!companyId) return;
    supabase.from('vat_returns').select('period_val').eq('company_id', companyId).eq('status', 'filed')
      .then(({ data }) => { if (data) setVatFiledSet(new Set(data.map(r => r.period_val))); });
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load persisted dashboard layout for this user
  useEffect(() => {
    if (!user?.id) return;
    supabase.from('user_dashboard_layouts')
      .select('layout')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data?.layout?.length) return;
        // Merge: keep saved order+visibility; append any tiles added since layout was saved
        const saved    = data.layout;
        const savedIds = new Set(saved.map(t => t.id));
        const merged   = [
          ...saved.filter(t => DEFAULT_DASHBOARD_LAYOUT.some(d => d.id === t.id)),
          ...DEFAULT_DASHBOARD_LAYOUT.filter(d => !savedIds.has(d.id)),
        ];
        setLayout(merged);
      });
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fix 4: rule-based insights using specific signals
  useEffect(() => {
    if (loading) return;
    const ins = [];
    if (payrollPct > 40)
      ins.push(`Payroll is your largest cost at ${Math.round(payrollPct)}% of expenses`);
    if (overdueAR.length > 0) {
      const tot = overdueAR.reduce((s, r) => s + Number(r.amount), 0);
      ins.push(`${overdueAR.length} invoice${overdueAR.length > 1 ? 's' : ''} overdue totalling ${fmtEUR(tot)}`);
    }
    if (currentBalance !== null && monthlyBurn > 0 && (currentBalance / monthlyBurn) < 3)
      ins.push("Cash runway is under 3 months — review expenses");
    if (ins.length === 0) ins.push("No unusual activity detected this period");
    setAiInsights(ins.slice(0, 3));
  }, [loading, payrollPct, overdueAR, currentBalance, monthlyBurn]);

  // Compliance deadlines (same logic as Compliance component)
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const daysDiff = d => Math.floor((d - today) / 86400000);
  const cs = {
    vat_period:      company?.vat_period      || 'bimonthly',
    year_end_month:  company?.year_end_month  || 12,
    ard_month:       company?.ard_month       || '',
    ard_day:         company?.ard_day         || '',
    vat_registered:  company?.vat_registered  ?? true,
    paye_registered: company?.paye_registered ?? true,
    cro_number:      company?.cro_number      || null,
  };
  const deadlines = [];
  if (cs.paye_registered) {
    for (let i = 0; i <= 3; i++) {
      const m   = new Date(today.getFullYear(), today.getMonth() + i, 1);
      const due = new Date(today.getFullYear(), today.getMonth() + i + 1, 14);
      if (daysDiff(due) >= -14) deadlines.push({ type: "P30", desc: `PAYE/PRSI — ${MONTH_NAMES_SHORT[m.getMonth()]}`, due });
    }
  }
  if (cs.vat_registered) {
    if (cs.vat_period === 'bimonthly') {
      const vp = [{ m:[0,1],dm:2 },{ m:[2,3],dm:4 },{ m:[4,5],dm:6 },{ m:[6,7],dm:8 },{ m:[8,9],dm:10 },{ m:[10,11],dm:0,ny:true }];
      for (let y = today.getFullYear(); y <= today.getFullYear() + 1; y++) {
        vp.forEach(p => {
          const due = new Date(p.ny ? y+1 : y, p.dm, 19);
          const d = daysDiff(due);
          if (d >= -14 && d <= 150) deadlines.push({ type: "VAT3", desc: `VAT3 — ${MONTH_NAMES_SHORT[p.m[0]]}/${MONTH_NAMES_SHORT[p.m[1]]}`, due });
        });
      }
    } else {
      for (let i = 0; i <= 3; i++) {
        const m   = new Date(today.getFullYear(), today.getMonth() + i, 1);
        const due = new Date(today.getFullYear(), today.getMonth() + i + 1, 19);
        const d   = daysDiff(due);
        if (d >= -14 && d <= 150) deadlines.push({ type: "VAT3", desc: `VAT3 — ${MONTH_NAMES_SHORT[m.getMonth()]}`, due });
      }
    }
  }
  const yem = Number(cs.year_end_month) || 12;
  for (let y = today.getFullYear() - 1; y <= today.getFullYear() + 1; y++) {
    const due = new Date(y, yem - 1 + 9, 23);
    const d   = daysDiff(due);
    if (d >= -14 && d <= 400) deadlines.push({ type: "CT1", desc: `Corp Tax — FY${y}`, due });
  }
  if (cs.paye_registered) {
    for (let y = today.getFullYear() - 1; y <= today.getFullYear(); y++) {
      const due = new Date(y + 1, 1, 15);
      const d   = daysDiff(due);
      if (d >= -14 && d <= 365) deadlines.push({ type: "P35", desc: `Annual Employer — ${y}`, due });
    }
  }
  if (cs.cro_number && cs.ard_month && cs.ard_day) {
    const am = Number(cs.ard_month) - 1, ad = Number(cs.ard_day);
    for (let y = today.getFullYear(); y <= today.getFullYear() + 1; y++) {
      const due = new Date(y, am, ad + 56);
      const d   = daysDiff(due);
      if (d >= -14 && d <= 400) deadlines.push({ type: "CRO B1", desc: `Annual Return`, due });
    }
  }
  deadlines.sort((a, b) => a.due - b.due);
  // For historical periods show deadlines that fell in that month; otherwise next 3 upcoming
  const next3 = isHistorical
    ? deadlines.filter(d => {
        const ds = d.due.toISOString().slice(0, 10);
        return ds >= periodStart && ds <= periodEnd;
      })
    : deadlines.filter(d => daysDiff(d.due) >= -14).slice(0, 3);
  const overdueDeadlines = deadlines.filter(d => daysDiff(d.due) < 0).length;
  const soonestDays      = isHistorical ? null : (next3[0] ? Math.max(0, daysDiff(next3[0].due)) : null);

  // Fix 3: show runway only when we have journal-derived burn; null = no journal data
  const cashRunway = currentBalance !== null && hasJournalData && monthlyBurn > 0
    ? (currentBalance / monthlyBurn).toFixed(1) : null;
  const runwayLabel = !hasJournalData ? 'Import data to calculate'
    : cashRunway ? `${cashRunway}mo runway` : 'Runway: —';

  // VAT deadline insight — computed here so we can use next3/daysDiff above
  useEffect(() => {
    if (loading) return;
    const vatDl = next3.find(d => d.type === 'VAT3' && daysDiff(d.due) >= 0 && daysDiff(d.due) <= 14);
    if (!vatDl) return;
    setAiInsights(prev => {
      const msg = `VAT return due in ${daysDiff(vatDl.due)} day${daysDiff(vatDl.due) !== 1 ? 's' : ''}`;
      if (prev.some(p => p.startsWith('VAT'))) return prev;
      return [...prev, msg].slice(0, 3);
    });
  }, [loading, next3.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Work queue
  const wq = [];
  if (uncategorised > 0)
    wq.push({
      pri: "High", icon: "⚑", page: "bank-import",
      title: `Review ${uncategorised} unmatched transaction${uncategorised > 1 ? 's' : ''}`,
      subtitle: "Likely matches found. Takes 2 minutes.",
    });
  if (reconcStats.suggested > 0)
    wq.push({
      pri: "High", icon: "⇌", page: "reconciliation",
      title: `Review ${reconcStats.suggested} suggested match${reconcStats.suggested !== 1 ? 'es' : ''}`,
      subtitle: `${fmtEUR(reconcStats.balance)} unreconciled · confirm or reject AI suggestions.`,
    });
  deadlines.filter(d => daysDiff(d.due) >= 0 && daysDiff(d.due) <= 14).forEach(d => {
    const days = daysDiff(d.due);
    const desc = d.desc.includes(' — ') ? d.desc.split(' — ')[1] : d.desc;
    wq.push({
      pri: "High", icon: "⊙", page: d.type === 'VAT3' ? 'vat-returns' : 'compliance',
      title: `File ${d.type} return — ${desc}`,
      subtitle: `Due in ${days} day${days !== 1 ? 's' : ''} · Draft ready for review.`,
    });
  });
  // VAT3 draft ready: period ended but not yet filed
  const todayStr = today.toISOString().slice(0, 10);
  getVATPeriods(cs.vat_period || 'bimonthly', company?.ros_efiler || false)
    .filter(p => p.end < todayStr && !vatFiledSet.has(p.val))
    .slice(0, 1)
    .forEach(p => {
      if (wq.some(w => w.page === 'vat-returns')) return; // already added by deadline check
      wq.push({
        pri: "High", icon: "§", page: "vat-returns",
        title: `VAT3 draft ready — ${p.label}`,
        subtitle: `Period ended ${p.end} · Due ${p.due} · Review figures before filing.`,
      });
    });
  if (overdueAR.length > 0) {
    const tot = overdueAR.reduce((s, r) => s + Number(r.amount || 0), 0);
    wq.push({
      pri: "Medium", icon: "◻", page: "invoices",
      title: `Chase ${overdueAR.length} overdue invoice${overdueAR.length > 1 ? 's' : ''}`,
      subtitle: `${fmtEUR(Math.abs(tot))} outstanding · clients need chasing.`,
    });
  }
  if (pendingExpenses > 0)
    wq.push({
      pri: "Medium", icon: "◧", page: "expenses",
      title: `Approve ${pendingExpenses} expense claim${pendingExpenses > 1 ? 's' : ''}`,
      subtitle: "Awaiting your approval.",
    });
  if (checklistData.total > 0 && checklistData.done < checklistData.total) {
    const incomplete = checklistData.total - checklistData.done;
    const pct = Math.round((checklistData.done / checklistData.total) * 100);
    const chkPri = today.getDate() > 20 ? "High" : "Medium";
    wq.push({
      pri: chkPri, icon: "⊕", page: "checklist",
      title: "Complete month-end close",
      subtitle: `${pct}% complete · ${incomplete} step${incomplete > 1 ? 's' : ''} remaining.`,
    });
  }
  if (checklistData.total > 0 && checklistData.done === checklistData.total) {
    wq.push({
      pri: "Low", icon: "☑", page: "checklist",
      title: `Month-end close complete — ${selPeriodLabel}`,
      subtitle: "All checklist items done. Great work!",
    });
  }
  if (recurringPosted) {
    wq.push({
      pri: "Low", icon: "↻", page: "journals",
      title: recurringPosted,
      subtitle: "Recurring journals auto-posted on login. Review in Journals.",
    });
  }
  if (recurringSkipped > 0) {
    wq.push({
      pri: "Medium", icon: "⊘", page: "journals",
      title: `${recurringSkipped} recurring journal${recurringSkipped !== 1 ? 's' : ''} skipped — period filed`,
      subtitle: "One or more recurring journals fall inside a locked VAT period. Post manually to the current period if needed.",
    });
  }

  const priCol = { High: "var(--warn)", Medium: "var(--text-muted)", Low: "var(--accent)" };
  const priBg  = { High: "var(--warn-dim)", Medium: "var(--surface-2)", Low: "var(--accent-dim)" };
  const priBorder = { High: "rgba(251,191,36,0.25)", Medium: "var(--border)", Low: "rgba(52,211,153,0.25)" };

  // ── Layout persistence + drag helpers ────────────────────────────────────────
  const saveLayout = (next) => {
    setLayout(next);
    if (!user?.id) return;
    supabase.from('user_dashboard_layouts').upsert(
      { user_id: user.id, layout: next, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
  };

  const onTileDragStart = (e, id) => { e.dataTransfer.effectAllowed = 'move'; setDragId(id); };
  const onTileDragOver  = (e, id) => {
    e.preventDefault();
    if (TILE_META[dragId]?.row === TILE_META[id]?.row) setDragOverId(id);
  };
  const onTileDrop = (targetId) => {
    if (dragId && dragId !== targetId && TILE_META[dragId]?.row === TILE_META[targetId]?.row) {
      const next = [...layout];
      const fi = next.findIndex(t => t.id === dragId);
      const ti = next.findIndex(t => t.id === targetId);
      next.splice(ti, 0, next.splice(fi, 1)[0]);
      saveLayout(next);
    }
    setDragId(null); setDragOverId(null);
  };
  const onTileDragEnd = () => { setDragId(null); setDragOverId(null); };

  const moveTile = (id, dir) => {
    const myRow   = TILE_META[id]?.row;
    const rowTiles = layout.filter(t => TILE_META[t.id]?.row === myRow);
    const idx     = rowTiles.findIndex(t => t.id === id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= rowTiles.length) return;
    const swapId = rowTiles[swapIdx].id;
    const next   = [...layout];
    const fi = next.findIndex(t => t.id === id);
    const ti = next.findIndex(t => t.id === swapId);
    [next[fi], next[ti]] = [next[ti], next[fi]];
    saveLayout(next);
  };
  const toggleTileVisible = (id) => saveLayout(layout.map(t => t.id === id ? { ...t, visible: !t.visible } : t));
  const resetTileLayout   = () => saveLayout(DEFAULT_DASHBOARD_LAYOUT);

  // tileWrap: plain function (not a React component) returning JSX for a tile slot.
  // Called directly inside .map() — key is set on the returned root element.
  const tileWrap = (id, rowItems, content) => {
    const entry   = layout.find(t => t.id === id);
    const isHidden = entry?.visible === false;
    const vi       = rowItems.findIndex(t => t.id === id);
    return (
      <div
        key={id}
        className={['tile-wrap', dragId === id ? 'dragging' : '', dragOverId === id && dragId !== id ? 'drag-over' : '', isHidden ? 'hidden-tile' : ''].filter(Boolean).join(' ')}
        draggable={editLayout}
        onDragStart={editLayout ? (e) => onTileDragStart(e, id) : undefined}
        onDragOver={editLayout  ? (e) => onTileDragOver(e, id)  : undefined}
        onDrop={editLayout      ? ()  => onTileDrop(id)         : undefined}
        onDragEnd={editLayout   ? onTileDragEnd                  : undefined}
      >
        {editLayout && (
          <div className="tile-edit-bar">
            <span className="tile-drag-handle" title="Drag to reorder" aria-hidden="true">⠿</span>
            <button className="tile-ord-btn" onClick={() => moveTile(id, -1)} disabled={vi === 0} aria-label={`Move ${TILE_META[id]?.label} earlier`}>◀</button>
            <button className="tile-ord-btn" onClick={() => moveTile(id, 1)} disabled={vi === rowItems.length - 1} aria-label={`Move ${TILE_META[id]?.label} later`}>▶</button>
            <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 6, flex: 1 }}>{TILE_META[id]?.label}</span>
            <button className="tile-vis-btn" onClick={() => toggleTileVisible(id)} title={isHidden ? 'Show tile' : 'Hide tile'} aria-label={isHidden ? `Show ${TILE_META[id]?.label}` : `Hide ${TILE_META[id]?.label}`}>
              {isHidden ? '○' : '●'}
            </button>
          </div>
        )}
        {content}
      </div>
    );
  };

  // Sparkline SVG
  const SparkLine = () => {
    if (btSparkline.length < 2) return <div style={{ height: 50, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "var(--dim)" }}>No data</div>;
    const vals = btSparkline.map(r => Number(r.balance || 0));
    const lo = Math.min(...vals), hi = Math.max(...vals), rng = hi - lo || 1;
    const W = 200, H = 44;
    const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * W},${H - ((v - lo) / rng) * (H - 8) - 4}`).join(' ');
    const up  = vals[vals.length - 1] >= vals[0];
    return (
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block" }}>
        <polyline points={pts} fill="none" stroke={up ? "var(--accent)" : "var(--danger)"} strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    );
  };

  // Donut SVG
  const Donut = () => {
    const { total, done } = checklistData;
    const pct = total > 0 ? done / total : 0;
    const r = 27, cx = 35, cy = 35, circ = 2 * Math.PI * r;
    return (
      <svg width="70" height="70" viewBox="0 0 70 70" style={{ flexShrink: 0 }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--surface-2)" strokeWidth="8" />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--accent)" strokeWidth="8"
          strokeDasharray={`${circ * pct} ${circ}`} strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`} />
        <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle"
          style={{ fill: "var(--text)", fontSize: 11, fontFamily: "'Source Code Pro',monospace", fontWeight: 700 }}>
          {total > 0 ? `${Math.round(pct * 100)}%` : '—'}
        </text>
      </svg>
    );
  };

  const hour     = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const name     = user?.firstName || 'there';

  return (
    <div className="fade-up" style={{ maxWidth: 1100 }}>

      {/* ── Historical period banner ── */}
      {isHistorical && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "var(--warn-dim)", border: "1px solid rgba(251,191,36,0.25)",
          borderRadius: "var(--radius-card)", padding: "9px 16px", marginBottom: 12,
          fontSize: 12, color: "var(--warn)",
        }}>
          <span>Viewing historical period — {selPeriodLabel}</span>
          <button onClick={() => setSelPeriod(curPeriod)}
            style={{ fontSize: 11, color: "var(--warn)", background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.35)", borderRadius: "var(--radius-pill)", padding: "3px 12px", cursor: "pointer" }}>
            Back to current
          </button>
        </div>
      )}

      {/* ── Getting Started card ── */}
      {company && !company.onboarding_completed && onOpenWizard && (
        <GettingStartedCard company={company} onOpenStep={onOpenWizard} onDismiss={onDismissGetStarted} />
      )}

      {/* ── AI Summary Banner ── */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-card)", padding: "14px 18px", marginBottom: 16, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 20, flexShrink: 0 }}>✨</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", flex: 1, minWidth: 180, lineHeight: 1.4 }}>
          {loading ? "Analysing your finances…" : aiInsights[0] || "Financial data loaded — insights ready"}
        </span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[
            { text: `${btSparkline.length} transactions`, ok: true },
            { text: runwayLabel, ok: cashRunway ? Number(cashRunway) >= 3 : null },
            { text: soonestDays !== null ? `Deadline in ${soonestDays}d` : 'No deadlines', ok: soonestDays === null || soonestDays > 14 },
            { text: overdueDeadlines > 0 ? `${overdueDeadlines} overdue` : 'On track', ok: overdueDeadlines === 0 },
            ...(reconcStats.autoCount > 0 ? [{ text: `${reconcStats.autoCount} reconciled`, ok: true }] : []),
          ].map((pill, i) => (
            <span key={i} style={{
              background: pill.ok === false ? "var(--danger-dim)" : pill.ok === true ? "var(--accent-dim)" : "var(--surface-2)",
              color: pill.ok === false ? "var(--danger)" : pill.ok === true ? "var(--accent)" : "var(--text-muted)",
              border: `1px solid ${pill.ok === false ? "rgba(248,113,113,0.25)" : pill.ok === true ? "rgba(52,211,153,0.25)" : "var(--border)"}`,
              borderRadius: "var(--radius-pill)", padding: "3px 10px", fontSize: 11, fontWeight: 500, whiteSpace: "nowrap",
            }}>{pill.text}</span>
          ))}
        </div>
      </div>

      {/* ── Layout edit controls ── */}
      {editLayout ? (
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 14px', background:'rgba(29,107,114,0.07)', border:'1px solid rgba(29,107,114,0.2)', borderRadius:'var(--radius-card)', marginBottom:12, fontSize:12, color:'var(--teal)' }}>
          <span aria-hidden="true">✎</span>
          <span style={{ flex:1 }}>Edit mode — drag tiles or use ◀▶ to reorder · ● to hide a tile</span>
          <button className="btn btn-s btn-sm" onClick={resetTileLayout}>Reset to default</button>
          <button className="btn btn-p btn-sm" onClick={() => setEditLayout(false)}>Done</button>
        </div>
      ) : (
        <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:8 }}>
          <button className="btn btn-s btn-sm" onClick={() => setEditLayout(true)} style={{ fontSize:11 }}>✎ Edit layout</button>
        </div>
      )}

      {/* ── Automation hero ── */}
      <AutomationHero companyId={companyId} theme="light" />

      {/* ── Tile grid ── */}
      {(() => {
        const largeTiles = layout.filter(t => TILE_META[t.id]?.row === 'large');
        const smallTiles = layout.filter(t => TILE_META[t.id]?.row === 'small');
        const visLarge   = largeTiles.filter(t => t.visible !== false || editLayout);
        const visSmall   = smallTiles.filter(t => t.visible !== false || editLayout);

        const tileContent = {
          'work-queue': (
            <div className="card">
              <div className="card-header">
                <span className="card-title">Work Queue</span>
                <span className="card-count">{loading ? '…' : `${wq.length} item${wq.length !== 1 ? 's' : ''}`}</span>
              </div>
              {loading ? (
                <div style={{ padding: "28px 16px", textAlign: "center", color: "var(--text-faint)", fontSize: 12 }}>Loading…</div>
              ) : wq.length === 0 ? (
                <div style={{ padding: "28px 16px", textAlign: "center" }}>
                  <div style={{ fontSize: 24, color: "var(--accent)", opacity: 0.4, marginBottom: 8 }}>✓</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>All clear — nothing needs attention right now</div>
                </div>
              ) : (
                <div>
                  {wq.slice(0, 5).map((item, i) => (
                    <div key={i} onClick={() => onNavigate?.(item.page)}
                      style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: i < Math.min(wq.length, 5) - 1 ? "1px solid var(--border)" : "none", cursor: onNavigate ? "pointer" : "default", transition: "background 0.1s" }}
                      onMouseEnter={e => { if (onNavigate) e.currentTarget.style.background = "var(--surface-2)"; }}
                      onMouseLeave={e => e.currentTarget.style.background = ""}
                    >
                      <div style={{ width: 34, height: 34, borderRadius: 9, background: priBg[item.pri], border: `1px solid ${priBorder[item.pri]}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 14, color: priCol[item.pri] }}>
                        {item.icon}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.3, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.subtitle}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                        <span style={{ fontSize: 10, fontWeight: 600, background: priBg[item.pri], color: priCol[item.pri], border: `1px solid ${priBorder[item.pri]}`, borderRadius: "var(--radius-pill)", padding: "2px 8px" }}>{item.pri}</span>
                        <span style={{ color: "var(--text-faint)", fontSize: 16 }}>›</span>
                      </div>
                    </div>
                  ))}
                  <div className="card-footer-link" onClick={() => onNavigate?.('overview')}>See all tasks →</div>
                </div>
              )}
            </div>
          ),
          'cash-position': (
            <div className="card">
              <div className="card-header">
                <span className="card-title">Cash Position</span>
                {!loading && currentBalance !== null && (
                  <span className="card-count">AIB · latest</span>
                )}
              </div>
              <div style={{ padding: "16px 18px" }}>
                {loading ? (
                  <div style={{ padding: "20px 0", textAlign: "center", color: "var(--text-faint)", fontSize: 12 }}>Loading…</div>
                ) : currentBalance === null ? (
                  <div style={{ padding: "12px 0", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
                    No bank data yet — import a CSV in Bank Import
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 2 }}>
                      <div style={{ fontSize: 32, fontWeight: 700, color: currentBalance >= 0 ? "var(--text)" : "var(--danger)", lineHeight: 1, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>
                        {fmtEUR(currentBalance)}
                      </div>
                      {btSparkline.length >= 2 && (() => {
                        const diff = Number(btSparkline[btSparkline.length - 1].balance || 0) - Number(btSparkline[0].balance || 0);
                        return (
                          <span style={{ fontSize: 11, fontWeight: 600, background: diff >= 0 ? "var(--accent-dim)" : "var(--danger-dim)", color: diff >= 0 ? "var(--accent)" : "var(--danger)", border: `1px solid ${diff >= 0 ? "rgba(52,211,153,0.25)" : "rgba(248,113,113,0.25)"}`, borderRadius: "var(--radius-pill)", padding: "2px 8px" }}>
                            {diff >= 0 ? '↑' : '↓'} {fmtEUR(Math.abs(diff))}
                          </span>
                        );
                      })()}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-faint)", marginBottom: 12 }}>Bank balance (AIB) · {selPeriodLabel}</div>
                    <div style={{ margin: "4px 0" }}><SparkLine /></div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 10, color: "var(--text-faint)" }}>
                      <span>{selPeriodLabel.split(' ')[0]} 1</span>
                      <span>Today</span>
                    </div>
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 12, color: "var(--text)", fontWeight: 500 }}>
                        {!hasJournalData ? "Import journal data to calculate runway" : monthlyBurn > 0 ? `${cashRunway}mo runway` : "No expense journals in last 30 days"}
                      </div>
                      {hasJournalData && monthlyBurn > 0 && (
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                          Burn rate · {fmtEUR(monthlyBurn)}/mo
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          ),
          'bank-health': (
            <div className="card" style={{ display: "flex", flexDirection: "column" }}>
              <div className="card-header">
                <span className="card-title">Bank Health</span>
                <span className="card-count" style={{ color: reconcStats.suggested > 0 ? "var(--warn)" : "var(--accent)", display:'flex', alignItems:'center', gap:5 }}>
                  <HealthPulseDot healthy={bookHealthy} size={7} />
                  {reconcStats.suggested > 0 ? `${reconcStats.suggested} pending` : "✓ clean"}
                </span>
              </div>
              <div style={{ padding: "12px 16px", flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  { lbl: "AWAITING MATCH", val: loading ? "…" : String(reconcStats.suggested), col: reconcStats.suggested > 0 ? "var(--warn)" : "var(--accent)" },
                  { lbl: "UNRECONCILED", val: loading ? "…" : fmtEUR(reconcStats.balance), col: "var(--text)" },
                  { lbl: "AUTO CONFIDENCE", val: loading ? "…" : reconcStats.autoCount > 0 ? `${reconcStats.avgConf}%` : "—", col: reconcStats.avgConf >= 80 ? "var(--accent)" : reconcStats.avgConf >= 60 ? "var(--warn)" : "var(--text-muted)" },
                ].map(r => (
                  <div key={r.lbl}>
                    <div style={{ fontSize: 9, fontWeight: 600, color: "var(--text-faint)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 2 }}>{r.lbl}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: r.col, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}>{r.val}</div>
                  </div>
                ))}
              </div>
              {onNavigate && (
                <div className="card-footer-link" onClick={() => onNavigate("reconciliation")}>
                  Go to reconciliation →
                </div>
              )}
            </div>
          ),
          'compliance': (
            <div className="card">
              <div className="card-header">
                <span className="card-title">Compliance</span>
                <span className="card-count" style={{ color: overdueDeadlines > 0 ? "var(--danger)" : "var(--text-muted)" }}>
                  {overdueDeadlines > 0 ? `${overdueDeadlines} overdue` : 'Next 3'}
                </span>
              </div>
              <div>
                {next3.length === 0 ? (
                  <div style={{ padding: "20px 16px", fontSize: 12, color: "var(--text-faint)", textAlign: "center" }}>No upcoming deadlines</div>
                ) : next3.map((dl, i) => {
                  const d   = daysDiff(dl.due);
                  const col = d < 0 ? "var(--danger)" : d <= 7 ? "var(--danger)" : d <= 14 ? "var(--warn)" : "var(--accent)";
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: i < next3.length - 1 ? "1px solid var(--border)" : "none" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>{dl.desc}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>
                          Due in {d < 0 ? `${Math.abs(d)}d — overdue` : `${d}d`}
                        </div>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: col, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {dl.due.toLocaleDateString("en-IE", { day: "numeric", month: "short" })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ),
          'month-end': (
            <div className="card" style={{ display: "flex", flexDirection: "column" }}>
              <div className="card-header">
                <span className="card-title">Month End</span>
                <span className="card-count">{selPeriodLabel}</span>
              </div>
              <div style={{ padding: "12px 16px 0", display: "flex", alignItems: "center", gap: 12 }}>
                <Donut />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
                    {checklistData.total === 0 ? "No checklist yet" : `${checklistData.done} / ${checklistData.total} complete`}
                  </div>
                  {checklistData.total > 0 && (
                    <div style={{ marginTop: 6, height: 3, borderRadius: 2, background: "var(--surface-2)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${(checklistData.done / checklistData.total) * 100}%`, background: "var(--accent)", borderRadius: 2, transition: "width 0.4s" }} />
                    </div>
                  )}
                  {checklistData.total > 0 && (
                    <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 5 }}>{checklistData.total - checklistData.done} tasks remaining</div>
                  )}
                </div>
              </div>
              <div style={{ flex: 1, padding: "8px 0 0" }}>
                {checklistData.total === 0 ? (
                  <div style={{ padding: "8px 16px" }}>
                    <button onClick={() => onNavigate?.('checklist')}
                      style={{ fontSize: 11, color: "var(--accent)", background: "var(--accent-dim)", border: "1px solid rgba(52,211,153,0.25)", borderRadius: "var(--radius-pill)", padding: "4px 12px", cursor: "pointer" }}>
                      Load Default Checklist →
                    </button>
                  </div>
                ) : checklistItems.slice(0, 4).map((item) => (
                  <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 16px", borderTop: "1px solid var(--border)" }}>
                    <span style={{ fontSize: 12, color: item.checked ? "var(--accent)" : "var(--text-faint)", flexShrink: 0 }}>
                      {item.checked ? "✓" : "○"}
                    </span>
                    <span style={{ fontSize: 11, color: item.checked ? "var(--text-muted)" : "var(--text)", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textDecoration: item.checked ? "line-through" : "none" }}>
                      {item.item_label || "—"}
                    </span>
                  </div>
                ))}
              </div>
              {onNavigate && <div className="card-footer-link" onClick={() => onNavigate('checklist')}>Go to month end →</div>}
            </div>
          ),
          'automation': (
            <div className="card" style={{ display: "flex", flexDirection: "column" }}>
              <div className="card-header">
                <span className="card-title">Automation</span>
                <span style={{ fontSize: 14 }}>🤖</span>
              </div>
              <div style={{ padding: "12px 16px", flex: 1 }}>
                {automationStats.total === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>No transactions imported yet</div>
                ) : (
                  <>
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 9, fontWeight: 600, color: "var(--text-faint)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3 }}>IMPORTED</div>
                      <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{automationStats.total.toLocaleString()}</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                      {[
                        { lbl: "Auto-processed", val: automationStats.processed, pct: automationStats.total > 0 ? Math.round((automationStats.processed / automationStats.total) * 100) : 0, col: "var(--accent)", trackCol: "var(--accent-dim)" },
                        { lbl: "Needs review", val: automationStats.review, pct: automationStats.total > 0 ? Math.round((automationStats.review / automationStats.total) * 100) : 0, col: automationStats.review > 0 ? "var(--warn)" : "var(--text-faint)", trackCol: automationStats.review > 0 ? "var(--warn-dim)" : "var(--surface-2)" },
                      ].map(r => (
                        <div key={r.lbl}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{r.lbl}</span>
                            <span style={{ fontSize: 11, fontWeight: 600, color: r.col }}>{r.val} · {r.pct}%</span>
                          </div>
                          <div style={{ height: 4, borderRadius: 2, background: "var(--surface-2)", overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${r.pct}%`, background: r.col, borderRadius: 2 }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
              {onNavigate && <div className="card-footer-link" onClick={() => onNavigate('bank-import')}>View automation log →</div>}
            </div>
          ),
          'ai-insights': (
            <div className="card" style={{ display: "flex", flexDirection: "column" }}>
              <div className="card-header">
                <span className="card-title">AI Insights</span>
                <span style={{ fontSize: 9, fontWeight: 600, background: "var(--accent-dim)", color: "var(--accent)", border: "1px solid rgba(52,211,153,0.25)", borderRadius: "var(--radius-pill)", padding: "2px 7px" }}>New</span>
              </div>
              <div style={{ flex: 1, padding: "4px 0" }}>
                {loading ? (
                  <div style={{ padding: "16px 16px", fontSize: 12, color: "var(--text-faint)" }}>Analysing…</div>
                ) : aiInsights.length === 0 ? (
                  <div style={{ padding: "16px 16px", fontSize: 12, color: "var(--text-faint)" }}>Import data to generate insights</div>
                ) : aiInsights.map((txt, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, padding: "10px 16px", borderBottom: i < aiInsights.length - 1 ? "1px solid var(--border)" : "none" }}>
                    <span style={{ color: "var(--accent)", fontSize: 9, marginTop: 4, flexShrink: 0 }}>●</span>
                    <span style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.5 }}>{txt}</span>
                  </div>
                ))}
              </div>
            </div>
          ),
        };

        return (
          <>
            {/* Row 1: large tiles (Work Queue + Cash Position) */}
            {visLarge.length > 0 && (
              <div style={{ display:"grid", gridTemplateColumns: visLarge.length === 1 ? "1fr" : "5fr 7fr", gap:16, marginBottom:16, alignItems:"start" }}>
                {visLarge.map(t => tileWrap(t.id, largeTiles, tileContent[t.id]))}
              </div>
            )}

            {/* Row 2: small tiles */}
            {visSmall.length > 0 && (
              <div style={{ display:"grid", gridTemplateColumns:`repeat(${visSmall.length}, 1fr)`, gap:16 }}>
                {visSmall.map(t => tileWrap(t.id, smallTiles, tileContent[t.id]))}
              </div>
            )}
          </>
        );
      })()}

      {/* ── Footer ── */}
      <div style={{ marginTop: 16, fontSize: 11, color: "var(--text-faint)", display: "flex", alignItems: "center", gap: 6 }}>
        <span>🔄</span>
        <span>Data last updated: {today.toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" })}</span>
      </div>
    </div>
  );
}

function Checklist({ period, selPeriod, companyId, company }) {
  const { user } = useUser();
  const [items, setItems]               = useState([]);
  const [loading, setLoading]           = useState(true);
  const [chkError, setChkError]         = useState(null);

  // global add-item form (shown outside edit mode)
  const [adding, setAdding]             = useState(false);
  const [newLabel, setNewLabel]         = useState("");
  const [newSection, setNewSection]     = useState("General");

  // edit mode
  const [editMode, setEditMode]         = useState(false);
  const [renaming, setRenaming]         = useState(null); // { type:'section'|'item', key:string, draft:string }
  const [addingInSec, setAddingInSec]   = useState(null); // section name receiving a new item
  const [secNewLabel, setSecNewLabel]   = useState("");
  const [loadingTmpl, setLoadingTmpl]   = useState(false);
  const [switchTo, setSwitchTo]         = useState(null); // 'basic'|'advanced'

  // template in use — kept in sync with companies.checklist_template
  const [activeTmpl, setActiveTmpl]     = useState(company?.checklist_template || 'basic');

  const getCid = () => requireCompanyId(companyId);

  // ── Load items ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!companyId) { setItems([]); return; }
    (async () => {
      setLoading(true);
      try {
        const cid = getCid();
        // order by sort_order (new column) then created_at for backwards compat
        const { data, error } = await supabase.from("checklists")
          .select("*").eq("company_id", cid).eq("period", period)
          .order("sort_order").order("created_at");
        if (error) throw error;
        const rows = data || [];
        if (selPeriod && rows.length) {
          const [y, m] = selPeriod.split('-').map(Number);
          const pStart = `${selPeriod}-01`;
          const pEnd   = new Date(y, m, 0).toISOString().slice(0, 10);
          const evaluated = await runChecklistAutoEval(cid, pStart, pEnd, rows);
          setItems(evaluated);
        } else {
          setItems(rows);
        }
      } catch (e) { setChkError(e.message); }
      setLoading(false);
    })();
  }, [companyId, period]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived ordering (sort_order ?? 0 as fallback before migration runs) ─────
  const sortedItems = [...items].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  // sections in min-sort_order order
  const sections = [...new Set(sortedItems.map(i => i.section))];

  const done  = items.filter(i => i.checked).length;
  const total = items.length;
  const pct   = total ? Math.round((done / total) * 100) : 0;
  const allDone = total > 0 && done === total;
  const tmplInfo = CHECKLIST_TEMPLATES_MAP[activeTmpl] || CHECKLIST_TEMPLATES_MAP.basic;

  // ── Helpers ───────────────────────────────────────────────────────────────────
  const maxSo = () => items.length ? Math.max(...items.map(i => i.sort_order ?? 0)) + 1 : 0;

  // ── Toggle checked ────────────────────────────────────────────────────────────
  const toggle = async (item) => {
    if (editMode) return;
    const newChecked = !item.checked;
    const isPinning  = !newChecked && item.completed_by === 'system';
    const patch = isPinning
      ? { checked: false, completed_by: null, pinned_manual: true }
      : { checked: newChecked };
    await supabase.from("checklists").update(patch).eq("id", item.id);
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, ...patch } : i));
  };

  // ── Load template (empty state) ───────────────────────────────────────────────
  const loadTemplate = async (key) => {
    setLoadingTmpl(true); setChkError(null);
    try {
      const cid = getCid();
      setResolvedCid(cid);
      const tmpl = CHECKLIST_TEMPLATES_MAP[key].template;
      let so = 0;
      const rows = tmpl.flatMap(({ section, items: tItems }) =>
        tItems.map(item_label => ({
          company_id: cid, section, item_label, is_auto: false, checked: false, period,
          completion_condition: CONDITION_MAP[item_label] || null,
          sort_order: so++,
        }))
      );
      const { data, error } = await supabase.from("checklists").insert(rows).select();
      if (error) throw error;
      await supabase.from("companies").update({ checklist_template: key }).eq("id", cid);
      setItems(data || []);
      setActiveTmpl(key);
    } catch (e) { setChkError(e.message); }
    setLoadingTmpl(false);
  };

  // ── Switch template (replaces existing period items) ─────────────────────────
  const switchTemplate = async (key) => {
    setLoadingTmpl(true); setChkError(null); setSwitchTo(null);
    try {
      const cid = getCid();
      const ids = items.map(i => i.id);
      if (ids.length) await supabase.from("checklists").delete().in("id", ids);
      const tmpl = CHECKLIST_TEMPLATES_MAP[key].template;
      let so = 0;
      const rows = tmpl.flatMap(({ section, items: tItems }) =>
        tItems.map(item_label => ({
          company_id: cid, section, item_label, is_auto: false, checked: false, period,
          completion_condition: CONDITION_MAP[item_label] || null,
          sort_order: so++,
        }))
      );
      const { data, error } = await supabase.from("checklists").insert(rows).select();
      if (error) throw error;
      await supabase.from("companies").update({ checklist_template: key }).eq("id", cid);
      setItems(data || []);
      setActiveTmpl(key);
      setEditMode(false);
    } catch (e) { setChkError(e.message); }
    setLoadingTmpl(false);
  };

  // ── Rename commit (section or item) ──────────────────────────────────────────
  const commitRename = async () => {
    if (!renaming || !renaming.draft.trim()) { setRenaming(null); return; }
    try {
      if (renaming.type === 'section') {
        const newName = renaming.draft.trim();
        if (newName !== renaming.key) {
          await supabase.from('checklists').update({ section: newName })
            .eq('company_id', getCid()).eq('period', period).eq('section', renaming.key);
          setItems(prev => prev.map(i => i.section === renaming.key ? { ...i, section: newName } : i));
        }
      } else {
        const newLabel2 = renaming.draft.trim();
        const orig = items.find(i => i.id === renaming.key)?.item_label;
        if (newLabel2 !== orig) {
          await supabase.from('checklists').update({ item_label: newLabel2 }).eq('id', renaming.key);
          setItems(prev => prev.map(i => i.id === renaming.key ? { ...i, item_label: newLabel2 } : i));
        }
      }
    } catch (e) { setChkError(e.message); }
    setRenaming(null);
  };

  // ── Delete section or item ────────────────────────────────────────────────────
  const deleteSection = async (sectionName) => {
    const ids = items.filter(i => i.section === sectionName).map(i => i.id);
    if (!ids.length) return;
    await supabase.from('checklists').delete().in('id', ids);
    setItems(prev => prev.filter(i => i.section !== sectionName));
  };

  const deleteItem = async (itemId) => {
    await supabase.from('checklists').delete().eq('id', itemId);
    setItems(prev => prev.filter(i => i.id !== itemId));
  };

  // ── Reorder items within section ──────────────────────────────────────────────
  const moveItemUp = async (item) => {
    const sItems = sortedItems.filter(i => i.section === item.section);
    const idx = sItems.findIndex(i => i.id === item.id);
    if (idx <= 0) return;
    const above = sItems[idx - 1];
    const aSo = above.sort_order ?? 0, bSo = item.sort_order ?? 0;
    await Promise.all([
      supabase.from('checklists').update({ sort_order: aSo }).eq('id', item.id),
      supabase.from('checklists').update({ sort_order: bSo }).eq('id', above.id),
    ]);
    setItems(prev => prev.map(i =>
      i.id === item.id  ? { ...i, sort_order: aSo } :
      i.id === above.id ? { ...i, sort_order: bSo } : i
    ));
  };

  const moveItemDown = async (item) => {
    const sItems = sortedItems.filter(i => i.section === item.section);
    const idx = sItems.findIndex(i => i.id === item.id);
    if (idx >= sItems.length - 1) return;
    const below = sItems[idx + 1];
    const aSo = item.sort_order ?? 0, bSo = below.sort_order ?? 0;
    await Promise.all([
      supabase.from('checklists').update({ sort_order: bSo }).eq('id', item.id),
      supabase.from('checklists').update({ sort_order: aSo }).eq('id', below.id),
    ]);
    setItems(prev => prev.map(i =>
      i.id === item.id  ? { ...i, sort_order: bSo } :
      i.id === below.id ? { ...i, sort_order: aSo } : i
    ));
  };

  // ── Reorder sections (swap sort_orders of all items between two sections) ─────
  const moveSectionUp = async (sectionName) => {
    const secIdx = sections.indexOf(sectionName);
    if (secIdx <= 0) return;
    const prevSec  = sections[secIdx - 1];
    const curItems = sortedItems.filter(i => i.section === sectionName);
    const prevItems = sortedItems.filter(i => i.section === prevSec);
    const allSo = [...curItems, ...prevItems].map(i => i.sort_order ?? 0).sort((a, b) => a - b);
    const merged = [...curItems, ...prevItems]; // cur gets lowest sort_orders
    const updates = merged.map((it, idx2) => ({ id: it.id, sort_order: allSo[idx2] }));
    await Promise.all(updates.map(u => supabase.from('checklists').update({ sort_order: u.sort_order }).eq('id', u.id)));
    setItems(prev => prev.map(i => { const u = updates.find(x => x.id === i.id); return u ? { ...i, sort_order: u.sort_order } : i; }));
  };

  const moveSectionDown = async (sectionName) => {
    const secIdx = sections.indexOf(sectionName);
    if (secIdx >= sections.length - 1) return;
    const nextSec  = sections[secIdx + 1];
    const curItems  = sortedItems.filter(i => i.section === sectionName);
    const nextItems = sortedItems.filter(i => i.section === nextSec);
    const allSo = [...curItems, ...nextItems].map(i => i.sort_order ?? 0).sort((a, b) => a - b);
    const merged = [...nextItems, ...curItems]; // next gets lowest sort_orders
    const updates = merged.map((it, idx2) => ({ id: it.id, sort_order: allSo[idx2] }));
    await Promise.all(updates.map(u => supabase.from('checklists').update({ sort_order: u.sort_order }).eq('id', u.id)));
    setItems(prev => prev.map(i => { const u = updates.find(x => x.id === i.id); return u ? { ...i, sort_order: u.sort_order } : i; }));
  };

  // ── Add item inside a section (edit mode) ─────────────────────────────────────
  const addItemToSection = async (sectionName, label) => {
    if (!label.trim()) return;
    const cid = getCid();
    const { data, error } = await supabase.from('checklists').insert({
      company_id: cid, section: sectionName, item_label: label.trim(),
      is_auto: false, checked: false, period, sort_order: maxSo(),
    }).select().single();
    if (!error && data) setItems(prev => [...prev, data]);
    else if (error) setChkError(error.message);
    setAddingInSec(null); setSecNewLabel("");
  };

  // ── Add new blank section ─────────────────────────────────────────────────────
  const addNewSection = async () => {
    const cid = getCid();
    const { data, error } = await supabase.from('checklists').insert({
      company_id: cid, section: "New Section", item_label: "Checklist item",
      is_auto: false, checked: false, period, sort_order: maxSo(),
    }).select().single();
    if (!error && data) {
      setItems(prev => [...prev, data]);
      setRenaming({ type: 'section', key: "New Section", draft: "New Section" });
    } else if (error) { setChkError(error.message); }
  };

  // ── Save optional per-item field (owner / due_offset) ─────────────────────────
  const saveItemField = async (itemId, field, value) => {
    const trimmed = (value || '').trim() || null;
    await supabase.from('checklists').update({ [field]: trimmed }).eq('id', itemId);
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, [field]: trimmed } : i));
  };

  // ── Global add item (outside edit mode) ───────────────────────────────────────
  const addItem = async () => {
    if (!newLabel.trim()) return;
    try {
      const cid = getCid();
      setResolvedCid(cid);
      const { data, error } = await supabase.from("checklists")
        .insert({ company_id: cid, section: newSection.trim() || "General", item_label: newLabel.trim(), is_auto: false, checked: false, period, sort_order: maxSo() })
        .select().single();
      if (error) throw error;
      setItems(prev => [...prev, data]);
      setNewLabel(""); setAdding(false);
    } catch (e) { setChkError(e.message); }
  };

  if (loading) return <div style={{ padding: 48, textAlign: "center", color: "var(--dim)", fontFamily: "Source Code Pro, monospace", fontSize: 12 }}>Loading checklist…</div>;

  return (
    <div className="fade-up">
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14, gap: 12 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text)", marginBottom: 2 }}>Month End Close — {period}</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Work through each section. Items marked AI are automated by Ledgrly.</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, flexShrink: 0 }}>
          {total > 0 && (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", marginBottom: 4, fontVariantNumeric: "tabular-nums" }}>
                {done}<span style={{ fontSize: 13, fontWeight: 400, color: "var(--text-faint)" }}> / {total}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div className="pb-track"><div className="pb-fill" style={{ width: `${pct}%` }} /></div>
                <span style={{ fontSize: 11, fontFamily: "Source Code Pro, monospace", color: "var(--teal)", fontWeight: 600 }}>{pct}%</span>
              </div>
            </div>
          )}
          {total > 0 && (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {!editMode && (
                <span
                  style={{ fontSize: 10, fontFamily: "Source Code Pro, monospace", color: "var(--teal)", background: "rgba(29,107,114,0.08)", border: "1px solid rgba(29,107,114,0.2)", borderRadius: 20, padding: "2px 8px", letterSpacing: "0.04em", cursor: "pointer", userSelect: "none" }}
                  onClick={() => setSwitchTo(s => s ? null : (activeTmpl === 'basic' ? 'advanced' : 'basic'))}
                  title="Click to switch template">
                  {tmplInfo.label} ▾
                </span>
              )}
              <button className="btn btn-s btn-sm" onClick={() => { setEditMode(e => !e); setRenaming(null); setAddingInSec(null); setSwitchTo(null); }}>
                {editMode ? "Done editing" : "✏ Edit"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Switch template confirmation */}
      {switchTo && (
        <div style={{ background: "rgba(184,134,11,0.07)", border: "1px solid var(--gold, #b88a0b)", borderRadius: 7, padding: "12px 16px", marginBottom: 12 }}>
          <div style={{ fontWeight: 600, color: "var(--text)", marginBottom: 4, fontSize: 13 }}>Switch to {CHECKLIST_TEMPLATES_MAP[switchTo]?.label} template?</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
            All {total} items for {period} will be replaced with the {CHECKLIST_TEMPLATES_MAP[switchTo]?.label} template ({CHECKLIST_TEMPLATES_MAP[switchTo]?.description}). Existing progress will be lost.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-d btn-sm" onClick={() => switchTemplate(switchTo)} disabled={loadingTmpl}>
              {loadingTmpl ? "Switching…" : `Yes, switch to ${CHECKLIST_TEMPLATES_MAP[switchTo]?.label}`}
            </button>
            <button className="btn btn-s btn-sm" onClick={() => setSwitchTo(null)}>Cancel</button>
          </div>
        </div>
      )}

      {chkError && <div style={{ padding: "9px 13px", background: "rgba(139,32,32,0.06)", border: "1px solid rgba(139,32,32,0.2)", color: "var(--red)", borderRadius: 3, fontSize: 12, marginBottom: 12 }}>{chkError}</div>}

      {allDone && !editMode && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--accent-dim)", border: "1px solid rgba(52,211,153,0.3)", borderRadius: 8, padding: "10px 16px", marginBottom: 12, fontSize: 13, color: "var(--accent)", fontWeight: 600 }}>
          <span>✓</span><span>Month-end close complete for {period}</span>
        </div>
      )}

      {/* Empty state — template chooser */}
      {total === 0 && !adding && (
        <div style={{ padding: "40px 32px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 3 }}>
          <div style={{ fontSize: 26, marginBottom: 10, color: "var(--dim)", textAlign: "center" }}>☑</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: 4, textAlign: "center" }}>No checklist for {period}</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 24, textAlign: "center" }}>Load a template to get started, or build a custom checklist.</div>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
            {Object.entries(CHECKLIST_TEMPLATES_MAP).map(([key, info]) => (
              <div key={key} style={{ background: "var(--white)", border: "1px solid var(--border)", borderRadius: 8, padding: "16px 20px", minWidth: 170, maxWidth: 220 }}>
                <div style={{ fontWeight: 700, color: "var(--text)", marginBottom: 2, fontSize: 14 }}>{info.label}</div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 14 }}>{info.description}</div>
                <button className="btn btn-p btn-sm" onClick={() => loadTemplate(key)} disabled={loadingTmpl}>
                  {loadingTmpl ? "Loading…" : `Load ${info.label}`}
                </button>
              </div>
            ))}
            <div style={{ background: "var(--white)", border: "1px dashed var(--border)", borderRadius: 8, padding: "16px 20px", minWidth: 170, maxWidth: 220 }}>
              <div style={{ fontWeight: 700, color: "var(--text)", marginBottom: 2, fontSize: 14 }}>Custom</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 14 }}>Build your own checklist from scratch</div>
              <button className="btn btn-s btn-sm" onClick={() => setAdding(true)}>+ Add Item</button>
            </div>
          </div>
        </div>
      )}

      {/* Sections */}
      {sections.map((section, secIdx) => {
        const sItems     = sortedItems.filter(i => i.section === section);
        const sDone      = sItems.filter(i => i.checked).length;
        const isRenSec   = renaming?.type === 'section' && renaming.key === section;
        return (
          <div key={section} className="card" style={{ marginBottom: 9 }}>
            <div className="sec-title">
              {editMode ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    <button className="chk-ord-btn" onClick={() => moveSectionUp(section)} disabled={secIdx === 0}>▲</button>
                    <button className="chk-ord-btn" onClick={() => moveSectionDown(section)} disabled={secIdx === sections.length - 1}>▼</button>
                  </div>
                  {isRenSec ? (
                    <input className="chk-rename-input" autoFocus value={renaming.draft}
                      onChange={e => setRenaming(r => ({ ...r, draft: e.target.value }))}
                      onBlur={commitRename}
                      onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null); }} />
                  ) : (
                    <span className="chk-edit-label" onClick={() => setRenaming({ type: 'section', key: section, draft: section })} title="Click to rename">{section}</span>
                  )}
                  <span className="sec-count" style={{ marginLeft: 4 }}>{sDone}/{sItems.length}</span>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                    <button className="chk-ord-btn" style={{ fontSize: 11 }}
                      onClick={() => { setAddingInSec(addingInSec === section ? null : section); setSecNewLabel(""); }}
                      title="Add item to this section">+</button>
                    <button className="chk-del-btn"
                      onClick={() => { if (window.confirm(`Delete section "${section}" and all ${sItems.length} items?`)) deleteSection(section); }}
                      title="Delete section">×</button>
                  </div>
                </div>
              ) : (
                <>{section}<span className="sec-count">{sDone}/{sItems.length}</span></>
              )}
            </div>

            {sItems.map((item, itemIdx) => {
              const isRenItem = renaming?.type === 'item' && renaming.key === item.id;
              return (
                <div key={item.id} className={`chk-item ${item.checked && !editMode ? "done" : ""} ${editMode ? "edit" : ""}`}
                  onClick={() => !editMode && toggle(item)}>
                  {!editMode && <div className="chk-box">{item.checked && <span className="chk-tick">✓</span>}</div>}

                  {editMode ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, flexWrap: "wrap" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 1, flexShrink: 0 }}>
                        <button className="chk-ord-btn" onClick={() => moveItemUp(item)} disabled={itemIdx === 0}>▲</button>
                        <button className="chk-ord-btn" onClick={() => moveItemDown(item)} disabled={itemIdx === sItems.length - 1}>▼</button>
                      </div>
                      {isRenItem ? (
                        <input className="chk-rename-input" style={{ fontWeight: 400, fontSize: 12, minWidth: 160 }} autoFocus value={renaming.draft}
                          onChange={e => setRenaming(r => ({ ...r, draft: e.target.value }))}
                          onBlur={commitRename}
                          onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null); }} />
                      ) : (
                        <span className="chk-edit-label" style={{ fontSize: 12, color: "var(--text)" }}
                          onClick={() => setRenaming({ type: 'item', key: item.id, draft: item.item_label })}
                          title="Click to rename">{item.item_label}</span>
                      )}
                      <input className="chk-meta-input" defaultValue={item.owner || ''} placeholder="Owner"
                        onBlur={e => saveItemField(item.id, 'owner', e.target.value)} />
                      <input className="chk-meta-input" defaultValue={item.due_offset || ''} placeholder="Due (WD+3)"
                        onBlur={e => saveItemField(item.id, 'due_offset', e.target.value)} />
                      <button className="chk-del-btn" style={{ marginLeft: "auto" }} onClick={() => deleteItem(item.id)}>×</button>
                    </div>
                  ) : (
                    <>
                      <span className="chk-label">{item.item_label}</span>
                      {item.owner && <span style={{ fontSize: 10, fontFamily: "Source Code Pro, monospace", color: "var(--dim)", marginLeft: "auto", flexShrink: 0 }}>@{item.owner}</span>}
                      {item.due_offset && <span style={{ fontSize: 10, fontFamily: "Source Code Pro, monospace", color: "var(--dim)", marginLeft: item.owner ? 6 : "auto", flexShrink: 0 }}>{item.due_offset}</span>}
                      {item.completed_by === 'system' && (
                        <span style={{ fontSize: 9, fontFamily: "Source Code Pro, monospace", background: "var(--accent-dim)", color: "var(--accent)", border: "1px solid rgba(52,211,153,0.3)", borderRadius: 3, padding: "1px 5px", marginLeft: 6, flexShrink: 0 }}>AUTO ✓</span>
                      )}
                      {item.pinned_manual && (
                        <span style={{ fontSize: 9, fontFamily: "Source Code Pro, monospace", background: "var(--surface-2)", color: "var(--text-faint)", border: "1px solid var(--border)", borderRadius: 3, padding: "1px 5px", marginLeft: 4, flexShrink: 0 }}>PINNED</span>
                      )}
                      {item.is_auto && !item.completed_by && <span className="ai-badge">AI</span>}
                    </>
                  )}
                </div>
              );
            })}

            {/* Per-section add row (edit mode) */}
            {editMode && addingInSec === section && (
              <div style={{ display: "flex", gap: 8, padding: "8px 18px", background: "var(--surface-2)", borderTop: "1px solid var(--border)" }}>
                <input className="f-input" style={{ flex: 1 }} value={secNewLabel} autoFocus
                  onChange={e => setSecNewLabel(e.target.value)}
                  placeholder="New item label…"
                  onKeyDown={e => { if (e.key === 'Enter') addItemToSection(section, secNewLabel); if (e.key === 'Escape') { setAddingInSec(null); setSecNewLabel(""); } }} />
                <button className="btn btn-p btn-sm" onClick={() => addItemToSection(section, secNewLabel)}>Add</button>
                <button className="btn btn-s btn-sm" onClick={() => { setAddingInSec(null); setSecNewLabel(""); }}>Cancel</button>
              </div>
            )}
          </div>
        );
      })}

      {/* Edit mode: add section */}
      {editMode && (
        <div style={{ marginBottom: 9 }}>
          <button className="btn btn-s btn-sm" onClick={addNewSection}>+ Add section</button>
        </div>
      )}

      {/* Normal mode: global add item */}
      {total > 0 && !editMode && !adding && (
        <button className="btn btn-s btn-sm" style={{ marginBottom: 9 }} onClick={() => setAdding(true)}>+ Add Item</button>
      )}
      {adding && (
        <div className="card" style={{ padding: 16, marginBottom: 9 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginBottom: 10 }}>
            <div className="f-group">
              <label className="f-label">Section</label>
              <input className="f-input" value={newSection} onChange={e => setNewSection(e.target.value)} placeholder="e.g. Bank & Cash" />
            </div>
            <div className="f-group">
              <label className="f-label">Item</label>
              <input className="f-input" value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="e.g. Complete bank reconciliation" onKeyDown={e => e.key === "Enter" && addItem()} autoFocus />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-p btn-sm" onClick={addItem}>Add</button>
            <button className="btn btn-s btn-sm" onClick={() => { setAdding(false); setNewLabel(""); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Keywords that signal a multi-period expense (prepayment candidate) ───────
const PREPAY_KEYWORDS = [
  'insurance', 'annual', 'subscription', 'licence', 'license', 'saas',
  'maintenance contract', 'support contract', 'retainer', 'rent in advance',
  'annual fee', 'service agreement', 'renewal', 'premium', 'prepaid', 'advance payment',
];

// ─────────────────────────────────────────────────────────────────────────────
// Revenue Feed — Stripe connector + human-in-the-loop review queue
// ─────────────────────────────────────────────────────────────────────────────
function vatCodeForRate(rate) {
  const r = Number(rate);
  if (r === 23)   return 'STD23';
  if (r === 13.5) return 'RED13';
  if (r === 9)    return 'RED9';
  if (r === 0)    return 'ZERO';
  return null;
}

function ReviewItem({ item, conn, fmt, expanded, events, onToggle, onApprove, onReject, approving }) {
  const isWeekly  = item.item_type === 'weekly_summary';
  const isPayout  = item.item_type === 'payout';
  const isPending = item.status === 'pending';
  const statusColor = { pending: 'var(--gold)', approved: 'var(--teal)', rejected: 'var(--danger)' }[item.status] || 'var(--muted)';

  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      <div style={{ padding: '11px 15px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={onToggle}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
            {isWeekly && `${item.period_label} — Charges`}
            {isPayout && `Payout — ${item.payout_date || item.period_label}`}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            {isWeekly && `${item.charge_count || 0} charge${(item.charge_count || 0) !== 1 ? 's' : ''}${item.refund_count ? ` · ${item.refund_count} refund${item.refund_count !== 1 ? 's' : ''}` : ''} · ${item.week_start} – ${item.week_end}`}
            {isPayout && `Bank arrival: ${item.payout_date}`}
          </div>
        </div>
        <div style={{ textAlign: 'right', marginRight: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
            {isWeekly && fmt(item.charge_gross)}
            {isPayout && fmt(item.payout_amount)}
          </div>
          {isWeekly && Number(item.fee_total) > 0 && (
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>fees {fmt(item.fee_total)}</div>
          )}
        </div>
        <div style={{ fontSize: 11, color: statusColor, fontWeight: 600, minWidth: 60, textAlign: 'right' }}>
          {{ pending: 'Pending', approved: 'Approved', rejected: 'Rejected' }[item.status] || item.status}
        </div>
        <div style={{ color: 'var(--text-faint)', fontSize: 11 }}>{expanded ? '▲' : '▼'}</div>
      </div>

      {expanded && (
        <div style={{ padding: '0 15px 14px', background: 'var(--surface-2)', borderTop: '1px solid var(--border)' }}>
          {isWeekly && (
            <div style={{ fontSize: 12, marginTop: 12, marginBottom: 8 }}>
              <div style={{ color: 'var(--text-faint)', marginBottom: 4 }}>Journals to post on approval:</div>
              <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text)', lineHeight: 1.8 }}>
                <div>Dr {conn?.acc_clearing || '1300'} / Cr {conn?.acc_sales || '4000'} &nbsp; {fmt(item.charge_gross)} (gross incl. VAT)</div>
                {Number(item.fee_total) > 0 && <div>Dr {conn?.acc_fees || '6500'} / Cr {conn?.acc_clearing || '1300'} &nbsp; {fmt(item.fee_total)} (fees, exempt)</div>}
              </div>
            </div>
          )}
          {isPayout && (
            <div style={{ fontSize: 12, marginTop: 12, marginBottom: 8 }}>
              <div style={{ color: 'var(--text-faint)', marginBottom: 4 }}>Journal to post on approval:</div>
              <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text)' }}>
                Dr {conn?.acc_bank || '1000'} / Cr {conn?.acc_clearing || '1300'} &nbsp; {fmt(item.payout_amount)}
              </div>
            </div>
          )}

          {isWeekly && (
            <div style={{ marginTop: 8 }}>
              {!events && <div style={{ fontSize: 11, color: 'var(--muted)' }}>Loading events…</div>}
              {events?.length === 0 && <div style={{ fontSize: 11, color: 'var(--muted)' }}>No events loaded.</div>}
              {events?.length > 0 && (
                <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                  <thead><tr style={{ color: 'var(--text-faint)' }}>
                    <th style={{ textAlign: 'left', padding: '3px 0', fontWeight: 500 }}>Date</th>
                    <th style={{ textAlign: 'left', padding: '3px 0', fontWeight: 500 }}>Description</th>
                    <th style={{ textAlign: 'right', padding: '3px 0', fontWeight: 500 }}>Amount</th>
                  </tr></thead>
                  <tbody>
                    {events.map(ev => (
                      <tr key={ev.id} style={{ color: ev.event_type === 'refund' ? 'var(--danger)' : 'var(--text)' }}>
                        <td style={{ padding: '2px 0', whiteSpace: 'nowrap' }}>{ev.occurred_at.slice(0, 10)}</td>
                        <td style={{ padding: '2px 8px 2px 0', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.description}</td>
                        <td style={{ padding: '2px 0', textAlign: 'right' }}>{fmt(ev.gross)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {!isPending && item.journal_ids?.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--teal)' }}>
              Posted {item.journal_ids.length} journal{item.journal_ids.length !== 1 ? 's' : ''}.
            </div>
          )}
          {!isPending && item.rejected_reason && (
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--danger)' }}>Reason: {item.rejected_reason}</div>
          )}

          {isPending && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn btn-p btn-sm" onClick={onApprove} disabled={approving}>
                {approving ? 'Posting…' : 'Approve & Post'}
              </button>
              <button className="btn btn-d btn-sm" onClick={onReject}>Reject</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RevenueFeed({ companyId, company }) {
  const { user } = useUser();
  const baseCurrency = company?.base_currency || 'EUR';
  const salesVatRate = company?.sales_vat_rate ?? 23;
  const fmt = v => new Intl.NumberFormat('en-IE', { style: 'currency', currency: baseCurrency }).format(Number(v) || 0);

  const [connections, setConnections]   = useState([]);
  const [connLoading, setConnLoading]   = useState(true);
  const [showConnect, setShowConnect]   = useState(false);
  const [connForm, setConnForm]         = useState({ api_key: '', signing_secret: '' });
  const [connecting, setConnecting]     = useState(false);
  const [connectErr, setConnectErr]     = useState(null);
  const [webhookUrl, setWebhookUrl]     = useState(null);
  const [items, setItems]               = useState([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [expandedId, setExpandedId]     = useState(null);
  const [drillEvents, setDrillEvents]   = useState({});
  const [approvingId, setApprovingId]   = useState(null);
  const [rejectingId, setRejectingId]   = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [tab, setTab]                   = useState('pending');
  const [clearingBal, setClearingBal]   = useState(null);

  useEffect(() => { if (companyId) loadAll(); }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadAll = async () => {
    setConnLoading(true); setItemsLoading(true);
    const [cr, ir, jr] = await Promise.all([
      supabase.from('provider_connections')
        .select('id,provider,status,display_name,last_event_at,acc_sales,acc_clearing,acc_fees,acc_bank,webhook_secret_hint,created_at')
        .eq('company_id', companyId).neq('status', 'disconnected').order('created_at'),
      supabase.from('revenue_review_items')
        .select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
      supabase.from('journals').select('debit_account,credit_account,amount')
        .eq('company_id', companyId).or('debit_account.eq.1300,credit_account.eq.1300'),
    ]);
    setConnections(cr.data || []);
    setItems(ir.data || []);
    const bal = (jr.data || []).reduce((s, j) => {
      const a = Number(j.amount || 0);
      return j.debit_account === '1300' ? s + a : j.credit_account === '1300' ? s - a : s;
    }, 0);
    setClearingBal(bal);
    setConnLoading(false); setItemsLoading(false);
  };

  const connectStripe = async () => {
    if (!connForm.api_key.trim()) { setConnectErr('API key required'); return; }
    setConnecting(true); setConnectErr(null); setWebhookUrl(null);
    const r = await fetch('/api/stripe-connect', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: companyId, api_key: connForm.api_key.trim(), signing_secret: connForm.signing_secret.trim() }),
    });
    const d = await r.json();
    if (!r.ok || d.error) { setConnectErr(d.error || 'Connection failed'); setConnecting(false); return; }
    setWebhookUrl(d.webhook_url);
    setConnecting(false);
    setConnForm({ api_key: '', signing_secret: '' });
    loadAll();
  };

  const disconnectStripe = async (id) => {
    if (!confirm('Disconnect this Stripe account? Existing journal entries are not affected.')) return;
    await fetch(`/api/stripe-connect?id=${id}`, { method: 'DELETE' });
    loadAll();
  };

  const loadDrillEvents = async (item) => {
    if (drillEvents[item.id] !== undefined) return;
    const { data } = await supabase.from('revenue_events')
      .select('id,event_type,occurred_at,gross,fee,description')
      .eq('company_id', companyId)
      .gte('occurred_at', item.week_start + 'T00:00:00Z')
      .lte('occurred_at', item.week_end   + 'T23:59:59Z')
      .in('event_type', ['charge', 'refund'])
      .order('occurred_at');
    setDrillEvents(p => ({ ...p, [item.id]: data || [] }));
  };

  const approveWeekly = async (item) => {
    setApprovingId(item.id);
    const conn = connections.find(c => c.id === item.connection_id) || {};
    const gross = Math.max(0, Number(item.charge_gross) || 0);
    const vc = vatCodeForRate(salesVatRate);
    const ref = `STR-${(item.period_label || '').replace(/\s+/g, '-')}`;
    const clearingAcc = conn.acc_clearing || '1300';
    const salesAcc    = conn.acc_sales    || '4000';
    const feesAcc     = conn.acc_fees     || '6500';
    // Same pattern as any normal rated sale: Dr clearing (gross) / Cr sales (gross) with rate code.
    // VAT3 back-calculates T1 from this journal exactly as it does for any other sales entry.
    const rows = [
      {
        company_id: companyId, date: item.week_end,
        description: `Stripe revenue — ${item.period_label}`,
        debit_account: clearingAcc, credit_account: salesAcc,
        amount: gross, reference: ref,
        vat_code: vc, source_recurring_id: null, is_accrual_reversal: false,
      },
      ...(Number(item.fee_total) > 0 ? [{
        company_id: companyId, date: item.week_end,
        description: `Stripe processing fees — ${item.period_label}`,
        debit_account: feesAcc, credit_account: clearingAcc,
        amount: Number(item.fee_total),
        reference: `${ref}-FEES`, vat_code: 'EXEMPT', source_recurring_id: null, is_accrual_reversal: false,
      }] : []),
    ];
    const { data: ins, error: jErr } = await supabase.from('journals').insert(rows).select('id');
    if (jErr) { alert('Journal post failed: ' + jErr.message); setApprovingId(null); return; }
    await supabase.from('revenue_review_items').update({
      status: 'approved', approved_by: user?.id, approved_at: new Date().toISOString(),
      journal_ids: (ins || []).map(j => j.id),
    }).eq('id', item.id);
    setApprovingId(null); loadAll();
  };

  const approvePayout = async (item) => {
    setApprovingId(item.id);
    const conn = connections.find(c => c.id === item.connection_id) || {};
    const pd  = item.payout_date || item.week_start;
    const { data: ins, error: jErr } = await supabase.from('journals').insert({
      company_id: companyId, date: pd,
      description: `Stripe payout — ${new Date(pd + 'T12:00:00Z').toLocaleDateString('en-IE', { day: 'numeric', month: 'short' })}`,
      debit_account: conn.acc_bank || '1000', credit_account: conn.acc_clearing || '1300',
      amount: Number(item.payout_amount), reference: `STR-PO-${pd}`,
      vat_code: null, source_recurring_id: null, is_accrual_reversal: false,
    }).select('id');
    if (jErr) { alert('Journal post failed: ' + jErr.message); setApprovingId(null); return; }
    await supabase.from('revenue_review_items').update({
      status: 'approved', approved_by: user?.id, approved_at: new Date().toISOString(),
      journal_ids: [(ins || [])[0]?.id].filter(Boolean),
    }).eq('id', item.id);
    setApprovingId(null); loadAll();
  };

  const rejectItem = async () => {
    await supabase.from('revenue_review_items').update({
      status: 'rejected', rejected_reason: rejectReason,
    }).eq('id', rejectingId);
    setRejectingId(null); setRejectReason(''); loadAll();
  };

  const conn    = connections[0];
  const pending = items.filter(i => i.status === 'pending');
  const history = items.filter(i => i.status !== 'pending');

  return (
    <div className="fade-up" style={{ maxWidth: 820 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginBottom: 18 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>Revenue Feed</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Automated journals from payment providers — review before posting.</div>
        </div>
        {conn && clearingBal !== null && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>Stripe Clearing (1300)</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: Math.abs(clearingBal) < 0.01 ? 'var(--teal)' : 'var(--gold)' }}>{fmt(clearingBal)}</div>
          </div>
        )}
      </div>

      {/* Connection card */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="card-title">Stripe Connection</span>
          {!connLoading && !conn && !showConnect && (
            <button className="btn btn-s btn-sm" onClick={() => setShowConnect(true)}>Connect Stripe</button>
          )}
        </div>
        {connLoading
          ? <div style={{ padding: '14px 15px', color: 'var(--muted)', fontSize: 12 }}>Loading…</div>
          : conn && (
            <div style={{ padding: '14px 15px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--teal)', flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{conn.display_name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    Connected · Last event: {conn.last_event_at ? new Date(conn.last_event_at).toLocaleDateString('en-IE') : 'none yet'}
                  </div>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button className="btn btn-s btn-sm" onClick={() => setShowConnect(v => !v)}>Update key</button>
                  <button className="btn btn-d btn-sm" onClick={() => disconnectStripe(conn.id)}>Disconnect</button>
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', background: 'var(--surface-2)', borderRadius: 4, padding: '6px 10px', marginBottom: 6 }}>
                Webhook URL: <code style={{ fontSize: 11 }}>https://app.ledgrly.ie/api/stripe-webhook?cid={companyId}</code>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                Nominals — Sales: <strong>{conn.acc_sales}</strong> · Clearing: <strong>{conn.acc_clearing}</strong> · Fees: <strong>{conn.acc_fees}</strong> · Bank: <strong>{conn.acc_bank}</strong>
                {conn.webhook_secret_hint && <> · Secret: <strong>{conn.webhook_secret_hint}</strong></>}
              </div>
            </div>
          )
        }

        {/* Connect / update form */}
        {(showConnect || (!connLoading && !conn)) && (
          <div style={{ padding: '14px 15px', borderTop: conn ? '1px solid var(--border)' : 'none' }}>
            {!conn && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.7 }}>
                1. In Stripe Dashboard → Developers → Webhooks → Add endpoint.<br/>
                2. URL: <code style={{ fontSize: 11 }}>https://app.ledgrly.ie/api/stripe-webhook?cid={companyId}</code><br/>
                3. Select events: <code>payment_intent.succeeded</code>, <code>charge.refunded</code>, <code>payout.paid</code><br/>
                4. Copy the signing secret, then paste both your restricted API key and signing secret below.
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="f-group">
                <label className="f-label">Restricted API Key</label>
                <input className="f-input" type="password" placeholder="rk_live_…" value={connForm.api_key}
                  onChange={e => setConnForm(p => ({ ...p, api_key: e.target.value }))} autoComplete="new-password" />
              </div>
              <div className="f-group">
                <label className="f-label">Webhook Signing Secret</label>
                <input className="f-input" type="password" placeholder="whsec_…" value={connForm.signing_secret}
                  onChange={e => setConnForm(p => ({ ...p, signing_secret: e.target.value }))} autoComplete="new-password" />
              </div>
            </div>
            {connectErr && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 6 }}>{connectErr}</div>}
            {webhookUrl && <div style={{ fontSize: 12, color: 'var(--teal)', marginTop: 8 }}>Connected! Webhook URL copied above.</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="btn btn-p btn-sm" onClick={connectStripe} disabled={connecting}>
                {connecting ? 'Connecting…' : conn ? 'Update' : 'Connect'}
              </button>
              <button className="btn btn-s btn-sm" onClick={() => { setShowConnect(false); setConnectErr(null); }}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Review queue */}
      {conn && (
        <div className="card">
          <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="card-title">Review Queue</span>
            {pending.length > 0 && (
              <span style={{ fontSize: 11, background: 'var(--accent)', color: '#fff', borderRadius: 10, padding: '1px 7px', fontWeight: 600 }}>
                {pending.length}
              </span>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {['pending', 'history'].map(t => (
                <button key={t} className="btn btn-s btn-sm"
                  style={tab === t ? { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' } : {}}
                  onClick={() => setTab(t)}>
                  {t === 'pending' ? `Pending${pending.length ? ` (${pending.length})` : ''}` : 'History'}
                </button>
              ))}
            </div>
          </div>
          {itemsLoading && <div style={{ padding: '14px 15px', color: 'var(--muted)', fontSize: 12 }}>Loading…</div>}
          {!itemsLoading && tab === 'pending' && pending.length === 0 && (
            <div style={{ padding: '32px 15px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              No pending items — Stripe events will appear here automatically.
            </div>
          )}
          {!itemsLoading && (tab === 'pending' ? pending : history).map(item => (
            <ReviewItem key={item.id} item={item} conn={conn} fmt={fmt}
              expanded={expandedId === item.id}
              events={drillEvents[item.id]}
              onToggle={() => {
                if (expandedId !== item.id) { loadDrillEvents(item); setExpandedId(item.id); }
                else setExpandedId(null);
              }}
              onApprove={() => item.item_type === 'payout' ? approvePayout(item) : approveWeekly(item)}
              onReject={() => setRejectingId(item.id)}
              approving={approvingId === item.id}
            />
          ))}
        </div>
      )}

      {/* Reject modal */}
      {rejectingId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => { setRejectingId(null); setRejectReason(''); }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 24, width: 380 }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, marginBottom: 12 }}>Reject item</div>
            <textarea className="f-input" rows={3} placeholder="Reason (optional)"
              value={rejectReason} onChange={e => setRejectReason(e.target.value)}
              style={{ width: '100%', resize: 'vertical', marginBottom: 12, boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-d btn-sm" onClick={rejectItem}>Reject</button>
              <button className="btn btn-s btn-sm" onClick={() => { setRejectingId(null); setRejectReason(''); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SuggestedJournals
//
// Detection is 100% code-driven against real journal data.
// The LLM (via /api/suggest-journals) is called ONLY for prepayment candidates
// to classify true/false and write a rationale.  It never invents amounts.
// ─────────────────────────────────────────────────────────────────────────────
function SuggestedJournals({ period, companyId, company }) {
  const [suggestions, setSuggestions] = useState([]);
  const [loadingInit, setLoadingInit] = useState(true);
  const [generating, setGenerating]   = useState(false);
  const [sgError, setSgError]         = useState(null);
  const [approvingId, setApprovingId] = useState(null);
  const [edits, setEdits]             = useState({}); // { [id]: { debit_account, credit_account, amount, description } }

  const { accounts: coaAccounts } = useChartOfAccounts(companyId);
  const baseCurrency = company?.base_currency || company?.currency || 'EUR';

  const acctName = (code) => {
    const pool = coaAccounts.length > 0 ? coaAccounts : COA_STATIC_FALLBACK;
    return pool.find(a => a.code === code)?.name || GL_ACCOUNTS.find(a => a.code === code)?.name || code;
  };

  const acctOptions = (coaAccounts.filter(a => a.is_active !== false).length > 0
    ? coaAccounts.filter(a => a.is_active !== false) : GL_ACCOUNTS);

  const [py, pm] = period.split('-').map(Number);
  const periodStart = `${period}-01`;
  const periodEnd   = new Date(py, pm, 0).toISOString().slice(0, 10);
  const lbStart = (() => {
    let y = py, m = pm - 3;
    while (m <= 0) { m += 12; y--; }
    return `${y}-${String(m).padStart(2, '0')}-01`;
  })();
  const lbEnd = new Date(py, pm - 1, 0).toISOString().slice(0, 10); // day before period

  // Load existing suggestions for this period
  useEffect(() => {
    if (!companyId) { setLoadingInit(false); return; }
    (async () => {
      const { data } = await supabase.from('suggested_journals')
        .select('*').eq('company_id', companyId).eq('period', period)
        .order('created_at', { ascending: false });
      setSuggestions(data || []);
      setLoadingInit(false);
    })();
  }, [companyId, period]); // eslint-disable-line

  const [showEvidence, setShowEvidence] = useState({});
  const toggleEvidence = (id) => setShowEvidence(prev => ({ ...prev, [id]: !prev[id] }));

  // ── Engine ────────────────────────────────────────────────────────────────────
  // Phase 1: pure code queries + statistical analysis → data-derived amounts.
  // Phase 2: /api/suggest-journals classifies prepayment candidates (true/false)
  //          and writes rationale text. It receives computed amounts; never invents them.
  const generateSuggestions = async () => {
    setGenerating(true); setSgError(null);
    try {
      const [{ data: curRaw, error: curErr }, { data: lbRaw, error: lbErr }, { data: existingRaw }] = await Promise.all([
        supabase.from('journals').select('id,date,debit_account,credit_account,amount,description')
          .eq('company_id', companyId).gte('date', periodStart).lte('date', periodEnd),
        supabase.from('journals').select('id,date,debit_account,credit_account,amount,description')
          .eq('company_id', companyId).gte('date', lbStart).lte('date', lbEnd),
        supabase.from('suggested_journals').select('type,debit_account,credit_account,status')
          .eq('company_id', companyId).eq('period', period),
      ]);

      if (curErr) throw new Error(`Journal query failed: ${curErr.message}`);
      if (lbErr)  throw new Error(`Lookback query failed: ${lbErr.message}`);

      const cur = curRaw || [];
      const lb  = lbRaw  || [];

      // Already raised this period (any status) → skip to avoid duplicates
      const alreadySuggested = new Set(
        (existingRaw || []).map(s => `${s.type}|${s.debit_account}|${s.credit_account}`)
      );

      const isExpense = (code) => {
        if (!code) return false;
        const pool = coaAccounts.length > 0 ? coaAccounts : COA_STATIC_FALLBACK;
        const found = pool.find(a => a.code === code);
        if (found) return found.account_type === 'expense';
        return code >= '5000' && code < '7000';
      };

      const readyCandidates  = []; // missing_accrual candidates (no AI needed)
      const prepayCandidates = []; // prepayment candidates → sent to /api/suggest-journals

      // ── Detector A: Missing accrual (amounts from historical average) ─────────
      // Collect lookback expense journals grouped by month → account
      const lbByMo = {};
      lb.filter(j => isExpense(j.debit_account)).forEach(j => {
        const mo = j.date.slice(0, 7);
        if (!lbByMo[mo]) lbByMo[mo] = {};
        if (!lbByMo[mo][j.debit_account]) lbByMo[mo][j.debit_account] = [];
        lbByMo[mo][j.debit_account].push({ amount: Number(j.amount), desc: j.description || '', date: j.date });
      });
      const lbMonths = Object.keys(lbByMo).sort().slice(-3);

      const acctFreq = {};
      lbMonths.forEach(mo => Object.keys(lbByMo[mo] || {}).forEach(code => {
        acctFreq[code] = (acctFreq[code] || 0) + 1;
      }));
      const curExpCodes = new Set(cur.filter(j => isExpense(j.debit_account)).map(j => j.debit_account));

      Object.entries(acctFreq)
        .filter(([code, freq]) => freq >= 2 && !curExpCodes.has(code))
        .forEach(([code]) => {
          if (alreadySuggested.has(`missing_accrual|${code}|2300`)) return;
          const postings = lbMonths.flatMap(mo => lbByMo[mo][code] || []);
          const amounts  = postings.map(p => p.amount);
          const avg      = amounts.reduce((s, a) => s + a, 0) / amounts.length;
          if (avg < 50) return;

          // Most-used description across postings (used as accrual description)
          const descCounts = {};
          postings.map(p => p.desc).filter(Boolean).forEach(d => { descCounts[d] = (descCounts[d] || 0) + 1; });
          const topDesc = Object.entries(descCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
          const name    = acctName(code);

          readyCandidates.push({
            type: 'missing_accrual',
            debit_account: code, credit_account: '2300',
            // amount = 3-month average of ACTUAL journal postings — never invented
            amount: Math.round(avg * 100) / 100,
            description: `Accrual — ${topDesc || name}`,
            rationale:
              `${name} posted in ${acctFreq[code]} of the last ${lbMonths.length} months (${lbMonths.join(', ')}) ` +
              `but has no entry in ${period}. ` +
              `${lbMonths.length}-month average: ${fmtCurrencyFull(avg, baseCurrency)}.` +
              (topDesc ? ` Most recent description: "${topDesc}".` : ''),
            meta: {
              code, accountName: name, avgAmount: avg,
              monthsPosted: acctFreq[code], lbMonths,
              topDescription: topDesc,
              // evidence: the real journal rows that formed the average
              evidence: postings.map(p => ({ date: p.date, amount: p.amount, desc: p.desc })),
            },
          });
        });

      // ── Detector B: Prepayment candidate (amounts from current-period actuals) ─
      const lbAmts = {}, lbMoCount = {};
      lb.filter(j => isExpense(j.debit_account)).forEach(j => {
        const c = j.debit_account;
        if (!lbAmts[c]) { lbAmts[c] = []; lbMoCount[c] = new Set(); }
        lbAmts[c].push({ amount: Number(j.amount), date: j.date, desc: j.description || '' });
        lbMoCount[c].add(j.date.slice(0, 7));
      });
      const lbAvg = {};
      Object.keys(lbAmts).forEach(c => {
        lbAvg[c] = lbAmts[c].reduce((s, a) => s + a.amount, 0) / (lbMoCount[c].size || 1);
      });

      // Group current period by account (may have multiple lines → sum)
      const curByAcct = {};
      cur.filter(j => isExpense(j.debit_account)).forEach(j => {
        const c = j.debit_account;
        if (!curByAcct[c]) curByAcct[c] = { total: 0, journals: [] };
        curByAcct[c].total += Number(j.amount);
        curByAcct[c].journals.push(j);
      });

      Object.entries(curByAcct).forEach(([code, { total, journals: jlist }]) => {
        if (alreadySuggested.has(`prepayment|1200|${code}`)) return;
        const repJ        = jlist[0];
        const descLower   = (repJ.description || '').toLowerCase();
        const hasKeyword  = PREPAY_KEYWORDS.some(kw => descLower.includes(kw));
        const avg         = lbAvg[code] || 0;
        const isAnomaly   = avg > 0 && total > avg * 2.0;
        if (!(hasKeyword || isAnomaly) || total < 300) return;

        // Heuristic spread estimate passed to the AI as a starting point
        let spreadEstimate = 12;
        if (descLower.includes('quarterly')) spreadEstimate = 3;
        else if (descLower.includes('semi-annual') || descLower.includes('half year') || descLower.includes('bi-annual')) spreadEstimate = 6;
        else if (isAnomaly && avg > 0) spreadEstimate = Math.min(Math.max(Math.round(total / avg), 3), 24);

        const name = acctName(code);
        prepayCandidates.push({
          code, account_name: name,
          // total amount comes from the ACTUAL current-period journal — never invented
          amount: total,
          avg_per_month: Math.round(avg * 100) / 100,
          amount_fmt:    fmtCurrencyFull(total, baseCurrency),
          avg_fmt:       fmtCurrencyFull(avg, baseCurrency),
          description:   repJ.description || name,
          has_keyword:   hasKeyword,
          spread_estimate: spreadEstimate,
          // evidence for the UI
          currentJournals: jlist.map(j => ({ date: j.date, amount: Number(j.amount), desc: j.description || '' })),
          lookbackSamples: (lbAmts[code] || []).map(e => ({ date: e.date, amount: e.amount, desc: e.desc })),
        });
      });

      // ── Phase 2: AI classification for prepayment candidates ─────────────────
      // The API receives amounts; it may only classify true/false + write rationale.
      let aiResults = [];
      if (prepayCandidates.length > 0) {
        try {
          const resp = await fetch('/api/suggest-journals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ candidates: prepayCandidates, period }),
          });
          if (resp.ok) {
            const body = await resp.json();
            aiResults = body.results || [];
          }
        } catch (_) { /* fall through to heuristic rationale */ }
      }

      // Merge AI results back onto prepay candidates; filter out non-prepayments
      const aiById = Object.fromEntries(aiResults.map((r, i) => [i, r]));
      prepayCandidates.forEach((c, idx) => {
        const ai           = aiById[idx] || {};
        const isPrep       = ai.is_prepayment !== false; // default true if no AI result
        if (!isPrep) return;

        // spread_months comes from AI (refined) falling back to heuristic estimate
        const spreadMonths  = Math.min(Math.max(Number(ai.spread_months) || c.spread_estimate, 2), 24);
        const futureMonths  = spreadMonths - 1;
        // ALL amounts derived from code (actual payment / spread)
        const monthlyAmt    = Math.round((c.amount / spreadMonths) * 100) / 100;
        const prepayAmt     = Math.round(monthlyAmt * futureMonths * 100) / 100;
        if (prepayAmt < 50) return;

        const rationale = ai.rationale ||
          (c.has_keyword && c.avg_per_month === 0
            ? `"${c.description}" indicates a multi-period payment. Deferring ${futureMonths} of ${spreadMonths} months (${fmtCurrencyFull(monthlyAmt, baseCurrency)}/month) to Prepayments.`
            : `${c.account_name} payment of ${fmtCurrencyFull(c.amount, baseCurrency)} is ${(c.amount / c.avg_per_month).toFixed(1)}× the ${lbMonths.length}-month average of ${fmtCurrencyFull(c.avg_per_month, baseCurrency)}, suggesting an advance or annual payment. Spreading over ${spreadMonths} months.`);

        readyCandidates.push({
          type: 'prepayment',
          debit_account: '1200', credit_account: c.code,
          amount: prepayAmt,
          description: `Prepayment — ${c.description}`,
          rationale,
          meta: {
            code: c.code, accountName: c.account_name,
            totalAmount: c.amount, spreadMonths, futureMonths, monthlyAmount: monthlyAmt,
            sourceDesc: c.description, hasKeyword: c.has_keyword, isAnomaly: c.avg_per_month > 0,
            avgPerMonth: c.avg_per_month,
            evidence: c.currentJournals,
            lookbackSamples: c.lookbackSamples,
          },
        });
      });

      if (readyCandidates.length === 0) {
        setSgError(
          `No suggestions for ${period} — all recurring expenses appear accounted for ` +
          `and no anomalous payments detected. ` +
          `(Analysed ${cur.length} current-period journal(s) against ${lb.length} lookback journal(s) ` +
          `from ${lbStart} → ${lbEnd}.)`
        );
        setGenerating(false);
        return;
      }

      const rows = readyCandidates.map(c => ({
        company_id: companyId, period,
        type: c.type, status: 'pending',
        debit_account: c.debit_account, credit_account: c.credit_account,
        amount: c.amount, description: c.description, date: periodEnd,
        rationale: c.rationale, meta: c.meta,
      }));
      const { data: inserted, error: insErr } = await supabase.from('suggested_journals').insert(rows).select();
      if (insErr) throw new Error(insErr.message);
      setSuggestions(prev => [...(inserted || []), ...prev]);

    } catch (e) { setSgError(e.message); }
    setGenerating(false);
  };

  // ── Approve ───────────────────────────────────────────────────────────────────
  const approveSuggestion = async (sg) => {
    setApprovingId(sg.id);
    try {
      const e    = edits[sg.id] || {};
      const dAcc = e.debit_account  || sg.debit_account;
      const cAcc = e.credit_account || sg.credit_account;
      const amt  = parseFloat(e.amount ?? sg.amount);
      const desc = ((e.description ?? (sg.description || ''))).trim() || 'Suggested journal';
      const ref  = `SJ-${sg.id.slice(0, 8).toUpperCase()}`;

      const { error: jErr } = await supabase.from('journals').insert({
        company_id: companyId, date: periodEnd, description: desc,
        debit_account: dAcc, credit_account: cAcc,
        amount: amt, reference: ref, is_accrual_reversal: false,
      });
      if (jErr) throw new Error(jErr.message);

      if (sg.type === 'missing_accrual') {
        // Post the reversal on the 1st of next period
        const nm = pm === 12 ? 1 : pm + 1;
        const ny = pm === 12 ? py + 1 : py;
        const revDate = `${ny}-${String(nm).padStart(2, '0')}-01`;
        await supabase.from('journals').insert({
          company_id: companyId, date: revDate,
          description: `Reversal: ${desc}`,
          debit_account: cAcc, credit_account: dAcc,
          amount: amt, reference: `REV-${ref}`, is_accrual_reversal: true,
        });
      }

      if (sg.type === 'prepayment') {
        const { monthlyAmount, futureMonths, code: expCode, sourceDesc } = sg.meta || {};
        if (monthlyAmount && futureMonths && expCode) {
          // Set up monthly releases: Dr expenseAccount / Cr 1200 Prepayments
          const nm = pm === 12 ? 1  : pm + 1;
          const ny = pm === 12 ? py + 1 : py;
          const startDate  = `${ny}-${String(nm).padStart(2, '0')}-01`;
          let em = pm + futureMonths, ey = py;
          while (em > 12) { em -= 12; ey++; }
          const endDate = `${ey}-${String(em).padStart(2, '0')}-28`;
          await supabase.from('recurring_journals').insert({
            company_id: companyId,
            name: `Prepayment release — ${sourceDesc || acctName(expCode)}`,
            debit_account: expCode, credit_account: '1200',
            amount: monthlyAmount,
            description_template: `Prepayment release — ${sourceDesc || acctName(expCode)} {month} {year}`,
            day_of_month: 28, start_date: startDate, end_date: endDate,
            journal_type: 'standard', active: true,
          });
        }
      }

      await supabase.from('suggested_journals').update({ status: 'approved' }).eq('id', sg.id);
      setSuggestions(prev => prev.map(s => s.id === sg.id ? { ...s, status: 'approved' } : s));
    } catch (e) { setSgError(e.message); }
    setApprovingId(null);
  };

  // ── Reject ────────────────────────────────────────────────────────────────────
  const rejectSuggestion = async (id) => {
    await supabase.from('suggested_journals').update({ status: 'rejected' }).eq('id', id);
    setSuggestions(prev => prev.map(s => s.id === id ? { ...s, status: 'rejected' } : s));
  };

  const setEdit = (id, field, value) =>
    setEdits(prev => ({ ...prev, [id]: { ...(prev[id] || {}), [field]: value } }));

  if (loadingInit) return null;

  const pending  = suggestions.filter(s => s.status === 'pending');
  const approved = suggestions.filter(s => s.status === 'approved');
  const rejected = suggestions.filter(s => s.status === 'rejected');

  const drStyle = { fontSize: 10, fontFamily: 'Source Code Pro, monospace', fontWeight: 700, color: 'var(--teal)', width: 24, flexShrink: 0, textAlign: 'right' };
  const crStyle = { fontSize: 10, fontFamily: 'Source Code Pro, monospace', fontWeight: 700, color: 'var(--red)', width: 24, flexShrink: 0, textAlign: 'right' };

  return (
    <div style={{ marginTop: 32 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14, gap: 12 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>Suggested Journals</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            Analysing <strong>{period}</strong> against lookback {lbStart} → {lbEnd}.
            {' '}Review and edit each draft, then approve to post. Nothing posts automatically.
          </div>
        </div>
        <button className="btn btn-p" style={{ flexShrink: 0 }} onClick={generateSuggestions} disabled={generating}>
          {generating ? 'Analysing…' : '⚡ Generate suggestions'}
        </button>
      </div>

      {sgError && (
        <div style={{ padding: '10px 14px', background: 'rgba(139,32,32,0.05)', border: '1px solid rgba(139,32,32,0.2)', color: 'var(--red)', borderRadius: 6, fontSize: 12, marginBottom: 12 }}>
          {sgError}
        </div>
      )}

      {suggestions.length === 0 && !generating && (
        <div style={{ textAlign: 'center', padding: '36px 24px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--dim)', fontSize: 13 }}>
          Click "Generate suggestions" to analyse {period} journals for missing accruals and prepayment opportunities.
        </div>
      )}

      {/* ── Pending suggestions ── */}
      {pending.map(sg => {
        const e    = edits[sg.id] || {};
        const dAcc = e.debit_account  ?? sg.debit_account;
        const cAcc = e.credit_account ?? sg.credit_account;
        const amt  = e.amount         ?? sg.amount;
        const desc = e.description    ?? (sg.description || '');
        const busy = approvingId === sg.id;

        // Reversal / release preview text
        const nm = pm === 12 ? 1  : pm + 1;
        const ny = pm === 12 ? py + 1 : py;
        const nextPeriodLabel = new Date(ny, nm - 1, 1).toLocaleDateString('en-IE', { month: 'long', year: 'numeric' });

        return (
          <div key={sg.id} className="card" style={{ marginBottom: 12 }}>
            {/* Card header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)', borderRadius: 'var(--radius) var(--radius) 0 0' }}>
              <span style={{ fontSize: 10, fontFamily: 'Source Code Pro, monospace', fontWeight: 600, letterSpacing: '0.05em', padding: '2px 9px', borderRadius: 20, ...(sg.type === 'missing_accrual' ? { color: '#92400e', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)' } : { color: '#4338ca', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)' }) }}>
                {sg.type === 'missing_accrual' ? 'MISSING ACCRUAL' : 'PREPAYMENT'}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{desc}</span>
              <span style={{ fontSize: 13, fontFamily: 'Source Code Pro, monospace', color: 'var(--text)', fontWeight: 700, flexShrink: 0 }}>{fmtCurrencyFull(Number(amt), baseCurrency)}</span>
            </div>

            <div style={{ padding: '14px 16px' }}>
              {/* Editable DR line */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                <span style={drStyle}>DR</span>
                <select className="f-input" style={{ flex: 1, fontSize: 12 }} value={dAcc} onChange={ev => setEdit(sg.id, 'debit_account', ev.target.value)}>
                  {acctOptions.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name || a.code}</option>)}
                </select>
                <input className="f-input" style={{ width: 110, fontSize: 12, fontFamily: 'Source Code Pro, monospace' }} type="number" min="0" step="0.01" value={amt} onChange={ev => setEdit(sg.id, 'amount', ev.target.value)} />
              </div>
              {/* Editable CR line */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={crStyle}>CR</span>
                <select className="f-input" style={{ flex: 1, fontSize: 12 }} value={cAcc} onChange={ev => setEdit(sg.id, 'credit_account', ev.target.value)}>
                  {acctOptions.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name || a.code}</option>)}
                </select>
                <span style={{ width: 110, fontSize: 12, fontFamily: 'Source Code Pro, monospace', color: 'var(--text-faint)', textAlign: 'right' }}>{fmtCurrencyFull(Number(amt), baseCurrency)}</span>
              </div>
              {/* Description */}
              <input className="f-input" style={{ width: '100%', fontSize: 12, marginBottom: 10 }} value={desc} onChange={ev => setEdit(sg.id, 'description', ev.target.value)} placeholder="Description…" />

              {/* Rationale */}
              <div style={{ fontSize: 12, color: 'var(--muted)', background: 'var(--surface-2)', borderRadius: 5, padding: '9px 12px', marginBottom: 12, lineHeight: 1.65 }}>
                {sg.type === 'missing_accrual' ? '📋 ' : '📅 '}{sg.rationale}
                {sg.type === 'missing_accrual' && (
                  <div style={{ marginTop: 6, fontSize: 11, color: 'var(--teal)' }}>
                    On approval: a reversing entry Dr {acctName('2300')} / Cr {acctName(dAcc)} will be auto-posted on 1 {nextPeriodLabel}.
                  </div>
                )}
                {sg.type === 'prepayment' && sg.meta?.monthlyAmount && (
                  <div style={{ marginTop: 6, fontSize: 11, color: 'var(--teal)' }}>
                    On approval: a recurring release of {fmtCurrencyFull(sg.meta.monthlyAmount, baseCurrency)}/month (Dr {acctName(cAcc)} / Cr {acctName('1200')}) will be set up for {sg.meta.futureMonths} months from {nextPeriodLabel}.
                  </div>
                )}
              </div>

              {/* Evidence — collapsible source-data pane */}
              {sg.meta?.evidence?.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <button
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--dim)', padding: 0, fontFamily: 'Source Code Pro, monospace', letterSpacing: '0.04em' }}
                    onClick={() => toggleEvidence(sg.id)}>
                    {showEvidence[sg.id] ? '▾' : '▸'} SOURCE DATA ({sg.meta.evidence.length} journal{sg.meta.evidence.length !== 1 ? 's' : ''})
                  </button>
                  {showEvidence[sg.id] && (
                    <div style={{ marginTop: 6, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 4, padding: '8px 12px', fontSize: 11, fontFamily: 'Source Code Pro, monospace', color: 'var(--muted)' }}>
                      {sg.type === 'missing_accrual' && (
                        <div style={{ marginBottom: 4, color: 'var(--text-muted)', fontSize: 10, letterSpacing: '0.05em' }}>
                          LOOKBACK JOURNALS USED TO COMPUTE AVERAGE
                        </div>
                      )}
                      {sg.type === 'prepayment' && (
                        <div style={{ marginBottom: 4, color: 'var(--text-muted)', fontSize: 10, letterSpacing: '0.05em' }}>
                          CURRENT-PERIOD JOURNAL(S) THAT TRIGGERED THIS SUGGESTION
                        </div>
                      )}
                      {sg.meta.evidence.map((e, i) => (
                        <div key={i} style={{ display: 'flex', gap: 12, padding: '2px 0', borderBottom: i < sg.meta.evidence.length - 1 ? '1px dashed var(--border)' : 'none' }}>
                          <span style={{ color: 'var(--dim)', width: 80, flexShrink: 0 }}>{e.date}</span>
                          <span style={{ color: 'var(--text)', width: 90, flexShrink: 0, textAlign: 'right' }}>{fmtCurrencyFull(e.amount, baseCurrency)}</span>
                          <span style={{ color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.desc || '—'}</span>
                        </div>
                      ))}
                      {sg.type === 'missing_accrual' && (
                        <div style={{ marginTop: 5, paddingTop: 5, borderTop: '1px solid var(--border)', color: 'var(--text)', display: 'flex', gap: 12 }}>
                          <span style={{ width: 80, flexShrink: 0 }}>Average</span>
                          <span style={{ width: 90, flexShrink: 0, textAlign: 'right', fontWeight: 600 }}>{fmtCurrencyFull(sg.meta.avgAmount, baseCurrency)}</span>
                          <span style={{ color: 'var(--dim)' }}>from {sg.meta.evidence.length} posting{sg.meta.evidence.length !== 1 ? 's' : ''} over {sg.meta.lbMonths?.join(', ') || 'lookback period'}</span>
                        </div>
                      )}
                      {sg.type === 'prepayment' && sg.meta.lookbackSamples?.length > 0 && (
                        <div style={{ marginTop: 6 }}>
                          <div style={{ color: 'var(--text-muted)', fontSize: 10, letterSpacing: '0.05em', marginBottom: 4 }}>LOOKBACK AVERAGE BASIS</div>
                          {sg.meta.lookbackSamples.map((e, i) => (
                            <div key={i} style={{ display: 'flex', gap: 12, padding: '2px 0' }}>
                              <span style={{ color: 'var(--dim)', width: 80, flexShrink: 0 }}>{e.date}</span>
                              <span style={{ color: 'var(--text)', width: 90, flexShrink: 0, textAlign: 'right' }}>{fmtCurrencyFull(e.amount, baseCurrency)}</span>
                              <span style={{ color: 'var(--muted)' }}>{e.desc || '—'}</span>
                            </div>
                          ))}
                          <div style={{ marginTop: 5, paddingTop: 5, borderTop: '1px solid var(--border)', color: 'var(--text)', display: 'flex', gap: 12 }}>
                            <span style={{ width: 80, flexShrink: 0 }}>Monthly avg</span>
                            <span style={{ width: 90, flexShrink: 0, textAlign: 'right', fontWeight: 600 }}>{fmtCurrencyFull(sg.meta.avgPerMonth, baseCurrency)}</span>
                            <span style={{ color: 'var(--dim)' }}>→ current {fmtCurrencyFull(sg.meta.totalAmount, baseCurrency)} = {(sg.meta.totalAmount / sg.meta.avgPerMonth).toFixed(1)}× normal</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-p btn-sm" onClick={() => approveSuggestion(sg)} disabled={busy}>
                  {busy ? 'Posting…' : '✓ Approve & Post'}
                </button>
                <button className="btn btn-d btn-sm" onClick={() => rejectSuggestion(sg.id)} disabled={busy}>Reject</button>
              </div>
            </div>
          </div>
        );
      })}

      {/* ── Approved / Rejected history ── */}
      {(approved.length > 0 || rejected.length > 0) && (
        <div>
          {approved.map(sg => (
            <div key={sg.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', background: 'rgba(29,107,114,0.06)', border: '1px solid rgba(29,107,114,0.15)', borderRadius: 5, marginBottom: 5, fontSize: 12 }}>
              <span style={{ color: 'var(--teal)', fontWeight: 700 }}>✓</span>
              <span style={{ color: 'var(--text)' }}>{sg.description}</span>
              <span style={{ marginLeft: 'auto', fontFamily: 'Source Code Pro, monospace', color: 'var(--teal)', fontSize: 11 }}>Approved · {fmtCurrencyFull(sg.amount, baseCurrency)}</span>
            </div>
          ))}
          {rejected.map(sg => (
            <div key={sg.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 5, marginBottom: 5, fontSize: 12, opacity: 0.55 }}>
              <span style={{ color: 'var(--dim)' }}>—</span>
              <span style={{ color: 'var(--text)', textDecoration: 'line-through' }}>{sg.description}</span>
              <span style={{ marginLeft: 'auto', fontFamily: 'Source Code Pro, monospace', color: 'var(--dim)', fontSize: 11 }}>Dismissed</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function buildPnL(journals, coaAccounts) {
  const ledger = journals.flatMap(j => [
    { account: j.debit_account,  side: 'debit',  amount: Number(j.amount) },
    { account: j.credit_account, side: 'credit', amount: Number(j.amount) },
  ]);
  const revenueMap = {}, cosMap = {}, opexMap = {};
  ledger.forEach(e => {
    const c = e.account;
    const coaA = coaAccounts.find(a => a.code === c);
    const atype = coaA?.account_type;
    const acat  = coaA?.category || '';
    const isIncome = atype === 'income'  || (!atype && c >= '4000' && c < '5000');
    const isCOS    = (atype === 'expense' && acat === 'Cost of Sales') || (!atype && c >= '5000' && c < '6000');
    const isOpex   = (atype === 'expense' && acat !== 'Cost of Sales') || (!atype && c >= '6000' && c < '7000');
    if (isIncome)    revenueMap[c] = (revenueMap[c] || 0) + (e.side === 'credit' ? e.amount : -e.amount);
    else if (isCOS)  cosMap[c]     = (cosMap[c]     || 0) + (e.side === 'debit'  ? e.amount : -e.amount);
    else if (isOpex) opexMap[c]    = (opexMap[c]    || 0) + (e.side === 'debit'  ? e.amount : -e.amount);
  });
  const toRows = map => Object.entries(map)
    .map(([code, amount]) => ({ code, amount, name: coaAccounts.find(a => a.code === code)?.name || GL_ACCOUNTS.find(a => a.code === code)?.name || code }))
    .sort((a, b) => a.code.localeCompare(b.code));
  const revRows = toRows(revenueMap), cosRows = toRows(cosMap), opexRows = toRows(opexMap);
  const totRev = revRows.reduce((s, r) => s + r.amount, 0);
  const gp     = totRev - cosRows.reduce((s, r) => s + r.amount, 0);
  const np     = gp    - opexRows.reduce((s, r) => s + r.amount, 0);
  return { revRows, cosRows, opexRows, totRev, gp, np };
}

function GLReport({ period, selPeriod, companyId, companyName = "Company", company }) {
  const now = new Date();
  const { accounts: coaAccounts } = useChartOfAccounts(companyId);
  const { balances: pyBalances }  = usePriorYearBalances(companyId);

  const [tab, setTab]       = useState("tb");
  const [journals, setJournals] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [ytdMode, setYtdMode]         = useState(true);
  const [cmpMode, setCmpMode]         = useState("none");
  const [cmpJournals, setCmpJournals] = useState([]);
  const [apInvoices, setApInvoices]   = useState([]);
  const [spendSort, setSpendSort]     = useState("desc");
  const [drillSupplier, setDrillSupplier] = useState(null);

  const periodLabel = new Date(selPeriod + '-01').toLocaleDateString("en-IE", { month: "long", year: "numeric" });

  // YTD start: first month of the accounting year that contains selPeriod
  const yearEndMonth  = company?.year_end_month || 12; // 1–12
  const yearStartMonth = (yearEndMonth % 12) + 1;      // Dec(12)→Jan(1), Mar(3)→Apr(4)
  const [py, pm] = selPeriod.split('-').map(Number);
  const ytdStartYear  = pm >= yearStartMonth ? py : py - 1;
  const ytdStart      = `${ytdStartYear}-${String(yearStartMonth).padStart(2, '0')}-01`;
  const periodEnd     = new Date(py, pm, 0).toISOString().slice(0, 10);

  const rangeStart    = ytdMode ? ytdStart : `${selPeriod}-01`;
  const reportLabel   = ytdMode ? `YTD to ${periodLabel}` : `${periodLabel} only`;
  const slug          = ytdMode ? `ytd-to-${selPeriod}` : selPeriod;

  const baseCurrency = company?.base_currency || company?.currency || "EUR";
  const fmt    = (n) => fmtCurrency(n, baseCurrency);
  const fmtK   = (n) => fmtCurrencyK(n, baseCurrency);
  const fmtEUR = (n) => fmtCurrencyFull(n, baseCurrency);

  const [cmpRangeStart, cmpPeriodEnd, cmpLabel] = (() => {
    if (cmpMode === "none") return [null, null, ""];
    if (cmpMode === "prev_year") {
      const start = ytdMode
        ? `${ytdStartYear - 1}-${String(yearStartMonth).padStart(2, '0')}-01`
        : `${py - 1}-${String(pm).padStart(2, '0')}-01`;
      const end = new Date(py - 1, pm, 0).toISOString().slice(0, 10);
      const label = ytdMode ? `YTD ${py - 1}` : new Date(py - 1, pm - 1, 1).toLocaleDateString("en-IE", { month: "short", year: "numeric" });
      return [start, end, label];
    }
    let cpm = pm - 1, cpy = py;
    if (cpm <= 0) { cpm = 12; cpy--; }
    const start = `${cpy}-${String(cpm).padStart(2, '0')}-01`;
    const end   = new Date(cpy, cpm, 0).toISOString().slice(0, 10);
    return [start, end, new Date(cpy, cpm - 1, 1).toLocaleDateString("en-IE", { month: "short", year: "numeric" })];
  })();
  const showCmp = cmpMode !== "none";

  useEffect(() => {
    if (!companyId) { setLoading(false); return; }
    (async () => {
      setLoading(true);
      const db = supabase;
      const { data, error } = await db.from('journals').select('*')
        .eq('company_id', companyId).gte('date', rangeStart).lte('date', periodEnd).order('date');
      if (!error && data) setJournals(data);
      setLoading(false);
    })();
  }, [companyId, selPeriod, ytdMode]); // eslint-disable-line

  useEffect(() => {
    if (!companyId || !showCmp || !cmpRangeStart) { setCmpJournals([]); return; }
    (async () => {
      const { data } = await supabase.from('journals').select('*')
        .eq('company_id', companyId).gte('date', cmpRangeStart).lte('date', cmpPeriodEnd).order('date');
      setCmpJournals(data || []);
    })();
  }, [companyId, cmpMode, cmpRangeStart]); // eslint-disable-line

  useEffect(() => {
    if (!companyId || (tab !== "spend" && tab !== "aged_ap")) return;
    (async () => {
      const { data } = await supabase.from('ap_invoices').select('*').eq('company_id', companyId);
      setApInvoices(data || []);
    })();
  }, [companyId, tab]); // eslint-disable-line

  const noJournals = journals.length === 0;

  // Expand each journal into two explicit ledger entries
  const ledger = journals.flatMap(j => [
    { account: j.debit_account,  side: 'debit',  amount: Number(j.amount), journal: j },
    { account: j.credit_account, side: 'credit', amount: Number(j.amount), journal: j },
  ]);

  // Trial Balance — aggregate both sides per account, compute net balance
  const tbMap = {};
  ledger.forEach(e => {
    if (!tbMap[e.account]) tbMap[e.account] = { debit: 0, credit: 0 };
    if (e.side === 'debit') tbMap[e.account].debit  += e.amount;
    else                    tbMap[e.account].credit += e.amount;
  });
  const tbRows = Object.entries(tbMap).map(([code, { debit, credit }]) => {
    const coaA    = coaAccounts.find(a => a.code === code);
    const fallback = GL_ACCOUNTS.find(a => a.code === code);
    const name     = coaA?.name || fallback?.name || code;
    const type     = coaA ? (coaA.account_type.charAt(0).toUpperCase() + coaA.account_type.slice(1)) : (fallback?.type || '—');
    const isDebitNormal = ['Asset', 'Expense'].includes(type);
    const net = isDebitNormal ? debit - credit : credit - debit;
    return { code, debit, credit, net, name, type };
  }).sort((a, b) => a.code.localeCompare(b.code));
  const tbTotDr  = tbRows.reduce((s, r) => s + r.debit,  0);
  const tbTotCr  = tbRows.reduce((s, r) => s + r.credit, 0);

  // P&L — net credits for income, net debits for costs/expenses
  const { revRows, cosRows, opexRows, totRev, gp, np } = buildPnL(journals, coaAccounts);
  const cmpPnl     = (showCmp && cmpJournals.length > 0) ? buildPnL(cmpJournals, coaAccounts) : null;
  const cmpRevMap  = cmpPnl ? Object.fromEntries(cmpPnl.revRows.map(r  => [r.code, r.amount])) : {};
  const cmpCosMap  = cmpPnl ? Object.fromEntries(cmpPnl.cosRows.map(r  => [r.code, r.amount])) : {};
  const cmpOpexMap = cmpPnl ? Object.fromEntries(cmpPnl.opexRows.map(r => [r.code, r.amount])) : {};

  // Prior year P&L derived from uploaded trial balance
  const hasPY = pyBalances.length > 0;
  const pyLookup = (code) => pyBalances.find(b => b.account_code === code);
  const pyRevRows  = revRows.map(r  => { const b = pyLookup(r.code);  return b ? (b.credit_balance - b.debit_balance)  : null; });
  const pyCosRows  = cosRows.map(r  => { const b = pyLookup(r.code);  return b ? (b.debit_balance  - b.credit_balance) : null; });
  const pyOpexRows = opexRows.map(r => { const b = pyLookup(r.code);  return b ? (b.debit_balance  - b.credit_balance) : null; });
  const pyTotRev  = pyBalances.filter(b => b.account_code >= '4000' && b.account_code < '5000').reduce((s, b) => s + (b.credit_balance - b.debit_balance), 0);
  const pyTotCos  = pyBalances.filter(b => b.account_code >= '5000' && b.account_code < '6000').reduce((s, b) => s + (b.debit_balance  - b.credit_balance), 0);
  const pyTotOpex = pyBalances.filter(b => b.account_code >= '6000' && b.account_code < '7000').reduce((s, b) => s + (b.debit_balance  - b.credit_balance), 0);
  const pyGP = pyTotRev - pyTotCos;
  const pyNP = pyGP - pyTotOpex;

  const varAbs   = (cur, cmp) => cmp === null ? null : cur - cmp;
  const varPct   = (cur, cmp) => (cmp === null || cmp === 0) ? null : ((cur - cmp) / Math.abs(cmp)) * 100;
  const fmtVar   = (abs) => abs === null ? "—" : (abs >= 0 ? `+${fmt(Math.abs(abs))}` : `-${fmt(Math.abs(abs))}`);
  const fmtPctV  = (pct) => pct === null ? "—" : `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
  const varColor = (abs) => abs === null ? "var(--dim)" : abs >= 0 ? "var(--teal)" : "var(--red)";

  // GL Extract — individual lines from ledger
  const glLines = ledger.map(e => ({
    date: e.journal.date, ref: e.journal.reference, narrative: e.journal.description,
    account: e.account,
    accountName: GL_ACCOUNTS.find(a => a.code === e.account)?.name || e.account,
    debit:  e.side === 'debit'  ? e.amount : 0,
    credit: e.side === 'credit' ? e.amount : 0,
  }));
  const glAccounts = [...new Map(glLines.map(l => [l.account, { code: l.account, name: l.accountName }])).values()]
    .sort((a, b) => a.code.localeCompare(b.code));

  // ── Balance Sheet computations ──
  const bsFixed      = tbRows.filter(r => r.code >= '1500' && r.code < '1600' && r.net !== 0);
  const bsCurrAss    = tbRows.filter(r => r.type === 'Asset' && ((r.code >= '1000' && r.code < '1500') || (r.code >= '1600' && r.code < '2000')) && r.net > 0);
  const bsOverdraft  = tbRows.filter(r => r.type === 'Asset' && r.code >= '1000' && r.code < '2000' && r.net < 0);
  const bsCurrLiab   = tbRows.filter(r => r.type === 'Liability' && r.code >= '2000' && r.code < '2500' && r.net !== 0);
  const bsLtLiab     = tbRows.filter(r => r.type === 'Liability' && r.code >= '2500' && r.code < '3000' && r.net !== 0);

  const bsFixedTotal    = bsFixed.reduce((s, r) => s + r.net, 0);
  const bsCurrAssTotal  = bsCurrAss.reduce((s, r) => s + r.net, 0);
  const bsOvdTotal      = bsOverdraft.reduce((s, r) => s + Math.abs(r.net), 0);
  const bsCurrLiabTotal = bsCurrLiab.reduce((s, r) => s + Math.abs(r.net), 0) + bsOvdTotal;
  const bsLtLiabTotal   = bsLtLiab.reduce((s, r) => s + Math.abs(r.net), 0);
  const bsTotalAssets   = bsFixedTotal + bsCurrAssTotal;
  const bsNetAssets     = bsTotalAssets - bsCurrLiabTotal - bsLtLiabTotal;
  const bsShareCap      = tbRows.filter(r => r.type === 'Equity' && r.code >= '3000' && r.code < '3100').reduce((s, r) => s + r.net, 0);
  const bsTotalCapital  = bsShareCap + np;

  const exportDate = fmtIE(new Date().toISOString().slice(0, 10));

  const exportTB = () => downloadCSV(`trial-balance-${slug}.csv`, [
    ["Ledgrly — Trial Balance", companyName, reportLabel],
    ["Exported", exportDate],
    [],
    ["Code", "Account", "Type", "Debit (€)", "Credit (€)", "Net Balance"],
    ...tbRows.map(r => [r.code, r.name, r.type, r.debit > 0 ? fmtEUR(r.debit) : "—", r.credit > 0 ? fmtEUR(r.credit) : "—", (r.net < 0 ? "-" : "") + fmtEUR(Math.abs(r.net))]),
    ["", "TOTAL", "", fmtEUR(tbTotDr), fmtEUR(tbTotCr), Math.abs(tbTotDr - tbTotCr) < 0.005 ? "BALANCED" : fmtEUR(Math.abs(tbTotDr - tbTotCr))],
  ]);

  const exportPNL = () => {
    const hdr = showCmp
      ? ["Section", "Code", "Account", `Current (${baseCurrency})`, `${cmpLabel} (${baseCurrency})`, `Variance (${baseCurrency})`, "Variance %"]
      : ["Section", "Code", "Account", `Amount (${baseCurrency})`];
    const row = (section, code, name, cur, cmpV) => showCmp
      ? [section, code, name, fmtEUR(cur), cmpV !== null ? fmtEUR(cmpV) : "—", fmtVar(varAbs(cur, cmpV)), fmtPctV(varPct(cur, cmpV))]
      : [section, code, name, fmtEUR(cur)];
    downloadCSV(`profit-and-loss-${slug}.csv`, [
      ["Ledgrly — Profit & Loss", companyName, reportLabel],
      ["Exported", exportDate],
      [],
      hdr,
      ["Revenue", "", "", ...(showCmp ? ["", "", "", ""] : [])],
      ...revRows.map(r => row("", r.code, r.name, r.amount, cmpRevMap[r.code] ?? null)),
      row("", "", "Total Revenue", totRev, cmpPnl?.totRev ?? null),
      ["Cost of Sales", "", "", ...(showCmp ? ["", "", "", ""] : [])],
      ...cosRows.map(r => row("", r.code, r.name, r.amount, cmpCosMap[r.code] ?? null)),
      row("", "", "Gross Profit", gp, cmpPnl?.gp ?? null),
      ["Operating Expenses", "", "", ...(showCmp ? ["", "", "", ""] : [])],
      ...opexRows.map(r => row("", r.code, r.name, r.amount, cmpOpexMap[r.code] ?? null)),
      row("", "", "Net Profit", np, cmpPnl?.np ?? null),
    ]);
  };

  const emptyMsg = (title, sub) => (
    <div style={{ padding: "40px 24px", textAlign: "center", color: "var(--dim)", fontSize: 13 }}>
      <div style={{ fontSize: 15, fontWeight: 500, color: "var(--text-muted)", marginBottom: 8 }}>{title}</div>
      {sub}
    </div>
  );

  if (loading) return <div style={{ padding: 48, textAlign: "center", color: "var(--dim)", fontSize: 12, fontFamily: "Source Code Pro, monospace" }}>Loading GL data…</div>;

  return (
    <div className="fade-up">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
          {[{ id: false, label: "Month" }, { id: true, label: "YTD" }].map(({ id, label }) => (
            <button key={label} onClick={() => setYtdMode(id)} style={{
              padding: "4px 12px", fontSize: 11, fontFamily: "Source Code Pro, monospace",
              background: ytdMode === id ? "var(--surface-2)" : "var(--surface)",
              color: ytdMode === id ? "var(--text)" : "var(--text-muted)",
              border: "none", borderLeft: id ? "1px solid var(--border)" : "none",
              cursor: "pointer", fontWeight: ytdMode === id ? 600 : 400,
            }}>{label}</button>
          ))}
        </div>
        {ytdMode && <span style={{ fontSize: 10, color: "var(--dim)", fontFamily: "Source Code Pro, monospace" }}>from {ytdStart}</span>}
        {tab === "pnl" && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
            <span style={{ fontSize: 10, color: "var(--dim)", fontFamily: "Source Code Pro, monospace" }}>Compare to</span>
            <select value={cmpMode} onChange={e => { setCmpMode(e.target.value); setCmpJournals([]); }} style={{ fontSize: 11, fontFamily: "Source Code Pro, monospace", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 4, padding: "3px 8px", cursor: "pointer" }}>
              <option value="none">None</option>
              {!ytdMode && <option value="prev">Previous period</option>}
              <option value="prev_year">{ytdMode ? "Previous year" : "Same period last year"}</option>
            </select>
          </div>
        )}
      </div>

      <div className="gl-tabs">
        {[{ id: "tb", label: "Trial Balance" }, { id: "pnl", label: "Profit & Loss" }, { id: "bs", label: "Balance Sheet" }, { id: "gl", label: "General Ledger" }, { id: "fullgl", label: "Full GL" }, { id: "spend", label: "Supplier Spend" }, { id: "aged_ap", label: "Aged Creditors" }].map(t => (
          <button key={t.id} className={`gl-tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {tab === "tb" && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Trial Balance — {reportLabel}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {!noJournals && <span style={{ fontSize: 10, fontFamily: "Source Code Pro, monospace", fontWeight: 600, color: Math.abs(tbTotDr - tbTotCr) < 0.005 ? "var(--green)" : "var(--red)" }}>{Math.abs(tbTotDr - tbTotCr) < 0.005 ? "✓ BALANCED" : "⚠ OUT OF BALANCE"}</span>}
              {!noJournals && <ExportDropdown onCSV={exportTB} onPrint={() => window.print()} />}
            </div>
          </div>
          <div className="print-only card-body">
            <div className="print-title">{companyName} — Trial Balance</div>
            <div className="print-meta">Period: {reportLabel} · Exported: {exportDate}</div>
          </div>
          {noJournals ? emptyMsg(`No trial balance data for ${reportLabel}`, "Post journals to populate your trial balance.") : (
            <table className="gl-table">
              <thead><tr><th style={{ width: 55 }}>Code</th><th>Account Name</th><th>Type</th><th className="r">Debit (€)</th><th className="r">Credit (€)</th><th className="r">Net Balance</th></tr></thead>
              <tbody>
                {tbRows.map((r, i) => (
                  <tr key={i}>
                    <td className="mono" style={{ color: "var(--dim)" }}>{r.code}</td><td>{r.name}</td>
                    <td><span style={{ fontSize: 10, color: "var(--dim)", fontFamily: "Source Code Pro, monospace" }}>{r.type}</span></td>
                    <td className="r mono">{r.debit > 0 ? fmt(r.debit) : "—"}</td>
                    <td className="r mono">{r.credit > 0 ? fmt(r.credit) : "—"}</td>
                    <td className="r mono" style={{ color: r.net >= 0 ? "var(--text)" : "var(--danger)", fontWeight: 600 }}>{fmt(Math.abs(r.net))}{r.net < 0 ? " Cr" : ""}</td>
                  </tr>
                ))}
                <tr className="tot"><td colSpan={3} style={{ fontWeight: 600 }}>Total</td><td className="r mono">{fmt(tbTotDr)}</td><td className="r mono">{fmt(tbTotCr)}</td><td className="r mono" style={{ color: tbTotDr === tbTotCr ? "var(--green)" : "var(--red)", fontWeight: 700 }}>{tbTotDr === tbTotCr ? "—" : fmt(Math.abs(tbTotDr - tbTotCr))}</td></tr>
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "pnl" && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Profit & Loss — {reportLabel}</span>
            {!noJournals && <ExportDropdown onCSV={exportPNL} onPrint={() => window.print()} />}
          </div>
          <div className="print-only card-body">
            <div className="print-title">{companyName} — Profit & Loss</div>
            <div className="print-meta">Period: {reportLabel} · Exported: {exportDate}</div>
          </div>
          {noJournals ? emptyMsg(`No P&L data for ${reportLabel}`, "Post journals with income (4xxx) and expense (5xxx–6xxx) accounts to generate your P&L.") : (
            <div>
              {showCmp ? (
                <div style={{ display: "flex", justifyContent: "flex-end", padding: "6px 16px 2px", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ width: 110, textAlign: "right", fontSize: 10, fontFamily: "'Source Code Pro',monospace", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Current</span>
                  <span style={{ width: 110, textAlign: "right", fontSize: 10, fontFamily: "'Source Code Pro',monospace", color: "var(--dim)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>{cmpLabel}</span>
                  <span style={{ width: 80,  textAlign: "right", fontSize: 10, fontFamily: "'Source Code Pro',monospace", color: "var(--dim)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>Variance</span>
                  <span style={{ width: 60,  textAlign: "right", fontSize: 10, fontFamily: "'Source Code Pro',monospace", color: "var(--dim)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", paddingRight: 16 }}>%</span>
                </div>
              ) : hasPY ? (
                <div style={{ display: "flex", justifyContent: "flex-end", padding: "6px 16px 2px", gap: 0, borderBottom: "1px solid var(--border)" }}>
                  <span style={{ width: 110, textAlign: "right", fontSize: 10, fontFamily: "'Source Code Pro',monospace", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Current Year</span>
                  <span style={{ width: 110, textAlign: "right", fontSize: 10, fontFamily: "'Source Code Pro',monospace", color: "var(--dim)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Prior Year</span>
                </div>
              ) : null}

              <div className="pnl-row pnl-sec"><span className="pnl-n">Revenue</span></div>
              {revRows.length === 0
                ? <div className="pnl-row" style={{ color: "var(--dim)", fontSize: 12 }}>No revenue entries (4xxx accounts)</div>
                : revRows.map((r, i) => {
                    const cmpV = showCmp ? (cmpRevMap[r.code] ?? null) : null;
                    const abs  = showCmp ? varAbs(r.amount, cmpV) : null;
                    return (
                      <div key={i} className="pnl-row">
                        <span className="pnl-n">{r.code} — {r.name}</span>
                        <span className="pnl-v">{fmt(r.amount)}</span>
                        {showCmp && <>
                          <span style={{ width: 110, textAlign: "right", fontFamily: "'Source Code Pro',monospace", fontSize: 13, color: "var(--dim)" }}>{cmpV !== null ? fmt(cmpV) : "—"}</span>
                          <span style={{ width: 80,  textAlign: "right", fontFamily: "'Source Code Pro',monospace", fontSize: 12, color: varColor(abs) }}>{fmtVar(abs)}</span>
                          <span style={{ width: 60,  textAlign: "right", fontFamily: "'Source Code Pro',monospace", fontSize: 11, color: varColor(abs), paddingRight: 16 }}>{fmtPctV(varPct(r.amount, cmpV))}</span>
                        </>}
                        {!showCmp && hasPY && <span style={{ width: 110, textAlign: "right", fontFamily: "'Source Code Pro',monospace", fontSize: 13, color: "var(--dim)", paddingRight: 16 }}>{pyRevRows[i] !== null ? fmt(pyRevRows[i]) : "—"}</span>}
                      </div>
                    );
                  })}
              <div className="pnl-row pnl-tot">
                <span className="pnl-n">Total Revenue</span>
                <span className="pnl-v" style={{ color: "var(--teal)", fontWeight: 700 }}>{fmt(totRev)}</span>
                {showCmp && (() => { const cmpV = cmpPnl?.totRev ?? null; const abs = varAbs(totRev, cmpV); return <>
                  <span style={{ width: 110, textAlign: "right", fontFamily: "'Source Code Pro',monospace", fontSize: 13, fontWeight: 700, color: "var(--dim)" }}>{cmpV !== null ? fmt(cmpV) : "—"}</span>
                  <span style={{ width: 80,  textAlign: "right", fontFamily: "'Source Code Pro',monospace", fontSize: 12, color: varColor(abs) }}>{fmtVar(abs)}</span>
                  <span style={{ width: 60,  textAlign: "right", fontFamily: "'Source Code Pro',monospace", fontSize: 11, color: varColor(abs), paddingRight: 16 }}>{fmtPctV(varPct(totRev, cmpV))}</span>
                </>; })()}
                {!showCmp && hasPY && <span style={{ width: 110, textAlign: "right", fontFamily: "'Source Code Pro',monospace", fontSize: 13, fontWeight: 700, color: "var(--dim)", paddingRight: 16 }}>{fmt(pyTotRev)}</span>}
              </div>

              <div className="pnl-row pnl-sec"><span className="pnl-n">Cost of Sales</span></div>
              {cosRows.length === 0
                ? <div className="pnl-row" style={{ color: "var(--dim)", fontSize: 12 }}>No cost of sales entries (5xxx accounts)</div>
                : cosRows.map((r, i) => {
                    const cmpV = showCmp ? (cmpCosMap[r.code] ?? null) : null;
                    const abs  = showCmp ? varAbs(r.amount, cmpV) : null;
                    return (
                      <div key={i} className="pnl-row">
                        <span className="pnl-n">{r.code} — {r.name}</span>
                        <span className="pnl-v">{fmt(r.amount)}</span>
                        {showCmp && <>
                          <span style={{ width: 110, textAlign: "right", fontFamily: "'Source Code Pro',monospace", fontSize: 13, color: "var(--dim)" }}>{cmpV !== null ? fmt(cmpV) : "—"}</span>
                          <span style={{ width: 80,  textAlign: "right", fontFamily: "'Source Code Pro',monospace", fontSize: 12, color: varColor(abs) }}>{fmtVar(abs)}</span>
                          <span style={{ width: 60,  textAlign: "right", fontFamily: "'Source Code Pro',monospace", fontSize: 11, color: varColor(abs), paddingRight: 16 }}>{fmtPctV(varPct(r.amount, cmpV))}</span>
                        </>}
                        {!showCmp && hasPY && <span style={{ width: 110, textAlign: "right", fontFamily: "'Source Code Pro',monospace", fontSize: 13, color: "var(--dim)", paddingRight: 16 }}>{pyCosRows[i] !== null ? fmt(pyCosRows[i]) : "—"}</span>}
                      </div>
                    );
                  })}
              <div className="pnl-row pnl-tot">
                <span className="pnl-n">Gross Profit</span>
                <span className="pnl-v" style={{ color: gp >= 0 ? "var(--green)" : "var(--red)", fontWeight: 700 }}>{fmt(gp)}</span>
                {showCmp && (() => { const cmpV = cmpPnl?.gp ?? null; const abs = varAbs(gp, cmpV); return <>
                  <span style={{ width: 110, textAlign: "right", fontFamily: "'Source Code Pro',monospace", fontSize: 13, fontWeight: 700, color: "var(--dim)" }}>{cmpV !== null ? fmt(cmpV) : "—"}</span>
                  <span style={{ width: 80,  textAlign: "right", fontFamily: "'Source Code Pro',monospace", fontSize: 12, color: varColor(abs) }}>{fmtVar(abs)}</span>
                  <span style={{ width: 60,  textAlign: "right", fontFamily: "'Source Code Pro',monospace", fontSize: 11, color: varColor(abs), paddingRight: 16 }}>{fmtPctV(varPct(gp, cmpV))}</span>
                </>; })()}
                {!showCmp && hasPY && <span style={{ width: 110, textAlign: "right", fontFamily: "'Source Code Pro',monospace", fontSize: 13, fontWeight: 700, color: pyGP >= 0 ? "var(--dim)" : "var(--red)", paddingRight: 16 }}>{fmt(pyGP)}</span>}
              </div>

              <div className="pnl-row pnl-sec"><span className="pnl-n">Operating Expenses</span></div>
              {opexRows.length === 0
                ? <div className="pnl-row" style={{ color: "var(--dim)", fontSize: 12 }}>No expense entries (6xxx accounts)</div>
                : opexRows.map((r, i) => {
                    const cmpV = showCmp ? (cmpOpexMap[r.code] ?? null) : null;
                    const abs  = showCmp ? varAbs(r.amount, cmpV) : null;
                    return (
                      <div key={i} className="pnl-row">
                        <span className="pnl-n">{r.code} — {r.name}</span>
                        <span className="pnl-v">{fmt(r.amount)}</span>
                        {showCmp && <>
                          <span style={{ width: 110, textAlign: "right", fontFamily: "'Source Code Pro',monospace", fontSize: 13, color: "var(--dim)" }}>{cmpV !== null ? fmt(cmpV) : "—"}</span>
                          <span style={{ width: 80,  textAlign: "right", fontFamily: "'Source Code Pro',monospace", fontSize: 12, color: varColor(abs) }}>{fmtVar(abs)}</span>
                          <span style={{ width: 60,  textAlign: "right", fontFamily: "'Source Code Pro',monospace", fontSize: 11, color: varColor(abs), paddingRight: 16 }}>{fmtPctV(varPct(r.amount, cmpV))}</span>
                        </>}
                        {!showCmp && hasPY && <span style={{ width: 110, textAlign: "right", fontFamily: "'Source Code Pro',monospace", fontSize: 13, color: "var(--dim)", paddingRight: 16 }}>{pyOpexRows[i] !== null ? fmt(pyOpexRows[i]) : "—"}</span>}
                      </div>
                    );
                  })}
              <div className="pnl-row pnl-tot" style={{ borderTop: "2px solid var(--border2)" }}>
                <span className="pnl-n" style={{ color: "var(--text)" }}>Net Profit</span>
                <span className="pnl-v" style={{ color: np >= 0 ? "var(--green)" : "var(--red)", fontWeight: 700 }}>{fmt(np)}</span>
                {showCmp && (() => { const cmpV = cmpPnl?.np ?? null; const abs = varAbs(np, cmpV); return <>
                  <span style={{ width: 110, textAlign: "right", fontFamily: "'Source Code Pro',monospace", fontSize: 13, fontWeight: 700, color: "var(--dim)" }}>{cmpV !== null ? fmt(cmpV) : "—"}</span>
                  <span style={{ width: 80,  textAlign: "right", fontFamily: "'Source Code Pro',monospace", fontSize: 12, color: varColor(abs) }}>{fmtVar(abs)}</span>
                  <span style={{ width: 60,  textAlign: "right", fontFamily: "'Source Code Pro',monospace", fontSize: 11, color: varColor(abs), paddingRight: 16 }}>{fmtPctV(varPct(np, cmpV))}</span>
                </>; })()}
                {!showCmp && hasPY && <span style={{ width: 110, textAlign: "right", fontFamily: "'Source Code Pro',monospace", fontSize: 13, fontWeight: 700, color: pyNP >= 0 ? "var(--dim)" : "var(--red)", paddingRight: 16 }}>{fmt(pyNP)}</span>}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "bs" && (() => {
        const bsAmt = v => {
          if (Math.abs(v) < 0.005) return "—";
          const s = "€" + Math.abs(v).toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          return v < 0 ? `(${s})` : s;
        };
        const bsRow = (label, amount, bold = false, indent = 0) => (
          <div style={{ display: "flex", padding: "3px 0", paddingLeft: indent * 16, fontSize: 13 }}>
            <span style={{ flex: 1, color: bold ? "var(--text)" : "var(--muted)", fontWeight: bold ? 600 : 400 }}>{label}</span>
            {amount !== null && <span style={{ fontFamily: "'Source Code Pro',monospace", width: 120, textAlign: "right", fontSize: 12, fontWeight: bold ? 700 : 400, color: amount < 0 ? "var(--red)" : undefined }}>{bsAmt(amount)}</span>}
          </div>
        );
        const bsHead = text => <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-muted)", marginTop: 16, marginBottom: 4 }}>{text}</div>;
        const bsDiv = (double) => <div style={{ borderTop: double ? "2px solid var(--text)" : "1px solid var(--border)", margin: "4px 0" }} />;
        return (
          <div className="card">
            <div className="card-header">
              <span className="card-title">Balance Sheet — {reportLabel}</span>
              {!noJournals && <span style={{ fontSize: 10, fontFamily: "'Source Code Pro',monospace", color: "var(--muted)", letterSpacing: "0.06em" }}>AS AT {periodEnd.toUpperCase()}</span>}
            </div>
            {noJournals ? emptyMsg(`No balance sheet data for ${reportLabel}`, "Post journals to populate your balance sheet.") : (
              <div className="card-body" style={{ maxWidth: 560 }}>
                {/* Fixed Assets */}
                {bsFixed.length > 0 && (
                  <>
                    {bsHead("Fixed Assets")}
                    {bsFixed.map(r => bsRow(`${r.code} · ${r.name}`, r.net, false, 1))}
                    {bsDiv(false)}
                    {bsRow("Total Fixed Assets", bsFixedTotal, true)}
                  </>
                )}

                {/* Current Assets */}
                {bsHead("Current Assets")}
                {bsCurrAss.length > 0
                  ? bsCurrAss.map(r => bsRow(`${r.code} · ${r.name}`, r.net, false, 1))
                  : <div style={{ fontSize: 12, color: "var(--dim)", fontStyle: "italic", padding: "2px 0" }}>No current asset balances</div>}
                {bsDiv(false)}
                {bsRow("Total Current Assets", bsCurrAssTotal, true)}

                {/* Creditors < 1yr */}
                {bsHead("Creditors: due within one year")}
                {bsCurrLiab.map(r => bsRow(`${r.code} · ${r.name}`, -Math.abs(r.net), false, 1))}
                {bsOverdraft.map(r => bsRow(`${r.code} · ${r.name} (overdraft)`, -Math.abs(r.net), false, 1))}
                {bsCurrLiabTotal > 0 && (<>{bsDiv(false)}{bsRow("Total Creditors < 1yr", -bsCurrLiabTotal, true)}</>)}

                {/* Creditors > 1yr */}
                {bsLtLiab.length > 0 && (
                  <>
                    {bsHead("Creditors: due after one year")}
                    {bsLtLiab.map(r => bsRow(`${r.code} · ${r.name}`, -Math.abs(r.net), false, 1))}
                    {bsDiv(false)}
                    {bsRow("Total Creditors > 1yr", -bsLtLiabTotal, true)}
                  </>
                )}

                {bsDiv(true)}
                {bsRow("Net Assets", bsNetAssets, true)}

                {/* Capital & Reserves */}
                {bsHead("Capital and Reserves")}
                {bsShareCap !== 0 && bsRow("Share Capital", bsShareCap, false, 1)}
                {bsRow("Retained Earnings (current period)", np, false, 1)}
                {bsDiv(false)}
                {bsRow("Total Capital and Reserves", bsTotalCapital, true)}
                {bsDiv(true)}

                {Math.abs(bsNetAssets - bsTotalCapital) > 0.50 && (
                  <div style={{ marginTop: 14, padding: "8px 12px", background: "rgba(184,134,11,0.07)", borderRadius: 6, borderLeft: "3px solid var(--gold)", fontSize: 11, color: "var(--muted)", lineHeight: 1.6 }}>
                    ⚠ Net Assets ({bsAmt(bsNetAssets)}) ≠ Capital & Reserves ({bsAmt(bsTotalCapital)}) — difference of {bsAmt(Math.abs(bsNetAssets - bsTotalCapital))}. This usually indicates missing opening balance journals for accounts that existed before this reporting period.
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {tab === "gl" && <GLExtract period={reportLabel} glLines={glLines} glAccounts={glAccounts} noJournals={noJournals} companyName={companyName} />}
      {tab === "fullgl" && <FullGLReport companyId={companyId} companyName={companyName} company={company} coaAccounts={coaAccounts} />}

      {tab === "spend" && (() => {
        const periodInvoices = apInvoices.filter(inv =>
          inv.invoice_date && inv.invoice_date >= rangeStart && inv.invoice_date <= periodEnd &&
          inv.status !== 'needs_review' && inv.status !== 'rejected'
        );
        const spendMap = {};
        periodInvoices.forEach(inv => {
          const key = inv.supplier || "Unknown";
          if (!spendMap[key]) spendMap[key] = { supplier: key, total: 0, count: 0, invoices: [] };
          spendMap[key].total += Number(inv.gross_amount || inv.amount || 0);
          spendMap[key].count++;
          spendMap[key].invoices.push(inv);
        });
        const rows = Object.values(spendMap).sort((a, b) =>
          spendSort === "desc" ? b.total - a.total : a.total - b.total
        );
        const grandTotal = rows.reduce((s, r) => s + r.total, 0);
        const exportSpend = () => downloadCSV(`supplier-spend-${slug}.csv`, [
          ["Ledgrly — Supplier Spend", companyName, reportLabel],
          ["Exported", exportDate],
          [],
          ["Supplier", "Invoices", `Total Spend (${baseCurrency})`],
          ...rows.map(r => [r.supplier, r.count, fmtEUR(r.total)]),
          ["TOTAL", rows.reduce((s, r) => s + r.count, 0), fmtEUR(grandTotal)],
        ]);
        return (
          <div className="card">
            <div className="card-header">
              <span className="card-title">Supplier Spend — {reportLabel}</span>
              {rows.length > 0 && <ExportDropdown onCSV={exportSpend} onPrint={() => window.print()} />}
            </div>
            {rows.length === 0
              ? emptyMsg("No supplier spend for this period", "AP invoices with an invoice date in the selected period will appear here.")
              : (
                <table className="gl-table">
                  <thead>
                    <tr>
                      <th>Supplier</th>
                      <th className="r" style={{ width: 80, cursor: "pointer" }} onClick={() => setSpendSort(s => s === "desc" ? "asc" : "desc")}>Invoices</th>
                      <th className="r" style={{ cursor: "pointer" }} onClick={() => setSpendSort(s => s === "desc" ? "asc" : "desc")}>Total Spend {spendSort === "desc" ? "▼" : "▲"}</th>
                      <th style={{ width: 28 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.flatMap((r, i) => {
                      const open = drillSupplier === r.supplier;
                      return [
                        <tr key={i} style={{ cursor: "pointer" }} onClick={() => setDrillSupplier(open ? null : r.supplier)}>
                          <td>{r.supplier}</td>
                          <td className="r mono">{r.count}</td>
                          <td className="r mono" style={{ fontWeight: 600 }}>{fmt(r.total)}</td>
                          <td className="r mono" style={{ fontSize: 10, color: "var(--dim)" }}>{open ? "▲" : "▼"}</td>
                        </tr>,
                        ...(open ? r.invoices.map((inv, j) => (
                          <tr key={`d${i}-${j}`} style={{ background: "var(--surface-2)", fontSize: 11 }}>
                            <td style={{ paddingLeft: 20, color: "var(--muted)" }}>{inv.invoice_ref || "—"}</td>
                            <td className="r mono" style={{ color: "var(--dim)" }}>{inv.invoice_date || "—"}</td>
                            <td className="r mono" style={{ color: "var(--muted)" }}>{fmt(Number(inv.gross_amount || inv.amount || 0))}</td>
                            <td></td>
                          </tr>
                        )) : []),
                      ];
                    })}
                    <tr className="tot">
                      <td style={{ fontWeight: 600 }}>Total</td>
                      <td className="r mono">{periodInvoices.length}</td>
                      <td className="r mono" style={{ fontWeight: 700, color: "var(--teal)" }}>{fmt(grandTotal)}</td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              )}
          </div>
        );
      })()}

      {tab === "aged_ap" && (() => {
        const today = new Date();
        const todayStr = today.toISOString().slice(0, 10);
        const outstanding = apInvoices.filter(inv =>
          inv.status !== 'paid' && inv.status !== 'rejected' && inv.status !== 'needs_review'
        );
        const getBucket = inv => {
          if (!inv.due_date) return "current";
          const diff = Math.floor((today - new Date(inv.due_date)) / 86400000);
          if (diff <= 0)  return "current";
          if (diff <= 30) return "b1_30";
          if (diff <= 60) return "b31_60";
          if (diff <= 90) return "b61_90";
          return "b90p";
        };
        const buckets = { current: {}, b1_30: {}, b31_60: {}, b61_90: {}, b90p: {} };
        outstanding.forEach(inv => {
          const b = getBucket(inv);
          const key = inv.supplier || "Unknown";
          const owed = Math.max(0, Number(inv.gross_amount || inv.amount || 0) - Number(inv.amount_paid || 0));
          buckets[b][key] = (buckets[b][key] || 0) + owed;
        });
        const suppliers = [...new Set(outstanding.map(inv => inv.supplier || "Unknown"))].sort();
        const bTot = b => Object.values(buckets[b]).reduce((s, v) => s + v, 0);
        const totals = { current: bTot("current"), b1_30: bTot("b1_30"), b31_60: bTot("b31_60"), b61_90: bTot("b61_90"), b90p: bTot("b90p") };
        const grandTotal = Object.values(totals).reduce((s, v) => s + v, 0);
        const rowTotal = s => ["current","b1_30","b31_60","b61_90","b90p"].reduce((t, b) => t + (buckets[b][s] || 0), 0);
        const exportAged = () => downloadCSV(`aged-creditors-${todayStr}.csv`, [
          ["Ledgrly — Aged Creditors", companyName],
          ["Report date", todayStr],
          [],
          ["Supplier", `Current (${baseCurrency})`, "1–30 days", "31–60 days", "61–90 days", "90+ days", "Total"],
          ...suppliers.map(s => [s, fmtEUR(buckets.current[s]||0), fmtEUR(buckets.b1_30[s]||0), fmtEUR(buckets.b31_60[s]||0), fmtEUR(buckets.b61_90[s]||0), fmtEUR(buckets.b90p[s]||0), fmtEUR(rowTotal(s))]),
          ["TOTAL", fmtEUR(totals.current), fmtEUR(totals.b1_30), fmtEUR(totals.b31_60), fmtEUR(totals.b61_90), fmtEUR(totals.b90p), fmtEUR(grandTotal)],
        ]);
        return (
          <div className="card">
            <div className="card-header">
              <span className="card-title">Aged Creditors</span>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 10, fontFamily: "'Source Code Pro',monospace", color: "var(--dim)", letterSpacing: "0.06em" }}>AS AT {todayStr.toUpperCase()}</span>
                {suppliers.length > 0 && <ExportDropdown onCSV={exportAged} onPrint={() => window.print()} />}
              </div>
            </div>
            {suppliers.length === 0
              ? emptyMsg("No outstanding AP invoices", "All invoices have been paid, or there are no approved invoices yet.")
              : (
                <table className="gl-table">
                  <thead>
                    <tr>
                      <th>Supplier</th>
                      <th className="r">Current</th>
                      <th className="r" style={{ color: "var(--warn)" }}>1–30 days</th>
                      <th className="r" style={{ color: "var(--gold)" }}>31–60 days</th>
                      <th className="r" style={{ color: "var(--red)" }}>61–90 days</th>
                      <th className="r" style={{ color: "var(--danger)" }}>90+ days</th>
                      <th className="r" style={{ fontWeight: 700 }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suppliers.map((s, i) => (
                      <tr key={i}>
                        <td>{s}</td>
                        <td className="r mono">{buckets.current[s] ? fmt(buckets.current[s]) : "—"}</td>
                        <td className="r mono" style={{ color: buckets.b1_30[s]  ? "var(--warn)"   : "var(--dim)" }}>{buckets.b1_30[s]  ? fmt(buckets.b1_30[s])  : "—"}</td>
                        <td className="r mono" style={{ color: buckets.b31_60[s] ? "var(--gold)"   : "var(--dim)" }}>{buckets.b31_60[s] ? fmt(buckets.b31_60[s]) : "—"}</td>
                        <td className="r mono" style={{ color: buckets.b61_90[s] ? "var(--red)"    : "var(--dim)" }}>{buckets.b61_90[s] ? fmt(buckets.b61_90[s]) : "—"}</td>
                        <td className="r mono" style={{ color: buckets.b90p[s]   ? "var(--danger)" : "var(--dim)", fontWeight: buckets.b90p[s] ? 700 : 400 }}>{buckets.b90p[s] ? fmt(buckets.b90p[s]) : "—"}</td>
                        <td className="r mono" style={{ fontWeight: 600 }}>{fmt(rowTotal(s))}</td>
                      </tr>
                    ))}
                    <tr className="tot">
                      <td style={{ fontWeight: 600 }}>Total</td>
                      <td className="r mono">{totals.current > 0 ? fmt(totals.current) : "—"}</td>
                      <td className="r mono" style={{ color: totals.b1_30  > 0 ? "var(--warn)"   : undefined }}>{totals.b1_30  > 0 ? fmt(totals.b1_30)  : "—"}</td>
                      <td className="r mono" style={{ color: totals.b31_60 > 0 ? "var(--gold)"   : undefined }}>{totals.b31_60 > 0 ? fmt(totals.b31_60) : "—"}</td>
                      <td className="r mono" style={{ color: totals.b61_90 > 0 ? "var(--red)"    : undefined }}>{totals.b61_90 > 0 ? fmt(totals.b61_90) : "—"}</td>
                      <td className="r mono" style={{ color: totals.b90p   > 0 ? "var(--danger)" : undefined, fontWeight: totals.b90p > 0 ? 700 : 400 }}>{totals.b90p > 0 ? fmt(totals.b90p) : "—"}</td>
                      <td className="r mono" style={{ fontWeight: 700, color: "var(--teal)" }}>{fmt(grandTotal)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
          </div>
        );
      })()}
    </div>
  );
}

function GLExtract({ period, glLines, glAccounts, noJournals, companyName = "Company" }) {
  const [selectedCode, setSelectedCode] = useState(glAccounts[0]?.code || "");

  useEffect(() => {
    if (glAccounts.length > 0 && !glAccounts.find(a => a.code === selectedCode)) {
      setSelectedCode(glAccounts[0].code);
    }
  }, [glAccounts]);

  const lines = glLines.filter(l => l.account === selectedCode);
  const account = glAccounts.find(a => a.code === selectedCode);

  const withBalance = lines.reduce((acc, line) => {
    const prev = acc.length > 0 ? acc[acc.length - 1].balance : 0;
    return [...acc, { ...line, balance: prev + line.debit - line.credit }];
  }, []);

  const totDr = lines.reduce((s, l) => s + l.debit, 0);
  const totCr = lines.reduce((s, l) => s + l.credit, 0);
  const closingBal = totDr - totCr;

  const exportDate = fmtIE(new Date().toISOString().slice(0, 10));
  const exportGL = () => downloadCSV(`gl-extract-${account?.code || "all"}-${period.replace(" ", "-")}.csv`, [
    ["Ledgrly — General Ledger Extract", companyName, period],
    ["Account", account ? `${account.code} — ${account.name}` : ""],
    ["Exported", exportDate],
    [],
    ["Date", "Reference", "Narrative", "Debit (€)", "Credit (€)", "Balance (€)"],
    ...withBalance.map(l => [fmtIE(l.date), l.ref, l.narrative, l.debit > 0 ? fmtEUR(l.debit) : "—", l.credit > 0 ? fmtEUR(l.credit) : "—", fmtEUR(l.balance)]),
    ["Period Total", "", "", fmtEUR(totDr), fmtEUR(totCr), fmtEUR(closingBal)],
  ]);

  return (
    <div className="card fade-up">
      <div className="card-header">
        <span className="card-title">General Ledger Extract — {period}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 10, color: "var(--dim)", fontFamily: "Source Code Pro, monospace" }}>{lines.length} entries</span>
          {withBalance.length > 0 && <ExportDropdown onCSV={exportGL} onPrint={() => window.print()} />}
        </div>
      </div>
      <div className="print-only card-body">
        <div className="print-title">{companyName} — General Ledger Extract</div>
        <div className="print-meta">Account: {account ? `${account.code} — ${account.name}` : "—"} · Period: {period} · Exported: {exportDate}</div>
      </div>
      {noJournals ? (
        <div className="gl-no-data">No journal entries for {period}</div>
      ) : (
        <>
          <div className="gl-extract-toolbar">
            <span style={{ fontSize: 10, fontFamily: "Source Code Pro, monospace", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Account</span>
            <select className="gl-extract-select" value={selectedCode} onChange={e => setSelectedCode(e.target.value)} style={{ minWidth: 280 }}>
              {glAccounts.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
            </select>
            <span style={{ fontSize: 10, fontFamily: "Source Code Pro, monospace", color: "var(--dim)", marginLeft: "auto" }}>Period: {period}</span>
          </div>
          {account && (
            <div className="gl-acct-header">
              <span className="gl-acct-code">{account.code}</span>
              <span className="gl-acct-name">{account.name}</span>
              <span className="gl-acct-type">{GL_ACCOUNTS.find(a => a.code === account.code)?.type || '—'}</span>
            </div>
          )}
          {withBalance.length === 0 ? (
            <div className="gl-no-data">No transactions for this account in {period}</div>
          ) : (
            <table className="glex-table">
              <thead><tr><th style={{ width: 70 }}>Date</th><th style={{ width: 90 }}>Ref</th><th>Narrative</th><th className="r" style={{ width: 100 }}>Debit (€)</th><th className="r" style={{ width: 100 }}>Credit (€)</th><th className="r" style={{ width: 110 }}>Balance (€)</th></tr></thead>
              <tbody>
                {withBalance.map((line, i) => (
                  <tr key={i}>
                    <td className="mono" style={{ color: "var(--dim)" }}>{line.date}</td>
                    <td className="mono" style={{ color: "var(--text-muted)", fontSize: 10 }}>{line.ref}</td>
                    <td style={{ color: "var(--muted)" }}>{line.narrative}</td>
                    <td className="r mono dr">{line.debit > 0 ? fmt(line.debit) : "—"}</td>
                    <td className="r mono cr">{line.credit > 0 ? fmt(line.credit) : "—"}</td>
                    <td className={`r mono ${line.balance >= 0 ? "bal-pos" : "bal-neg"}`}>{line.balance < 0 ? `(${fmt(Math.abs(line.balance))})` : fmt(line.balance)}</td>
                  </tr>
                ))}
                <tr className="glex-totrow">
                  <td colSpan={3} style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>Period Total</td>
                  <td className="r mono">{fmt(totDr)}</td><td className="r mono cr">{fmt(totCr)}</td>
                  <td className={`r mono ${closingBal >= 0 ? "bal-pos" : "bal-neg"}`}>{closingBal < 0 ? `(${fmt(Math.abs(closingBal))})` : fmt(closingBal)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}


function FullGLReport({ companyId, companyName, company, coaAccounts }) {
  const now        = new Date();
  const [mode, setMode]         = useState("ytd"); // "month" | "ytd"
  const [journals, setJournals] = useState([]);
  const [loading, setLoading]   = useState(true);

  const yearEndMonth  = company?.year_end_month || 12;
  const yearStartMonth = (yearEndMonth % 12) + 1;
  const curYear  = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  const ytdStartYear  = curMonth >= yearStartMonth ? curYear : curYear - 1;
  const ytdStart      = `${ytdStartYear}-${String(yearStartMonth).padStart(2, '0')}-01`;
  const monthStart    = `${curYear}-${String(curMonth).padStart(2, '0')}-01`;
  const periodEnd     = new Date(curYear, curMonth, 0).toISOString().slice(0, 10);
  const rangeStart    = mode === "ytd" ? ytdStart : monthStart;

  const periodLabel = mode === "ytd"
    ? `YTD to ${now.toLocaleDateString("en-IE", { month: "long", year: "numeric" })}`
    : now.toLocaleDateString("en-IE", { month: "long", year: "numeric" });

  useEffect(() => {
    if (!companyId) { setLoading(false); return; }
    setLoading(true);
    supabase.from('journals').select('*')
      .eq('company_id', companyId).gte('date', rangeStart).lte('date', periodEnd).order('date')
      .then(({ data, error }) => {
        if (!error && data) setJournals(data);
        setLoading(false);
      });
  }, [companyId, mode]);

  const resolveName = (code) => {
    const coa = coaAccounts?.find(a => a.code === code);
    if (coa) return coa.name;
    return GL_ACCOUNTS.find(a => a.code === code)?.name || code;
  };

  // Two rows per journal: debit leg then credit leg
  const rows = journals.flatMap(j => [
    {
      date: j.date, ref: j.reference || "", description: j.description || "",
      drCode: j.debit_account,  drName: resolveName(j.debit_account),
      crCode: j.credit_account, crName: resolveName(j.credit_account),
      debit: Number(j.amount), credit: 0,
      postedBy: j.posted_by || "",
    },
    {
      date: j.date, ref: j.reference || "", description: j.description || "",
      drCode: j.debit_account,  drName: resolveName(j.debit_account),
      crCode: j.credit_account, crName: resolveName(j.credit_account),
      debit: 0, credit: Number(j.amount),
      postedBy: j.posted_by || "",
    },
  ]);

  const totalDr  = rows.reduce((s, r) => s + r.debit,  0);
  const totalCr  = rows.reduce((s, r) => s + r.credit, 0);
  const balanced = Math.abs(totalDr - totalCr) < 0.005;

  const exportDate = fmtIE(new Date().toISOString().slice(0, 10));

  const exportCSV = () => {
    const csvRows = [
      ["Ledgrly — Full General Ledger", companyName, periodLabel],
      ["Exported", exportDate],
      [],
      ["Date", "Reference", "Description", "Debit Account Code", "Debit Account Name", "Credit Account Code", "Credit Account Name", "Debit (€)", "Credit (€)", "Posted By"],
      ...rows.map(r => [
        fmtIE(r.date), r.ref, r.description,
        r.drCode, r.drName, r.crCode, r.crName,
        r.debit  > 0 ? fmtEUR(r.debit)  : "",
        r.credit > 0 ? fmtEUR(r.credit) : "",
        r.postedBy,
      ]),
      [],
      ["", "", "", "", "", "", "Total", fmtEUR(totalDr), fmtEUR(totalCr), balanced ? "BALANCED" : "OUT OF BALANCE"],
    ];
    downloadCSV(`full-gl-${mode === "ytd" ? `ytd-${curYear}` : `${curYear}-${String(curMonth).padStart(2,'0')}`}.csv`, csvRows);
  };

  const btnBase = { padding: "4px 14px", fontSize: 11, fontFamily: "Source Code Pro, monospace", borderRadius: 6, border: "1px solid var(--border)", cursor: "pointer", fontWeight: 500 };
  const btnActive   = { ...btnBase, background: "var(--surface-2)", color: "var(--text)", borderColor: "var(--border2)" };
  const btnInactive = { ...btnBase, background: "var(--surface)", color: "var(--muted)" };

  if (loading) return (
    <div className="card fade-up" style={{ padding: 48, textAlign: "center", color: "var(--dim)", fontSize: 12, fontFamily: "Source Code Pro, monospace" }}>
      Loading Full GL…
    </div>
  );

  return (
    <div className="card fade-up">
      <div className="card-header">
        <span className="card-title">Full GL — {periodLabel}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {rows.length > 0 && (
            <span style={{ fontSize: 10, fontFamily: "Source Code Pro, monospace", fontWeight: 600, color: balanced ? "var(--green)" : "var(--red)" }}>
              {balanced ? "✓ BALANCED" : "⚠ OUT OF BALANCE"}
            </span>
          )}
          {rows.length > 0 && (
            <>
              <button onClick={exportCSV} style={{ ...btnInactive, fontSize: 11 }}>Download CSV</button>
              <button onClick={() => window.print()} style={{ ...btnInactive, fontSize: 11 }}>Print / PDF</button>
            </>
          )}
        </div>
      </div>
      <div className="print-only card-body">
        <div className="print-title">{companyName} — Full General Ledger</div>
        <div className="print-meta">Period: {periodLabel} · Exported: {exportDate}</div>
      </div>

      <div style={{ padding: "8px 15px", borderBottom: "1px solid var(--border)", display: "flex", gap: 6, alignItems: "center", background: "var(--surface-2)" }}>
        <button onClick={() => setMode("month")} style={mode === "month" ? btnActive : btnInactive}>Current Month</button>
        <button onClick={() => setMode("ytd")}   style={mode === "ytd"   ? btnActive : btnInactive}>Year to Date</button>
        <span style={{ marginLeft: 8, fontSize: 10, fontFamily: "Source Code Pro, monospace", color: "var(--dim)" }}>
          {rangeStart} → {periodEnd}
        </span>
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: "40px 24px", textAlign: "center", color: "var(--dim)", fontSize: 13 }}>
          <div style={{ fontSize: 15, fontWeight: 500, color: "var(--text-muted)", marginBottom: 8 }}>No journal entries for {periodLabel}</div>
          Post journals to populate your Full GL report.
        </div>
      ) : (
        <>
          <table className="gl-table">
            <thead>
              <tr>
                <th style={{ width: 72 }}>Date</th>
                <th style={{ width: 88 }}>Reference</th>
                <th>Description</th>
                <th style={{ width: 46 }}>Dr Code</th>
                <th>Dr Account</th>
                <th style={{ width: 46 }}>Cr Code</th>
                <th>Cr Account</th>
                <th className="r" style={{ width: 96 }}>Debit (€)</th>
                <th className="r" style={{ width: 96 }}>Credit (€)</th>
                <th style={{ width: 80 }}>Posted By</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "rgba(0,0,0,0.015)" }}>
                  <td className="mono" style={{ color: "var(--dim)", fontSize: 11 }}>{fmtIE(r.date)}</td>
                  <td className="mono" style={{ color: "var(--text-muted)", fontSize: 10 }}>{r.ref || "—"}</td>
                  <td style={{ color: "var(--muted)", fontSize: 12 }}>{r.description || "—"}</td>
                  <td className="mono" style={{ color: "var(--dim)", fontSize: 11 }}>{r.drCode}</td>
                  <td style={{ fontSize: 12 }}>{r.drName}</td>
                  <td className="mono" style={{ color: "var(--dim)", fontSize: 11 }}>{r.crCode}</td>
                  <td style={{ fontSize: 12 }}>{r.crName}</td>
                  <td className="r mono dr">{r.debit  > 0 ? fmt(r.debit)  : ""}</td>
                  <td className="r mono cr">{r.credit > 0 ? fmt(r.credit) : ""}</td>
                  <td className="mono" style={{ fontSize: 10, color: "var(--dim)" }}>{r.postedBy || ""}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="tot" style={{ borderTop: "2px solid var(--border2)" }}>
                <td colSpan={7} style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>
                  {rows.length} rows · {journals.length} journals
                  {balanced
                    ? <span style={{ marginLeft: 10, fontSize: 10, fontFamily: "Source Code Pro, monospace", color: "var(--green)", fontWeight: 600 }}>✓ BALANCED</span>
                    : <span style={{ marginLeft: 10, fontSize: 10, fontFamily: "Source Code Pro, monospace", color: "var(--red)",   fontWeight: 600 }}>⚠ OUT OF BALANCE</span>}
                </td>
                <td className="r mono" style={{ fontWeight: 700 }}>{fmt(totalDr)}</td>
                <td className="r mono" style={{ fontWeight: 700, color: "var(--teal)" }}>{fmt(totalCr)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </>
      )}
    </div>
  );
}

const EMPTY_REC_FORM = () => ({
  name: '', debit_account: '', credit_account: '', amount: '',
  vat_code: '', description_template: '', day_of_month: '28',
  start_date: new Date().toISOString().slice(0, 10), end_date: '',
  journal_type: 'standard', active: true,
});

function RecurringTab({ companyId, coaAccounts, readOnly }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [editId, setEditId]       = useState(null);
  const [form, setForm]           = useState(EMPTY_REC_FORM());
  const [saving, setSaving]       = useState(false);
  const [formErr, setFormErr]     = useState(null);
  const [expandedRuns, setExpandedRuns] = useState(null);
  const [runs, setRuns]           = useState({});

  useEffect(() => {
    if (!companyId) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase.from('recurring_journals').select('*')
        .eq('company_id', companyId).order('created_at', { ascending: false });
      setTemplates(data || []);
      setLoading(false);
    })();
  }, [companyId]);

  const loadRuns = async (tplId) => {
    if (runs[tplId]) { setExpandedRuns(expandedRuns === tplId ? null : tplId); return; }
    const { data } = await supabase.from('recurring_journal_runs').select('*')
      .eq('recurring_journal_id', tplId).order('period', { ascending: false }).limit(12);
    setRuns(prev => ({ ...prev, [tplId]: data || [] }));
    setExpandedRuns(tplId);
  };

  const startNew = () => { setForm(EMPTY_REC_FORM()); setEditId(null); setShowForm(true); setFormErr(null); };
  const startEdit = (tpl) => {
    setForm({
      name: tpl.name, debit_account: tpl.debit_account, credit_account: tpl.credit_account,
      amount: String(tpl.amount), vat_code: tpl.vat_code || '',
      description_template: tpl.description_template || '', day_of_month: String(tpl.day_of_month),
      start_date: tpl.start_date, end_date: tpl.end_date || '',
      journal_type: tpl.journal_type, active: tpl.active,
    });
    setEditId(tpl.id); setShowForm(true); setFormErr(null);
  };

  const save = async () => {
    if (!form.name || !form.debit_account || !form.credit_account || !form.amount) {
      setFormErr('Name, debit account, credit account and amount are required.'); return;
    }
    setSaving(true); setFormErr(null);
    const payload = {
      company_id: companyId, name: form.name, debit_account: form.debit_account,
      credit_account: form.credit_account, amount: parseFloat(form.amount),
      vat_code: form.vat_code || null, description_template: form.description_template,
      day_of_month: parseInt(form.day_of_month, 10) || 28,
      start_date: form.start_date, end_date: form.end_date || null,
      journal_type: form.journal_type, active: form.active,
    };
    if (editId) {
      const { error } = await supabase.from('recurring_journals').update(payload).eq('id', editId);
      if (error) { setFormErr(error.message); setSaving(false); return; }
      setTemplates(prev => prev.map(t => t.id === editId ? { ...t, ...payload, id: editId } : t));
    } else {
      const { data, error } = await supabase.from('recurring_journals').insert(payload).select().single();
      if (error) { setFormErr(error.message); setSaving(false); return; }
      setTemplates(prev => [data, ...prev]);
    }
    setShowForm(false); setSaving(false);
  };

  const toggleActive = async (tpl) => {
    const { error } = await supabase.from('recurring_journals').update({ active: !tpl.active }).eq('id', tpl.id);
    if (!error) setTemplates(prev => prev.map(t => t.id === tpl.id ? { ...t, active: !t.active } : t));
  };

  const acctOptions = (coaAccounts?.filter(a => a.is_active !== false).length > 0
    ? coaAccounts.filter(a => a.is_active !== false) : GL_ACCOUNTS);

  const scheduleLabel = (tpl) => {
    const dom = tpl.day_of_month === 28 ? 'last working day' : `day ${tpl.day_of_month}`;
    return `Monthly on ${dom}`;
  };

  const nextRun = (tpl) => {
    if (!tpl.active) return '—';
    const today = new Date();
    const y = today.getFullYear(), m = today.getMonth() + 1;
    const dom = Math.min(tpl.day_of_month, new Date(y, m, 0).getDate());
    const candidate = new Date(y, m - 1, dom);
    const next = candidate >= today ? candidate : new Date(y, m, Math.min(tpl.day_of_month, new Date(y, m + 1, 0).getDate()));
    return next.toLocaleDateString('en-IE');
  };

  if (loading) return <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>Loading…</div>;

  return (
    <div>
      {!readOnly && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <button className="btn btn-p" onClick={startNew}>+ New Recurring Journal</button>
        </div>
      )}

      {showForm && (
        <div className="jnl-form" style={{ marginBottom: 14 }}>
          <div className="jnl-fh">
            <span className="jnl-ft">{editId ? 'Edit' : 'New'} Recurring Journal</span>
            <button className="btn btn-s btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
          <div className="jnl-fb">
            <div className="f-row">
              <div className="f-group" style={{ flex: 2 }}>
                <label className="f-label">Template Name</label>
                <input className="f-input" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Monthly Rent Accrual" />
              </div>
              <div className="f-group">
                <label className="f-label">Type</label>
                <select className="f-input" value={form.journal_type} onChange={e => setForm(p => ({ ...p, journal_type: e.target.value }))}>
                  <option value="standard">Standard</option>
                  <option value="accrual">Accrual (auto-reversal)</option>
                </select>
              </div>
              <div className="f-group">
                <label className="f-label">Amount (€)</label>
                <input className="f-input" type="number" min="0" step="0.01" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} placeholder="0.00" />
              </div>
            </div>
            <div className="f-row">
              <div className="f-group">
                <label className="f-label">Debit Account</label>
                <select className="f-input" value={form.debit_account} onChange={e => setForm(p => ({ ...p, debit_account: e.target.value }))}>
                  <option value="">Select…</option>
                  {acctOptions.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                </select>
              </div>
              <div className="f-group">
                <label className="f-label">Credit Account</label>
                <select className="f-input" value={form.credit_account} onChange={e => setForm(p => ({ ...p, credit_account: e.target.value }))}>
                  <option value="">Select…</option>
                  {acctOptions.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                </select>
              </div>
              <div className="f-group">
                <label className="f-label">VAT Code</label>
                <select className="f-input" value={form.vat_code} onChange={e => setForm(p => ({ ...p, vat_code: e.target.value }))}>
                  <option value="">None</option>
                  {['STD23','RED13','RED9','ZERO','EXEMPT','RCT','RC_EU','NONE'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="f-row">
              <div className="f-group" style={{ flex: 2 }}>
                <label className="f-label">Description Template <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>(supports {'{month}'} {'{year}'})</span></label>
                <input className="f-input" value={form.description_template} onChange={e => setForm(p => ({ ...p, description_template: e.target.value }))} placeholder="e.g. Rent accrual — {month} {year}" />
              </div>
              <div className="f-group">
                <label className="f-label">Day of Month <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>(1–28)</span></label>
                <input className="f-input" type="number" min="1" max="28" value={form.day_of_month} onChange={e => setForm(p => ({ ...p, day_of_month: e.target.value }))} />
              </div>
            </div>
            <div className="f-row">
              <div className="f-group">
                <label className="f-label">Start Date</label>
                <input className="f-input" type="date" value={form.start_date} onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))} />
              </div>
              <div className="f-group">
                <label className="f-label">End Date <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>(leave blank = ongoing)</span></label>
                <input className="f-input" type="date" value={form.end_date} onChange={e => setForm(p => ({ ...p, end_date: e.target.value }))} />
              </div>
            </div>
            {formErr && <div style={{ fontSize: 12, color: 'var(--danger)', background: 'var(--danger-dim)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 3, padding: '7px 11px', marginBottom: 8 }}>{formErr}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-p" onClick={save} disabled={saving}>{saving ? 'Saving…' : editId ? 'Update' : 'Create'}</button>
              <button className="btn btn-s" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {templates.length === 0 && !showForm && (
        <div style={{ textAlign: 'center', padding: '56px 40px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 3 }}>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>No recurring journals set up yet.</div>
          {!readOnly && <button className="btn btn-p" onClick={startNew}>+ New Recurring Journal</button>}
        </div>
      )}

      <div className="jnl-list">
        {templates.map(tpl => (
          <div key={tpl.id} className="jnl-card">
            <div className="jnl-head" style={{ cursor: 'default' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{tpl.name}</span>
                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, fontFamily: 'Source Code Pro, monospace',
                    background: tpl.journal_type === 'accrual' ? 'rgba(139,92,246,0.12)' : 'var(--surface-2)',
                    color: tpl.journal_type === 'accrual' ? '#a78bfa' : 'var(--text-faint)' }}>
                    {tpl.journal_type === 'accrual' ? 'ACCRUAL' : 'STANDARD'}
                  </span>
                  {!tpl.active && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: 'var(--surface-2)', color: 'var(--text-faint)', fontFamily: 'Source Code Pro, monospace' }}>PAUSED</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'Source Code Pro, monospace' }}>
                  DR {tpl.debit_account} / CR {tpl.credit_account} · {fmtEUR(tpl.amount)} · {scheduleLabel(tpl)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                  Next run: {nextRun(tpl)} · Starts {tpl.start_date}{tpl.end_date ? ` · Ends ${tpl.end_date}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                <button className="btn btn-s btn-sm" onClick={() => loadRuns(tpl.id)}>
                  {expandedRuns === tpl.id ? 'Hide History' : 'History'}
                </button>
                {!readOnly && <button className="btn btn-s btn-sm" onClick={() => startEdit(tpl)}>Edit</button>}
                {!readOnly && (
                  <button className="btn btn-s btn-sm" onClick={() => toggleActive(tpl)}
                    style={{ color: tpl.active ? 'var(--warn)' : 'var(--accent)' }}>
                    {tpl.active ? 'Pause' : 'Resume'}
                  </button>
                )}
              </div>
            </div>
            {expandedRuns === tpl.id && (
              <div style={{ borderTop: '1px solid var(--border)', padding: '8px 12px' }}>
                {(runs[tpl.id] || []).length === 0
                  ? <div style={{ fontSize: 12, color: 'var(--text-faint)', padding: '4px 0' }}>No runs yet.</div>
                  : (runs[tpl.id] || []).map(run => (
                    <div key={run.id} style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 11, color: 'var(--text-muted)', fontFamily: 'Source Code Pro, monospace', padding: '3px 0' }}>
                      <span style={{ width: 70 }}>{run.period}</span>
                      <span style={{ color: 'var(--accent)' }}>✓ posted</span>
                      <span style={{ color: 'var(--text-faint)' }}>{run.posted_at ? new Date(run.posted_at).toLocaleDateString('en-IE') : ''}</span>
                    </div>
                  ))
                }
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── JOURNAL ATTACHMENTS ──────────────────────────────────────────────────────
const ATTACHMENT_BUCKET  = 'journal-attachments';
const ATTACHMENT_MAX     = 10 * 1024 * 1024; // 10 MB
const ATTACHMENT_TYPES   = ['application/pdf','image/jpeg','image/png','image/webp','image/gif'];
const ATTACHMENT_ACCEPT  = '.pdf,.jpg,.jpeg,.png,.webp,.gif';

function fmtFileSize(bytes) {
  if (bytes < 1024)           return `${bytes} B`;
  if (bytes < 1024 * 1024)    return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function JournalAttachments({ journalId, companyId, userId }) {
  const [attachments, setAttachments] = useState([]);
  const [loadingAtts, setLoadingAtts] = useState(true);
  const [uploading, setUploading]     = useState(false);
  const [uploadErr, setUploadErr]     = useState(null);
  const [dragOver, setDragOver]       = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!journalId) return;
    setLoadingAtts(true);
    supabase.from('journal_attachments')
      .select('*')
      .eq('journal_id', journalId)
      .order('created_at', { ascending: true })
      .then(({ data }) => { setAttachments(data || []); setLoadingAtts(false); });
  }, [journalId]);

  const uploadFile = async (file) => {
    setUploadErr(null);
    if (!ATTACHMENT_TYPES.includes(file.type)) {
      setUploadErr('Unsupported file type. Accepted: PDF, JPEG, PNG, WEBP, GIF.');
      return;
    }
    if (file.size > ATTACHMENT_MAX) {
      setUploadErr('File too large — maximum is 10 MB.');
      return;
    }
    setUploading(true);

    const ext       = file.name.split('.').pop().toLowerCase();
    const storePath = `${companyId}/${journalId}/${crypto.randomUUID()}.${ext}`;

    const { error: storeErr } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .upload(storePath, file, { contentType: file.type, upsert: false });

    if (storeErr) {
      setUploadErr(`Upload failed: ${storeErr.message}`);
      setUploading(false);
      return;
    }

    const { data: row, error: dbErr } = await supabase
      .from('journal_attachments')
      .insert({
        journal_id:  journalId,
        company_id:  companyId,
        file_name:   file.name,
        file_path:   storePath,
        mime_type:   file.type,
        file_size:   file.size,
        uploaded_by: userId || null,
      })
      .select()
      .single();

    if (dbErr) {
      await supabase.storage.from(ATTACHMENT_BUCKET).remove([storePath]);
      setUploadErr(`Metadata save failed: ${dbErr.message}`);
      setUploading(false);
      return;
    }

    setAttachments(prev => [...prev, row]);
    setUploading(false);
  };

  const handleFiles = files => {
    Array.from(files).forEach(f => uploadFile(f));
  };

  const viewAttachment = async (att) => {
    const { data, error } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .createSignedUrl(att.file_path, 3600);
    if (error || !data?.signedUrl) {
      alert(`Could not generate link: ${error?.message || 'unknown error'}`);
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const deleteAttachment = async (att) => {
    if (!window.confirm(`Delete "${att.file_name}"?`)) return;
    await supabase.storage.from(ATTACHMENT_BUCKET).remove([att.file_path]);
    await supabase.from('journal_attachments').delete().eq('id', att.id);
    setAttachments(prev => prev.filter(a => a.id !== att.id));
  };

  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: '12px 18px 14px' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
        Attachments {attachments.length > 0 && <span style={{ fontWeight: 400, color: 'var(--dim)', textTransform: 'none', letterSpacing: 0 }}>({attachments.length})</span>}
      </div>

      {/* Attachment list */}
      {!loadingAtts && attachments.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          {attachments.map(att => (
            <div key={att.id} className="att-row">
              <span className="att-icon">{att.mime_type === 'application/pdf' ? '📄' : '🖼'}</span>
              <span className="att-name" title={att.file_name}>{att.file_name}</span>
              <span className="att-size">{fmtFileSize(att.file_size)}</span>
              <button className="att-btn" onClick={() => viewAttachment(att)}>View ↗</button>
              <button className="att-btn att-btn-del" onClick={() => deleteAttachment(att)} title="Remove attachment">✕</button>
            </div>
          ))}
        </div>
      )}

      {loadingAtts && <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 8 }}>Loading…</div>}

      {/* Drop zone */}
      <div
        className={`att-zone${dragOver ? ' drag-over' : ''}`}
        onClick={() => !uploading && fileInputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }}
        onDrop={e => { e.preventDefault(); setDragOver(false); if (!uploading) handleFiles(e.dataTransfer.files); }}
      >
        <input ref={fileInputRef} type="file" style={{ display: 'none' }}
          accept={ATTACHMENT_ACCEPT} multiple
          onChange={e => { handleFiles(e.target.files); e.target.value = ''; }} />
        {uploading
          ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Uploading…</span>
          : <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
              Drop files here or <span style={{ color: 'var(--accent)' }}>click to attach</span>
              <span style={{ color: 'var(--dim)' }}> · PDF, JPG, PNG · max 10 MB</span>
            </span>
        }
      </div>

      {uploadErr && (
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--danger)', background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 3, padding: '5px 9px' }}>
          {uploadErr}
        </div>
      )}
    </div>
  );
}

function Journals({ period, selPeriod, companyName, companyId: propCompanyId, readOnly = false }) {
  const { user } = useUser();
  const { accounts: coaAccounts } = useChartOfAccounts(propCompanyId);
  const now = new Date();

  const [activeTab, setActiveTab] = useState('journals');
  const [journals, setJournals]   = useState([]);
  const [companyId, setCompanyId] = useState(null);
  const [loading, setLoading]     = useState(true);
  const [expanded, setExpanded]   = useState(null);
  const [showForm, setShowForm]   = useState(false);
  const periodLabel = new Date(selPeriod + '-01').toLocaleDateString("en-IE", { month: "long", year: "numeric" });

  const emptyForm = () => ({ date: new Date().toISOString().slice(0, 10), description: "", debit_account: "", credit_account: "", amount: "", reference: "" });
  const [form, setForm] = useState(emptyForm());

  const toDisplayJournal = (j) => ({
    id: j.id,
    ref: j.reference,
    date: j.date,
    description: j.description,
    preparedBy: "User",
    status: "posted",
    lines: [
      { account: j.debit_account,  name: coaAccounts.find(a => a.code === j.debit_account)?.name  || GL_ACCOUNTS.find(a => a.code === j.debit_account)?.name  || j.debit_account,  debit: j.amount, credit: 0 },
      { account: j.credit_account, name: coaAccounts.find(a => a.code === j.credit_account)?.name || GL_ACCOUNTS.find(a => a.code === j.credit_account)?.name || j.credit_account, debit: 0, credit: j.amount },
    ],
  });

  const resolveCompanyId = async () => {
    let { data: companies } = await supabase
      .from("companies")
      .select("id")
      .eq("clerk_user_id", user.id)
      .limit(1);

    if (companies && companies.length > 0) return companies[0].id;

    const companyName = user.firstName
      ? `${user.firstName} ${user.lastName ?? ""}`.trim()
      : user.emailAddresses[0].emailAddress;
    const { data: created, error: createErr } = await supabase
      .from("companies")
      .insert({ clerk_user_id: user.id, name: companyName })
      .select("id")
      .single();
    if (createErr) throw new Error(`Could not create workspace: ${createErr.message}`);
    return created.id;
  };

  // Resolve companyId: use prop if provided, otherwise derive from user
  useEffect(() => {
    if (propCompanyId) { setCompanyId(propCompanyId); return; }
    if (!user) return;
    let cancelled = false;
    resolveCompanyId()
      .then(cid => { if (!cancelled) setCompanyId(cid); })
      .catch(err => console.error("[journals] resolveCompanyId:", err.message));
    return () => { cancelled = true; };
  }, [user, propCompanyId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch journals filtered to selected period
  useEffect(() => {
    if (!companyId) return;
    (async () => {
      setLoading(true);
      try {
        const db = supabase;
        const [y, m] = selPeriod.split('-').map(Number);
        const start = `${selPeriod}-01`;
        const end = new Date(y, m, 0).toISOString().slice(0, 10);
        const { data: rows, error: rowsErr } = await db
          .from("journals")
          .select("*")
          .eq("company_id", companyId)
          .gte("date", start)
          .lte("date", end)
          .order("date", { ascending: false });
        if (rowsErr) throw new Error(rowsErr.message);
        if (rows) setJournals(rows.map(toDisplayJournal));
      } catch (err) {
        console.error("[journals] fetch failed:", err.message);
      }
      setLoading(false);
    })();
  }, [companyId, selPeriod]); // eslint-disable-line

  const [postError, setPostError] = useState(null);

  const formValid = !!(form.description && form.debit_account && form.credit_account &&
    form.amount && parseFloat(form.amount) > 0 && form.debit_account !== form.credit_account);

  const post = async () => {
    if (!formValid) return;
    setPostError(null);

    let cid;
    try { cid = requireCompanyId(companyId); } catch (err) { setPostError(err.message); return; }

    // Period-lock check before writing
    const dateStr = sanitiseDate(form.date);
    const lockCheck = await isPeriodLocked(cid, dateStr);
    if (lockCheck.locked) {
      const filedOn = lockCheck.filedAt
        ? new Date(lockCheck.filedAt).toLocaleDateString('en-IE')
        : 'a previous date';
      setPostError(`This period's VAT3 was filed on ${filedOn} — post to the current period or unlock first.`);
      return;
    }

    const amount = parseFloat(form.amount);
    const ref = form.reference.trim() || `JNL-${String(jnlCounter++).padStart(3, "0")}`;
    const { data: inserted, error } = await supabase.from("journals").insert({
      company_id: cid,
      date: dateStr,
      description: form.description,
      debit_account: form.debit_account,
      credit_account: form.credit_account,
      amount,
      reference: ref,
    }).select().single();
    if (error) {
      setPostError(`Save failed: ${error.message}`);
      return;
    }
    setJournals(prev => [toDisplayJournal(inserted), ...prev]);
    setForm(emptyForm());
    setShowForm(false);
  };

  return (
    <div className="fade-up">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text)", marginBottom: 2 }}>Journal Postings — {periodLabel}</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>{journals.length} journal{journals.length !== 1 ? "s" : ""} in {periodLabel}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {readOnly && <span className="ro-badge">Read-only</span>}
          {activeTab === 'journals' && !readOnly && <button className="btn btn-p" onClick={() => setShowForm(true)}>+ New Journal</button>}
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)", marginBottom: 14 }}>
        {[['journals', 'Journals'], ['recurring', 'Recurring']].map(([id, label]) => (
          <button key={id} onClick={() => setActiveTab(id)} style={{
            padding: "7px 16px", fontSize: 12, fontWeight: 600, border: "none",
            borderBottom: activeTab === id ? "2px solid var(--accent)" : "2px solid transparent",
            background: "transparent", color: activeTab === id ? "var(--accent)" : "var(--text-muted)",
            cursor: "pointer", transition: "color 0.15s",
          }}>{label}</button>
        ))}
      </div>

      {activeTab === 'recurring' && (
        <RecurringTab companyId={companyId} coaAccounts={coaAccounts} readOnly={readOnly} />
      )}

      {activeTab === 'journals' && (
        <>
          {showForm && !readOnly && (
            <div className="jnl-form">
              <div className="jnl-fh"><span className="jnl-ft">New Journal Entry</span><button className="btn btn-s btn-sm" onClick={() => setShowForm(false)}>Cancel</button></div>
              <div className="jnl-fb">
                <div className="f-row">
                  <div className="f-group">
                    <label className="f-label">Date</label>
                    <input className="f-input" type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
                  </div>
                  <div className="f-group">
                    <label className="f-label">Reference</label>
                    <input className="f-input" value={form.reference} onChange={e => setForm(p => ({ ...p, reference: e.target.value }))} placeholder={`JNL-${String(jnlCounter).padStart(3, "0")}`} />
                  </div>
                  <div className="f-group">
                    <label className="f-label">Amount (€)</label>
                    <input className="f-input" type="number" min="0" step="0.01" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} placeholder="0.00" />
                  </div>
                </div>
                <div className="f-row">
                  <div className="f-group">
                    <label className="f-label">Debit Account</label>
                    <select className="f-input" value={form.debit_account} onChange={e => setForm(p => ({ ...p, debit_account: e.target.value }))}>
                      <option value="">Select account…</option>
                      {(coaAccounts.filter(a => a.is_active !== false).length > 0 ? coaAccounts.filter(a => a.is_active !== false) : GL_ACCOUNTS).map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                    </select>
                  </div>
                  <div className="f-group">
                    <label className="f-label">Credit Account</label>
                    <select className="f-input" value={form.credit_account} onChange={e => setForm(p => ({ ...p, credit_account: e.target.value }))}>
                      <option value="">Select account…</option>
                      {(coaAccounts.filter(a => a.is_active !== false).length > 0 ? coaAccounts.filter(a => a.is_active !== false) : GL_ACCOUNTS).map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                    </select>
                  </div>
                  <div className="f-group">
                    <label className="f-label">Description</label>
                    <input className="f-input" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Brief description of this journal entry" />
                  </div>
                </div>
                {postError && (
                  <div style={{ marginBottom: 10, fontSize: 12, color: "var(--red)", background: "rgba(139,32,32,0.06)", border: "1px solid rgba(139,32,32,0.2)", borderRadius: 2, padding: "7px 11px" }}>
                    {postError}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-p" onClick={post} disabled={!formValid} style={{ opacity: !formValid ? 0.42 : 1 }}>Post Journal</button>
                  <button className="btn btn-s" onClick={() => setShowForm(false)}>Cancel</button>
                </div>
              </div>
            </div>
          )}

          {loading && <div style={{ color: "var(--dim)", fontSize: 13, padding: "20px 0" }}>Loading journals…</div>}

          <div className="jnl-list">
            {journals.map((j, ji) => (
              <div key={ji} className="jnl-card">
                <div className="jnl-head" onClick={() => setExpanded(expanded === ji ? null : ji)}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span className="jnl-ref">{j.ref}</span>
                      <SPill status={j.status} />
                    </div>
                    <div className="jnl-desc">{j.description}</div>
                    <div className="jnl-meta">{j.date} · Prepared by {j.preparedBy}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 10, color: "var(--dim)", fontFamily: "Source Code Pro, monospace" }}>Total</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{fmt(j.lines.reduce((s, l) => s + l.debit, 0))}</div>
                    </div>
                    <span style={{ color: "var(--dim)" }}>{expanded === ji ? "▲" : "▼"}</span>
                  </div>
                </div>
                {expanded === ji && (
                  <div>
                    <div className="jl-hdr">
                      <span style={{ width: 55 }}>Code</span><span style={{ flex: 1 }}>Account Name</span>
                      <span style={{ width: 110, textAlign: "right" }}>Debit (€)</span><span style={{ width: 110, textAlign: "right" }}>Credit (€)</span>
                    </div>
                    {j.lines.map((l, li) => (
                      <div key={li} className="jl-row">
                        <span className="jl-code">{l.account}</span><span className="jl-name">{l.name}</span>
                        <span className="jl-dr">{l.debit > 0 ? fmt(l.debit) : "—"}</span>
                        <span className="jl-cr">{l.credit > 0 ? fmt(l.credit) : "—"}</span>
                      </div>
                    ))}
                    <div className="jl-row" style={{ background: "var(--surface2)", fontWeight: 600 }}>
                      <span className="jl-code" /><span className="jl-name" style={{ fontSize: 12, fontWeight: 600 }}>Total</span>
                      <span className="jl-dr" style={{ fontWeight: 700 }}>{fmt(j.lines.reduce((s, l) => s + l.debit, 0))}</span>
                      <span className="jl-cr" style={{ fontWeight: 700 }}>{fmt(j.lines.reduce((s, l) => s + l.credit, 0))}</span>
                    </div>
                    {j.id && companyId && (
                      <JournalAttachments journalId={j.id} companyId={companyId} userId={user?.id} />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── BANK IMPORT HELPERS ──────────────────────────────────────────────────────
function parseCsvLine(line) {
  const result = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === "," && !inQ) { result.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  result.push(cur.trim());
  return result;
}

function parseRevolutCSV(text) {
  const lines = text.split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const idx = name => headers.findIndex(h => h === name);
  const idI = idx("ID"), stateI = idx("State"), dateI = idx("Date completed (UTC)");
  const descI = idx("Description"), amtI = idx("Amount"), currI = idx("Currency");
  const balI = idx("Balance"), typeI = idx("Type");
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    if (!c.length || c.every(x => !x)) continue;
    if ((c[stateI] || "").trim().toUpperCase() !== "COMPLETED") continue;
    rows.push({
      revolut_id: (c[idI] || `ROW-${i}`).trim(),
      date: (c[dateI] || "").trim().slice(0, 10),
      description: (c[descI] || "").trim(),
      amount: parseFloat((c[amtI] || "0").trim()) || 0,
      currency: (c[currI] || "EUR").trim(),
      balance: parseFloat((c[balI] || "0").trim()) || 0,
      type: (c[typeI] || "").trim(),
    });
  }
  return rows;
}

// Guard against YYYY-DD-MM dates that can appear when day and month were swapped during parsing.
// If the month part (positions 5-6) is > 12, we know day/month are reversed and swap them back.
function sanitiseDate(date) {
  const s = String(date || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s;
  const [, y, mo, d] = m;
  if (parseInt(mo, 10) > 12 && parseInt(d, 10) <= 12) {
    const fixed = `${y}-${d}-${mo}`;
    console.warn(`[sanitiseDate] corrected swapped date ${s} → ${fixed}`);
    return fixed;
  }
  return s;
}

function detectCSVFormat(text) {
  const first = text.split("\n")[0].replace(/\r/g, "") || "";
  console.log("[detectCSVFormat] first line:", JSON.stringify(first));
  if (first.includes("Posted Account") || first.includes("Posted Transactions Date")) {
    console.log("[detectCSVFormat] detected: aib");
    return "aib";
  }
  if (first.includes("Date completed (UTC)")) {
    console.log("[detectCSVFormat] detected: revolut");
    return "revolut";
  }
  console.warn("[detectCSVFormat] unrecognised header — could not detect format");
  return null;
}

function parseAIBDate(raw) {
  const s = (raw || "").trim();
  const parts = s.split("/");
  if (parts.length !== 3) {
    if (s) console.warn("[parseAIBDate] could not parse date:", JSON.stringify(s));
    return "";
  }
  const day   = parseInt(parts[0], 10); // AIB Ireland always uses DD/MM/YYYY
  const month = parseInt(parts[1], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    console.warn("[parseAIBDate] invalid date (expected DD/MM/YYYY):", JSON.stringify(s));
    return "";
  }
  return `${parts[2]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function aibHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return "AIB-" + (h >>> 0).toString(16).padStart(8, "0");
}

function parseAIBCSV(text) {
  console.log("[parseAIBCSV] starting, text length:", text.length);
  // Normalise line endings
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(l => l.trim());
  console.log("[parseAIBCSV] total lines (incl header):", lines.length);
  if (lines.length < 2) { console.warn("[parseAIBCSV] not enough lines"); return []; }
  const headers = parseCsvLine(lines[0]);
  console.log("[parseAIBCSV] headers:", headers);
  const idx = name => headers.findIndex(h => h.trim() === name);
  const dateI = idx("Posted Transactions Date");
  const d1I   = idx("Description1"), d2I = idx("Description2"), d3I = idx("Description3");
  const debI  = idx("Debit Amount"), crI = idx("Credit Amount");
  const balI  = idx("Balance"), currI = idx("Posted Currency"), typeI = idx("Transaction Type");
  console.log("[parseAIBCSV] column indices — date:", dateI, "desc1:", d1I, "debit:", debI, "credit:", crI, "balance:", balI);
  if (dateI === -1) { console.error("[parseAIBCSV] 'Posted Transactions Date' column not found — headers don't match expected AIB format"); return []; }
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    if (!c.length || c.every(x => !x)) continue;
    const date = parseAIBDate(c[dateI] || "");
    if (!date) { console.warn("[parseAIBCSV] row", i, "skipped — bad date:", JSON.stringify(c[dateI])); continue; }
    const desc = [c[d1I], c[d2I], c[d3I]].map(s => (s || "").trim()).filter(Boolean).join(" ");
    const credit = parseFloat((c[crI] || "0").replace(/,/g, "")) || 0;
    const debit  = parseFloat((c[debI] || "0").replace(/,/g, "")) || 0;
    const amount  = credit - debit;
    const balance = parseFloat((c[balI] || "0").replace(/,/g, "")) || 0;
    const currency = (c[currI] || "EUR").trim();
    const type = (c[typeI] || "").trim();
    const revolut_id = aibHash(`${date}|${desc}|${amount}|${i}`);
    rows.push({ revolut_id, date, description: desc, amount, currency, balance, type });
  }
  console.log("[parseAIBCSV] parsed", rows.length, "rows. First row:", rows[0]);
  return rows;
}

function cleanPayee(description) {
  let s = (description || "").trim();

  // 1. Strip leading bank / gateway prefixes — applied 3× to handle chained ones
  //    e.g. "SP PAYPAL *MERCHANT" → "MERCHANT" in two passes
  const PREFIX_RE = /^(card\s+payment\s+at\s+|card\s+purchase\s+|online\s+purchase\s+|online\s+transfer\s+(to|from)\s+|payment\s+(to|from)\s+|received\s+from\s+|sent\s+to\s+|money\s+added\s+from\s+|from\s+|to\s+|vdp-?|vsp-?|bp\s|dd\s|so\s|atm\s|pos\s|tfr\s|fee\s|sto\s|chg\s|sp\s|sq[\s*]|sepa\s+ct\s+|paypal[\s*]+|stripe[\s*]+|amzn[\s*]+|goog[\s*]+|msft[\s*]+|www\.|https?:\/\/)/i;
  for (let i = 0; i < 4; i++) s = s.replace(PREFIX_RE, "").trim();

  // 2. Strip reference codes, card numbers, account numbers (alphanumeric blobs)
  s = s.replace(/\b[A-Z]{1,3}\d{4,}[A-Z0-9]*\b/gi, ""); // ref codes: IE29AIBK, REF00123
  s = s.replace(/\b\d{1,2}[\/\-.]\d{1,2}([\/\-.]\d{2,4})?\b/g, ""); // dates: 12/03/24
  s = s.replace(/\b[A-Z]{2,4}\d{2,}\b/gi, "");           // month-year codes: MAR24, JAN2024
  s = s.replace(/\b\d{2,}\b/g, "");                       // any remaining 2+ digit numbers

  // 3. Strip special / punctuation characters → space
  s = s.replace(/[*_#@!|\\/.,:;()\[\]{}'"\-]/g, " ");

  // 4. Strip company / country / location suffixes
  s = s.replace(/\b(ltd|limited|plc|dac|uc|llc|inc|gmbh|sarl|irl|ireland|ire|ie|dublin|cork|galway|limerick|uk|gb|eu|us|usa|online|stores?|group|holdings?|services?|solutions?)\b/gi, "");

  // 5. Collapse, lowercase, keep only first 4 meaningful words (≥3 chars, non-numeric)
  // 4 words preserves enough distinction to avoid merchant collisions (e.g. "google ads" vs "google gsuite")
  const words = s.replace(/\s+/g, " ").trim().toLowerCase()
    .split(" ")
    .filter(w => w.length >= 3 && !/^\d+$/.test(w));

  return words.slice(0, 4).join(" ");
}

function wordOverlap(a, b) {
  const words = s => new Set(s.split(/\s+/).filter(w => w.length > 2 && !/^\d+$/.test(w)));
  const wa = words(a), wb = words(b);
  if (!wa.size || !wb.size) return 0;
  let common = 0;
  wa.forEach(w => { if (wb.has(w)) common++; });
  return common / Math.max(wa.size, wb.size);
}

function suggestNominalFallback(description, amount) {
  const d = (description || "").toLowerCase();
  // Keyword matches take priority regardless of direction
  if (/salary|payroll|wages|staff/.test(d)) return "6000";
  if (/rent|lease|rates|office space/.test(d)) return "6100";
  if (/fuel|motor|toll|parking|train|flight|taxi|\bcar\b/.test(d)) return "6200";
  if (/phone|mobile|broadband|internet|telecom/.test(d)) return "6300";
  if (/legal|solicitor|accountant|audit|professional|consultant/.test(d)) return "6400";
  if (/bank charge|bank fee|account fee|monthly fee/.test(d)) return "6500";
  if (/marketing|advertising|advert|google ads|meta ads/.test(d)) return "6700";
  if (/insurance/.test(d)) return "6800";
  if (/repair|maintenance/.test(d)) return "6900";
  if (/depreciation/.test(d)) return "6950";
  if (/\bvat\b|revenue commissioners|ros\.ie/.test(d)) return "2100";
  if (/paye|prsi|usc|p30/.test(d)) return "2200";
  if (/subcontract|sub-contract/.test(d)) return "5200";
  if (/materials|supplies|stock|cost of/.test(d)) return "5100";
  if (/interest received|deposit interest/.test(d)) return "4300";
  // Direction-aware default: money in → Sales Revenue, money out → Sundry Expenses
  return amount > 0 ? "4000" : "6600";
}

// ── Rule-based fallback ────────────────────────────────────────────────────────
const PAYEE_RULES = [
  [/payroll|salary|wages/i,                             "6000"],
  [/rent|rates|lease/i,                                 "6100"],
  [/fuel|motor|toll|parking|transport|flight|taxi/i,    "6200"],
  [/phone|broadband|mobile|saas|software|subscription/i,"6300"],
  [/solicitor|accountant|auditor|consultant|legal/i,    "6400"],
  [/bank.?fee|account.?charge|monthly.?fee|bank.?charge/i,"6500"],
  [/marketing|advertising|google.?ads|meta.?ads|facebook.?ads/i,"6700"],
  [/insurance/i,                                        "6800"],
  [/repair|maintenance|cleaning/i,                      "6900"],
  [/vat|revenue.?commissioners|ros/i,                   "2100"],
  [/paye|prsi|usc/i,                                    "2200"],
  [/loan.?repayment/i,                                  "2500"],
];
function ruleCode(payee) {
  const n = (payee.name || payee.key || "").toLowerCase();
  for (const [rx, code] of PAYEE_RULES) if (rx.test(n)) return code;
  return payee.direction === "income" ? "4000" : "6600";
}

const CAT_CHUNK_SIZE    = 75;
const CAT_CHUNK_DELAY   = 500;   // ms between chunks
const CAT_CHUNK_TIMEOUT = 55000; // ms per chunk — fits within 60s Vercel Pro limit

// Module-level AbortController — lives outside React so Clerk token refreshes and
// parent re-renders cannot cancel an in-flight categorisation.
let globalCatAbortCtrl = null;

// Accepts deduplicated payees array: [{ key, name, count, totalAmount, direction }]
// Returns { map, allChunksFailed }.
async function categoriseWithAI(uniquePayees, { onProgress, cancelRef, businessContext, txRules } = {}) {
  globalCatAbortCtrl = new AbortController();
  const signal = globalCatAbortCtrl.signal;

  // Use full rules engine for fallback; synthetic amount encodes direction for applyRules
  const bestFallbackCode = (p) => {
    const match = txRules?.length && applyRules(p.name || p.key, p.direction === "income" ? 1 : -1, txRules);
    return match ? match.nominal_code : ruleCode(p);
  };

  const chunks = [];
  for (let i = 0; i < uniquePayees.length; i += CAT_CHUNK_SIZE) {
    chunks.push(uniquePayees.slice(i, i + CAT_CHUNK_SIZE));
  }
  console.log(`[categoriseWithAI] START — ${uniquePayees.length} payees in ${chunks.length} chunk(s) of ${CAT_CHUNK_SIZE}`);

  const map = {};
  let chunkIndex = 0;
  let successfulChunks = 0;

  for (const chunk of chunks) {
    chunkIndex++;

    if (cancelRef?.current) {
      console.log(`[categoriseWithAI] cancelled before chunk ${chunkIndex}`);
      break;
    }

    onProgress?.(chunkIndex - 1, chunks.length,
      `Categorising payees with AI… chunk ${chunkIndex} of ${chunks.length}`);

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Chunk timed out after ${CAT_CHUNK_TIMEOUT / 1000}s`)), CAT_CHUNK_TIMEOUT)
    );
    const body = businessContext ? { payees: chunk, businessContext } : { payees: chunk };
    const fetchPromise = fetch("/api/categorise", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    }).then(async res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.results) throw new Error("No results in response");
      return data.results;
    });

    try {
      const results = await Promise.race([fetchPromise, timeoutPromise]);
      results.forEach(r => { map[r.key] = { code: r.code, confidence: r.confidence }; });
      successfulChunks++;
      console.log(`[categoriseWithAI] chunk ${chunkIndex}/${chunks.length} done — ${results.length} results`);
    } catch (err) {
      const aborted = err.name === "AbortError" || err.message?.includes("aborted");
      console.warn(`[categoriseWithAI] chunk ${chunkIndex}/${chunks.length} failed${aborted ? " (aborted)" : ""}:`, err.message);
      if (aborted) break;
      let ruleHits = 0, unknown = 0;
      chunk.forEach(p => {
        if (!map[p.key]) {
          const code = bestFallbackCode(p);
          if (code === "6600") unknown++; else ruleHits++;
          map[p.key] = { code, confidence: "low" };
        }
      });
      console.log(`[fallback] ${ruleHits} payees re-matched by rules after AI failure, ${unknown} genuinely unknown → 6600`);
    }

    if (chunkIndex < chunks.length && !cancelRef?.current) {
      await new Promise(r => setTimeout(r, CAT_CHUNK_DELAY));
    }
  }

  console.log(`[categoriseWithAI] DONE — ${successfulChunks}/${chunks.length} chunks succeeded`);

  // Fill any payees that got no result
  uniquePayees.forEach(p => {
    if (!map[p.key]) map[p.key] = { code: bestFallbackCode(p), confidence: "low" };
  });

  globalCatAbortCtrl = null;
  return { map, allChunksFailed: chunks.length > 0 && successfulChunks === 0 };
}

// ─── BANK IMPORT ──────────────────────────────────────────────────────────────
const CONF_COLOR = { high: "var(--green)", medium: "var(--gold)", low: "var(--red)" };

// Strip AIB-style prefixes and trailing junk to get a clean merchant name for pattern matching.
// Example: "*INET BWAGES IE25121264477151 TxnDate: 12Dec2025" → "inet bwages"
function preCleanDesc(raw) {
  let s = (raw || "").trim();
  // Remove leading AIB transaction type codes
  s = s.replace(/^(VDP-|VDC-|VDA-|VDP |VDC |VDA |D\/D |DD )/i, "").trim();
  // Remove leading asterisk (e.g. "*INET WAGES")
  s = s.replace(/^\*/, "").trim();
  // Remove TxnDate and everything after (AIB format: "TxnDate: 12Dec2025")
  s = s.replace(/\s*TxnDate:.*$/i, "").trim();
  // Remove IBAN references — IE + 2 digits + any alphanumeric (e.g. IE25121264477151 or IE25AIBK...)
  s = s.replace(/\bIE\d{2}[A-Z0-9]+\b.*$/i, "").trim();
  // Remove trailing card-last-4 references like " *3702"
  s = s.replace(/\s*\*\d{4}\b.*$/, "").trim();
  // Remove trailing date/time stamps like "08FEB25 11:49", "08FEB25", "12Dec2025"
  s = s.replace(/\s+\d{2}[A-Z]{3}\d{2,4}(\s+\d{2}:\d{2})?$/i, "").trim();
  return s.toLowerCase();
}

// More aggressive version of preCleanDesc — strips reference codes and returns the first
// distinctive uppercase merchant token, e.g. "VDP-Spotify P359F1 *3702" → "SPOTIFY".
function extractKeyword(raw) {
  let s = (raw || '').trim();
  s = s.replace(/^(VDP-|VDC-|VDA-|VDP |VDC |VDA |D\/D |DD )/i, '').trim();
  s = s.replace(/^\*/, '').trim();
  s = s.replace(/\s*TxnDate:.*$/i, '').trim();
  s = s.replace(/\bIE\d{2}[A-Z0-9]+\b.*/i, '').trim();
  s = s.replace(/\s*\*\d{4}\b.*$/g, '').trim();
  s = s.replace(/\s+\d{2}[A-Z]{3}\d{2,4}(\s+\d{2}:\d{2})?$/i, '').trim();
  // Hyphenated ref codes like PA-XEWMGNCV
  s = s.replace(/\b[A-Z]{1,4}-[A-Z0-9]{4,}\b/gi, '').trim();
  // Mixed alphanum tokens with digits, 4+ chars: P359F1, REF123ABC — but not plain words
  s = s.replace(/\b(?=[A-Z0-9]*[0-9])[A-Z0-9]{4,}\b/gi, '').trim();
  s = s.replace(/\s+/g, ' ').trim();
  const first = s.split(/\s+/).find(t => t.length >= 3) || s.split(/\s+/)[0] || '';
  return first.replace(/[^A-Z0-9]/gi, '').toUpperCase();
}

// Applies transaction_rules from the DB against a description + amount.
// Rules are sorted: user > learned > system, then exact > startswith > contains > regex,
// then longer patterns first (more specific wins within same match_type).
// Returns matched rule object or null.
function applyRules(description, amount, rules) {
  const rawLower   = (description || "").toLowerCase();
  const cleanLower = preCleanDesc(description);
  const isIncome   = amount > 0;

  const MATCH_RANK  = { exact: 0, startswith: 1, contains: 2, regex: 3 };
  const SOURCE_RANK = { user: 0, learned: 1, system: 2 };

  const sorted = [...rules].sort((a, b) => {
    const src = (SOURCE_RANK[a.source] ?? 2) - (SOURCE_RANK[b.source] ?? 2);
    if (src !== 0) return src;
    const mt = (MATCH_RANK[a.match_type] ?? 2) - (MATCH_RANK[b.match_type] ?? 2);
    if (mt !== 0) return mt;
    return b.pattern.length - a.pattern.length; // longer = more specific
  });

  for (const rule of sorted) {
    if (rule.direction === 'in'  && !isIncome) continue;
    if (rule.direction === 'out' &&  isIncome) continue;
    const p = rule.pattern.toLowerCase();
    let hit = false;
    try {
      switch (rule.match_type) {
        case 'exact':      hit = rawLower === p || cleanLower === p; break;
        case 'startswith': hit = rawLower.startsWith(p) || cleanLower.startsWith(p); break;
        case 'regex':      { const rx = new RegExp(rule.pattern, 'i'); hit = rx.test(rawLower) || rx.test(cleanLower); break; }
        default:           hit = rawLower.includes(p) || cleanLower.includes(p);
      }
    } catch (e) { console.warn('[applyRules] invalid regex:', rule.pattern); }
    if (hit) return rule;
  }
  return null;
}

class BankImportErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(err) { return { error: err }; }
  componentDidCatch(err, info) {
    console.error("[BankImport] render error caught by boundary:", err, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: "24px 20px", background: "rgba(139,32,32,0.06)", border: "1px solid rgba(139,32,32,0.2)", borderRadius: 8, margin: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--danger)", marginBottom: 8 }}>
            Import session error
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 14, fontFamily: "Source Code Pro, monospace" }}>
            {this.state.error?.message || "An unexpected error occurred"}
          </div>
          <button
            className="btn btn-s btn-sm"
            onClick={() => this.setState({ error: null })}
          >
            Reset Import
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const BankImport = React.memo(function BankImport({ companyId }) {
  const { user } = useUser();
  const { accounts: coaAccounts } = useChartOfAccounts(companyId);
  const { rules: txRules } = useTransactionRules(companyId);
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [nominals, setNominals] = useState({});
  const [confidence, setConfidence] = useState({});
  const [fileName, setFileName] = useState("");
  const [bankFormat, setBankFormat] = useState(null);
  const [over, setOver] = useState(false);
  const [alert, setAlert] = useState(null);
  const [toast, setToast] = useState(null);
  const [posting, setPosting] = useState(false);
  const [catProgress, setCatProgress] = useState(null); // null | { done, total, msg }
  const cancelCatRef = useRef(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [confirmReverse, setConfirmReverse] = useState(null);
  const [reversing, setReversing] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [clearAllInput, setClearAllInput] = useState("");
  const [clearingAll, setClearingAll] = useState(false);
  const fileRef = useRef(null);
  const toastTimer = useRef(null);
  const loadingRef = useRef(false);    // guard against double-invocation
  const isMountedRef = useRef(true);   // false after unmount — guards async state setters
  const ghostFileRef = useRef(null);   // set on session restore; blocks one same-file ghost call

  // Needs Review tab
  const [activeTab, setActiveTab]         = useState('import');
  const [reviewRows, setReviewRows]       = useState([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewChanges, setReviewChanges] = useState({});
  const [applySimilar, setApplySimilar]   = useState(new Set());
  const [reviewSaving, setReviewSaving]   = useState(false);
  const [reviewToast, setReviewToast]     = useState(null);
  const [fixingAll, setFixingAll]         = useState(false);
  const [fixAllResult, setFixAllResult]   = useState(null);

  // Rules learning loop state
  const [learnQueue, setLearnQueue]       = useState([]); // { revolut_id, description, keyword, nominalCode, nominalName, direction }[]
  const [learnKwEdit, setLearnKwEdit]     = useState('');
  const [learnSaving, setLearnSaving]     = useState(false);
  const [learnApplied, setLearnApplied]   = useState(null); // { count, ruleId, appliedIds, originalCode, nominalCode }
  const [learnConflict, setLearnConflict] = useState(false);

  const learnCurrent = learnQueue[0] ?? null;
  useEffect(() => {
    if (learnCurrent) setLearnKwEdit(learnCurrent.keyword);
  }, [learnCurrent?.revolut_id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // Eagerly load review count so the tab badge is visible on mount.
  // Clears state immediately on company switch so stale rows from the previous
  // company are never visible while the new fetch is in flight.
  useEffect(() => {
    setReviewRows([]);
    if (!companyId) return;
    supabase.from('bank_transactions')
      .select('id, revolut_id, date, description, amount, nominal_account')
      .eq('company_id', companyId)
      .eq('nominal_account', '6600')
      .order('date', { ascending: false })
      .then(({ data }) => { setReviewRows(data || []); });
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore in-progress import if a Clerk reload interrupted it.
  // If ledgrly_import_nominals exists for the same file, restore those nominals directly
  // (preserves AI + rule results). Otherwise re-run the rules engine as a fallback.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('ledgrly_import_session');
      if (!saved) return;
      const { version, rows: savedRows, fileName: savedFile, bankFormat: savedFmt } = JSON.parse(saved);
      if (!savedRows?.length) return;
      if (!version || version < 2) { sessionStorage.removeItem('ledgrly_import_session'); return; }

      let restoredNom = null, restoredConf = null;
      try {
        const savedNom = sessionStorage.getItem('ledgrly_import_nominals');
        if (savedNom) {
          const { fileName: nomFile, nominals: nomData } = JSON.parse(savedNom);
          if (nomFile === savedFile && nomData && Object.keys(nomData).length) {
            restoredNom = nomData;
            restoredConf = Object.fromEntries(savedRows.map(r => [r.revolut_id, 'high']));
            console.warn('[sessionStorage] restored', Object.keys(nomData).length, 'saved nominals for', savedFile, '— root-cause fix should have prevented this');
          }
        }
      } catch {}

      if (!restoredNom) {
        restoredNom = {}; restoredConf = {};
        savedRows.forEach(r => {
          restoredNom[r.revolut_id] = suggestNominalFallback(r.description, r.amount);
          restoredConf[r.revolut_id] = 'low';
        });
      }

      setRows(savedRows);
      setNominals(restoredNom);
      setConfidence(restoredConf);
      setFileName(savedFile || '');
      setBankFormat(savedFmt || null);
      setSelected(new Set(savedRows.filter(r => !r.imported).map(r => r.revolut_id)));
      // Arm the ghost-call guard — blocks one same-filename loadFile call that can
      // fire right after restore when the browser restores the file input via form state.
      ghostFileRef.current = savedFile || null;
    } catch {}
  }, []);

  // Keep ledgrly_import_nominals in sync: save whenever categorisation is idle and rows exist.
  // Fires after every nominal change (including manual edits) so the restore is always current.
  useEffect(() => {
    if (catProgress !== null) return;
    if (!rows.length || !fileName) return;
    try {
      sessionStorage.setItem('ledgrly_import_nominals', JSON.stringify({ fileName, nominals }));
    } catch {}
  }, [catProgress, nominals, fileName, rows.length]);

  // Precompute grouped account options once — avoids recomputing 681× per render
  const nominalOptions = useMemo(() => {
    const accts = coaAccounts.filter(a => a.is_active !== false).length > 0
      ? coaAccounts.filter(a => a.is_active !== false)
      : GL_ACCOUNTS.map(a => ({ code: a.code, name: a.name, category: a.type }));
    return accts.reduce((gs, a) => {
      const key = a.category || a.account_type || '—';
      const g = gs.find(x => x.label === key);
      if (g) g.items.push(a); else gs.push({ label: key, items: [a] });
      return gs;
    }, []);
  }, [coaAccounts]);

  const getCid = () => {
    if (!companyId) throw new Error('[BankImport] companyId prop not set — always pass companyId');
    return companyId;
  };

  const loadHistory = async () => {
    setHistory([]);
    setHistoryLoading(true);
    try {
      const cid = getCid();
      console.log("[loadHistory] companyId:", cid);
      const db = supabase;

      // Step 1: probe which timestamp column exists — try created_at first (Supabase default)
      // then imported_at. Use select('*') on a single row to inspect the schema.
      const probe = await db.from("bank_transactions")
        .select("*").eq("company_id", cid).limit(1);
      console.log("[loadHistory] schema probe — error:", probe.error?.message, "| sample row keys:", probe.data?.[0] ? Object.keys(probe.data[0]).join(", ") : "none");

      const tsCol = probe.data?.[0]
        ? (("created_at"  in probe.data[0]) ? "created_at"  : ("imported_at" in probe.data[0]) ? "imported_at" : null)
        : "created_at"; // default assumption — will be correct once migration runs
      console.log("[loadHistory] timestamp column detected:", tsCol);

      if (!tsCol) {
        console.error("[loadHistory] no timestamp column found — cannot build history");
        setHistoryLoading(false);
        return;
      }

      // Step 2: fetch all bank_transactions — range(0,9999) overrides the default 1000-row cap
      const selectCols = `import_batch_id, bank_format, amount, ${tsCol}`;
      const { data, error } = await db.from("bank_transactions")
        .select(selectCols)
        .eq("company_id", cid)
        .range(0, 9999);

      console.log("[loadHistory] query cols:", selectCols);
      console.log("[loadHistory] query error:", error?.message || "none");
      console.log("[loadHistory] rows returned:", data?.length ?? 0);
      if (data?.length) {
        const sample = data[0];
        console.log("[loadHistory] first row sample:", JSON.stringify(sample));
        console.log("[loadHistory] first row ts value:", sample[tsCol]);
      }

      // Step 2b: also fetch journals — catches batches partially reversed or missing from bank_transactions
      const { data: jData } = await db.from("journals")
        .select("import_batch_id, created_at")
        .eq("company_id", cid)
        .not("import_batch_id", "is", null)
        .range(0, 9999);
      console.log("[loadHistory] journal rows:", jData?.length ?? 0);

      if (error) { setHistoryLoading(false); return; }
      if ((!data || !data.length) && (!jData || !jData.length)) {
        console.log("[loadHistory] no rows in bank_transactions or journals — history empty");
        setHistoryLoading(false);
        return;
      }

      // Step 3: group rows
      const groups = new Map();
      data.forEach((r, i) => {
        const ts = r[tsCol];
        let key;
        if (r.import_batch_id) {
          key = r.import_batch_id;
        } else if (ts) {
          key = `legacy:${ts.slice(0, 13)}`; // hour-level: "legacy:2026-04-15T14"
        } else {
          console.warn("[loadHistory] row", i, "has no timestamp — skipping");
          return;
        }
        if (i < 5) console.log("[loadHistory] row", i, "key:", key, "ts:", ts);

        if (!groups.has(key)) {
          groups.set(key, {
            import_batch_id: r.import_batch_id || null,
            bank_format: r.bank_format || null,
            imported_at: ts,
            min_ts: ts,
            max_ts: ts,
            legacy: !r.import_batch_id,
            count: 0,
            total: 0,
          });
        }
        const g = groups.get(key);
        g.count++;
        g.total += Number(r.amount);
        if (ts < g.min_ts) g.min_ts = ts;
        if (ts > g.max_ts) g.max_ts = ts;
        if (ts < g.imported_at) g.imported_at = ts;
        if (!g.bank_format && r.bank_format) g.bank_format = r.bank_format;
      });

      // Add journal-only batches — visible so user can clean up orphaned journal entries
      if (jData?.length) {
        jData.forEach(j => {
          if (!j.import_batch_id || groups.has(j.import_batch_id)) return;
          groups.set(j.import_batch_id, {
            import_batch_id: j.import_batch_id,
            bank_format: null,
            imported_at: j.created_at,
            min_ts: j.created_at,
            max_ts: j.created_at,
            legacy: false,
            count: 0,
            total: 0,
            journalOnly: true,
          });
        });
        const journalOnlyCount = [...groups.values()].filter(g => g.journalOnly).length;
        if (journalOnlyCount) console.log("[loadHistory] journal-only orphaned batches:", journalOnlyCount);
      }

      console.log("[loadHistory] groups built:", groups.size, [...groups.keys()].slice(0, 5));

      // Log per-batch counts so reversed batches are visible in the console
      groups.forEach((g, key) => {
        console.log(`[loadHistory] batch ${key} has ${g.count} transactions remaining`);
      });

      const sorted = [...groups.values()].sort(
        (a, b) => new Date(b.imported_at) - new Date(a.imported_at)
      );
      console.log("[loadHistory] final history:", sorted.length, "entries");
      setHistory(sorted);
    } catch (err) {
      console.error("[BankImport] loadHistory threw:", err);
    }
    setHistoryLoading(false);
  };

  // Fire when companyId changes. loadHistory() clears stale state before fetching.
  useEffect(() => {
    if (companyId) loadHistory();
    else setHistory([]);
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const reverseImport = async (batch) => {
    setReversing(true);
    try {
      const cid = getCid();
      const db = supabase;
      if (batch.import_batch_id) {
        // New-style: exact match on import_batch_id — chain .select() to get deleted row count.
        // bank_transactions are deleted first: FK CASCADE on bank_matches.bank_transaction_id
        // auto-deletes all bank_matches rows for these transactions before journals are removed.
        const { data: deletedBt, error: btErr } = await db.from("bank_transactions").delete().eq("company_id", cid).eq("import_batch_id", batch.import_batch_id).select("revolut_id");
        if (btErr) throw new Error(btErr.message);
        console.log(`[reverseImport] batch ${batch.import_batch_id}: deleted ${deletedBt?.length ?? 0} bank_transactions rows`);
        const { data: deletedJ, error: jErr } = await db.from("journals").delete().eq("company_id", cid).eq("import_batch_id", batch.import_batch_id).select("id");
        if (jErr) throw new Error(jErr.message);
        console.log(`[reverseImport] batch ${batch.import_batch_id}: deleted ${deletedJ?.length ?? 0} journal rows`);
      } else {
        // Legacy: 1-hour window from the earliest timestamp in this batch
        const wStart = batch.min_ts;
        const wEnd   = new Date(new Date(batch.min_ts).getTime() + 3600000).toISOString();
        const { error: btErr } = await db.from("bank_transactions")
          .delete().eq("company_id", cid)
          .gte("imported_at", wStart).lte("imported_at", wEnd);
        // Journals don't have import_batch_id yet for legacy — match by created_at window
        const { error: jErr } = await db.from("journals")
          .delete().eq("company_id", cid)
          .gte("created_at", wStart).lte("created_at", wEnd);
        if (btErr) throw new Error(btErr.message);
        if (jErr)  throw new Error(jErr.message);
      }
      await loadHistory();
      setConfirmReverse(null);
      setAlert({ type: "ok", msg: `Import reversed — ${batch.count} transaction${batch.count !== 1 ? "s" : ""} removed.` });
    } catch (err) {
      setAlert({ type: "err", msg: `Reversal failed: ${err.message}` });
    }
    setReversing(false);
  };

  const clearAllData = async () => {
    setClearingAll(true);
    try {
      const cid = getCid();
      const db = supabase;
      const { error: btErr } = await db.from("bank_transactions").delete().eq("company_id", cid);
      if (btErr) throw new Error(`bank_transactions: ${btErr.message}`);
      const { error: jErr } = await db.from("journals").delete().eq("company_id", cid);
      if (jErr) throw new Error(`journals: ${jErr.message}`);
      console.log("[clearAllData] all bank_transactions and journals deleted for company", cid);
      setHistory([]);
      setConfirmClearAll(false);
      setClearAllInput("");
      setAlert({ type: "ok", msg: "All bank transactions and journal entries deleted." });
    } catch (err) {
      setAlert({ type: "err", msg: `Clear failed: ${err.message}` });
    }
    setClearingAll(false);
  };

  const loadFile = async (file) => {
    // Consume the ghost-call guard in one shot — blocks the browser re-firing the file
    // input onChange via form-state restoration after a Clerk-triggered page reload.
    const ghostName = ghostFileRef.current;
    ghostFileRef.current = null;
    if (ghostName && file?.name === ghostName) {
      console.log("[loadFile] blocked ghost call for session-restored file:", file?.name);
      return;
    }

    // If the same file is already loaded, skip re-parse and restore nominals from session.
    // Catches Clerk token-refresh re-fires that slip past the ghost guard.
    if (file?.name === fileName && rows.length > 0) {
      console.log("[loadFile] same file already loaded — skipping re-parse:", file?.name);
      try {
        const savedNom = sessionStorage.getItem('ledgrly_import_nominals');
        if (savedNom) {
          const { fileName: nomFile, nominals: nomData } = JSON.parse(savedNom);
          if (nomFile === file.name && nomData && Object.keys(nomData).length) {
            setNominals(nomData);
            setConfidence(Object.fromEntries(rows.map(r => [r.revolut_id, 'high'])));
            console.log("[loadFile] restored", Object.keys(nomData).length, "saved nominals from session");
          }
        }
      } catch {}
      return;
    }

    if (loadingRef.current) {
      console.warn("[loadFile] already processing — ignoring duplicate call for:", file?.name);
      return;
    }
    loadingRef.current = true;
    // Clear saved nominals — new file upload means any saved state is stale
    sessionStorage.removeItem('ledgrly_import_nominals');
    console.log("[loadFile] file selected:", file?.name, "size:", file?.size);
    try {
    if (!file || !file.name.toLowerCase().endsWith(".csv")) {
      setAlert({ type: "err", msg: "Please upload a Revolut Business or AIB CSV file." }); return;
    }
    setFileName(file.name); setAlert(null);
    const text = await file.text();
    console.log("[loadFile] file read, length:", text.length, "first 120 chars:", JSON.stringify(text.slice(0, 120)));
    const fmt = detectCSVFormat(text);
    console.log("[loadFile] detected format:", fmt);
    if (!fmt) {
      setAlert({ type: "err", msg: "Unrecognised CSV format. Please upload a Revolut Business or AIB export." }); return;
    }
    setBankFormat(fmt);
    console.log("[loadFile] starting parse for format:", fmt);
    const parsed = fmt === "aib" ? parseAIBCSV(text) : parseRevolutCSV(text);
    console.log("[loadFile] parse complete, rows:", parsed.length);
    if (!parsed.length) {
      setAlert({ type: "err", msg: fmt === "aib" ? "No transactions found in this AIB file." : "No COMPLETED transactions found in this file." }); return;
    }

    // STEP 1: Render the table immediately — don't wait for Supabase
    const quickNom = {}, quickConf = {};
    parsed.forEach(r => { quickNom[r.revolut_id] = suggestNominalFallback(r.description, r.amount); quickConf[r.revolut_id] = "low"; });
    setRows(parsed.map(r => ({ ...r, imported: false })));
    setNominals(quickNom);
    setConfidence(quickConf);
    setSelected(new Set(parsed.map(r => r.revolut_id)));
    console.log("[loadFile] table rendered with", parsed.length, "rows — starting duplicate check");

    // STEP 2: Fetch all existing transactions — build exact and fuzzy learned maps
    let importedIds = new Set();
    let pastCats = {};      // exact description → nominal_code
    let learnedPayees = {}; // cleanPayee(description) → nominal_code (for fuzzy lookup)
    try {
      const cid = getCid();
      const db = supabase;
      const { data: existing, error } = await db.from("bank_transactions")
        .select("revolut_id, description, nominal_account, import_batch_id")
        .eq("company_id", cid);
      if (error) console.error("[BankImport] Supabase error:", error.message);
      if (existing) {
        // Group by batch to detect any that were reversed (0 remaining rows)
        const batchCounts = {};
        existing.forEach(r => {
          const bk = r.import_batch_id || "__legacy__";
          batchCounts[bk] = (batchCounts[bk] || 0) + 1;
        });
        Object.entries(batchCounts).forEach(([bk, count]) => {
          console.log(`[loadHistory] batch ${bk} has ${count} transactions remaining (0 were reversed)`);
        });

        existing.forEach(r => {
          // Only count as imported if the batch still has live rows (guards against partial-reverse edge cases)
          const bk = r.import_batch_id || "__legacy__";
          if (!batchCounts[bk]) return; // batch has 0 remaining — was reversed
          importedIds.add(r.revolut_id);
          if (r.nominal_account) {
            if (!pastCats[r.description]) pastCats[r.description] = r.nominal_account;
            const cp = cleanPayee(r.description);
            if (cp && !learnedPayees[cp]) learnedPayees[cp] = r.nominal_account;
          }
        });
      }
      console.log("[BankImport] importedIds:", importedIds.size, "pastCats:", Object.keys(pastCats).length, "learnedPayees:", Object.keys(learnedPayees).length);
    } catch (err) { console.error("[BankImport] Supabase lookup error:", err); }

    // STEP 3: Apply exact matches immediately; keyword fallback for everything else — render now
    const withStatus = parsed.map(r => ({ ...r, imported: importedIds.has(r.revolut_id) }));
    const newTxns = withStatus.filter(r => !r.imported);
    const fuzzyMatched = new Set();
    const needFuzzy = [];
    const updNom = {}, updConf = {};
    newTxns.forEach(r => {
      if (pastCats[r.description]) {
        updNom[r.revolut_id] = pastCats[r.description]; updConf[r.revolut_id] = "high";
        fuzzyMatched.add(r.revolut_id);
      } else {
        updNom[r.revolut_id] = suggestNominalFallback(r.description, r.amount); updConf[r.revolut_id] = "low";
        needFuzzy.push(r);
      }
    });
    setRows(withStatus);
    setNominals(updNom);
    setConfidence(updConf);
    setSelected(new Set(newTxns.map(r => r.revolut_id)));
    console.log("[BankImport] newTxns:", newTxns.length, "imported:", importedIds.size, "exact matched:", fuzzyMatched.size, "needFuzzy:", needFuzzy.length);

    // STEP 3b: Async batched fuzzy match against learned payees — yields to browser, 3s timeout
    const learnedEntries = Object.entries(learnedPayees);
    const accFuzzyNom = {}, accFuzzyConf = {}; // local mirror of fuzzy additions for sessionStorage snapshot
    if (needFuzzy.length && learnedEntries.length) {
      setCatProgress({ done: 0, total: 0, msg: "Matching learned categorisations…" });
      const BATCH = 50, TIMEOUT = 3000;
      const t0 = Date.now();
      for (let i = 0; i < needFuzzy.length; i += BATCH) {
        if (Date.now() - t0 > TIMEOUT) {
          console.log("[BankImport] fuzzy match timed out after", i, "rows — proceeding to AI");
          break;
        }
        const batchNom = {}, batchConf = {};
        needFuzzy.slice(i, i + BATCH).forEach(r => {
          const cp = cleanPayee(r.description);
          if (!cp) return;
          let best = 0, bestCode = null;
          for (const [key, code] of learnedEntries) {
            const s = wordOverlap(cp, key);
            if (s > best) { best = s; bestCode = code; }
          }
          if (best >= 0.6 && bestCode) {
            batchNom[r.revolut_id] = bestCode; batchConf[r.revolut_id] = "high";
            fuzzyMatched.add(r.revolut_id);
          }
        });
        if (Object.keys(batchNom).length) {
          Object.assign(accFuzzyNom, batchNom);
          Object.assign(accFuzzyConf, batchConf);
          setNominals(prev => ({ ...prev, ...batchNom }));
          setConfidence(prev => ({ ...prev, ...batchConf }));
        }
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      console.log("[BankImport] fuzzy matched:", fuzzyMatched.size - (newTxns.length - needFuzzy.length));
    }

    // Snapshot to sessionStorage before AI starts — survives a Clerk-triggered reload
    try {
      sessionStorage.setItem('ledgrly_import_session', JSON.stringify({
        version: 2,
        rows: withStatus,
        fileName: file.name,
        bankFormat: fmt,
      }));
    } catch {}

    // STEP 4: Two-pass AI categorisation for transactions not resolved above
    const toAI = newTxns.filter(r => !fuzzyMatched.has(r.revolut_id));
    console.log("[BankImport] toAI:", toAI.length);
    if (toAI.length) {
      // Pass 1 — deduplicate: group transactions by cleaned payee name
      setCatProgress({ done: 0, total: 0, msg: `Identifying unique payees from ${toAI.length} transaction${toAI.length !== 1 ? "s" : ""}…` });
      await new Promise(r => setTimeout(r, 0));

      const payeeMap = {};
      toAI.forEach(r => {
        const key = cleanPayee(r.description) || r.description.toLowerCase().slice(0, 40);
        if (!payeeMap[key]) payeeMap[key] = { key, name: r.description, count: 0, totalAmount: 0, posCount: 0, txnIds: [] };
        payeeMap[key].count++;
        payeeMap[key].totalAmount += r.amount;
        if (r.amount > 0) payeeMap[key].posCount++;
        payeeMap[key].txnIds.push(r.revolut_id);
      });

      const allUniquePayees = Object.values(payeeMap);
      console.log("[BankImport] unique payees:", allUniquePayees.length, "from", toAI.length, "transactions");

      // Tracks txn IDs matched by rules/history — AI results must never overwrite these
      const rulesMatchedIds = new Set();

      // Check learned payees by exact key — skip AI for any already seen payee
      const learnedHits = {};
      const needAIPayees = allUniquePayees.filter(p => {
        const learned = learnedPayees[p.key];
        if (learned) { learnedHits[p.key] = { code: learned, confidence: "high" }; return false; }
        return true;
      });

      if (Object.keys(learnedHits).length) {
        setNominals(prev => { const u = { ...prev }; Object.entries(learnedHits).forEach(([key, v]) => { payeeMap[key]?.txnIds.forEach(id => { u[id] = v.code; rulesMatchedIds.add(id); }); }); return u; });
        setConfidence(prev => { const u = { ...prev }; Object.entries(learnedHits).forEach(([key, v]) => { payeeMap[key]?.txnIds.forEach(id => { u[id] = v.confidence; }); }); return u; });
        console.log("[BankImport] learned pre-AI hits:", Object.keys(learnedHits).length, "payees");
      }

      // Pre-classification via rules engine — DB rules fire before any AI call
      const patternHits = {};
      const needAIAfterPatterns = needAIPayees.filter(p => {
        const rawDesc   = p.name || "";
        const cleanDesc = preCleanDesc(rawDesc);
        const repAmount = p.totalAmount / (p.count || 1);
        const matched   = applyRules(rawDesc, repAmount, txRules);
        if (matched) {
          patternHits[p.key] = { code: matched.nominal_code, confidence: matched.confidence };
          console.log(`[rules] raw: '${rawDesc}' | cleaned: '${cleanDesc}' | matched: ${matched.nominal_code} ${matched.nominal_name} (${matched.match_type}:"${matched.pattern}")`);
        } else {
          console.log(`[rules] raw: '${rawDesc}' | cleaned: '${cleanDesc}' | matched: none → AI`);
        }
        return !matched;
      });
      console.log(`[rules] ${Object.keys(patternHits).length} matched by rules, ${needAIAfterPatterns.length} sent to AI`);
      if (Object.keys(patternHits).length) {
        const nomUpd = {}, confUpd = {};
        needAIPayees.forEach(p => {
          const hit = patternHits[p.key];
          if (hit) p.txnIds.forEach(id => { nomUpd[id] = hit.code; confUpd[id] = hit.confidence; rulesMatchedIds.add(id); });
        });
        setNominals(prev => ({ ...prev, ...nomUpd }));
        setConfidence(prev => ({ ...prev, ...confUpd }));
      }

      // Pass 2 — chunked AI calls for payees not resolved by patterns or learned history
      if (needAIAfterPatterns.length) {
        const aiTxnCount = needAIAfterPatterns.reduce((s, p) => s + p.txnIds.length, 0);

        // Build business context summary — sent with every chunk for consistent categorisation
        const datesSorted = toAI.map(r => r.date).filter(Boolean).sort();
        const totalDebits  = toAI.filter(r => r.amount < 0).reduce((s, r) => s + Math.abs(r.amount), 0);
        const totalCredits = toAI.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0);
        const avgSize      = toAI.reduce((s, r) => s + Math.abs(r.amount), 0) / (toAI.length || 1);
        const topPayees    = Object.values(payeeMap)
          .sort((a, b) => b.count - a.count).slice(0, 10)
          .map(p => `"${p.name}" (${p.count}×, €${Math.abs(Math.round(p.totalAmount)).toLocaleString("en-IE")})`);
        const businessContext = {
          totalTransactions: toAI.length,
          dateRange: datesSorted.length ? `${datesSorted[0]} to ${datesSorted[datesSorted.length - 1]}` : null,
          totalDebits:  Math.round(totalDebits  * 100) / 100,
          totalCredits: Math.round(totalCredits * 100) / 100,
          avgTransactionSize: Math.round(avgSize * 100) / 100,
          topPayees,
        };
        console.log("[BankImport] businessContext:", JSON.stringify(businessContext).slice(0, 300));

        cancelCatRef.current = false;
        if (isMountedRef.current) setCatProgress({ done: 0, total: needAIAfterPatterns.length,
          msg: `Categorising payees… 0 of ${needAIAfterPatterns.length} complete (0%)` });
        await new Promise(r => setTimeout(r, 0));

        const { map: aiResultMap, allChunksFailed } = await categoriseWithAI(
          needAIAfterPatterns.map(p => ({
            key: p.key, name: p.name, count: p.count,
            totalAmount: Math.round(p.totalAmount * 100) / 100,
            direction: p.posCount > p.count / 2 ? "income" : "expense",
          })),
          {
            onProgress: (done, total, msg) => { if (isMountedRef.current) setCatProgress({ done, total, msg }); },
            cancelRef: cancelCatRef,
            businessContext,
            txRules,
          }
        );

        if (!isMountedRef.current) return; // component unmounted — don't touch state

        if (allChunksFailed) {
          console.warn("[BankImport] all AI chunks failed — transactions categorised by rules only");
          setAlert({ type: "err", msg: "AI categorisation unavailable — all transactions have been categorised using rules. Please review and adjust any that need correction." });
        }

        // Pass 3 — map results back to every matching transaction
        if (isMountedRef.current) setCatProgress({ done: needAIPayees.length, total: needAIPayees.length,
          msg: `Applying to ${aiTxnCount} transaction${aiTxnCount !== 1 ? "s" : ""}…` });
        await new Promise(r => setTimeout(r, 0));
        if (isMountedRef.current) {
          let aiSkipped = 0, aiUpdated = 0;
          setNominals(prev => {
            const u = { ...prev };
            Object.entries(aiResultMap).forEach(([key, v]) => {
              payeeMap[key]?.txnIds.forEach(id => {
                if (rulesMatchedIds.has(id)) { aiSkipped++; return; }
                u[id] = v.code; aiUpdated++;
              });
            });
            console.log(`[applyAI] skipped ${aiSkipped} rule-matched transactions, updated ${aiUpdated} AI-categorised transactions`);
            return u;
          });
          setConfidence(prev => {
            const u = { ...prev };
            Object.entries(aiResultMap).forEach(([key, v]) => {
              payeeMap[key]?.txnIds.forEach(id => { if (!rulesMatchedIds.has(id)) u[id] = v.confidence; });
            });
            return u;
          });
        }
        console.log("[BankImport] AI results applied:", Object.keys(aiResultMap).length, "payees →", aiTxnCount, "transactions");
      }
    }
    setCatProgress(null);
    } finally {
      loadingRef.current = false;
    }
  };

  const handleNominalChange = useCallback((revolut_id, code) => {
    try {
      if (!revolut_id || !code) {
        console.warn("[handleNominalChange] missing revolut_id or code — skipping", { revolut_id, code });
        return;
      }
      const changedRow = rows.find(r => r.revolut_id === revolut_id);
      if (!changedRow) {
        console.warn("[handleNominalChange] row not found for revolut_id:", revolut_id);
        // Still update the nominal even if we can't find siblings
        setNominals(p => ({ ...p, [revolut_id]: code }));
        setConfidence(p => ({ ...p, [revolut_id]: "high" }));
        return;
      }
      const changedPayee = cleanPayee(changedRow.description || "");

      // Find similar unimported rows — cap at 100 to avoid blocking the UI on large imports
      let siblings = [];
      if (changedPayee.length >= 3) {
        siblings = rows.filter(r =>
          r.revolut_id !== revolut_id &&
          !r.imported &&
          r.description != null &&
          wordOverlap(cleanPayee(r.description), changedPayee) >= 0.7
        ).slice(0, 100);
      }
      console.log(`[handleNominalChange] ${revolut_id} → ${code} | payee="${changedPayee}" | ${siblings.length} sibling(s)`);

      setNominals(p => {
        const u = { ...p, [revolut_id]: code };
        siblings.forEach(r => { u[r.revolut_id] = code; });
        return u;
      });
      setConfidence(p => {
        const u = { ...p, [revolut_id]: "high" };
        siblings.forEach(r => { u[r.revolut_id] = "high"; });
        return u;
      });
      if (siblings.length > 0) {
        clearTimeout(toastTimer.current);
        setToast(`Applied to ${siblings.length} similar transaction${siblings.length !== 1 ? "s" : ""}`);
        toastTimer.current = setTimeout(() => setToast(null), 3000);
      }
      // Queue a learn prompt so user can confirm whether to always code this payee
      if (changedRow) {
        const kw = extractKeyword(changedRow.description || '');
        if (kw.length >= 3) {
          const nomName   = GL_ACCOUNTS.find(a => a.code === code)?.name || code;
          const direction = changedRow.amount > 0 ? 'in' : 'out';
          const newItem = { revolut_id, description: changedRow.description, keyword: kw, nominalCode: code, nominalName: nomName, direction };
          setLearnQueue(prev => [...prev, newItem]);
        }
      }
    } catch (err) {
      console.error("[handleNominalChange] unexpected error — nominal change aborted:", err);
      // Fallback: at least update the single row that was changed
      try {
        setNominals(p => ({ ...p, [revolut_id]: code }));
        setConfidence(p => ({ ...p, [revolut_id]: "high" }));
      } catch (innerErr) {
        console.error("[handleNominalChange] fallback state update also failed:", innerErr);
      }
    }
  }, [rows, toastTimer]);

  const toggle = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleAll = () => {
    const newRows = rows.filter(r => !r.imported);
    const allChk = newRows.length > 0 && newRows.every(r => selected.has(r.revolut_id));
    setSelected(allChk ? new Set() : new Set(newRows.map(r => r.revolut_id)));
  };

  const post = async () => {
    const toPost = rows.filter(r => selected.has(r.revolut_id));
    if (!toPost.length) return;
    setPosting(true); setAlert(null);
    try {
      const cid = getCid();
      const db = supabase;
      const batchId = crypto.randomUUID();
      const journals = toPost.map(r => {
        const nominal  = nominals[r.revolut_id] || "6600";
        const isIn     = r.amount >= 0;
        const vatCode  = coaAccounts.find(a => a.code === nominal)?.default_vat_code ?? null;
        return {
          company_id: cid, date: sanitiseDate(r.date), description: r.description, reference: r.revolut_id,
          debit_account: isIn ? "1000" : nominal,
          credit_account: isIn ? nominal : "1000",
          amount: Math.abs(r.amount),
          import_batch_id: batchId,
          vat_code: vatCode,
        };
      });
      const { data: insertedJournals, error: jErr } = await db.from("journals").insert(journals).select('id, reference');
      if (jErr) throw new Error(jErr.message);
      const now = new Date().toISOString();
      const btRows = toPost.map(r => ({
        company_id: cid, revolut_id: r.revolut_id, date: r.date,
        description: r.description, amount: r.amount, currency: r.currency,
        balance: r.balance, nominal_account: nominals[r.revolut_id] || "6600",
        bank_format: bankFormat, import_batch_id: batchId,
        reconciled: true, reconciled_at: now,
      }));
      const { data: insertedBts, error: btErr } = await db.from("bank_transactions").insert(btRows).select('id, revolut_id');
      if (btErr) throw new Error(btErr.message);
      if (insertedJournals?.length && insertedBts?.length) {
        const allByRef = {};
        for (const bt of insertedBts) { if (!allByRef[bt.revolut_id]) allByRef[bt.revolut_id] = []; allByRef[bt.revolut_id].push(bt.id); }
        let matchRows;
        if (Object.values(allByRef).some(ids => ids.length > 1)) {
          // Duplicate revolut_ids in batch (should not happen with index-salted hashes) — fall back to positional pairing
          console.warn('[post] duplicate revolut_ids detected — pairing journals to bank_transactions by position');
          matchRows = insertedJournals.map((j, k) => {
            const btId = insertedBts[k]?.id;
            return btId ? { company_id: cid, bank_transaction_id: btId, matched_type: 'journal', matched_id: j.id, confidence: 100, status: 'confirmed', matched_by: 'auto', confirmed_at: now } : null;
          }).filter(Boolean);
        } else {
          const btByRevId = Object.fromEntries(insertedBts.map(bt => [bt.revolut_id, bt.id]));
          matchRows = insertedJournals.map(j => {
            const btId = btByRevId[j.reference];
            return btId ? { company_id: cid, bank_transaction_id: btId, matched_type: 'journal', matched_id: j.id, confidence: 100, status: 'confirmed', matched_by: 'auto', confirmed_at: now } : null;
          }).filter(Boolean);
        }
        if (matchRows.length) {
          const { error: mErr } = await db.from('bank_matches').insert(matchRows);
          if (mErr) console.warn('[post] bank_matches insert skipped (migration may not have run):', mErr.message);
        }
      }
      setRows(prev => prev.map(r => selected.has(r.revolut_id) ? { ...r, imported: true } : r));
      setSelected(new Set());
      sessionStorage.removeItem('ledgrly_import_session');
      sessionStorage.removeItem('ledgrly_import_nominals');
      setAlert({ type: "ok", msg: `${toPost.length} transaction${toPost.length !== 1 ? "s" : ""} posted to the ledger.` });
      loadHistory();
    } catch (e) {
      setAlert({ type: "err", msg: e.message });
    }
    setPosting(false);
  };

  const loadReviewRows = useCallback(async () => {
    if (!companyId) return;
    setReviewLoading(true);
    const { data } = await supabase
      .from('bank_transactions')
      .select('id, revolut_id, date, description, amount, nominal_account')
      .eq('company_id', companyId)
      .eq('nominal_account', '6600')
      .order('date', { ascending: false });
    setReviewRows(data || []);
    setReviewChanges({});
    setApplySimilar(new Set());
    setReviewLoading(false);
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab === 'review') loadReviewRows();
  }, [activeTab, loadReviewRows]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveAllReviewChanges = async () => {
    const changedIds = Object.keys(reviewChanges);
    if (!changedIds.length) return;
    setReviewSaving(true);
    try {
      for (const revolut_id of changedIds) {
        const newCode = reviewChanges[revolut_id];
        const row = reviewRows.find(r => r.revolut_id === revolut_id);
        if (!row) continue;
        const isIncome = Number(row.amount) >= 0;

        // Update the directly changed transaction
        await supabase.from('bank_transactions')
          .update({ nominal_account: newCode })
          .eq('company_id', companyId).eq('revolut_id', revolut_id);

        if (isIncome) {
          await supabase.from('journals').update({ credit_account: newCode })
            .eq('company_id', companyId).eq('reference', revolut_id);
        } else {
          await supabase.from('journals').update({ debit_account: newCode })
            .eq('company_id', companyId).eq('reference', revolut_id);
        }

        // Stamp the bank_match as overridden if this transaction was auto-matched with default code
        const { data: jnlRows } = await supabase.from('journals')
          .select('id').eq('company_id', companyId).eq('reference', revolut_id);
        if (jnlRows?.length) {
          await supabase.from('bank_matches')
            .update({ suggestion_kept: false })
            .eq('company_id', companyId).eq('matched_type', 'journal').eq('matched_by', 'auto')
            .is('suggestion_kept', null).in('matched_id', jnlRows.map(j => j.id));
        }

        // Apply to Similar: fuzzy-match on base payee, batch-update all matches
        if (applySimilar.has(revolut_id)) {
          const basePayee = preCleanDesc(row.description);
          if (basePayee.length >= 4) {
            const pattern = `%${basePayee}%`;
            const { data: similar } = await supabase.from('bank_transactions')
              .select('revolut_id, amount')
              .eq('company_id', companyId)
              .ilike('description', pattern)
              .neq('revolut_id', revolut_id);

            console.log(`[NeedsReview] applying to similar: found ${similar?.length ?? 0} rows matching pattern "${basePayee}"`);

            if (similar?.length) {
              // Batch-update bank_transactions
              await supabase.from('bank_transactions')
                .update({ nominal_account: newCode })
                .eq('company_id', companyId)
                .ilike('description', pattern);

              // Group by direction then do one journal update per group
              const expenseIds = similar.filter(s => Number(s.amount) < 0).map(s => s.revolut_id);
              const incomeIds  = similar.filter(s => Number(s.amount) >= 0).map(s => s.revolut_id);

              if (expenseIds.length) {
                await supabase.from('journals').update({ debit_account: newCode })
                  .eq('company_id', companyId).in('reference', expenseIds);
              }
              if (incomeIds.length) {
                await supabase.from('journals').update({ credit_account: newCode })
                  .eq('company_id', companyId).in('reference', incomeIds);
              }
              // Stamp bank_matches as overridden for any auto-matched similar transactions
              const simRevIds = [...expenseIds, ...incomeIds];
              if (simRevIds.length) {
                const { data: simJnls } = await supabase.from('journals')
                  .select('id').eq('company_id', companyId).in('reference', simRevIds);
                if (simJnls?.length) {
                  await supabase.from('bank_matches')
                    .update({ suggestion_kept: false })
                    .eq('company_id', companyId).eq('matched_type', 'journal').eq('matched_by', 'auto')
                    .is('suggestion_kept', null).in('matched_id', simJnls.map(j => j.id));
                }
              }
            }
          }
        }
      }
      const saved = changedIds.length;
      setReviewToast(`${saved} transaction${saved !== 1 ? 's' : ''} updated ✓`);
      setTimeout(() => setReviewToast(null), 3500);
      // Queue learn prompts for each changed row with an extractable keyword
      const learnItems = [];
      for (const revolut_id of changedIds) {
        const newCode = reviewChanges[revolut_id];
        const row = reviewRows.find(r => r.revolut_id === revolut_id);
        if (!row) continue;
        const kw = extractKeyword(row.description || '');
        if (kw.length >= 3) {
          const nomName   = GL_ACCOUNTS.find(a => a.code === newCode)?.name || newCode;
          const direction = Number(row.amount) >= 0 ? 'in' : 'out';
          learnItems.push({ revolut_id, description: row.description, keyword: kw, nominalCode: newCode, nominalName: nomName, direction });
        }
      }
      if (learnItems.length > 0) setLearnQueue(prev => [...prev, ...learnItems]);
      await loadReviewRows();
    } catch (e) {
      setReviewToast(`Error: ${e.message}`);
    }
    setReviewSaving(false);
  };

  const fixAllKnown = async () => {
    setFixingAll(true);
    setFixAllResult(null);
    try {
      const { data: pending } = await supabase.from('bank_transactions')
        .select('revolut_id, description, amount')
        .eq('company_id', companyId)
        .eq('nominal_account', '6600');

      if (!pending?.length) {
        setFixAllResult('No uncategorised transactions found');
        setFixingAll(false);
        return;
      }

      // Group by matched nominal code and direction for batch updates
      const groups = {}; // { code: { expense: [], income: [] } }
      for (const bt of pending) {
        const rule = applyRules(bt.description, bt.amount, txRules);
        if (!rule) continue;
        const code = rule.nominal_code;
        if (!groups[code]) groups[code] = { expense: [], income: [] };
        if (Number(bt.amount) < 0) groups[code].expense.push(bt.revolut_id);
        else groups[code].income.push(bt.revolut_id);
      }

      let fixed = 0;
      for (const [code, dirs] of Object.entries(groups)) {
        const allIds = [...dirs.expense, ...dirs.income];
        fixed += allIds.length;

        await supabase.from('bank_transactions')
          .update({ nominal_account: code })
          .eq('company_id', companyId).in('revolut_id', allIds);

        if (dirs.expense.length) {
          await supabase.from('journals').update({ debit_account: code })
            .eq('company_id', companyId).in('reference', dirs.expense);
        }
        if (dirs.income.length) {
          await supabase.from('journals').update({ credit_account: code })
            .eq('company_id', companyId).in('reference', dirs.income);
        }
        // Stamp bank_matches as overridden for any auto-matched transactions we just re-coded
        const { data: fixJnls } = await supabase.from('journals')
          .select('id').eq('company_id', companyId).in('reference', allIds);
        if (fixJnls?.length) {
          await supabase.from('bank_matches')
            .update({ suggestion_kept: false })
            .eq('company_id', companyId).eq('matched_type', 'journal').eq('matched_by', 'auto')
            .is('suggestion_kept', null).in('matched_id', fixJnls.map(j => j.id));
        }
      }

      console.log(`[NeedsReview] Fix All Known: fixed ${fixed} of ${pending.length} uncategorised transactions`);
      setFixAllResult(`Fixed ${fixed} of ${pending.length} — ${pending.length - fixed} still unmatched`);
      await loadReviewRows();
    } catch (e) {
      setFixAllResult(`Error: ${e.message}`);
    }
    setFixingAll(false);
  };

  const advanceLearnQueue = () => {
    setLearnApplied(null);
    setLearnConflict(false);
    setLearnQueue(prev => prev.slice(1));
  };

  const skipLearnPrompt = () => advanceLearnQueue();

  const saveLearnedRule = async () => {
    if (!learnCurrent || !companyId) return;
    const kw = learnKwEdit.trim().toLowerCase();
    if (kw.length < 3) return;
    setLearnSaving(true);
    setLearnConflict(false);
    try {
      const nomName = GL_ACCOUNTS.find(a => a.code === learnCurrent.nominalCode)?.name || learnCurrent.nominalCode;
      const { data: inserted, error: insErr } = await supabase
        .from('transaction_rules')
        .insert({ company_id: companyId, pattern: kw, match_type: 'contains', direction: learnCurrent.direction,
                  nominal_code: learnCurrent.nominalCode, nominal_name: nomName,
                  confidence: 'high', source: 'user', created_from: 'learned' })
        .select('id').single();
      if (insErr) {
        if (insErr.code === '23505') { setLearnConflict(true); setLearnSaving(false); return; }
        throw insErr;
      }
      // Apply rule to existing uncoded transactions; skip any transaction whose date
      // falls inside a filed VAT return period (period-lock enforcement).
      const lockedPeriods = await getLockedPeriods(companyId);
      const { data: allUncoded } = await supabase
        .from('bank_transactions').select('revolut_id, amount, date')
        .eq('company_id', companyId).eq('nominal_account', '6600')
        .ilike('description', `%${kw}%`);
      const allRows    = allUncoded || [];
      const eligible   = allRows.filter(t => !isDateLocked(t.date, lockedPeriods));
      const skipped    = allRows.length - eligible.length;
      const appliedIds = eligible.map(t => t.revolut_id);
      if (appliedIds.length) {
        await supabase.from('bank_transactions')
          .update({ nominal_account: learnCurrent.nominalCode })
          .eq('company_id', companyId).in('revolut_id', appliedIds);
        const expenses = eligible.filter(t => Number(t.amount) < 0).map(t => t.revolut_id);
        const income   = eligible.filter(t => Number(t.amount) >= 0).map(t => t.revolut_id);
        if (expenses.length) await supabase.from('journals').update({ debit_account: learnCurrent.nominalCode }).eq('company_id', companyId).in('reference', expenses);
        if (income.length)   await supabase.from('journals').update({ credit_account: learnCurrent.nominalCode }).eq('company_id', companyId).in('reference', income);
        // Stamp bank_matches as overridden for auto-matched transactions we just re-coded
        const { data: learnJnls } = await supabase.from('journals')
          .select('id').eq('company_id', companyId).in('reference', appliedIds);
        if (learnJnls?.length) {
          await supabase.from('bank_matches')
            .update({ suggestion_kept: false })
            .eq('company_id', companyId).eq('matched_type', 'journal').eq('matched_by', 'auto')
            .is('suggestion_kept', null).in('matched_id', learnJnls.map(j => j.id));
        }
      }
      setLearnApplied({ count: appliedIds.length, skipped, ruleId: inserted.id, appliedIds, originalCode: '6600', nominalCode: learnCurrent.nominalCode });
      setTimeout(advanceLearnQueue, 4000);
    } catch (e) {
      console.error('[learn] save rule failed:', e);
    }
    setLearnSaving(false);
  };

  const updateLearnedRule = async () => {
    if (!learnCurrent || !companyId) return;
    const kw = learnKwEdit.trim().toLowerCase();
    setLearnSaving(true);
    try {
      const nomName = GL_ACCOUNTS.find(a => a.code === learnCurrent.nominalCode)?.name || learnCurrent.nominalCode;
      await supabase.from('transaction_rules')
        .update({ nominal_code: learnCurrent.nominalCode, nominal_name: nomName, confidence: 'high', source: 'user', created_from: 'learned' })
        .eq('company_id', companyId).eq('pattern', kw).eq('direction', learnCurrent.direction);
      setLearnConflict(false);
      setLearnApplied({ count: 0, ruleId: null, appliedIds: [], originalCode: null, nominalCode: learnCurrent.nominalCode });
      setTimeout(advanceLearnQueue, 2500);
    } catch (e) {
      console.error('[learn] update rule failed:', e);
    }
    setLearnSaving(false);
  };

  const undoLearnedRule = async () => {
    if (!learnApplied || !companyId) return;
    const { ruleId, appliedIds, originalCode } = learnApplied;
    try {
      if (ruleId) await supabase.from('transaction_rules').delete().eq('id', ruleId);
      if (appliedIds.length) {
        await supabase.from('bank_transactions')
          .update({ nominal_account: originalCode })
          .eq('company_id', companyId).in('revolut_id', appliedIds);
        const { data: txns } = await supabase.from('bank_transactions').select('revolut_id, amount').eq('company_id', companyId).in('revolut_id', appliedIds);
        const expenses = (txns || []).filter(t => Number(t.amount) < 0).map(t => t.revolut_id);
        const income   = (txns || []).filter(t => Number(t.amount) >= 0).map(t => t.revolut_id);
        if (expenses.length) await supabase.from('journals').update({ debit_account: originalCode }).eq('company_id', companyId).in('reference', expenses);
        if (income.length)   await supabase.from('journals').update({ credit_account: originalCode }).eq('company_id', companyId).in('reference', income);
        // Revert override stamp — rule removed, code restored to AI's original answer
        const { data: undoJnls } = await supabase.from('journals')
          .select('id').eq('company_id', companyId).in('reference', appliedIds);
        if (undoJnls?.length) {
          await supabase.from('bank_matches')
            .update({ suggestion_kept: null })
            .eq('company_id', companyId).eq('matched_type', 'journal').eq('matched_by', 'auto')
            .eq('suggestion_kept', false).in('matched_id', undoJnls.map(j => j.id));
        }
      }
    } catch (e) {
      console.error('[learn] undo failed:', e);
    }
    advanceLearnQueue();
  };

  const newRows = rows.filter(r => !r.imported);
  const allNewChk = newRows.length > 0 && newRows.every(r => selected.has(r.revolut_id));

  const fmtHistDate = d => {
    const dt = new Date(d);
    return dt.toLocaleDateString("en-IE", { day: "2-digit", month: "short", year: "numeric" }) + " "
      + dt.toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div>
      {/* ── Confirmation modal ── */}
      {confirmClearAll && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="card" style={{ maxWidth: 440, width: "90%", padding: "28px 28px 24px", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text)", marginBottom: 10 }}>Clear All Data?</div>
            <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.75, marginBottom: 18 }}>
              This will delete <strong>ALL</strong> imported bank transactions and journal entries for this company.
              <br /><span style={{ color: "var(--red)", fontWeight: 600 }}>This cannot be undone.</span>
            </div>
            <input
              type="text"
              value={clearAllInput}
              onChange={e => setClearAllInput(e.target.value)}
              placeholder="Type RESET to confirm"
              style={{ width: "100%", marginBottom: 16, padding: "8px 10px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 5, background: "var(--surface)", color: "var(--text)", boxSizing: "border-box" }}
              autoFocus
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn btn-p btn-sm"
                style={{ background: "var(--red)", borderColor: "var(--red)" }}
                onClick={clearAllData}
                disabled={clearAllInput !== "RESET" || clearingAll}
              >
                {clearingAll ? "Deleting…" : "Delete All Data"}
              </button>
              <button className="btn btn-s btn-sm" onClick={() => { setConfirmClearAll(false); setClearAllInput(""); }} disabled={clearingAll}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {confirmReverse && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="card" style={{ maxWidth: 440, width: "90%", padding: "28px 28px 24px", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text)", marginBottom: 10 }}>Reverse Import?</div>
            <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.75, marginBottom: 22 }}>
              This will permanently delete <strong>{confirmReverse.count} transaction{confirmReverse.count !== 1 ? "s" : ""}</strong> and their associated journal entries from the import on{" "}
              <strong>{fmtHistDate(confirmReverse.imported_at)}</strong>.
              {confirmReverse.legacy && (
                <div style={{ marginTop: 10, fontSize: 12, color: "var(--gold)", background: "rgba(184,134,11,0.07)", border: "1px solid rgba(184,134,11,0.25)", borderRadius: 4, padding: "7px 11px" }}>
                  ⚠ Legacy import — reversal will delete all transactions imported within the same 1-hour window. Review the count above before confirming.
                </div>
              )}
              <br />
              <span style={{ color: "var(--red)", fontWeight: 600 }}>This cannot be undone.</span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn btn-p btn-sm"
                style={{ background: "var(--red)", borderColor: "var(--red)" }}
                onClick={() => reverseImport(confirmReverse)}
                disabled={reversing}
              >
                {reversing ? "Reversing…" : `Delete ${confirmReverse.count} Transaction${confirmReverse.count !== 1 ? "s" : ""}`}
              </button>
              <button className="btn btn-s btn-sm" onClick={() => setConfirmReverse(null)} disabled={reversing}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab bar ── */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)", marginBottom: 16 }}>
        {[
          { key: 'import', label: 'Import' },
          { key: 'review', label: `Needs Review${reviewRows.length > 0 ? ` (${reviewRows.length})` : ''}` },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: "8px 16px", fontSize: 12, fontFamily: "Source Code Pro,monospace",
              background: "none", border: "none", borderBottom: activeTab === tab.key ? "2px solid var(--teal)" : "2px solid transparent",
              color: activeTab === tab.key ? "var(--teal)" : "var(--muted)",
              cursor: "pointer", fontWeight: activeTab === tab.key ? 600 : 400,
              marginBottom: -1, transition: "color 0.15s",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Rules learn prompt ── */}
      {learnCurrent && (
        <div style={{ background: "var(--accent-dim)", border: "1px solid rgba(52,211,153,0.3)", borderRadius: 8, padding: "10px 14px", marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", fontSize: 12 }}>
          {learnApplied ? (
            <>
              <span style={{ color: "var(--text)", flex: 1 }}>
                Rule saved{learnApplied.count > 0
                  ? ` — applied to ${learnApplied.count} transaction${learnApplied.count !== 1 ? 's' : ''}${learnApplied.skipped > 0 ? ` (${learnApplied.skipped} older one${learnApplied.skipped !== 1 ? 's' : ''} left unchanged)` : ''}`
                  : ''} ✓
              </span>
              {learnApplied.ruleId && learnApplied.appliedIds.length > 0 && (
                <button className="btn btn-s btn-sm" style={{ fontSize: 11 }} onClick={undoLearnedRule}>Undo</button>
              )}
            </>
          ) : learnConflict ? (
            <>
              <span style={{ color: "var(--text-muted)", flex: 1 }}>
                A rule for <code style={{ color: "var(--accent)", fontFamily: "Source Code Pro,monospace" }}>{learnKwEdit}</code> already exists — update it to <strong style={{ color: "var(--text)" }}>{learnCurrent.nominalCode} · {learnCurrent.nominalName}</strong>?
              </span>
              <button className="btn btn-p btn-sm" style={{ fontSize: 11 }} onClick={updateLearnedRule} disabled={learnSaving}>{learnSaving ? "Updating…" : "Update rule"}</button>
              <button className="btn btn-s btn-sm" style={{ fontSize: 11 }} onClick={skipLearnPrompt}>Skip</button>
            </>
          ) : (
            <>
              <span style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>Always code to <strong style={{ color: "var(--text)" }}>{learnCurrent.nominalCode} · {learnCurrent.nominalName}</strong>?</span>
              <input
                value={learnKwEdit}
                onChange={e => setLearnKwEdit(e.target.value.toUpperCase())}
                style={{ fontFamily: "Source Code Pro,monospace", fontSize: 11, padding: "3px 8px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--accent)", width: 140 }}
                placeholder="KEYWORD"
                spellCheck={false}
              />
              <button className="btn btn-p btn-sm" style={{ fontSize: 11 }} onClick={saveLearnedRule} disabled={learnSaving || learnKwEdit.trim().length < 3}>{learnSaving ? "Saving…" : "Yes, always"}</button>
              <button className="btn btn-s btn-sm" style={{ fontSize: 11 }} onClick={skipLearnPrompt}>Skip</button>
              {learnQueue.length > 1 && <span style={{ fontSize: 10, color: "var(--text-faint)" }}>{learnQueue.length} pending</span>}
            </>
          )}
        </div>
      )}

      {activeTab === 'import' && !rows.length && (
        <div
          className={`bi-drop${over ? " over" : ""}`}
          onDragOver={e => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); loadFile(e.dataTransfer.files[0]); }}
          onClick={() => fileRef.current?.click()}
        >
          <div className="bi-drop-icon">⇅</div>
          <div className="bi-drop-label">Drop your Revolut Business or AIB CSV here</div>
          <div className="bi-drop-sub">Auto-detects format · AI categorises automatically · checks for duplicates</div>
          <div className="bi-drop-btn">Choose File</div>
          <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }}
            onClick={e => e.stopPropagation()}
            onChange={e => { if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value = ""; }} />
        </div>
      )}  {/* end activeTab === 'import' drop zone */}

      {activeTab === 'import' && alert && <div className={`bi-alert ${alert.type === "ok" ? "bi-alert-ok" : "bi-alert-err"}`}>{alert.msg}</div>}

      {/* ── Import History (shown when no file is loaded and import tab active) ── */}
      {activeTab === 'import' && !rows.length && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">
            <span className="card-title">Import History</span>
            <span style={{ fontSize: 11, color: "var(--dim)", fontFamily: "Source Code Pro, monospace" }}>
              {historyLoading ? "Loading…" : `${history.length} import${history.length !== 1 ? "s" : ""}`}
            </span>
          </div>
          {historyLoading ? (
            <div style={{ padding: "24px", textAlign: "center", color: "var(--dim)", fontSize: 12, fontFamily: "Source Code Pro, monospace" }}>Loading history…</div>
          ) : history.length === 0 ? (
            <div style={{ padding: "28px 24px", textAlign: "center", color: "var(--dim)", fontSize: 12 }}>No previous imports found.</div>
          ) : (
            <table className="gl-table">
              <thead>
                <tr>
                  <th>Imported</th>
                  <th>Format</th>
                  <th className="r">Transactions</th>
                  <th className="r">Net Amount</th>
                  <th className="r" style={{ width: 110 }}></th>
                </tr>
              </thead>
              <tbody>
                {history.map((batch, i) => {
                  const daysOld = Math.floor((Date.now() - new Date(batch.imported_at)) / 86400000);
                  // Journal-only orphaned batches are always reversible (cleanup)
                  const canReverse = batch.journalOnly || daysOld <= 30;
                  return (
                    <tr key={i}>
                      <td style={{ fontFamily: "Source Code Pro, monospace", fontSize: 11, color: "var(--muted)" }}>
                        {fmtHistDate(batch.imported_at)}
                        {batch.legacy && (
                          <span style={{
                            marginLeft: 7, fontSize: 9, fontFamily: "Source Code Pro, monospace", fontWeight: 700,
                            padding: "1px 6px", borderRadius: 20, textTransform: "uppercase", letterSpacing: "0.05em",
                            background: "rgba(107,101,96,0.1)", color: "var(--muted)", border: "1px solid var(--border)",
                            verticalAlign: "middle",
                          }}>Legacy</span>
                        )}
                        {batch.journalOnly && (
                          <span style={{
                            marginLeft: 7, fontSize: 9, fontFamily: "Source Code Pro, monospace", fontWeight: 700,
                            padding: "1px 6px", borderRadius: 20, textTransform: "uppercase", letterSpacing: "0.05em",
                            background: "rgba(184,134,11,0.1)", color: "var(--gold)", border: "1px solid rgba(184,134,11,0.3)",
                            verticalAlign: "middle",
                          }}>Orphaned</span>
                        )}
                      </td>
                      <td>
                        {batch.bank_format ? (
                          <span style={{
                            fontSize: 10, fontFamily: "Source Code Pro, monospace", fontWeight: 700,
                            padding: "2px 8px", borderRadius: 20, textTransform: "uppercase",
                            background: batch.bank_format === "revolut" ? "rgba(22,163,74,0.1)" : "rgba(29,107,114,0.1)",
                            color: batch.bank_format === "revolut" ? "var(--green)" : "var(--teal)",
                          }}>
                            {batch.bank_format === "aib" ? "AIB" : "Revolut"}
                          </span>
                        ) : <span style={{ color: "var(--dim)", fontSize: 11 }}>—</span>}
                      </td>
                      <td className="r mono" style={{ color: batch.journalOnly ? "var(--dim)" : undefined, fontSize: batch.journalOnly ? 11 : undefined }}>
                        {batch.journalOnly ? "journals only" : batch.count}
                      </td>
                      <td className="r mono" style={{ color: batch.total >= 0 ? "var(--green)" : "var(--red)", fontWeight: 600 }}>
                        {batch.journalOnly ? "—" : `${batch.total >= 0 ? "+" : ""}${fmtEUR(batch.total)}`}
                      </td>
                      <td className="r">
                        <button
                          className="btn btn-s btn-sm"
                          style={{ fontSize: 11, color: canReverse ? "var(--red)" : undefined, opacity: canReverse ? 1 : 0.45 }}
                          onClick={() => canReverse && setConfirmReverse(batch)}
                          disabled={!canReverse}
                          title={canReverse
                            ? batch.journalOnly
                              ? "Delete orphaned journal entries for this batch"
                              : batch.legacy
                                ? "Reverse this import — deletes all transactions in the same 1-hour window"
                                : "Reverse this import — deletes transactions and journals"
                            : "Contact your accountant to reverse imports older than 30 days"}
                        >
                          {canReverse ? "⟳ Reverse" : "🔒 Locked"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {!historyLoading && (
            <div style={{ padding: "10px 16px", borderTop: history.length ? "1px solid var(--border)" : "none", display: "flex", justifyContent: "flex-end" }}>
              <button
                className="btn btn-sm"
                style={{ fontSize: 11, color: "var(--red)", border: "1px solid var(--red)", background: "transparent", opacity: clearingAll ? 0.6 : 1 }}
                onClick={() => { setConfirmClearAll(true); setClearAllInput(""); }}
                disabled={clearingAll}
              >
                Clear All Data
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'import' && rows.length > 0 && (
        <>
          <div className="bi-toolbar">
            <span className="bi-fname">{fileName}</span>
            {bankFormat && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10,
                fontFamily: "'Source Code Pro', monospace", fontWeight: 600,
                padding: "2px 9px", borderRadius: 20, textTransform: "uppercase", letterSpacing: "0.06em",
                background: bankFormat === "revolut" ? "rgba(22,163,74,0.1)" : "rgba(29,107,114,0.1)",
                color: bankFormat === "revolut" ? "var(--green)" : "var(--teal)",
                border: bankFormat === "revolut" ? "1px solid rgba(22,163,74,0.25)" : "1px solid rgba(29,107,114,0.25)",
              }}>
                {bankFormat === "revolut" ? "Revolut" : "AIB"}
              </span>
            )}
            <span className="bi-count">
              {rows.length} transactions · {rows.filter(r => r.imported).length} imported · {newRows.length} new
            </span>
            {toast && <span className="bi-toast">✓ {toast}</span>}
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button className="btn btn-s btn-sm" onClick={() => downloadCSV(
                `bank-import-${fmtIE(new Date().toISOString().slice(0,10)).replace(/\//g,"-")}.csv`,
                [
                  ["Ledgrly — Bank Import", `Exported ${fmtIE(new Date().toISOString().slice(0,10))}`],
                  [],
                  ["Date", "Description", "Reference", "Amount (€)", "Balance (€)", "Nominal Account", "VAT Code"],
                  ...rows.map(r => {
                    const code = nominals[r.revolut_id] || "6600";
                    const name = GL_ACCOUNTS.find(a => a.code === code)?.name || code;
                    return [fmtIE(r.date), r.description, r.revolut_id, fmtEUR(r.amount), fmtEUR(r.balance), `${code} — ${name}`, "—"];
                  }),
                ]
              )}>
                ⬇ CSV
              </button>
              <button className="btn btn-s btn-sm" onClick={() => { setRows([]); setFileName(""); setAlert(null); setSelected(new Set()); setCatProgress(null); setBankFormat(null); sessionStorage.removeItem('ledgrly_import_session'); sessionStorage.removeItem('ledgrly_import_nominals'); }}>
                Clear
              </button>
              <button className="btn btn-p btn-sm" onClick={post} disabled={posting || selected.size === 0 || !!catProgress}>
                {posting ? "Posting…" : `Post ${selected.size > 0 ? selected.size + " " : ""}Selected to Ledger`}
              </button>
            </div>
          </div>
          {catProgress && (
            <div style={{ padding: "9px 14px 10px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, margin: "6px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontFamily: "Source Code Pro, monospace", color: "var(--teal)", display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="dot" style={{ background: "var(--teal)" }} />
                  <span className="dot" style={{ background: "var(--teal)" }} />
                  <span className="dot" style={{ background: "var(--teal)" }} />
                  &nbsp;{catProgress.msg}
                </span>
                <button
                  className="btn btn-s btn-sm"
                  style={{ fontSize: 10, padding: "2px 10px" }}
                  onClick={() => { cancelCatRef.current = true; }}
                >
                  Cancel
                </button>
              </div>
              {catProgress.total > 0 && (
                <div style={{ height: 5, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{
                    height: "100%", borderRadius: 3, background: "var(--teal)",
                    width: `${Math.round((catProgress.done / catProgress.total) * 100)}%`,
                    transition: "width 0.35s ease",
                  }} />
                </div>
              )}
            </div>
          )}

          <div className="card" style={{ overflowX: "auto" }}>
            <table className="bi-tbl">
              <thead>
                <tr>
                  <th style={{ width: 28 }}>
                    <input type="checkbox" className="bi-chk" checked={allNewChk} onChange={toggleAll} />
                  </th>
                  <th>Date</th>
                  <th>Description</th>
                  <th className="r">Amount</th>
                  <th className="r">Balance</th>
                  <th>Nominal Account</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr
                    key={r.revolut_id}
                    className={`${r.imported ? "bi-imported" : ""} ${selected.has(r.revolut_id) ? "bi-sel" : ""}`}
                    onClick={() => !r.imported && toggle(r.revolut_id)}
                  >
                    <td onClick={e => e.stopPropagation()}>
                      {!r.imported && (
                        <input type="checkbox" className="bi-chk" checked={selected.has(r.revolut_id)} onChange={() => toggle(r.revolut_id)} />
                      )}
                    </td>
                    <td style={{ fontFamily: "var(--mono, monospace)", fontSize: 11 }}>{r.date}</td>
                    <td>{r.description}</td>
                    <td className="r">
                      <span className={r.amount >= 0 ? "bi-amt-pos" : "bi-amt-neg"}>
                        {r.amount >= 0 ? "+" : ""}{(r.amount ?? 0).toLocaleString("en-IE", { minimumFractionDigits: 2 })}
                      </span>
                    </td>
                    <td className="r">
                      <span className="bi-bal">{(r.balance ?? 0).toLocaleString("en-IE", { minimumFractionDigits: 2 })}</span>
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      {!r.imported ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {confidence[r.revolut_id] && (
                            <span
                              title={`AI confidence: ${confidence[r.revolut_id]}`}
                              style={{
                                display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                                flexShrink: 0, background: CONF_COLOR[confidence[r.revolut_id]] || "var(--dim)",
                              }}
                            />
                          )}
                          <select
                            className="bi-nom-sel"
                            value={nominals[r.revolut_id] || "6600"}
                            onChange={e => handleNominalChange(r.revolut_id, e.target.value)}
                          >
                            {nominalOptions.map(grp => (
                              <optgroup key={grp.label} label={grp.label}>
                                {grp.items.map(a => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
                              </optgroup>
                            ))}
                          </select>
                        </div>
                      ) : <span style={{ fontSize: 11, color: "var(--dim)" }}>—</span>}
                    </td>
                    <td>
                      <span className={`bi-tag ${r.imported ? "bi-tag-imp" : "bi-tag-new"}`}>
                        {r.imported ? "Imported" : "New"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Needs Review Tab ── */}
      {activeTab === 'review' && (
        <div>
          {/* Header bar */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
            {reviewLoading ? (
              <span style={{ fontSize: 12, color: "var(--muted)", fontFamily: "Source Code Pro,monospace" }}>Loading…</span>
            ) : reviewRows.length === 0 ? (
              <span style={{ fontSize: 13, color: "var(--green)", fontWeight: 600 }}>All transactions categorised ✓</span>
            ) : (
              <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>
                <span style={{ display: "inline-block", background: "rgba(220,38,38,0.1)", color: "var(--red)", border: "1px solid rgba(220,38,38,0.25)", borderRadius: 20, padding: "1px 10px", fontSize: 11, fontFamily: "Source Code Pro,monospace", fontWeight: 700, marginRight: 8 }}>
                  {reviewRows.length}
                </span>
                transaction{reviewRows.length !== 1 ? 's' : ''} need{reviewRows.length === 1 ? 's' : ''} review
              </span>
            )}
            {reviewToast && (
              <span style={{ fontSize: 11, fontFamily: "Source Code Pro,monospace", color: reviewToast.startsWith('Error') ? "var(--red)" : "var(--green)" }}>{reviewToast}</span>
            )}
            <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {fixAllResult && (
                <span style={{ fontSize: 11, fontFamily: "Source Code Pro,monospace", color: fixAllResult.startsWith('Error') ? "var(--red)" : "var(--teal)" }}>{fixAllResult}</span>
              )}
              <button
                className="btn btn-s btn-sm"
                onClick={fixAllKnown}
                disabled={fixingAll || reviewLoading}
                title="Re-run transaction rules against all uncategorised (6600) transactions"
                style={{ fontSize: 11 }}
              >
                {fixingAll ? "Running…" : "⚡ Fix All Known"}
              </button>
              <button className="btn btn-s btn-sm" onClick={loadReviewRows} disabled={reviewLoading} style={{ fontSize: 11 }}>Refresh</button>
              <button
                className="btn btn-p btn-sm"
                onClick={saveAllReviewChanges}
                disabled={reviewSaving || Object.keys(reviewChanges).length === 0}
              >
                {reviewSaving ? "Saving…" : `Save ${Object.keys(reviewChanges).length > 0 ? Object.keys(reviewChanges).length + " " : ""}Change${Object.keys(reviewChanges).length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>

          {!reviewLoading && reviewRows.length > 0 && (
            <div className="card" style={{ overflowX: "auto" }}>
              <table className="bi-tbl">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th className="r">Amount</th>
                    <th>Current Nominal</th>
                    <th>New Nominal</th>
                    <th style={{ textAlign: "center", fontSize: 10 }}>Apply to Similar</th>
                  </tr>
                </thead>
                <tbody>
                  {reviewRows.map(row => {
                    const pendingCode = reviewChanges[row.revolut_id];
                    const currentCode = row.nominal_account || '6600';
                    const displayCode = pendingCode || currentCode;
                    const isSimilarOn = applySimilar.has(row.revolut_id);
                    const isChanged   = !!pendingCode && pendingCode !== currentCode;
                    return (
                      <tr key={row.revolut_id} style={{ background: isChanged ? "rgba(29,107,114,0.04)" : undefined }}>
                        <td style={{ fontFamily: "Source Code Pro,monospace", fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>{row.date}</td>
                        <td style={{ fontSize: 12, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.description}>{row.description}</td>
                        <td className="r">
                          <span className={Number(row.amount) >= 0 ? "bi-amt-pos" : "bi-amt-neg"}>
                            {Number(row.amount) >= 0 ? "+" : ""}{Number(row.amount).toLocaleString("en-IE", { minimumFractionDigits: 2 })}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: 11, fontFamily: "Source Code Pro,monospace", color: "var(--muted)" }}>{currentCode}</span>
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          <select
                            className="bi-nom-sel"
                            value={displayCode}
                            onChange={e => {
                              const newCode = e.target.value;
                              setReviewChanges(prev => ({ ...prev, [row.revolut_id]: newCode }));
                            }}
                            style={isChanged ? { borderColor: "var(--teal)", color: "var(--teal)" } : undefined}
                          >
                            {nominalOptions.map(grp => (
                              <optgroup key={grp.label} label={grp.label}>
                                {grp.items.map(a => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
                              </optgroup>
                            ))}
                          </select>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <label style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 11, color: isSimilarOn ? "var(--teal)" : "var(--dim)" }}>
                            <input
                              type="checkbox"
                              checked={isSimilarOn}
                              onChange={() => setApplySimilar(prev => {
                                const next = new Set(prev);
                                if (next.has(row.revolut_id)) next.delete(row.revolut_id); else next.add(row.revolut_id);
                                return next;
                              })}
                              style={{ accentColor: "var(--teal)" }}
                            />
                            All
                          </label>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}, (prev, next) => prev.companyId === next.companyId); // React.memo(BankImport)

const SUGGS = ["Will I have enough cash for payroll?", "What journals should I post at month end?", "What's net profit vs budget?", "Which invoices are most at risk?"];

function Chat({ page, companyName, period, selPeriod, companyId, company, onClose }) {
  const [ctxLoading, setCtxLoading] = useState(true);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [msgs, setMsgs] = useState([]);
  const [inp, setInp] = useState("");
  const [typing, setTyping] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, typing]);

  // Load live account context on mount, then build system prompt + greeting
  useEffect(() => {
    (async () => {
      setCtxLoading(true);
      let ctx = "";

      try {
        if (companyId) {
          const db = supabase;
          const today  = new Date().toISOString().slice(0, 10);
          const in30   = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

          // Derive period bounds from YYYY-MM selPeriod
          const sp = selPeriod || (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`; })();
          const [pYear, pMonth] = sp.split('-').map(Number);
          const periodStart = `${sp}-01`;
          const periodEnd   = new Date(pYear, pMonth, 0).toISOString().slice(0, 10);

          // Trailing 12 months range for monthly summary
          const trail12Start = (() => {
            const d = new Date(pYear, pMonth - 13, 1);
            return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
          })();

          const [btLatest, overdueInvs, upcomingInvs, periodJournals, trail12Journals] = await Promise.all([
            db.from('bank_transactions').select('balance').eq('company_id', companyId).lte('date', periodEnd).order('date', { ascending: false }).limit(1),
            db.from('invoices').select('amount,client,invoice_ref').eq('company_id', companyId).lt('due_date', today).neq('status', 'paid'),
            db.from('invoices').select('amount,due_date,client').eq('company_id', companyId).gte('due_date', today).lte('due_date', in30).in('status', ['pending','chased']),
            db.from('journals').select('debit_account,credit_account,amount,date,description,reference').eq('company_id', companyId).gte('date', periodStart).lte('date', periodEnd).order('date'),
            db.from('journals').select('debit_account,credit_account,amount,date').eq('company_id', companyId).gte('date', trail12Start).lte('date', periodEnd),
          ]);

          const currentBal = btLatest.data?.[0] ? Number(btLatest.data[0].balance) : null;
          const overdueAmt = (overdueInvs.data || []).reduce((s, i) => s + Number(i.amount), 0);
          const overdueN   = overdueInvs.data?.length || 0;
          const upcomingAmt= (upcomingInvs.data || []).reduce((s, i) => s + Number(i.amount), 0);
          const upcomingN  = upcomingInvs.data?.length || 0;
          const yem        = company?.year_end_month ? MONTH_NAMES_LONG[company.year_end_month - 1] : "December";
          const vatPeriod  = company?.vat_period === 'monthly' ? 'Monthly' : 'Bi-monthly';
          const fmtE = n => fmtCurrencyFull(n, baseCurrency);

          // Build trailing-12-month monthly summary from journals
          const monthMap = {};
          for (const j of (trail12Journals.data || [])) {
            const mo = j.date.slice(0, 7); // YYYY-MM
            if (!monthMap[mo]) monthMap[mo] = { income: 0, expenses: 0, count: 0 };
            const amt = Math.abs(Number(j.amount));
            if (j.credit_account >= '4000' && j.credit_account < '5000') monthMap[mo].income += amt;
            if (j.debit_account  >= '5000' && j.debit_account  < '7000') monthMap[mo].expenses += amt;
            monthMap[mo].count++;
          }
          const months12 = Object.entries(monthMap).sort(([a], [b]) => a.localeCompare(b));
          const monthly12Table = months12.length > 0
            ? months12.map(([mo, v]) => `  ${mo}: income ${fmtE(v.income)}, expenses ${fmtE(v.expenses)}, net ${fmtE(v.income - v.expenses)} (${v.count} journals)`).join('\n')
            : "  No journal data in trailing 12 months";

          // Period journal detail
          const pJnls = periodJournals.data || [];
          const pIncome   = pJnls.filter(j => j.credit_account >= '4000' && j.credit_account < '5000').reduce((s, j) => s + Math.abs(Number(j.amount)), 0);
          const pExpenses = pJnls.filter(j => j.debit_account  >= '5000' && j.debit_account  < '7000').reduce((s, j) => s + Math.abs(Number(j.amount)), 0);
          const pJnlDetail = pJnls.length > 0
            ? pJnls.slice(0, 30).map(j => `  ${j.date} | DR:${j.debit_account} CR:${j.credit_account} | ${fmtE(j.amount)} | ${j.description || j.reference || ''}`).join('\n')
            : "  No journals posted for this period";

          ctx = `
LIVE ACCOUNT DATA for ${companyName} (as of ${today}):

SELECTED PERIOD: ${period} (${periodStart} → ${periodEnd})
- Bank balance at period end: ${currentBal !== null ? fmtE(currentBal) : "No bank data imported yet"}
- Period income (4xxx credit journals): ${fmtE(pIncome)}
- Period expenses (5xxx-6xxx debit journals): ${fmtE(pExpenses)}
- Period net: ${fmtE(pIncome - pExpenses)}
- Overdue invoices (AR): ${overdueN} invoice${overdueN !== 1 ? 's' : ''} totalling ${fmtE(overdueAmt)}
- Invoices due in next 30 days: ${upcomingN} invoice${upcomingN !== 1 ? 's' : ''} totalling ${fmtE(upcomingAmt)}
- Company: ${companyName} | VAT period: ${vatPeriod} | Accounting year end: ${yem}

TRAILING 12-MONTH SUMMARY (monthly):
${monthly12Table}

JOURNAL DETAIL FOR ${period} (up to 30 entries):
${pJnlDetail}

Use these figures when answering questions. For periods not shown, state that data is unavailable.`.trim();
        } else {
          ctx = "No company data available yet — the user has not imported any bank transactions.";
        }
      } catch (e) {
        ctx = "Live account data could not be loaded. Help with general Irish accounting questions only.";
      }

      const prompt = `You are Ledgrly AI — a concise Irish SME finance assistant built into Ledgrly. You are helping the team at ${companyName}.

${ctx}

You can also help with:
- Irish accounting questions (double-entry, nominal accounts, chart of accounts)
- VAT — VAT3 returns, VAT rates, ROS filing, thresholds
- Payroll compliance — P30, PAYE/PRSI/USC, Revenue Commissioners
- CRO filings — annual returns, B1
- Corporation Tax — CT1, preliminary tax, deadlines
- Journal entries — accruals, prepayments, depreciation

RULES: Max 2–3 sentences per reply unless the user asks for detail. Be direct and practical. Use Irish accounting terminology (ROS, CRO, CT1, P30, VAT3, Revenue). Current page: ${page}.`;

      setSystemPrompt(prompt);
      setMsgs([{ role: "assistant", text: `Good morning. I'm Ledgrly AI — your Irish finance assistant. I've loaded your account data for ${period}. What do you need?` }]);
      setCtxLoading(false);
    })();
  }, [companyId, selPeriod]); // eslint-disable-line

  const send = async (text) => {
    const msg = text || inp;
    if (!msg.trim() || ctxLoading) return;
    setInp(""); setMsgs(p => [...p, { role: "user", text: msg }]); setTyping(true);
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 1000,
          system: systemPrompt,
          messages: [...msgs.map(m => ({ role: m.role, content: m.text })), { role: "user", content: msg }] }) });
      const data = await res.json();
      if (!res.ok) {
        setMsgs(p => [...p, { role: "assistant", text: `Error: ${data.error || "Unable to reach AI. Please try again."}` }]);
      } else {
        setMsgs(p => [...p, { role: "assistant", text: data.content?.[0]?.text || "No response received." }]);
      }
    } catch (e) { setMsgs(p => [...p, { role: "assistant", text: `Connection error: ${e.message}` }]); }
    setTyping(false);
  };

  return (
    <div className="chat-panel">
      <div className="chat-hdr">
        <div className="chat-av">⚡</div>
        <div style={{ flex: 1 }}>
          <div className="chat-ttl">Ledgrly AI</div>
          <div className="chat-st">{ctxLoading ? "● Loading data…" : "● Online · Live data"}</div>
        </div>
        {onClose && <button className="chat-dock-close" onClick={onClose} title="Close (Esc)">✕</button>}
      </div>
      <div className="chat-msgs">
        {ctxLoading ? (
          <div className="msg msg-a" style={{ fontFamily: "Source Code Pro, monospace", fontSize: 11, color: "var(--dim)" }}>
            <span className="dot" /><span className="dot" /><span className="dot" /> Loading your account data…
          </div>
        ) : (
          msgs.map((m, i) => <div key={i} className={`msg ${m.role === "assistant" ? "msg-a" : "msg-u"}`}>{m.text}</div>)
        )}
        {typing && <div className="msg msg-a"><span className="dot" /><span className="dot" /><span className="dot" /></div>}
        <div ref={endRef} />
      </div>
      <div className="chat-sugg">
        {!ctxLoading && SUGGS.map((s, i) => <button key={i} className="sugg" onClick={() => send(s)}>{s}</button>)}
      </div>
      <div className="chat-inp-area">
        <input className="chat-inp" value={inp} onChange={e => setInp(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()}
          placeholder={ctxLoading ? "Loading…" : "Ask anything..."}
          disabled={ctxLoading} />
        <button className="send-btn" onClick={() => send()} disabled={ctxLoading}>↑</button>
      </div>
    </div>
  );
}

// ─── SETTINGS PAGE ───────────────────────────────────────────────────────────
const SETTINGS_MONTHS    = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const SETTINGS_TYPES     = ["Limited Company","Sole Trader","Partnership","LLP"];
const SETTINGS_CURRENCIES = ["EUR","GBP","USD"];

function Settings({ company, onUpdate }) {
  const { user } = useUser();
  const blank = () => ({
    name:            company?.name            || "",
    company_type:    company?.company_type    || "Limited Company",
    vat_registered:  company?.vat_registered  ?? false,
    vat_number:      company?.vat_number      || "",
    vat_period:      company?.vat_period      || "bimonthly",
    ros_efiler:      company?.ros_efiler      ?? false,
    year_end_month:  company?.year_end_month  || 12,
    ard_month:       company?.ard_month       || "",
    ard_day:         company?.ard_day         || "",
    currency:        company?.base_currency    || company?.currency || "EUR",
    paye_registered: company?.paye_registered ?? false,
    rct_registered:  company?.rct_registered  ?? false,
    cro_number:      company?.cro_number      || "",
    sales_vat_rate:  company?.sales_vat_rate  ?? 23,
  });
  const [form, setForm] = useState(blank());
  const [saving, setSaving] = useState(false);
  const [slugResetting, setSlugResetting] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [error,  setError]  = useState(null);

  // ── Team state ──
  const [members,        setMembers]        = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [inviteEmail,    setInviteEmail]    = useState("");
  const [inviteRole,     setInviteRole]     = useState("member");
  const [inviting,       setInviting]       = useState(false);
  const [inviteMsg,      setInviteMsg]      = useState(null);
  const [creatingOrg,      setCreatingOrg]      = useState(false);
  const [creatingOrgError, setCreatingOrgError] = useState(null);

  // ── Prior Year Balances ──
  const { balances: pyBalances, meta: pyMeta, refetch: pyRefetch } = usePriorYearBalances(company?.id);

  // ── Transaction Rules ──
  const { rules: txRulesList, refetch: txRulesRefetch } = useTransactionRules(company?.id);
  const [ruleForm,          setRuleForm]          = useState(null);
  const [ruleSaving,        setRuleSaving]        = useState(false);
  const [ruleConfirmDelete, setRuleConfirmDelete] = useState(null);
  const [showSystemRules,   setShowSystemRules]   = useState(false);

  const companyRules = txRulesList.filter(r => r.company_id != null);
  const systemRules  = txRulesList.filter(r => r.company_id == null);

  // ── Invoice Settings ──
  const [invSetForm,    setInvSetForm]    = useState({ logo_url: '', trading_name: '', address: '', vat_number: '', reg_number: '', payment_terms: 30, bank_details: '', footer_notes: '', stmt_rct: 'This invoice is subject to Relevant Contracts Tax (RCT). VAT is to be accounted for by the principal contractor under the reverse charge mechanism in accordance with Section 16(3) of the VAT Consolidation Act 2010.', stmt_rc_eu: 'Reverse charge applies – VAT to be accounted for by the recipient under Articles 44 and 196 of the EU VAT Directive', stmt_exempt: 'VAT exempt supply under Section 34 of the VAT Consolidation Act 2010' });
  const [invSetSaving,  setInvSetSaving]  = useState(false);
  const [invSetSaved,   setInvSetSaved]   = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);

  useEffect(() => {
    if (!company?.id) return;
    supabase.from('invoice_settings').select('*').eq('company_id', company.id).maybeSingle().then(({ data }) => {
      if (data) setInvSetForm({ logo_url: data.logo_url || '', trading_name: data.trading_name || '', address: data.address || '', vat_number: data.vat_number || '', reg_number: data.reg_number || '', payment_terms: data.payment_terms ?? 30, bank_details: data.bank_details || '', footer_notes: data.footer_notes || '', stmt_rct: data.stmt_rct || 'This invoice is subject to Relevant Contracts Tax (RCT). VAT is to be accounted for by the principal contractor under the reverse charge mechanism in accordance with Section 16(3) of the VAT Consolidation Act 2010.', stmt_rc_eu: data.stmt_rc_eu || 'Reverse charge applies – VAT to be accounted for by the recipient under Articles 44 and 196 of the EU VAT Directive', stmt_exempt: data.stmt_exempt || 'VAT exempt supply under Section 34 of the VAT Consolidation Act 2010' });
    });
  }, [company?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveInvSettings = async () => {
    if (!company?.id || invSetSaving) return;
    setInvSetSaving(true);
    await supabase.from('invoice_settings').upsert({ company_id: company.id, ...invSetForm, payment_terms: Number(invSetForm.payment_terms) || 30, updated_at: new Date().toISOString() }, { onConflict: 'company_id' });
    setInvSetSaved(true); setTimeout(() => setInvSetSaved(false), 2500); setInvSetSaving(false);
  };

  const uploadLogo = async (file) => {
    if (!company?.id || !file) return;
    setLogoUploading(true);
    const ext  = file.name.split('.').pop().toLowerCase();
    const path = `logos/${company.id}.${ext}`;
    const { error } = await supabase.storage.from('journal-attachments').upload(path, file, { upsert: true, contentType: file.type });
    if (!error) {
      const { data: { publicUrl } } = supabase.storage.from('journal-attachments').getPublicUrl(path);
      setInvSetForm(p => ({ ...p, logo_url: publicUrl }));
    }
    setLogoUploading(false);
  };

  const addRule = async () => {
    if (!company?.id || !ruleForm?.pattern || !ruleForm.nominal_code) return;
    setRuleSaving(true);
    const nomName   = GL_ACCOUNTS.find(a => a.code === ruleForm.nominal_code)?.name || ruleForm.nominal_code;
    const pattern   = ruleForm.pattern.trim().toLowerCase();
    const direction = ruleForm.direction || 'out';
    const payload   = {
      company_id: company.id, pattern,
      match_type: ruleForm.match_type || 'contains', direction,
      nominal_code: ruleForm.nominal_code, nominal_name: nomName,
      confidence: 'high', source: 'user',
    };
    const { error: insErr } = await supabase.from('transaction_rules').insert(payload);
    if (insErr?.code === '23505') {
      await supabase.from('transaction_rules')
        .update({ nominal_code: ruleForm.nominal_code, nominal_name: nomName, confidence: 'high', source: 'user' })
        .eq('company_id', company.id).eq('pattern', pattern).eq('direction', direction);
    }
    setRuleForm(null); setRuleSaving(false); txRulesRefetch();
  };

  const deleteRule = async (id) => {
    if (!company?.id) return;
    await supabase.from('transaction_rules').delete().eq('id', id);
    setRuleConfirmDelete(null); txRulesRefetch();
  };

  const toggleRule = async (id, current) => {
    if (!company?.id) return;
    await supabase.from('transaction_rules').update({ is_active: !current }).eq('id', id);
    txRulesRefetch();
  };
  const [pyYearEndDate, setPyYearEndDate] = useState("");
  const [pyUploading,   setPyUploading]   = useState(false);
  const [pyUploadError, setPyUploadError] = useState(null);
  const [pyConfirmDelete, setPyConfirmDelete] = useState(false);

  const parsePYCSV = (text) => {
    const lines = text.trim().split(/\r?\n/);
    const rows = [];
    const startIdx = isNaN(String(lines[0]?.split(',')[0]).trim().replace(/"/g, '')) ? 1 : 0;
    for (let i = startIdx; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
      if (!cols[0] || cols[0].length === 0) continue;
      rows.push({
        company_id:     company.id,
        year_end_date:  pyYearEndDate,
        account_code:   cols[0],
        account_name:   cols[1] || cols[0],
        debit_balance:  parseFloat(cols[2] || '0') || 0,
        credit_balance: parseFloat(cols[3] || '0') || 0,
      });
    }
    return rows;
  };

  const uploadPY = async (text) => {
    if (!company?.id || !pyYearEndDate) { setPyUploadError("Please select a year end date first."); return; }
    setPyUploading(true); setPyUploadError(null);
    const rows = parsePYCSV(text);
    if (rows.length === 0) { setPyUploadError("No valid rows found in CSV. Check the format: Account Code, Account Name, Debit Balance, Credit Balance"); setPyUploading(false); return; }
    const db = supabase;
    await db.from('prior_year_balances').delete().eq('company_id', company.id).eq('year_end_date', pyYearEndDate);
    const { error } = await db.from('prior_year_balances').insert(rows);
    if (error) { setPyUploadError(error.message); }
    else { pyRefetch(); setPyYearEndDate(""); }
    setPyUploading(false);
  };

  const deletePY = async () => {
    if (!company?.id || !pyMeta) return;
    await supabase.from('prior_year_balances').delete().eq('company_id', company.id);
    pyRefetch(); setPyConfirmDelete(false);
  };

  // ── Chart of Accounts ──
  const { accounts: coa, loading: coaLoading, refetch: coaRefetch } = useChartOfAccounts(company?.id);
  const [coaSearch,        setCoaSearch]        = useState("");
  const [coaForm,          setCoaForm]          = useState(null);
  const [coaEdit,          setCoaEdit]          = useState(null);
  const [coaEditForm,      setCoaEditForm]      = useState({});
  const [coaConfirmDelete, setCoaConfirmDelete] = useState(null);
  const [coaSaving,        setCoaSaving]        = useState(false);

  const filteredCoa = coa.filter(a => !coaSearch ||
    a.code.toLowerCase().includes(coaSearch.toLowerCase()) ||
    a.name.toLowerCase().includes(coaSearch.toLowerCase()));

  const coaIsStatic = (a) => !!a?._static;

  const coaAdd = async () => {
    if (!coaForm?.code || !coaForm.name || !company?.id) return;
    setCoaSaving(true);
    await supabase.from("chart_of_accounts").insert({
      company_id: company.id, code: coaForm.code.trim(), name: coaForm.name.trim(),
      account_type: coaForm.account_type, category: coaForm.category || "", is_active: true, is_system: false,
    });
    setCoaForm(null); setCoaSaving(false); coaRefetch();
  };

  const coaSaveEdit = async (id) => {
    if (!company?.id) return;
    setCoaSaving(true);
    await supabase.from("chart_of_accounts")
      .update({ name: coaEditForm.name, category: coaEditForm.category || "" }).eq("id", id);
    setCoaEdit(null); setCoaSaving(false); coaRefetch();
  };

  const coaDelete = async (id) => {
    if (!company?.id) return;
    await supabase.from("chart_of_accounts").delete().eq("id", id);
    setCoaConfirmDelete(null); coaRefetch();
  };

  const coaToggleActive = async (id, current) => {
    if (!company?.id) return;
    await supabase.from("chart_of_accounts")
      .update({ is_active: !current }).eq("id", id);
    coaRefetch();
  };

  useEffect(() => {
    if (!company?.clerk_org_id) return;
    setMembersLoading(true);
    fetch(`/api/org-members?orgId=${company.clerk_org_id}`)
      .then(r => r.json())
      .then(d => { setMembers(d.members || []); setMembersLoading(false); })
      .catch(() => setMembersLoading(false));
  }, [company?.clerk_org_id]);

  const enableTeam = async () => {
    if (!company?.id || !user) return;
    setCreatingOrg(true);
    setCreatingOrgError(null);
    try {
      // Check if an org already exists in the DB (e.g. created in a previous attempt)
      const { data: existing } = await supabase
        .from("companies").select("clerk_org_id").eq("id", company.id).single();
      if (existing?.clerk_org_id) {
        onUpdate({ ...company, clerk_org_id: existing.clerk_org_id });
        setCreatingOrg(false);
        return;
      }

      const res = await fetch('/api/create-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: company.id, companyName: company.name, userId: user.id }),
      });
      const d = await res.json();
      console.log('[create-org] response:', { status: res.status, ok: res.ok, body: d });

      if (!res.ok || d.error) {
        const msg = d.error || `Server error (${res.status})`;
        if (/clerk_secret_key|not configured/i.test(msg)) {
          setCreatingOrgError("Organisation features require server configuration — CLERK_SECRET_KEY is not set.");
        } else {
          setCreatingOrgError(msg);
        }
      } else if (d.orgId) {
        await supabase.from("companies").update({ clerk_org_id: d.orgId }).eq("id", company.id);
        onUpdate({ ...company, clerk_org_id: d.orgId });
      } else {
        setCreatingOrgError("Unexpected response from server — no organisation ID returned.");
      }
    } catch (e) {
      console.error('[create-org] exception:', e);
      setCreatingOrgError(e.message || "Network error — please try again.");
    }
    setCreatingOrg(false);
  };

  const sendInvite = async () => {
    if (!inviteEmail.trim() || !company?.clerk_org_id) return;
    setInviting(true); setInviteMsg(null);
    try {
      const res = await fetch('/api/invite-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: company.clerk_org_id, emailAddress: inviteEmail.trim(), role: inviteRole }),
      });
      const d = await res.json();
      if (!res.ok) setInviteMsg({ ok: false, text: d.error || "Invitation failed" });
      else { setInviteMsg({ ok: true, text: `Invitation sent to ${inviteEmail}` }); setInviteEmail(""); }
    } catch (e) {
      setInviteMsg({ ok: false, text: e.message });
    }
    setInviting(false);
  };

  const valid = form.name.trim().length > 0 &&
    (!form.vat_registered || form.vat_number.trim().length > 0);

  const save = async () => {
    if (!valid || saving || !company?.id) return;
    setSaving(true); setSaved(false); setError(null);
    const { data, error: err } = await supabase
      .from("companies")
      .update({
        name:            form.name.trim(),
        company_type:    form.company_type,
        vat_registered:  form.vat_registered,
        vat_number:      form.vat_registered ? (form.vat_number.trim() || null) : null,
        vat_period:      form.vat_period,
        ros_efiler:      form.ros_efiler,
        year_end_month:  Number(form.year_end_month),
        ard_month:       form.ard_month ? Number(form.ard_month) : null,
        ard_day:         form.ard_day   ? Number(form.ard_day)   : null,
        currency:        form.currency,
        base_currency:   form.currency,
        paye_registered: form.paye_registered,
        rct_registered:  form.rct_registered,
        cro_number:      form.cro_number.trim() || null,
        sales_vat_rate:  Number(form.sales_vat_rate) || 23,
      })
      .eq("id", company.id)
      .select()
      .single();
    if (err) { setError(err.message); }
    else     { setSaved(true); onUpdate(data); setTimeout(() => setSaved(false), 3000); }
    setSaving(false);
  };

  const ardDeadline = form.ard_month && form.ard_day
    ? (() => {
        const due = new Date(new Date().getFullYear(), Number(form.ard_month) - 1, Number(form.ard_day) + 56);
        return due.toLocaleDateString("en-IE", { day: "numeric", month: "long" }) + " (56 days after ARD)";
      })()
    : "Set ARD month and day above";

  return (
    <div className="fade-up" style={{ maxWidth: 660 }}>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text)", marginBottom: 2 }}>Company Settings</div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>Update your company profile, tax settings, and compliance dates.</div>
      </div>

      {/* ── Company Details ── */}
      <div className="card" style={{ marginBottom: 13 }}>
        <div className="card-header"><span className="card-title">Company Details</span></div>
        <div style={{ padding: "16px 15px" }}>
          <div className="f-row">
            <div className="f-group" style={{ gridColumn: "span 2" }}>
              <label className="f-label">Company / Trading Name</label>
              <input className="f-input" value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Brennan & Sons Ltd" />
            </div>
            <div className="f-group">
              <label className="f-label">Company Type</label>
              <select className="f-input" value={form.company_type}
                onChange={e => setForm(p => ({ ...p, company_type: e.target.value }))}>
                {SETTINGS_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="f-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className="f-group">
              <label className="f-label">Base Currency</label>
              <select className="f-input" value={form.currency}
                onChange={e => setForm(p => ({ ...p, currency: e.target.value }))}>
                {SETTINGS_CURRENCIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="f-group">
              <label className="f-label">Accounting Year End</label>
              <select className="f-input" value={form.year_end_month}
                onChange={e => setForm(p => ({ ...p, year_end_month: e.target.value }))}>
                {SETTINGS_MONTHS.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* ── VAT & Tax ── */}
      <div className="card" style={{ marginBottom: 13 }}>
        <div className="card-header"><span className="card-title">VAT & Tax</span></div>
        <div style={{ padding: "16px 15px" }}>
          <div className="f-row">
            <div className="f-group">
              <label className="f-label">VAT Registered?</label>
              <div className="ob-toggle">
                <button className={`ob-toggle-btn ${!form.vat_registered ? "active" : ""}`}
                  onClick={() => setForm(p => ({ ...p, vat_registered: false, vat_number: "" }))}>No</button>
                <button className={`ob-toggle-btn ${form.vat_registered ? "active" : ""}`}
                  onClick={() => setForm(p => ({ ...p, vat_registered: true }))}>Yes</button>
              </div>
            </div>
            <div className="f-group">
              <label className="f-label">VAT Return Period</label>
              <select className="f-input" value={form.vat_period}
                onChange={e => setForm(p => ({ ...p, vat_period: e.target.value }))}>
                <option value="bimonthly">Bi-monthly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div className="f-group">
              <label className="f-label">Sales VAT Rate (%)</label>
              <select className="f-input" value={form.sales_vat_rate}
                onChange={e => setForm(p => ({ ...p, sales_vat_rate: Number(e.target.value) }))}>
                <option value={23}>23% (Standard)</option>
                <option value={13.5}>13.5% (Reduced)</option>
                <option value={9}>9% (Special)</option>
                <option value={0}>0% (Zero-rated)</option>
              </select>
            </div>
            <div className="f-group">
              <label className="f-label">ROS e-Filing</label>
              <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                <button type="button" className={`ob-toggle-btn ${!form.ros_efiler ? "active" : ""}`}
                  onClick={() => setForm(p => ({ ...p, ros_efiler: false }))}>19th</button>
                <button type="button" className={`ob-toggle-btn ${form.ros_efiler ? "active" : ""}`}
                  onClick={() => setForm(p => ({ ...p, ros_efiler: true }))}>23rd (ROS)</button>
              </div>
            </div>
            <div className="f-group">
              <label className="f-label">VAT Number</label>
              <input className="f-input" value={form.vat_number}
                onChange={e => setForm(p => ({ ...p, vat_number: e.target.value }))}
                placeholder="IE 1234567A"
                disabled={!form.vat_registered}
                style={{ opacity: form.vat_registered ? 1 : 0.45 }} />
            </div>
            <div className="f-group">
              <label className="f-label">PAYE Registered?</label>
              <div style={{ display: "flex", border: "1px solid var(--border2)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
                <button type="button" className={`ob-toggle-btn ${!form.paye_registered ? "active" : ""}`}
                  onClick={() => setForm(p => ({ ...p, paye_registered: false }))}>No</button>
                <button type="button" className={`ob-toggle-btn ${form.paye_registered ? "active" : ""}`}
                  onClick={() => setForm(p => ({ ...p, paye_registered: true }))}>Yes</button>
              </div>
            </div>
            <div className="f-group">
              <label className="f-label">RCT (Construction)?</label>
              <div style={{ display: "flex", border: "1px solid var(--border2)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
                <button type="button" className={`ob-toggle-btn ${!form.rct_registered ? "active" : ""}`}
                  onClick={() => setForm(p => ({ ...p, rct_registered: false }))}>No</button>
                <button type="button" className={`ob-toggle-btn ${form.rct_registered ? "active" : ""}`}
                  onClick={() => setForm(p => ({ ...p, rct_registered: true }))}>Yes</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── CRO Annual Return ── */}
      <div className="card" style={{ marginBottom: 13 }}>
        <div className="card-header"><span className="card-title">CRO Annual Return</span></div>
        <div style={{ padding: "16px 15px" }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
            Your Annual Return Date (ARD) determines when your B1 return is due (56 days after ARD). Set a CRO number to enable the B1 deadline.
          </div>
          <div className="f-row">
            <div className="f-group" style={{ gridColumn: "span 2" }}>
              <label className="f-label">CRO Number</label>
              <input className="f-input" value={form.cro_number}
                onChange={e => setForm(p => ({ ...p, cro_number: e.target.value }))}
                placeholder="e.g. 123456" />
            </div>
          </div>
          <div className="f-row">
            <div className="f-group">
              <label className="f-label">ARD Month</label>
              <select className="f-input" value={form.ard_month}
                onChange={e => setForm(p => ({ ...p, ard_month: e.target.value }))}>
                <option value="">Not set</option>
                {SETTINGS_MONTHS.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
              </select>
            </div>
            <div className="f-group">
              <label className="f-label">ARD Day</label>
              <input className="f-input" type="number" min="1" max="31"
                value={form.ard_day}
                onChange={e => setForm(p => ({ ...p, ard_day: e.target.value }))}
                placeholder="e.g. 30" />
            </div>
            <div className="f-group">
              <label className="f-label">B1 Filing Deadline</label>
              <div style={{ padding: "7px 9px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 2, fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
                {ardDeadline}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Invoice & Credit Note Settings ── */}
      <div className="card" style={{ marginBottom: 13 }}>
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="card-title">Invoice & Credit Note Settings</span>
          <button className="btn btn-s btn-sm" onClick={saveInvSettings} disabled={invSetSaving}>
            {invSetSaved ? 'Saved ✓' : invSetSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
        <div style={{ padding: '16px 15px' }}>
          {/* Logo */}
          <div style={{ marginBottom: 14 }}>
            <label className="f-label">Company Logo</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
              {invSetForm.logo_url && <img src={invSetForm.logo_url} alt="Logo" style={{ height: 48, maxWidth: 120, objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 4, padding: 4, background: '#fff' }} />}
              <label style={{ cursor: 'pointer' }}>
                <span className="btn btn-s btn-sm">{logoUploading ? 'Uploading…' : invSetForm.logo_url ? 'Change logo' : 'Upload logo'}</span>
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
              </label>
              {invSetForm.logo_url && <button className="btn btn-d btn-sm" onClick={() => setInvSetForm(p => ({ ...p, logo_url: '' }))}>Remove</button>}
            </div>
          </div>
          <div className="f-row">
            <div className="f-group" style={{ gridColumn: 'span 2' }}>
              <label className="f-label">Trading Name (on invoices)</label>
              <input className="f-input" value={invSetForm.trading_name} onChange={e => setInvSetForm(p => ({ ...p, trading_name: e.target.value }))} placeholder="Leave blank to use company name" />
            </div>
            <div className="f-group">
              <label className="f-label">Default Payment Terms (days)</label>
              <input className="f-input" type="number" min="0" value={invSetForm.payment_terms} onChange={e => setInvSetForm(p => ({ ...p, payment_terms: e.target.value }))} />
            </div>
          </div>
          <div className="f-row">
            <div className="f-group">
              <label className="f-label">VAT Number (on invoices)</label>
              <input className="f-input" value={invSetForm.vat_number} onChange={e => setInvSetForm(p => ({ ...p, vat_number: e.target.value }))} placeholder="IE 1234567A" />
            </div>
            <div className="f-group">
              <label className="f-label">Company Reg. Number</label>
              <input className="f-input" value={invSetForm.reg_number} onChange={e => setInvSetForm(p => ({ ...p, reg_number: e.target.value }))} placeholder="e.g. 123456" />
            </div>
          </div>
          <div className="f-row" style={{ gridTemplateColumns: '1fr' }}>
            <div className="f-group">
              <label className="f-label">Business Address</label>
              <textarea className="f-input" rows={3} value={invSetForm.address} onChange={e => setInvSetForm(p => ({ ...p, address: e.target.value }))} placeholder={'Address line 1\nAddress line 2\nCity, County'} style={{ resize: 'vertical' }} />
            </div>
          </div>
          <div className="f-row" style={{ gridTemplateColumns: '1fr' }}>
            <div className="f-group">
              <label className="f-label">Bank / Payment Details</label>
              <textarea className="f-input" rows={3} value={invSetForm.bank_details} onChange={e => setInvSetForm(p => ({ ...p, bank_details: e.target.value }))} placeholder={'IBAN: IE29 AIBK 9311 5212 3456 78\nBIC: AIBKIE2D'} style={{ resize: 'vertical' }} />
            </div>
          </div>
          <div className="f-row" style={{ gridTemplateColumns: '1fr' }}>
            <div className="f-group">
              <label className="f-label">Footer / Notes (appears on all invoices)</label>
              <textarea className="f-input" rows={2} value={invSetForm.footer_notes} onChange={e => setInvSetForm(p => ({ ...p, footer_notes: e.target.value }))} placeholder="e.g. Thank you for your business." style={{ resize: 'vertical' }} />
            </div>
          </div>
          <div style={{ marginTop: 14, marginBottom: 8, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: 12 }}>Statutory Statements</div>
          <div className="f-row" style={{ gridTemplateColumns: '1fr' }}>
            <div className="f-group">
              <label className="f-label">RCT — Relevant Contracts Tax</label>
              <textarea className="f-input" rows={3} value={invSetForm.stmt_rct} onChange={e => setInvSetForm(p => ({ ...p, stmt_rct: e.target.value }))} style={{ resize: 'vertical', fontSize: 12 }} />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>On credit notes, "This invoice" is automatically replaced with "This credit note".</div>
            </div>
          </div>
          <div className="f-row" style={{ gridTemplateColumns: '1fr' }}>
            <div className="f-group">
              <label className="f-label">EU B2B Reverse Charge</label>
              <textarea className="f-input" rows={2} value={invSetForm.stmt_rc_eu} onChange={e => setInvSetForm(p => ({ ...p, stmt_rc_eu: e.target.value }))} style={{ resize: 'vertical', fontSize: 12 }} />
            </div>
          </div>
          <div className="f-row" style={{ gridTemplateColumns: '1fr' }}>
            <div className="f-group">
              <label className="f-label">VAT Exempt</label>
              <textarea className="f-input" rows={2} value={invSetForm.stmt_exempt} onChange={e => setInvSetForm(p => ({ ...p, stmt_exempt: e.target.value }))} style={{ resize: 'vertical', fontSize: 12 }} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Team Members ── */}
      <div className="card" style={{ marginBottom: 13 }}>
        <div className="card-header">
          <span className="card-title">Team Access</span>
          {company?.clerk_org_id && (
            <span style={{ fontSize: 10, fontFamily: "Source Code Pro, monospace", color: "var(--teal)", background: "rgba(29,107,114,0.08)", padding: "2px 8px", borderRadius: 20, border: "1px solid rgba(29,107,114,0.2)" }}>
              Multi-user enabled
            </span>
          )}
        </div>
        <div style={{ padding: "16px 15px" }}>
          {!company?.clerk_org_id ? (
            <div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12, lineHeight: 1.6 }}>
                Enable team access to invite colleagues to this workspace. Admins have full access; members can view all reports and add invoices and bank imports, but cannot post journals.
              </div>
              <button className="btn btn-p btn-sm" onClick={enableTeam} disabled={creatingOrg || !company?.id}>
                {creatingOrg ? "Setting up…" : "Enable Team Access"}
              </button>
              {creatingOrgError && (
                <div style={{ marginTop: 10, fontSize: 12, color: "var(--red)", lineHeight: 1.6, maxWidth: 480 }}>
                  ✗ {creatingOrgError}
                </div>
              )}
            </div>
          ) : (
            <div>
              <div style={{ marginBottom: 16 }}>
                <div className="f-label" style={{ marginBottom: 7 }}>Invite colleague by email</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <input className="f-input" style={{ flex: 1, minWidth: 200 }} placeholder="colleague@company.ie"
                    value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && sendInvite()} />
                  <select className="f-input" style={{ width: 130 }} value={inviteRole} onChange={e => setInviteRole(e.target.value)}>
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button className="btn btn-p btn-sm" onClick={sendInvite} disabled={inviting || !inviteEmail.trim()}>
                    {inviting ? "Sending…" : "Send Invite"}
                  </button>
                </div>
                {inviteMsg && (
                  <div style={{ marginTop: 8, fontSize: 12, color: inviteMsg.ok ? "var(--green)" : "var(--red)" }}>
                    {inviteMsg.ok ? "✓ " : "✗ "}{inviteMsg.text}
                  </div>
                )}
                <div style={{ marginTop: 7, fontSize: 11, color: "var(--dim)", lineHeight: 1.5 }}>
                  <strong>Admin</strong> — full access including posting journals. <strong>Member</strong> — read-only journals and GL reports; can add invoices and import bank transactions.
                </div>
              </div>
              <div className="f-label" style={{ marginBottom: 8 }}>Current Members</div>
              {membersLoading ? (
                <div style={{ fontSize: 12, color: "var(--dim)" }}>Loading members…</div>
              ) : members.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--dim)" }}>No team members yet. Send an invitation above.</div>
              ) : (
                <div>
                  {members.map((m, i) => {
                    const name = m.public_user_data?.first_name
                      ? `${m.public_user_data.first_name} ${m.public_user_data.last_name || ''}`.trim()
                      : m.public_user_data?.identifier || "—";
                    const email = m.public_user_data?.identifier || "";
                    const initials = name[0]?.toUpperCase() || "?";
                    const isAdmin = m.role === 'org:admin';
                    return (
                      <div key={i} style={{ display: "flex", alignItems: "center", padding: "9px 0", borderBottom: "1px solid var(--border)", gap: 10 }}>
                        <div style={{ width: 30, height: 30, borderRadius: 6, background: "rgba(29,107,114,0.1)", border: "1px solid rgba(29,107,114,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "var(--teal)", flexShrink: 0 }}>
                          {initials}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>{name}</div>
                          {email && email !== name && <div style={{ fontSize: 10, fontFamily: "Source Code Pro, monospace", color: "var(--dim)" }}>{email}</div>}
                        </div>
                        <span style={{ fontSize: 10, fontFamily: "Source Code Pro, monospace", color: isAdmin ? "var(--teal)" : "var(--muted)", background: isAdmin ? "rgba(29,107,114,0.08)" : "var(--surface2)", padding: "2px 9px", borderRadius: 20, border: "1px solid var(--border)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                          {isAdmin ? "Admin" : "Member"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Prior Year Data ── */}
      <div className="card" style={{ marginBottom: 13 }}>
        <div className="card-header">
          <span className="card-title">Prior Year Data</span>
          {pyMeta && (
            <span style={{ fontSize: 10, fontFamily: "Source Code Pro, monospace", color: "var(--teal)", background: "rgba(29,107,114,0.08)", padding: "2px 8px", borderRadius: 20, border: "1px solid rgba(29,107,114,0.2)" }}>
              {pyMeta.count} accounts loaded
            </span>
          )}
        </div>
        <div style={{ padding: "16px 15px" }}>
          {pyMeta ? (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
                <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "10px 13px" }}>
                  <div style={{ fontSize: 10, color: "var(--dim)", fontFamily: "Source Code Pro, monospace", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.07em" }}>Year End Date</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{fmtIE(pyMeta.year_end_date)}</div>
                </div>
                <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "10px 13px" }}>
                  <div style={{ fontSize: 10, color: "var(--dim)", fontFamily: "Source Code Pro, monospace", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.07em" }}>Accounts</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{pyMeta.count} rows</div>
                </div>
                <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "10px 13px" }}>
                  <div style={{ fontSize: 10, color: "var(--dim)", fontFamily: "Source Code Pro, monospace", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.07em" }}>Uploaded</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{fmtIE(pyMeta.created_at?.slice(0, 10))}</div>
                </div>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10, lineHeight: 1.5 }}>
                Prior year figures are shown as a comparison column on the P&L report. To replace this data, delete it and upload a new file.
              </div>
              {pyConfirmDelete ? (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "var(--red)" }}>Delete all prior year data?</span>
                  <button className="btn btn-d btn-sm" onClick={deletePY}>Yes, Delete</button>
                  <button className="btn btn-s btn-sm" onClick={() => setPyConfirmDelete(false)}>Cancel</button>
                </div>
              ) : (
                <button className="btn btn-d btn-sm" onClick={() => setPyConfirmDelete(true)}>Delete Prior Year Data</button>
              )}
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12, lineHeight: 1.6 }}>
                Upload a prior year trial balance CSV to show a comparison column in GL Reports P&L. Once uploaded, prior year figures will appear alongside current year figures.
              </div>
              <div style={{ fontSize: 12, color: "var(--dim)", marginBottom: 14, fontFamily: "Source Code Pro, monospace", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "10px 13px", lineHeight: 1.8 }}>
                CSV format: <strong>Account Code, Account Name, Debit Balance, Credit Balance</strong><br />
                Example: <span style={{ color: "var(--accent)" }}>4000,Sales Revenue,0,125000</span><br />
                Header row is optional — first row is skipped if column 1 is not a number.
              </div>
              <div className="f-row" style={{ marginBottom: 12 }}>
                <div className="f-group">
                  <label className="f-label">Prior Year End Date</label>
                  <input type="date" className="f-input" value={pyYearEndDate} onChange={e => { setPyYearEndDate(e.target.value); setPyUploadError(null); }} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: pyYearEndDate ? "pointer" : "not-allowed" }}>
                  <input type="file" accept=".csv,text/csv" style={{ display: "none" }}
                    disabled={!pyYearEndDate || pyUploading}
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = ev => uploadPY(ev.target.result);
                      reader.readAsText(file);
                      e.target.value = "";
                    }}
                  />
                  <span className={`btn btn-p btn-sm${!pyYearEndDate || pyUploading ? " btn-disabled" : ""}`}
                    style={{ opacity: !pyYearEndDate ? 0.45 : 1 }}>
                    {pyUploading ? "Uploading…" : "Upload CSV"}
                  </span>
                </label>
                {!pyYearEndDate && <span style={{ fontSize: 11, color: "var(--dim)", fontFamily: "Source Code Pro, monospace" }}>Select year end date first</span>}
              </div>
              {pyUploadError && (
                <div style={{ marginTop: 10, fontSize: 12, color: "var(--red)", lineHeight: 1.5 }}>✗ {pyUploadError}</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── AP Mailbox ── */}
      {company?.mailbox_slug && (() => {
        const mailboxAddr = `bills-${company.mailbox_slug}@inbound.ledgrly.ie`;
        return (
          <div className="card" style={{ marginBottom: 13 }}>
            <div className="card-header">
              <span className="card-title">AP Mailbox</span>
              <span style={{ fontSize: 10, fontFamily: "Source Code Pro, monospace", color: "var(--dim)" }}>INBOUND EMAIL</span>
            </div>
            <div style={{ padding: "14px 16px" }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.6 }}>
                Forward supplier invoices to this address — they land in the AP review queue automatically.
                <br />
                <span style={{ color: "var(--text-faint)" }}>
                  Tip: set up an auto-forward rule in Gmail or Outlook so any invoice that arrives in your inbox gets forwarded here without manual steps.
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <code style={{ fontSize: 13, fontFamily: "Source Code Pro, monospace", color: "var(--accent)", background: "var(--surface-2)", padding: "6px 12px", borderRadius: 4, border: "1px solid var(--border)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {mailboxAddr}
                </code>
                <button className="btn btn-s btn-sm" style={{ flexShrink: 0 }} onClick={() => {
                  navigator.clipboard?.writeText(mailboxAddr);
                }}>Copy</button>
              </div>
              <div style={{ marginTop: 10, fontSize: 11, color: "var(--text-faint)", lineHeight: 1.6, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <span>Supported: PDF, JPEG, PNG, WebP attachments.</span>
                <button
                  className="btn btn-s btn-sm"
                  style={{ flexShrink: 0, opacity: slugResetting ? 0.5 : 1 }}
                  disabled={slugResetting}
                  onClick={async () => {
                    if (slugResetting) return;
                    setSlugResetting(true);
                    const { data: newSlug, error: rErr } = await supabase.rpc('regenerate_mailbox_slug', { p_company_id: company.id });
                    if (!rErr && newSlug) {
                      const updated = { ...company, mailbox_slug: newSlug };
                      onUpdate(updated);
                    }
                    setSlugResetting(false);
                  }}
                >
                  {slugResetting ? "Resetting…" : "Reset address"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Transaction Rules ── */}
      <div className="card" style={{ marginBottom: 13 }}>
        <div className="card-header">
          <span className="card-title">Transaction Rules</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 10, fontFamily: "Source Code Pro, monospace", color: "var(--dim)" }}>
              {companyRules.length} company · {systemRules.length} system
            </span>
            <button className="btn btn-p btn-sm" onClick={() => setRuleForm({ pattern: "", match_type: "contains", direction: "out", nominal_code: "6600" })}>
              + Add Rule
            </button>
          </div>
        </div>
        <div style={{ padding: "12px 15px" }}>
          {/* Add Rule Form */}
          {ruleForm && (
            <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "12px", marginBottom: 14 }}>
              <div className="f-label" style={{ marginBottom: 8 }}>New Rule</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 100px 1fr", gap: 8, marginBottom: 10 }}>
                <div><label className="f-label">Pattern</label>
                  <input className="f-input" placeholder="e.g. acme corp" value={ruleForm.pattern}
                    onChange={e => setRuleForm(p => ({ ...p, pattern: e.target.value }))} /></div>
                <div><label className="f-label">Match Type</label>
                  <select className="f-input" value={ruleForm.match_type} onChange={e => setRuleForm(p => ({ ...p, match_type: e.target.value }))}>
                    <option value="contains">Contains</option>
                    <option value="startswith">Starts with</option>
                    <option value="exact">Exact</option>
                    <option value="regex">Regex</option>
                  </select></div>
                <div><label className="f-label">Direction</label>
                  <select className="f-input" value={ruleForm.direction} onChange={e => setRuleForm(p => ({ ...p, direction: e.target.value }))}>
                    <option value="out">Expense</option>
                    <option value="in">Income</option>
                    <option value="both">Both</option>
                  </select></div>
                <div><label className="f-label">Nominal Account</label>
                  <select className="f-input" value={ruleForm.nominal_code} onChange={e => setRuleForm(p => ({ ...p, nominal_code: e.target.value }))}>
                    {GL_ACCOUNTS.map(a => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
                  </select></div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-p btn-sm" onClick={addRule} disabled={ruleSaving || !ruleForm.pattern.trim()}>{ruleSaving ? "Saving…" : "Save Rule"}</button>
                <button className="btn btn-s btn-sm" onClick={() => setRuleForm(null)}>Cancel</button>
              </div>
            </div>
          )}
          {/* Company Rules */}
          {companyRules.length === 0 && !ruleForm ? (
            <div style={{ fontSize: 12, color: "var(--dim)", marginBottom: 10 }}>No company-specific rules yet. Add one above or override a system rule.</div>
          ) : (
            companyRules.length > 0 && (
              <table className="gl-table" style={{ marginBottom: 12 }}>
                <thead><tr><th>Pattern</th><th>Type</th><th>Dir</th><th>Nominal</th><th>Source</th><th style={{ width: 80 }}>Active</th><th style={{ width: 70 }}></th></tr></thead>
                <tbody>
                  {companyRules.map(r => (
                    <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.45 }}>
                      <td className="mono" style={{ fontSize: 11 }}>{r.pattern}</td>
                      <td><span style={{ fontSize: 10, fontFamily: "Source Code Pro, monospace", color: "var(--dim)" }}>{r.match_type}</span></td>
                      <td><span style={{ fontSize: 10, fontFamily: "Source Code Pro, monospace", color: r.direction === "in" ? "var(--teal)" : "var(--muted)" }}>{r.direction}</span></td>
                      <td style={{ fontSize: 12 }}>{r.nominal_code} · {r.nominal_name}</td>
                      <td><span style={{ fontSize: 10, fontFamily: "Source Code Pro, monospace", color: r.source === "user" ? "var(--accent)" : "var(--text-faint)" }}>{r.source}</span></td>
                      <td>
                        <button onClick={() => toggleRule(r.id, r.is_active)} className="btn btn-s btn-sm" style={{ fontSize: 10, padding: "2px 8px" }}>
                          {r.is_active ? "On" : "Off"}
                        </button>
                      </td>
                      <td>
                        {ruleConfirmDelete === r.id ? (
                          <div style={{ display: "flex", gap: 4 }}>
                            <button className="btn btn-d btn-sm" style={{ fontSize: 10 }} onClick={() => deleteRule(r.id)}>Del</button>
                            <button className="btn btn-s btn-sm" style={{ fontSize: 10 }} onClick={() => setRuleConfirmDelete(null)}>No</button>
                          </div>
                        ) : (
                          <button className="btn btn-d btn-sm" style={{ fontSize: 10, padding: "2px 8px" }} onClick={() => setRuleConfirmDelete(r.id)}>Delete</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
          {/* System Rules (collapsible) */}
          <button className="btn btn-s btn-sm" style={{ fontSize: 10, marginBottom: showSystemRules ? 8 : 0 }}
            onClick={() => setShowSystemRules(s => !s)}>
            {showSystemRules ? "Hide" : "Show"} {systemRules.length} system rules
          </button>
          {showSystemRules && (
            <table className="gl-table" style={{ marginTop: 8 }}>
              <thead><tr><th>Pattern</th><th>Type</th><th>Dir</th><th>Nominal</th></tr></thead>
              <tbody>
                {systemRules.map(r => (
                  <tr key={r.id} style={{ opacity: 0.7 }}>
                    <td className="mono" style={{ fontSize: 11 }}>{r.pattern}</td>
                    <td><span style={{ fontSize: 10, fontFamily: "Source Code Pro, monospace", color: "var(--dim)" }}>{r.match_type}</span></td>
                    <td><span style={{ fontSize: 10, fontFamily: "Source Code Pro, monospace", color: r.direction === "in" ? "var(--teal)" : "var(--muted)" }}>{r.direction}</span></td>
                    <td style={{ fontSize: 12 }}>{r.nominal_code} · {r.nominal_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Chart of Accounts ── */}
      <div className="card" style={{ marginBottom: 13, maxWidth: "100%" }}>
        <div className="card-header">
          <span className="card-title">Chart of Accounts</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input className="f-input" style={{ width: 180, fontSize: 12, padding: "4px 9px" }}
              placeholder="Search…" value={coaSearch} onChange={e => setCoaSearch(e.target.value)} />
            <button className="btn btn-p btn-sm"
              onClick={() => setCoaForm({ code: "", name: "", account_type: "expense", category: "" })}>
              + Add Account
            </button>
          </div>
        </div>

        {coaForm && (
          <div style={{ padding: "12px 15px", borderBottom: "1px solid var(--border)", background: "rgba(26,39,68,0.02)" }}>
            <div className="f-row" style={{ gridTemplateColumns: "90px 1fr 120px 1fr" }}>
              <div className="f-group"><label className="f-label">Code</label><input className="f-input" value={coaForm.code} onChange={e => setCoaForm(p => ({ ...p, code: e.target.value }))} placeholder="7000" /></div>
              <div className="f-group"><label className="f-label">Name</label><input className="f-input" value={coaForm.name} onChange={e => setCoaForm(p => ({ ...p, name: e.target.value }))} placeholder="Account name" /></div>
              <div className="f-group">
                <label className="f-label">Type</label>
                <select className="f-input" value={coaForm.account_type} onChange={e => setCoaForm(p => ({ ...p, account_type: e.target.value }))}>
                  {["asset","liability","equity","income","expense"].map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
                </select>
              </div>
              <div className="f-group"><label className="f-label">Category</label><input className="f-input" value={coaForm.category} onChange={e => setCoaForm(p => ({ ...p, category: e.target.value }))} placeholder="e.g. Overheads" /></div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-p btn-sm" onClick={coaAdd} disabled={coaSaving || !coaForm.code || !coaForm.name}>{coaSaving ? "Saving…" : "Save Account"}</button>
              <button className="btn btn-s btn-sm" onClick={() => setCoaForm(null)}>Cancel</button>
            </div>
          </div>
        )}

        {coa.some(a => a._static) && (
          <div style={{ padding: "10px 15px", background: "rgba(184,134,11,0.06)", borderBottom: "1px solid rgba(184,134,11,0.2)", fontSize: 12, color: "var(--gold)", display: "flex", alignItems: "center", gap: 8 }}>
            <span>⚠</span>
            <span>Showing built-in accounts — database table not yet created. Run the <strong>chart_of_accounts</strong> SQL migration in Supabase to enable editing. Check the browser console for details.</span>
          </div>
        )}
        {coaLoading ? (
          <div style={{ padding: "16px", fontSize: 12, color: "var(--dim)" }}>Loading chart of accounts…</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="gl-table" style={{ minWidth: 560 }}>
              <thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Category</th><th style={{ textAlign: "center" }}>Active</th><th></th></tr></thead>
              <tbody>
                {["asset","liability","equity","income","expense"].flatMap(typeKey => {
                  const rows = filteredCoa.filter(a => a.account_type === typeKey);
                  if (!rows.length) return [];
                  const typeLabel = { asset:"Assets", liability:"Liabilities", equity:"Equity", income:"Income", expense:"Expenses" }[typeKey];
                  const typeColour = { asset:"var(--accent)", liability:"var(--danger)", equity:"var(--info)", income:"var(--accent)", expense:"var(--warn)" }[typeKey];
                  return [
                    <tr key={`hdr-${typeKey}`} style={{ background: "var(--surface2)" }}>
                      <td colSpan={6} style={{ fontSize: 11, fontWeight: 700, color: typeColour, padding: "5px 12px" }}>
                        <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: typeColour, marginRight: 7, verticalAlign: "middle" }} />{typeLabel}
                      </td>
                    </tr>,
                    ...rows.map(a => (
                      <tr key={a.id} style={{ opacity: a.is_active ? 1 : 0.45 }}>
                        <td className="mono" style={{ color: "var(--accent)", fontWeight: 600 }}>{a.code}</td>
                        <td>
                          {coaEdit === a.id
                            ? <input className="f-input" style={{ padding: "3px 7px", fontSize: 12 }} value={coaEditForm.name} onChange={e => setCoaEditForm(p => ({ ...p, name: e.target.value }))} />
                            : <span style={{ fontSize: 12 }}>{a.name}</span>}
                          {a.is_system && <span style={{ marginLeft: 7, fontSize: 9, fontFamily: "Source Code Pro, monospace", color: "var(--dim)", background: "var(--surface2)", padding: "1px 6px", borderRadius: 2, border: "1px solid var(--border)" }}>system</span>}
                        </td>
                        <td style={{ fontSize: 11, textTransform: "capitalize", color: "var(--muted)" }}>{a.account_type}</td>
                        <td>
                          {coaEdit === a.id
                            ? <input className="f-input" style={{ padding: "3px 7px", fontSize: 12 }} value={coaEditForm.category} onChange={e => setCoaEditForm(p => ({ ...p, category: e.target.value }))} />
                            : <span style={{ fontSize: 11, color: "var(--muted)" }}>{a.category || "—"}</span>}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <button onClick={() => !coaIsStatic(a) && coaToggleActive(a.id, a.is_active)}
                            title={coaIsStatic(a) ? "Run SQL migration to enable" : (a.is_active ? "Deactivate" : "Activate")}
                            style={{ width: 34, height: 18, borderRadius: 9, border: "none", cursor: coaIsStatic(a) ? "not-allowed" : "pointer", background: a.is_active ? "var(--teal)" : "var(--border2)", transition: "background 0.2s", position: "relative", flexShrink: 0, opacity: coaIsStatic(a) ? 0.4 : 1 }}>
                            <span style={{ position: "absolute", top: 2, left: a.is_active ? 18 : 2, width: 14, height: 14, borderRadius: "50%", background: "white", transition: "left 0.2s" }} />
                          </button>
                        </td>
                        <td style={{ paddingRight: 10 }}>
                          {!coaIsStatic(a) && (
                            <div style={{ display: "flex", gap: 5 }}>
                              {coaEdit === a.id ? (
                                <><button className="btn btn-p btn-sm" onClick={() => coaSaveEdit(a.id)} disabled={coaSaving}>Save</button><button className="btn btn-s btn-sm" onClick={() => setCoaEdit(null)}>Cancel</button></>
                              ) : (
                                <><button className="btn btn-s btn-sm" onClick={() => { setCoaEdit(a.id); setCoaEditForm({ name: a.name, category: a.category || "" }); }}>Edit</button>
                                {!a.is_system && (coaConfirmDelete === a.id
                                  ? <><button className="btn btn-d btn-sm" onClick={() => coaDelete(a.id)}>Confirm</button><button className="btn btn-s btn-sm" onClick={() => setCoaConfirmDelete(null)}>No</button></>
                                  : <button className="btn btn-d btn-sm" onClick={() => setCoaConfirmDelete(a.id)}>Delete</button>)}</>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {error && (
        <div style={{ marginBottom: 12, fontSize: 12, color: "var(--red)", background: "rgba(139,32,32,0.06)", border: "1px solid rgba(139,32,32,0.2)", borderRadius: 2, padding: "9px 13px" }}>
          {error}
        </div>
      )}
      {saved && (
        <div style={{ marginBottom: 12, fontSize: 12, color: "var(--green)", background: "rgba(26,92,53,0.07)", border: "1px solid rgba(26,92,53,0.2)", borderRadius: 2, padding: "9px 13px" }}>
          ✓ Settings saved successfully.
        </div>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn btn-p" onClick={save}
          disabled={!valid || saving || !company?.id}
          style={{ opacity: (!valid || !company?.id) ? 0.45 : 1 }}>
          {saving ? "Saving…" : "Save Settings"}
        </button>
        <button className="btn btn-s" onClick={() => { setForm(blank()); setError(null); setSaved(false); }}>
          Reset
        </button>
      </div>
    </div>
  );
}

function FinancialStatements({ company, companyName }) {
  const baseCurrency = company?.base_currency || company?.currency || "EUR";
  const fmt    = (n) => fmtCurrency(n, baseCurrency);
  const fmtEUR = (n) => fmtCurrencyFull(n, baseCurrency);

  const [loading,   setLoading]   = useState(false);
  const [generated, setGenerated] = useState(false);
  const [journals,  setJournals]  = useState([]);
  const [regNumber,   setRegNumber]   = useState("");
  const [dirRemun,    setDirRemun]    = useState("");
  const [regAddress,  setRegAddress]  = useState("");
  const [directors,   setDirectors]   = useState("");
  const [accountants, setAccountants] = useState("");

  const yeMonth = company?.year_end_month || 12;
  const yearEndOptions = (() => {
    const now = new Date();
    const thisYE = new Date(now.getFullYear(), yeMonth, 0);
    const startYear = thisYE <= now ? now.getFullYear() : now.getFullYear() - 1;
    return Array.from({ length: 3 }, (_, i) => {
      const y = startYear - i;
      const d = new Date(y, yeMonth, 0);
      return {
        val: d.toISOString().slice(0, 10),
        label: d.toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric" }),
      };
    });
  })();
  const [yearEnd, setYearEnd] = useState(yearEndOptions[0]?.val || "");

  const generate = async () => {
    if (!company?.id) return;
    setLoading(true);
    const { data } = await supabase.from('journals')
      .select('*').eq('company_id', company.id).lte('date', yearEnd).order('date');
    setJournals(data || []);
    setGenerated(true);
    setLoading(false);
  };

  const rawD = {}, rawC = {};
  journals.forEach(j => {
    const a = Number(j.amount);
    rawD[j.debit_account]  = (rawD[j.debit_account]  || 0) + a;
    rawC[j.credit_account] = (rawC[j.credit_account] || 0) + a;
  });
  const allCodes = [...new Set([...Object.keys(rawD), ...Object.keys(rawC)])];
  const acctBal = code => {
    const d = rawD[code] || 0, c = rawC[code] || 0;
    const t = GL_ACCOUNTS.find(a => a.code === code)?.type || '';
    return (t === 'Liability' || t === 'Equity' || t === 'Income') ? c - d : d - c;
  };
  const sumRng = (f, t) => allCodes.filter(c => c >= f && c <= t).reduce((s, c) => s + acctBal(c), 0);

  // Balance sheet figures
  // 1000-1099 = Bank accounts (cash), 1100-1299 = Debtors + Prepayments, 1500-1599 = Fixed assets
  const fixedAssets   = sumRng("1500", "1599");
  const debtors       = sumRng("1100", "1299");
  const cashAtBank    = sumRng("1000", "1099");
  const currAssets    = debtors + cashAtBank;
  const creditors     = sumRng("2000", "2399");
  const netCurrAssets = currAssets - creditors;
  const totAssetsLCL  = fixedAssets + netCurrAssets;
  const shareCapital  = sumRng("3000", "3099");
  const retainedEarns = totAssetsLCL - shareCapital; // balancing figure

  // P&L figures
  const turnover    = sumRng("4000", "4999");
  const cos         = sumRng("5000", "5999");
  const grossProfit = turnover - cos;
  const adminExp    = sumRng("6000", "6999");
  const opProfit    = grossProfit - adminExp;
  const interest    = allCodes.filter(c => c >= "7000" && c <= "7999")
    .reduce((s, c) => s + ((rawC[c] || 0) - (rawD[c] || 0)), 0);
  const pbt     = opProfit + interest;
  const pfYear  = pbt;

  useEffect(() => {
    if (!generated || allCodes.length === 0) return;
    console.group("[FinancialStatements] Balance Sheet codes");
    allCodes.slice().sort().forEach(c => {
      const d = rawD[c] || 0, cr = rawC[c] || 0;
      if (d || cr) console.log(`  ${c}: D=${d.toFixed(2)} C=${cr.toFixed(2)} net=${acctBal(c).toFixed(2)}`);
    });
    console.log(`  cash=${cashAtBank.toFixed(2)} debtors=${debtors.toFixed(2)} fixed=${fixedAssets.toFixed(2)} creditors=${creditors.toFixed(2)} capital=${shareCapital.toFixed(2)} totalALC=${totAssetsLCL.toFixed(2)} turnover=${turnover.toFixed(2)} opProfit=${opProfit.toFixed(2)}`);
    console.groupEnd();
  }, [journals]); // eslint-disable-line react-hooks/exhaustive-deps

  const yeDate  = new Date(yearEnd + "T00:00:00");
  const yeFmt   = yeDate.toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric" });
  const yeYear  = yeDate.getFullYear();
  const expDate = fmtIE(new Date().toISOString().slice(0, 10));

  // Format as statutory amount: negatives bracketed, zero as dash
  const fa = n => {
    if (n === null || n === undefined) return "";
    if (Math.round(Math.abs(n)) === 0) return "—";
    const v = Math.round(Math.abs(n));
    const s = "€" + v.toLocaleString("en-IE");
    return n < 0 ? `(${s})` : s;
  };

  // Inline row renderer: label | col1 (sub-amounts) | col2 (totals/bold)
  const fsRow = (label, { c1, c2, bold, indent = 0, top1, top2, dbl, note } = {}) => (
    <div style={{ display: "flex", padding: "4px 0", paddingLeft: indent * 22, fontSize: 13, fontWeight: bold ? 600 : 400 }}>
      <span style={{ flex: 1, color: "var(--text)" }}>
        {label}{note !== undefined && <sup style={{ fontSize: 9, color: "var(--muted)", marginLeft: 3 }}>{note}</sup>}
      </span>
      <span style={{ width: 90, textAlign: "right", fontFamily: "'Source Code Pro',monospace", fontSize: 12, marginRight: 14, borderTop: top1 ? "1px solid var(--border2)" : undefined }}>
        {c1 !== undefined ? fa(c1) : ""}
      </span>
      <span style={{ width: 90, textAlign: "right", fontFamily: "'Source Code Pro',monospace", fontSize: 12, fontWeight: top2 || dbl ? 700 : undefined, borderTop: dbl ? "2px solid var(--text)" : top2 ? "1px solid var(--border2)" : undefined, borderBottom: dbl ? "2px solid var(--text)" : undefined }}>
        {c2 !== undefined ? fa(c2) : ""}
      </span>
    </div>
  );
  const fsHead = (text, sub) => (
    <div style={{ marginTop: 18, marginBottom: 6 }}>
      <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text)" }}>{text}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>{sub}</div>}
    </div>
  );
  const fsDivider = () => <div style={{ borderTop: "1px solid var(--border)", margin: "6px 0" }} />;
  const amtCols = () => (
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4, fontSize: 10, fontFamily: "'Source Code Pro',monospace", color: "var(--dim)" }}>
      <span style={{ width: 90, textAlign: "right", marginRight: 14 }}>€</span>
      <span style={{ width: 90, textAlign: "right" }}>€</span>
    </div>
  );

  const exportCSV = () => downloadCSV(`frs105-${yeYear}.csv`, [
    ["FRS 105 Financial Statements", companyName, `Year ended ${yeFmt}`],
    ["Company Registration No.", regNumber || "—"],
    ["Exported", expDate],
    [],
    ["PROFIT AND LOSS ACCOUNT FOR YEAR ENDED", yeFmt],
    [], [" ", "€", "€"],
    ["Turnover", "", fa(turnover)],
    cos > 0 ? ["Cost of Sales", fa(cos), ""] : [],
    cos > 0 ? ["Gross Profit", "", fa(grossProfit)] : [],
    adminExp > 0 ? ["Administrative Expenses", fa(adminExp), ""] : [],
    ["Operating Profit", "", fa(opProfit)],
    interest !== 0 ? [interest > 0 ? "Interest receivable" : "Interest payable", fa(Math.abs(interest)), ""] : [],
    ["Profit before tax", "", fa(pbt)],
    ["Tax on profit", "", "—"],
    ["Profit for the financial year", "", fa(pfYear)],
    [],
    ["BALANCE SHEET AS AT", yeFmt],
    [], [" ", "€", "€"],
    ["Fixed Assets", "", fa(fixedAssets)],
    ["Current Assets — Debtors", fa(debtors), ""],
    ["Current Assets — Cash at bank and in hand", fa(cashAtBank), ""],
    ["Total Current Assets", "", fa(currAssets)],
    ["Creditors: amounts falling due within one year", "", creditors > 0 ? `(${fa(creditors)})` : "—"],
    ["Net Current Assets", "", fa(netCurrAssets)],
    ["Total Assets less Current Liabilities", "", fa(totAssetsLCL)],
    [],
    ["Capital and Reserves"],
    ["Called up share capital", fa(shareCapital), ""],
    ["Profit and loss account", fa(retainedEarns), ""],
    ["Total Capital and Reserves", "", fa(totAssetsLCL)],
    [],
    ["Directors' Remuneration", dirRemun ? fmtEUR(parseFloat(dirRemun)) : "—"],
    [],
    ["Note: These statements should be reviewed by a qualified accountant before CRO filing."],
  ].filter(r => r.length));

  // ── Setup screen ──
  if (!generated) return (
    <div className="fade-up">
      <div className="card" style={{ maxWidth: 560, margin: "32px auto" }}>
        <div className="card-header">
          <span className="card-title">FRS 105 — Micro-Entity Financial Statements</span>
        </div>
        <div className="card-body">
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{companyName}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
              Micro-entity financial statements prepared under FRS 105 — The Financial Reporting Standard applicable to the Micro-entities Regime.
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <div className="f-group">
              <label className="f-label">Year End</label>
              <select className="f-input" value={yearEnd} onChange={e => setYearEnd(e.target.value)}>
                {yearEndOptions.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
              </select>
            </div>
            <div className="f-group">
              <label className="f-label">Company Registration No.</label>
              <input className="f-input" value={regNumber} onChange={e => setRegNumber(e.target.value)} placeholder="e.g. 123456" />
            </div>
          </div>
          <div className="f-group" style={{ marginBottom: 14 }}>
            <label className="f-label">Directors' Remuneration (€) — for Note 3</label>
            <input className="f-input" type="number" min="0" value={dirRemun} onChange={e => setDirRemun(e.target.value)} placeholder="0" />
          </div>
          <div className="f-group" style={{ marginBottom: 14 }}>
            <label className="f-label">Registered Address</label>
            <textarea className="f-input" rows={3} value={regAddress} onChange={e => setRegAddress(e.target.value)} placeholder="e.g. 1 Main Street, Dublin 2" style={{ resize: "vertical", minHeight: 60 }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 22 }}>
            <div className="f-group">
              <label className="f-label">Director(s)</label>
              <input className="f-input" value={directors} onChange={e => setDirectors(e.target.value)} placeholder="e.g. John Smith" />
            </div>
            <div className="f-group">
              <label className="f-label">Accountants / Firm</label>
              <input className="f-input" value={accountants} onChange={e => setAccountants(e.target.value)} placeholder="e.g. Murphy & Associates" />
            </div>
          </div>
          <button className="btn btn-p" onClick={generate} disabled={loading || !yearEnd} style={{ width: "100%", fontSize: 14, padding: "12px 20px" }}>
            {loading ? "Loading journal data…" : "Generate FRS 105 Statements"}
          </button>
        </div>
      </div>
    </div>
  );

  // ── Generated statements ──
  return (
    <div className="fade-up">
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 16, fontWeight: 700, color: "var(--text)" }}>
            {companyName} — FRS 105 Financial Statements
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "'Source Code Pro',monospace", marginTop: 2 }}>
            Year ended {yeFmt} · {journals.length} journal entries loaded
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <ExportDropdown onCSV={exportCSV} onPrint={() => window.print()} />
          <button className="btn btn-s btn-sm" onClick={() => setGenerated(false)}>← Settings</button>
        </div>
      </div>

      {/* Cover Page */}
      <div className="card" style={{ marginBottom: 14, pageBreakAfter: "always" }}>
        <div className="card-body" style={{ minHeight: 320, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center", padding: "48px 32px" }}>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 26, fontWeight: 700, marginBottom: 6 }}>{companyName}</div>
          {regNumber && <div style={{ fontSize: 12, color: "var(--muted)", fontFamily: "monospace", marginBottom: 4 }}>Company No. {regNumber}</div>}
          {regAddress && <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6, marginBottom: 16, maxWidth: 340, whiteSpace: "pre-line" }}>{regAddress}</div>}
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 18, fontWeight: 600, marginTop: 24, marginBottom: 6 }}>Financial Statements</div>
          <div style={{ fontSize: 14, color: "var(--muted)", marginBottom: 4 }}>for the year ended {yeFmt}</div>
          <div style={{ fontSize: 11, color: "var(--dim)", fontFamily: "monospace", marginTop: 6 }}>Prepared under FRS 105 — Micro-entities Regime</div>
          {accountants && <div style={{ marginTop: 28, paddingTop: 14, borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--muted)" }}><strong>Accountants:</strong> {accountants}</div>}
        </div>
      </div>

      {/* Directors' Report */}
      <div className="card" style={{ marginBottom: 14, pageBreakAfter: "always" }}>
        <div className="card-header">
          <span className="card-title">Directors' Report</span>
          <span style={{ fontSize: 10, fontFamily: "'Source Code Pro',monospace", color: "var(--muted)", letterSpacing: "0.06em" }}>FOR THE YEAR ENDED {yeFmt.toUpperCase()}</span>
        </div>
        <div className="card-body" style={{ fontSize: 13, lineHeight: 1.8, color: "var(--muted)" }}>
          <p>The directors present their annual report and the financial statements for the year ended {yeFmt}.</p>
          <p style={{ marginTop: 10 }}><strong style={{ color: "var(--text)" }}>Principal Activity:</strong> The principal activity of the company during the year was as registered with the Companies Registration Office.</p>
          <p style={{ marginTop: 10 }}><strong style={{ color: "var(--text)" }}>Results and Dividends:</strong> The profit for the financial year amounted to {fa(pfYear)}. The directors do not recommend the payment of a dividend.</p>
          <p style={{ marginTop: 10 }}><strong style={{ color: "var(--text)" }}>Future Developments:</strong> The directors do not anticipate any significant changes to the nature of the company's activities in the foreseeable future.</p>
          {directors && <p style={{ marginTop: 10 }}><strong style={{ color: "var(--text)" }}>Directors:</strong> {directors}</p>}
          <div style={{ marginTop: 32, paddingTop: 16, borderTop: "1px solid var(--border)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>
            <div>
              <div style={{ fontSize: 11, color: "var(--dim)", marginBottom: 32 }}>Signed on behalf of the Board</div>
              <div style={{ borderTop: "1px solid var(--muted)", paddingTop: 4, fontSize: 11, color: "var(--dim)" }}>Director</div>
              <div style={{ fontSize: 11, color: "var(--dim)", marginTop: 8 }}>Date: ___/___/_____</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--dim)", marginBottom: 32 }}>&nbsp;</div>
              <div style={{ borderTop: "1px solid var(--muted)", paddingTop: 4, fontSize: 11, color: "var(--dim)" }}>Director</div>
              <div style={{ fontSize: 11, color: "var(--dim)", marginTop: 8 }}>Date: ___/___/_____</div>
            </div>
          </div>
        </div>
      </div>

      {/* Profit & Loss */}
      <div className="card" style={{ marginBottom: 14, pageBreakAfter: "always" }}>
        <div className="card-header">
          <span className="card-title">Profit and Loss Account</span>
          <span style={{ fontSize: 10, fontFamily: "'Source Code Pro',monospace", color: "var(--muted)", letterSpacing: "0.06em" }}>FOR THE YEAR ENDED {yeFmt.toUpperCase()}</span>
        </div>
        <div className="card-body">
          {amtCols()}
          {fsRow("Turnover", { c2: turnover })}
          {cos > 0 && fsRow("Cost of Sales", { c1: cos, indent: 1 })}
          {cos > 0 && fsRow("Gross Profit", { c2: grossProfit, top2: true, bold: true })}
          {cos > 0 && fsDivider()}
          {adminExp > 0 && fsRow("Administrative Expenses", { c1: adminExp, indent: 1 })}
          {fsRow(cos > 0 ? "Operating Profit" : "Net Profit", { c2: opProfit, top2: true, bold: true })}
          {fsDivider()}
          {interest !== 0 && fsRow(interest > 0 ? "Interest receivable" : "Interest payable", { c1: Math.abs(interest) })}
          {fsRow("Profit before tax", { c2: pbt, bold: true })}
          {fsDivider()}
          {fsRow("Tax on profit", {})}
          <div style={{ fontSize: 11, color: "var(--dim)", fontStyle: "italic", padding: "2px 0 6px 10px" }}>No corporation tax posted for this period</div>
          {fsRow("Profit for the financial year", { c2: pfYear, dbl: true, bold: true })}
        </div>
      </div>

      {/* Balance Sheet */}
      <div className="card" style={{ marginBottom: 14, pageBreakAfter: "always" }}>
        <div className="card-header">
          <span className="card-title">Balance Sheet</span>
          <span style={{ fontSize: 10, fontFamily: "'Source Code Pro',monospace", color: "var(--muted)", letterSpacing: "0.06em" }}>AS AT {yeFmt.toUpperCase()}</span>
        </div>
        <div className="card-body">
          {amtCols()}
          {fsHead("Fixed Assets")}
          {fsRow("Tangible assets", { c2: fixedAssets })}
          {fsDivider()}
          {fsHead("Current Assets")}
          {fsRow("Debtors", { c1: debtors })}
          {fsRow("Cash at bank and in hand", { c1: cashAtBank })}
          {fsRow("", { c2: currAssets, top1: true })}
          {fsDivider()}
          {fsHead("Creditors: amounts falling due within one year")}
          {fsRow("", { c2: creditors > 0 ? -creditors : 0 })}
          {fsDivider()}
          {fsRow("Net Current Assets", { c2: netCurrAssets, top2: true, bold: true })}
          {fsDivider()}
          {fsRow("Total Assets less Current Liabilities", { c2: totAssetsLCL, bold: true })}
          {fsDivider()}
          {fsHead("Capital and Reserves")}
          {fsRow("Called up share capital", { c1: shareCapital })}
          {fsRow("Profit and loss account", { c1: retainedEarns })}
          {fsRow("", { c2: totAssetsLCL, dbl: true, bold: true })}
          <div style={{ marginTop: 16, fontSize: 11, color: "var(--muted)", lineHeight: 1.6 }}>
            These financial statements have been prepared in accordance with the micro-entity provisions of the Companies Act 2014 and FRS 105. Approved by the Board of Directors on ___/___/_____ · Signed: ____________________
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-header"><span className="card-title">Notes to the Financial Statements</span></div>
        <div className="card-body" style={{ fontSize: 13, lineHeight: 1.7 }}>
          <div style={{ marginBottom: 22 }}>
            <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 600, fontSize: 14, marginBottom: 10 }}>1. Accounting Policies</div>
            <div style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.9 }}>
              <p><strong style={{ color: "var(--text)" }}>Basis of preparation:</strong> These financial statements have been prepared under the historical cost convention and in accordance with FRS 105 — The Financial Reporting Standard applicable to the Micro-entities Regime, as issued by the Financial Reporting Council.</p>
              <p style={{ marginTop: 8 }}><strong style={{ color: "var(--text)" }}>Going concern:</strong> The directors have a reasonable expectation that the company has adequate resources to continue in operational existence for the foreseeable future. Accordingly, these financial statements have been prepared on a going concern basis.</p>
              <p style={{ marginTop: 8 }}><strong style={{ color: "var(--text)" }}>Revenue recognition:</strong> Turnover represents amounts receivable for services and goods provided in the normal course of business, net of value added tax and trade discounts.</p>
              <p style={{ marginTop: 8 }}><strong style={{ color: "var(--text)" }}>Fixed assets:</strong> Fixed assets are stated at cost less accumulated depreciation. Depreciation is provided to write off the cost less the estimated residual value on a straight-line basis over the estimated useful economic lives of the assets.</p>
            </div>
          </div>
          <div style={{ marginBottom: 22 }}>
            <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 600, fontSize: 14, marginBottom: 10 }}>2. Company Information</div>
            <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 2 }}>
              <div><strong style={{ color: "var(--text)" }}>Company name:</strong> {companyName}</div>
              <div><strong style={{ color: "var(--text)" }}>Company registration number:</strong> {regNumber || <span style={{ fontStyle: "italic" }}>Not provided</span>}</div>
              <div><strong style={{ color: "var(--text)" }}>Country of incorporation:</strong> Ireland</div>
              <div><strong style={{ color: "var(--text)" }}>Nature of business:</strong> As per company registration with the Companies Registration Office</div>
            </div>
          </div>
          <div>
            <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 600, fontSize: 14, marginBottom: 10 }}>3. Directors' Remuneration</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              {dirRemun && parseFloat(dirRemun) > 0
                ? <span>Aggregate remuneration paid to directors in the year ended {yeFmt}: <strong style={{ fontFamily: "'Source Code Pro',monospace", color: "var(--text)" }}>{fmtEUR(parseFloat(dirRemun))}</strong></span>
                : <span>No directors' remuneration was paid or payable during the year ended {yeFmt}.</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Disclaimer */}
      <div style={{ fontSize: 11, color: "var(--muted)", background: "rgba(184,134,11,0.05)", borderRadius: "var(--radius-sm)", padding: "12px 16px", borderLeft: "3px solid var(--gold)", lineHeight: 1.7, marginBottom: 14 }}>
        ⚠ These statements have been prepared in accordance with the micro-entity provisions of FRS 105. They should be reviewed and approved by a qualified accountant before filing with the CRO.
      </div>
    </div>
  );
}

// ─── ADD COMPANY MODAL ────────────────────────────────────────────────────────
function AddCompanyModal({ user, onSuccess, onClose }) {
  const BLANK = () => ({
    name:            "",
    company_type:    "Limited Company",
    year_end_month:  12,
    currency:        "EUR",
    vat_registered:  false,
    vat_number:      "",
    vat_period:      "bimonthly",
    sales_vat_rate:  23,
    paye_registered: false,
    rct_registered:  false,
    ard_month:       "",
    ard_day:         "",
  });

  const [form, setForm] = useState(BLANK());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const valid = form.name.trim().length > 0;

  useEffect(() => {
    const h = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true); setErr(null);

    const { data, error } = await supabase.from("companies").insert({
      clerk_user_id:        user.id,
      name:                 form.name.trim(),
      company_type:         form.company_type,
      year_end_month:       Number(form.year_end_month),
      currency:             form.currency,
      base_currency:        form.currency,
      vat_registered:       form.vat_registered,
      vat_number:           form.vat_registered ? (form.vat_number.trim() || null) : null,
      vat_period:           form.vat_period,
      sales_vat_rate:       Number(form.sales_vat_rate) || 23,
      paye_registered:      form.paye_registered,
      rct_registered:       form.rct_registered,
      ard_month:            form.ard_month ? Number(form.ard_month) : null,
      ard_day:              form.ard_day   ? Number(form.ard_day)   : null,
      period_start:         1,
      onboarding_completed: true,
      onboarding_steps:     { company_profile: true, tax_profile: true },
    }).select().single();

    if (error) {
      if (error.code === "23505") {
        if (error.constraint === "companies_clerk_user_id_name_key") {
          setErr("A company with that name already exists in your practice.");
        } else {
          setErr(`Duplicate value rejected (constraint: ${error.constraint || "unknown"}) — ${error.details || error.message}`);
        }
      } else {
        setErr(error.message);
      }
      setSaving(false); return;
    }

    supabase.rpc('claim_mailbox_slug', { p_company_id: data.id, p_name: data.name });

    let coData = data;
    let orgWarnMsg = null;
    try {
      const r = await fetch("/api/create-org", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: data.id, companyName: data.name, userId: user.id }),
      });
      if (r.ok) {
        const { orgId } = await r.json();
        if (orgId) {
          await supabase.from("companies").update({ clerk_org_id: orgId }).eq("id", data.id);
          coData = { ...data, clerk_org_id: orgId };
        }
      } else { orgWarnMsg = "Company saved — team sharing setup failed. Retry in Settings."; }
    } catch (_) { orgWarnMsg = "Company saved — team sharing setup failed. Retry in Settings."; }

    try {
      const periodKey = new Date().toLocaleDateString("en-IE", { month: "long", year: "numeric" });
      const rows = CHECKLIST_TEMPLATE.flatMap(({ section, items }) =>
        items.map(item_label => ({
          company_id: data.id, section, item_label,
          is_auto: false, checked: false, period: periodKey,
          completion_condition: CONDITION_MAP[item_label] || null,
        }))
      );
      await supabase.from("checklists").insert(rows);
    } catch (_) {}

    setSaving(false);
    onSuccess(coData, orgWarnMsg);
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="card" style={{ maxWidth: 560, width: "100%", padding: "24px 26px 22px", boxShadow: "0 16px 48px rgba(0,0,0,0.5)", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>Add company</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>Creates a new workspace and seeds the default month-end checklist.</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 4px", flexShrink: 0 }}>✕</button>
        </div>

        {/* Name */}
        <div style={{ marginBottom: 14 }}>
          <label className="f-label">Company / Trading Name <span style={{ color: "var(--danger)" }}>*</span></label>
          <input className="f-input" style={{ marginTop: 5, width: "100%", boxSizing: "border-box" }}
            value={form.name} onChange={e => f("name", e.target.value)}
            placeholder="e.g. Brennan & Sons Ltd"
            onKeyDown={e => e.key === "Enter" && submit()}
            autoFocus />
        </div>

        {/* Type + Currency */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
          <div>
            <label className="f-label">Company Type</label>
            <select className="f-input" style={{ marginTop: 5, width: "100%" }} value={form.company_type}
              onChange={e => f("company_type", e.target.value)}>
              {SETTINGS_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="f-label">Base Currency</label>
            <select className="f-input" style={{ marginTop: 5, width: "100%" }} value={form.currency}
              onChange={e => f("currency", e.target.value)}>
              {OB_CURRENCIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {/* Year-end + ARD */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
          <div>
            <label className="f-label">Year-End Month</label>
            <select className="f-input" style={{ marginTop: 5, width: "100%" }} value={form.year_end_month}
              onChange={e => f("year_end_month", Number(e.target.value))}>
              {OB_MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="f-label">ARD Month</label>
            <select className="f-input" style={{ marginTop: 5, width: "100%" }} value={form.ard_month}
              onChange={e => f("ard_month", e.target.value)}>
              <option value="">—</option>
              {OB_MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="f-label">ARD Day</label>
            <input className="f-input" style={{ marginTop: 5, width: "100%" }} type="number" min="1" max="31"
              value={form.ard_day} onChange={e => f("ard_day", e.target.value)} placeholder="e.g. 30" />
          </div>
        </div>

        {/* VAT */}
        <div style={{ display: "grid", gridTemplateColumns: form.vat_registered ? "1fr 1fr" : "1fr 1fr", gap: 12, marginBottom: form.vat_registered ? 10 : 14 }}>
          <div>
            <label className="f-label">VAT Registered?</label>
            <div style={{ display: "flex", marginTop: 5, border: "1px solid var(--border2)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
              <button type="button" className={`ob-toggle-btn${!form.vat_registered ? " active" : ""}`}
                onClick={() => f("vat_registered", false)}>No</button>
              <button type="button" className={`ob-toggle-btn${form.vat_registered ? " active" : ""}`}
                onClick={() => f("vat_registered", true)}>Yes</button>
            </div>
          </div>
          {form.vat_registered && (
            <div>
              <label className="f-label">Filing Frequency</label>
              <select className="f-input" style={{ marginTop: 5, width: "100%" }} value={form.vat_period}
                onChange={e => f("vat_period", e.target.value)}>
                <option value="bimonthly">Bi-monthly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
          )}
        </div>
        {form.vat_registered && (
          <div style={{ marginBottom: 14 }}>
            <label className="f-label">VAT Number</label>
            <input className="f-input" style={{ marginTop: 5, width: "100%", boxSizing: "border-box" }}
              value={form.vat_number} onChange={e => f("vat_number", e.target.value)} placeholder="IE 1234567A" />
          </div>
        )}

        {/* PAYE + RCT */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 22 }}>
          <div>
            <label className="f-label">PAYE Registered?</label>
            <div style={{ display: "flex", marginTop: 5, border: "1px solid var(--border2)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
              <button type="button" className={`ob-toggle-btn${!form.paye_registered ? " active" : ""}`}
                onClick={() => f("paye_registered", false)}>No</button>
              <button type="button" className={`ob-toggle-btn${form.paye_registered ? " active" : ""}`}
                onClick={() => f("paye_registered", true)}>Yes</button>
            </div>
          </div>
          <div>
            <label className="f-label">RCT (Construction)?</label>
            <div style={{ display: "flex", marginTop: 5, border: "1px solid var(--border2)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
              <button type="button" className={`ob-toggle-btn${!form.rct_registered ? " active" : ""}`}
                onClick={() => f("rct_registered", false)}>No</button>
              <button type="button" className={`ob-toggle-btn${form.rct_registered ? " active" : ""}`}
                onClick={() => f("rct_registered", true)}>Yes</button>
            </div>
          </div>
        </div>

        {err && (
          <div style={{ marginBottom: 14, fontSize: 12, color: "var(--danger)", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: 4, padding: "8px 12px" }}>
            {err}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn btn-s btn-sm" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-p btn-sm" onClick={submit} disabled={!valid || saving}>
            {saving ? "Creating…" : "Create company"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── COMPANY SWITCHER ─────────────────────────────────────────────────────────
function CompanySwitcher({ companies, company, onSwitch, onPractice, onAddCompany }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div className="co-switcher" ref={ref}>
      <button className="co-switcher-btn" onClick={() => setOpen(v => !v)}>
        <div className="co-dot" />
        <span className="co-name">{company?.name || "Your Company"}</span>
        <span className="co-caret">▾</span>
      </button>
      {open && (
        <div className="co-menu">
          {companies.length >= 3 && (
            <button className="co-menu-item practice" onClick={() => { onPractice(); setOpen(false); }}>
              ⊞ Practice Dashboard
            </button>
          )}
          {companies.map(c => (
            <button
              key={c.id}
              className={`co-menu-item ${c.id === company?.id ? "active" : ""}`}
              onClick={() => { onSwitch(c); setOpen(false); }}
            >
              {c.id === company?.id ? "✓ " : "  "}{c.name}
            </button>
          ))}
          <button className="co-menu-item" style={{ borderTop: "1px solid rgba(255,255,255,0.08)", color: "var(--accent)", fontSize: 11, fontFamily: "'Source Code Pro', monospace", letterSpacing: "0.04em" }}
            onClick={() => { onAddCompany(); setOpen(false); }}>
            ⊕ Add company
          </button>
        </div>
      )}
    </div>
  );
}

// ─── PRACTICE DASHBOARD ───────────────────────────────────────────────────────
function PracticeDashboard({ companies, onSelectCompany, onAddCompany }) {
  const [data,    setData]    = useState({});
  const [sortKey, setSortKey] = useState('status');
  const [sortDir, setSortDir] = useState('asc');

  useEffect(() => {
    if (!companies.length) return;
    companies.forEach(async c => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const [balRes, importRes, arRes, vatRes] = await Promise.all([
          supabase.from('bank_transactions').select('balance')
            .eq('company_id', c.id).order('date', { ascending: false }).limit(1),
          supabase.from('bank_transactions').select('created_at')
            .eq('company_id', c.id).order('created_at', { ascending: false }).limit(1),
          supabase.from('invoices').select('total, amount_paid, due_date')
            .eq('company_id', c.id)
            .neq('status', 'draft').neq('status', 'void')
            .neq('status', 'credited').neq('status', 'paid'),
          supabase.from('vat_returns').select('period_val')
            .eq('company_id', c.id).eq('status', 'filed'),
        ]);
        let arTotal = 0, arOverdue = 0;
        for (const inv of (arRes.data || [])) {
          const owed = Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid || 0));
          if (owed > 0) {
            arTotal += owed;
            if (inv.due_date && inv.due_date < today) arOverdue += owed;
          }
        }
        setData(prev => ({
          ...prev,
          [c.id]: {
            balance:    balRes.data?.[0] ? Number(balRes.data[0].balance) : null,
            lastImport: importRes.data?.[0]?.created_at || null,
            arTotal,
            arOverdue,
            vatFiled:   new Set((vatRes.data || []).map(r => r.period_val)),
          },
        }));
      } catch (_) {}
    });
  }, [companies.length]); // eslint-disable-line

  // Returns { dueDate, daysUntil } for the most recent unfiled VAT period, or null if all filed.
  function getVATStatus(company, vatFiled) {
    if (!company.vat_registered) return null;
    const type   = company.vat_period || 'bimonthly';
    const now    = new Date(); now.setHours(0, 0, 0, 0);
    const year   = now.getFullYear(), month = now.getMonth();
    const dueDay = company.ros_efiler ? 23 : 19;
    const periods = [];
    if (type === 'monthly') {
      for (let i = 0; i < 3; i++) {
        const d = new Date(year, month - i, 1);
        const y = d.getFullYear(), m = d.getMonth();
        periods.push({ val: `m-${y}-${m}`, dueDate: new Date(y, m + 1, dueDay) });
      }
    } else {
      const curPair = Math.floor(month / 2);
      for (let i = 0; i < 3; i++) {
        let pair = curPair - i, y = year;
        while (pair < 0) { pair += 6; y--; }
        const em = pair * 2 + 1, dm = em + 1;
        const dy = dm > 11 ? y + 1 : y;
        periods.push({ val: `b-${y}-${pair}`, dueDate: new Date(dy, dm % 12, dueDay) });
      }
    }
    for (const p of periods) {
      if (!vatFiled.has(p.val)) {
        return { dueDate: p.dueDate, daysUntil: Math.floor((p.dueDate - now) / 86400000) };
      }
    }
    return null;
  }

  // Next upcoming VAT3 deadline from computeDeadlines.
  function getNextVATDue(company) {
    return computeDeadlines(company).find(d => d.type === 'VAT3')?.due ?? null;
  }

  const fmtDate  = dt => new Date(dt).toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: '2-digit' });
  const fmtMoney = n  => `€${Math.abs(n).toLocaleString('en-IE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  // Single source of status truth — dot colour, label, and reason all come from here.
  function getClientStatus(company, d) {
    if (!d) return { level: 'loading', label: '…', reason: '' };
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const red = [], amber = [];

    const vatSt = getVATStatus(company, d.vatFiled);
    if (vatSt) {
      if (vatSt.daysUntil < 0)        red.push(`VAT overdue ${fmtDate(vatSt.dueDate)}`);
      else if (vatSt.daysUntil <= 7) amber.push(`VAT due ${fmtDate(vatSt.dueDate)}`);
    }
    if (d.lastImport) {
      const days = Math.floor((now - new Date(d.lastImport)) / 86400000);
      if (days > 30) amber.push(`books stale — ${days} days`);
    } else {
      amber.push('no bank import');
    }
    if (d.arOverdue > 0) amber.push(`AR overdue ${fmtMoney(d.arOverdue)}`);
    if (!company.cro_number) amber.push('CRO missing');
    if (company.vat_registered && !company.vat_period) amber.push('VAT frequency not set');

    if (red.length)   return { level: 'red',   label: 'Overdue',         reason: red[0]   };
    if (amber.length) return { level: 'amber', label: 'Needs attention', reason: amber[0] };
    return               { level: 'green', label: 'On track',          reason: ''       };
  }

  const STATUS_ORDER = { red: 0, amber: 1, green: 2, loading: 3 };
  const DOT = { red: 'var(--red)', amber: 'var(--gold)', green: '#34d399', loading: 'var(--muted)' };

  const handleSort = key => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const sorted = [...companies].sort((a, b) => {
    const da = data[a.id], db = data[b.id];
    const sa = getClientStatus(a, da), sb = getClientStatus(b, db);
    let cmp = 0;
    if (sortKey === 'status') {
      cmp = STATUS_ORDER[sa.level] - STATUS_ORDER[sb.level];
      if (cmp === 0) cmp = a.name.localeCompare(b.name);
    } else if (sortKey === 'name') {
      cmp = a.name.localeCompare(b.name);
    } else if (sortKey === 'nextVat') {
      const va = getNextVATDue(a), vb = getNextVATDue(b);
      cmp = (va?.getTime() ?? Infinity) - (vb?.getTime() ?? Infinity);
    } else if (sortKey === 'arOwed') {
      cmp = (da?.arTotal ?? 0) - (db?.arTotal ?? 0);
    } else if (sortKey === 'lastImport') {
      const ia = da?.lastImport ? new Date(da.lastImport).getTime() : 0;
      const ib = db?.lastImport ? new Date(db.lastImport).getTime() : 0;
      cmp = ib - ia; // most-recent first when asc
    } else if (sortKey === 'cash') {
      cmp = (da?.balance ?? -Infinity) - (db?.balance ?? -Infinity);
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const thCls = key => `prac-th${sortKey === key ? ` sort-${sortDir}` : ''}`;

  return (
    <div className="fade-up">
      <div style={{ marginBottom: 18, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>Practice Dashboard</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            {companies.length} {companies.length === 1 ? 'workspace' : 'workspaces'} — sorted by status. Click a row to open.
          </div>
        </div>
        <button className="btn btn-p btn-sm" onClick={onAddCompany}>⊕ Add company</button>
      </div>

      {/* ── Desktop table ── */}
      <div className="prac-table-wrap">
        <table className="prac-table">
          <thead>
            <tr>
              <th className={thCls('status')}     onClick={() => handleSort('status')}     style={{ width: 160 }}>Status</th>
              <th className={thCls('name')}        onClick={() => handleSort('name')}>Client</th>
              <th className={thCls('nextVat')}     onClick={() => handleSort('nextVat')}   style={{ width: 112 }}>Next VAT</th>
              <th className={thCls('arOwed')}      onClick={() => handleSort('arOwed')}    style={{ width: 170 }}>AR Owed</th>
              <th className={thCls('lastImport')}  onClick={() => handleSort('lastImport')} style={{ width: 122 }}>Last Import</th>
              <th className={thCls('cash')}        onClick={() => handleSort('cash')}      style={{ width: 110, textAlign: 'right' }}>Cash</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(c => {
              const d       = data[c.id];
              const st      = getClientStatus(c, d);
              const nextVat = getNextVATDue(c);
              const vatSt   = d ? getVATStatus(c, d.vatFiled) : null;
              const vatRed   = vatSt && vatSt.daysUntil < 0;
              const vatAmber = vatSt && vatSt.daysUntil >= 0 && vatSt.daysUntil <= 7;
              const importDays = d?.lastImport
                ? Math.floor((Date.now() - new Date(d.lastImport)) / 86400000) : null;

              return (
                <tr key={c.id} className="prac-tr" onClick={() => onSelectCompany(c)}>
                  {/* Status */}
                  <td className="prac-td">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="prac-status-dot" style={{ background: DOT[st.level] }} />
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: DOT[st.level], lineHeight: 1.3 }}>{st.label}</div>
                        {st.reason && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{st.reason}</div>}
                      </div>
                    </div>
                  </td>
                  {/* Client */}
                  <td className="prac-td">
                    <div style={{ fontWeight: 600 }}>{c.name}</div>
                    {c.cro_number
                      ? <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{c.cro_number}</div>
                      : <div style={{ fontSize: 11, color: 'var(--gold)', marginTop: 1 }}>⚠ CRO missing</div>}
                  </td>
                  {/* Next VAT */}
                  <td className="prac-td" style={{
                    fontFamily: 'Source Code Pro, monospace', fontSize: 12,
                    color: vatRed ? 'var(--red)' : vatAmber ? 'var(--gold)' : 'var(--text)',
                  }}>
                    {!c.vat_registered
                      ? <span style={{ color: 'var(--muted)' }}>N/A</span>
                      : nextVat ? fmtDate(nextVat) : '—'}
                  </td>
                  {/* AR Owed */}
                  <td className="prac-td">
                    {!d
                      ? <span style={{ color: 'var(--muted)' }}>…</span>
                      : d.arTotal === 0
                        ? <span style={{ color: 'var(--muted)' }}>None</span>
                        : <>
                            <div style={{ fontFamily: 'Source Code Pro, monospace', fontSize: 12 }}>{fmtMoney(d.arTotal)}</div>
                            {d.arOverdue > 0 && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 1 }}>{fmtMoney(d.arOverdue)} overdue</div>}
                          </>}
                  </td>
                  {/* Last Import */}
                  <td className="prac-td" style={{
                    fontFamily: 'Source Code Pro, monospace', fontSize: 12,
                    color: !d ? 'var(--muted)' : importDays === null ? 'var(--red)' : importDays > 30 ? 'var(--gold)' : 'var(--text)',
                  }}>
                    {!d ? '…' : d.lastImport ? fmtDate(d.lastImport) : <span style={{ color: 'var(--red)' }}>Never</span>}
                  </td>
                  {/* Cash */}
                  <td className="prac-td" style={{
                    textAlign: 'right', fontFamily: 'Source Code Pro, monospace', fontSize: 12,
                    color: !d || d.balance === null ? 'var(--muted)' : d.balance < 0 ? 'var(--red)' : 'var(--teal)',
                  }}>
                    {!d ? '…' : d.balance === null ? '—' : fmtMoney(d.balance)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Mobile compact strips ── */}
      <div className="prac-compact">
        {sorted.map(c => {
          const st = getClientStatus(c, data[c.id]);
          return (
            <div key={c.id} className="prac-compact-row" onClick={() => onSelectCompany(c)}>
              <span className="prac-status-dot" style={{ background: DOT[st.level], width: 10, height: 10 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.name}
                </div>
                {st.reason
                  ? <div style={{ fontSize: 11, color: DOT[st.level], marginTop: 1 }}>{st.reason}</div>
                  : <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{st.label}</div>}
              </div>
              <span style={{ color: 'var(--muted)', fontSize: 16 }}>›</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── EXPENSES PAGE ───────────────────────────────────────────────────────────
function Expenses({ companyName = "Company", isAdmin = false, companyId }) {
  const { user } = useUser();
  const { accounts: coaAccounts }   = useChartOfAccounts(companyId);
  const [expenses, setExpenses]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [view, setView]             = useState("mine");
  const [showForm, setShowForm]     = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [receiptUrl, setReceiptUrl] = useState(null);
  const [saveError, setSaveError]   = useState(null);
  const [selected, setSelected]     = useState(null);
  const [matchData, setMatchData]   = useState(null); // { expenseId, rows }
  const [approvingId, setApprovingId] = useState(null);
  const fileInputRef = useRef(null);

  const today = new Date();
  const thisMonth = today.toISOString().slice(0, 7);
  const fmtD = d => d ? new Date(d).toLocaleDateString("en-IE", { day: "2-digit", month: "short", year: "numeric" }) : "—";
  const pmIcon = pm => ({ company_card:"💳", personal_card:"👤", cash:"💵", bank_transfer:"🏦" }[pm] || "💳");

  const emptyForm = () => ({
    receipt_date: today.toISOString().slice(0,10), supplier:"", description:"",
    amount:"", vat_amount:"0", net_amount:"",
    nominal_account:"6600", nominal_name:"Sundry Expenses", category:"Overheads",
    payment_method:"company_card", notes:"", receipt_text:"",
  });
  const [form, setForm] = useState(emptyForm());

  const ff = f => e => {
    const val = e.target.value;
    setForm(p => {
      const u = { ...p, [f]: val };
      if (f === "amount" || f === "vat_amount") {
        const a = parseFloat(f === "amount" ? val : u.amount) || 0;
        const v = parseFloat(f === "vat_amount" ? val : u.vat_amount) || 0;
        u.net_amount = (a - v).toFixed(2);
      }
      if (f === "nominal_account") {
        const acct = coaAccounts.find(a => a.code === val) || GL_ACCOUNTS.find(a => a.code === val);
        if (acct) { u.nominal_name = acct.name; u.category = acct.category || acct.type || ""; }
      }
      return u;
    });
  };

  useEffect(() => {
    if (!companyId) { setExpenses([]); return; }
    (async () => {
      setLoading(true);
      try {
        const { data } = await supabase
          .from("expenses").select("*").eq("company_id", companyId)
          .order("receipt_date", { ascending: false });
        if (data) setExpenses(data);
      } catch (err) { console.error("[expenses]", err.message); }
      setLoading(false);
    })();
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFile = async file => {
    if (!file) return;
    setReceiptUrl(URL.createObjectURL(file));
    if (!file.type.startsWith("image/")) { setForm(p => ({ ...p, receipt_text: `Receipt: ${file.name}` })); return; }
    setExtracting(true);
    try {
      const b64 = await new Promise((res, rej) => {
        const rd = new FileReader();
        rd.onload = e => res(e.target.result.split(",")[1]);
        rd.onerror = rej;
        rd.readAsDataURL(file);
      });
      const resp = await fetch("/api/extract-receipt", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64: b64, mediaType: file.type }),
      });
      const d = await resp.json();
      setForm(p => ({
        ...p,
        supplier:     d.supplier     || p.supplier,
        receipt_date: d.date         || p.receipt_date,
        amount:       d.total_amount ? String(d.total_amount) : p.amount,
        vat_amount:   d.vat_amount   ? String(d.vat_amount)   : p.vat_amount,
        net_amount:   d.net_amount   ? String(d.net_amount)   : p.net_amount,
        description:  d.description  || p.description,
        receipt_text: JSON.stringify(d),
      }));
    } catch (e) { console.error("[expenses] extract error:", e); }
    setExtracting(false);
  };

  const save = async () => {
    if (!form.supplier || !form.amount) return;
    setSaveError(null);
    let cid;
    try { cid = requireCompanyId(companyId); } catch (e) { setSaveError(e.message); return; }
    const byName = user.firstName ? `${user.firstName} ${user.lastName ?? ""}`.trim() : user.emailAddresses?.[0]?.emailAddress || "Unknown";
    const { data: ins, error } = await supabase.from("expenses").insert({
      company_id: cid, submitted_by_clerk_id: user.id, submitted_by_name: byName,
      receipt_date: form.receipt_date, supplier: form.supplier, description: form.description,
      amount: parseFloat(form.amount) || 0, vat_amount: parseFloat(form.vat_amount) || 0,
      net_amount: parseFloat(form.net_amount) || 0, nominal_account: form.nominal_account,
      nominal_name: form.nominal_name, category: form.category, payment_method: form.payment_method,
      status: "submitted", receipt_text: form.receipt_text, notes: form.notes,
    }).select().single();
    if (error) { setSaveError(`Save failed: ${error.message}`); return; }
    setExpenses(p => [ins, ...p]);
    setForm(emptyForm()); setReceiptUrl(null); setShowForm(false);
  };

  const approve = async exp => {
    if (!companyId) return;
    setApprovingId(exp.id);
    const db = supabase;
    const creditAcct = ["company_card","bank_transfer"].includes(exp.payment_method) ? "1000" : "2000";
    const ref = `EXP-${exp.id.slice(0, 6).toUpperCase()}`;
    const { data: jnl } = await db.from("journals").insert({
      company_id: companyId, date: sanitiseDate(exp.receipt_date),
      description: `Expense: ${exp.supplier}${exp.description ? ` — ${exp.description}` : ""}`,
      debit_account: exp.nominal_account, credit_account: creditAcct,
      amount: exp.amount, reference: ref,
    }).select("id").single();
    const journalId = jnl?.id || null;
    await db.from("expenses").update({ status: "posted", journal_id: journalId }).eq("id", exp.id);
    setExpenses(p => p.map(e => e.id === exp.id ? { ...e, status: "posted", journal_id: journalId } : e));
    setApprovingId(null);
  };

  const reject = async exp => {
    if (!companyId) return;
    await supabase.from("expenses").update({ status: "rejected" }).eq("id", exp.id);
    setExpenses(p => p.map(e => e.id === exp.id ? { ...e, status: "rejected" } : e));
  };

  const findMatches = async exp => {
    if (!companyId) return;
    const d = new Date(exp.receipt_date);
    const d0 = new Date(d); d0.setDate(d0.getDate() - 3);
    const d1 = new Date(d); d1.setDate(d1.getDate() + 3);
    const { data } = await supabase.from("bank_transactions")
      .select("revolut_id,date,description,amount").eq("company_id", companyId)
      .gte("date", d0.toISOString().slice(0,10)).lte("date", d1.toISOString().slice(0,10)).order("date");
    const candidates = (data || []).filter(r => Math.abs(Math.abs(Number(r.amount)) - exp.amount) < 0.02);
    setMatchData({ expenseId: exp.id, rows: candidates });
  };

  const exportCSV = () => downloadCSV(
    `expenses-${fmtIE(today.toISOString().slice(0,10)).replace(/\//g,"-")}.csv`, [
      ["Date","Submitted By","Supplier","Description","Amount","VAT","Net","Nominal","Payment Method","Status","Notes"],
      ...expenses.map(e => [fmtIE(e.receipt_date), e.submitted_by_name, e.supplier, e.description, e.amount, e.vat_amount, e.net_amount, `${e.nominal_account} ${e.nominal_name}`, e.payment_method?.replace(/_/g," "), e.status, e.notes||""]),
    ]
  );

  const displayed = view === "mine" ? expenses.filter(e => e.submitted_by_clerk_id === user?.id) : expenses;
  const totalSubmitted  = displayed.filter(e => e.status !== "draft").reduce((s,e) => s + (e.amount||0), 0);
  const pendingCount    = displayed.filter(e => e.status === "submitted").length;
  const approvedMonth   = displayed.filter(e => ["approved","posted"].includes(e.status) && (e.receipt_date||"").startsWith(thisMonth)).length;
  const rejectedCount   = displayed.filter(e => e.status === "rejected").length;

  const statusPill = s => ({
    draft:    ["var(--dim)",   "rgba(107,114,128,0.09)"],
    submitted:["var(--gold)",  "rgba(184,134,11,0.1)"],
    approved: ["var(--teal)",  "rgba(29,107,114,0.1)"],
    rejected: ["var(--red)",   "rgba(220,38,38,0.1)"],
    posted:   ["var(--green)", "rgba(22,163,74,0.1)"],
  }[s] || ["var(--dim)","var(--surface2)"]);

  const acctOptions = coaAccounts.filter(a => a.is_active !== false).length > 0
    ? coaAccounts.filter(a => a.is_active !== false) : GL_ACCOUNTS;

  return (
    <div className="fade-up">
      {/* KPIs */}
      <div className="kpi-grid">
        {[
          { label:"Total Submitted",     value:fmt(totalSubmitted), sub:`${displayed.filter(e=>e.status!=="draft").length} claims`,  c:"var(--text)" },
          { label:"Pending Approval",    value:pendingCount,        sub:"awaiting review",                                            c:"var(--gold)" },
          { label:"Approved This Month", value:approvedMonth,       sub:"posted to GL",                                               c:"var(--teal)" },
          { label:"Rejected",            value:rejectedCount,       sub:"require resubmission",                                       c:"var(--red)"  },
        ].map((k,i) => (
          <div key={i} className="kpi-card" style={{"--tc":k.c}}>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value" style={{color:k.c}}>{k.value}</div>
            <div className="kpi-sub">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,flexWrap:"wrap",gap:8}}>
        <div className="gl-tabs" style={{marginBottom:0,width:"auto",flex:"none"}}>
          <button className={`gl-tab${view==="mine"?" active":""}`} onClick={()=>setView("mine")}>My Expenses</button>
          {isAdmin && <button className={`gl-tab${view==="all"?" active":""}`} onClick={()=>setView("all")}>All Expenses</button>}
        </div>
        <div style={{display:"flex",gap:8}}>
          {expenses.length > 0 && <button className="btn btn-s" onClick={exportCSV}>⬇ Export CSV</button>}
          <input ref={fileInputRef} type="file" accept="image/*,application/pdf" style={{display:"none"}}
            onChange={e => { if (e.target.files[0]) { handleFile(e.target.files[0]); setShowForm(true); setSaveError(null); } }} />
          <button className="btn btn-s" onClick={()=>fileInputRef.current?.click()} disabled={extracting}>
            {extracting ? "Extracting…" : "📷 Upload Receipt"}
          </button>
          <button className="btn btn-p" onClick={()=>{ setShowForm(v=>!v); setSaveError(null); if(!showForm){setForm(emptyForm());setReceiptUrl(null);} }}>
            {showForm ? "Cancel" : "+ Add Expense"}
          </button>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div className="jnl-form" style={{marginBottom:14}}>
          <div className="jnl-fh">
            <span className="jnl-ft">{receiptUrl ? "📷 Receipt Captured" : "New Expense"}</span>
            <button className="btn btn-s btn-sm" onClick={()=>{setShowForm(false);setReceiptUrl(null);}}>Cancel</button>
          </div>
          <div className="jnl-fb">
            <div style={{display:"flex",gap:18,marginBottom:16}}>
              {receiptUrl && (
                <div style={{flexShrink:0,textAlign:"center"}}>
                  <img src={receiptUrl} alt="Receipt" style={{width:90,height:120,objectFit:"cover",borderRadius:6,border:"1px solid var(--border)",background:"var(--surface2)"}} onError={e=>{e.target.style.display="none";}} />
                  {extracting && <div style={{fontSize:10,color:"var(--teal)",marginTop:4,fontFamily:"Source Code Pro,monospace"}}>AI extracting…</div>}
                </div>
              )}
              <div style={{flex:1}}>
                <div className="f-row">
                  <div className="f-group"><label className="f-label">Supplier</label><input className="f-input" value={form.supplier} onChange={ff("supplier")} placeholder="Supplier name" /></div>
                  <div className="f-group"><label className="f-label">Description</label><input className="f-input" value={form.description} onChange={ff("description")} placeholder="What was purchased" /></div>
                  <div className="f-group"><label className="f-label">Receipt Date</label><input className="f-input" type="date" value={form.receipt_date} onChange={ff("receipt_date")} /></div>
                </div>
                <div className="f-row">
                  <div className="f-group"><label className="f-label">Total (€ inc VAT)</label><input className="f-input" type="number" step="0.01" value={form.amount} onChange={ff("amount")} placeholder="0.00" /></div>
                  <div className="f-group"><label className="f-label">VAT (€)</label><input className="f-input" type="number" step="0.01" value={form.vat_amount} onChange={ff("vat_amount")} placeholder="0.00" /></div>
                  <div className="f-group"><label className="f-label">Net (€)</label><input className="f-input" value={form.net_amount} readOnly style={{opacity:0.7}} /></div>
                </div>
              </div>
            </div>
            <div className="f-row" style={{gridTemplateColumns:"2fr 1fr 1fr"}}>
              <div className="f-group">
                <label className="f-label">Nominal Account</label>
                <select className="f-input" value={form.nominal_account} onChange={ff("nominal_account")}>
                  {acctOptions.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                </select>
              </div>
              <div className="f-group">
                <label className="f-label">Payment Method</label>
                <select className="f-input" value={form.payment_method} onChange={ff("payment_method")}>
                  <option value="company_card">Company Card</option>
                  <option value="personal_card">Personal Card</option>
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank Transfer</option>
                </select>
              </div>
              <div className="f-group"><label className="f-label">Notes</label><input className="f-input" value={form.notes} onChange={ff("notes")} placeholder="Optional…" /></div>
            </div>
            {saveError && <div style={{marginBottom:10,fontSize:12,color:"var(--red)",background:"rgba(220,38,38,0.06)",border:"1px solid rgba(220,38,38,0.2)",borderRadius:2,padding:"7px 11px"}}>{saveError}</div>}
            <div style={{display:"flex",gap:8}}>
              <button className="btn btn-p" onClick={save} disabled={!form.supplier||!form.amount} style={{opacity:(!form.supplier||!form.amount)?0.42:1}}>Submit for Approval</button>
              <button className="btn btn-s" onClick={()=>{setShowForm(false);setReceiptUrl(null);}}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card full-col">
        <div className="card-header">
          <span className="card-title">{view==="mine" ? "My Expense Claims" : "All Expense Claims"}</span>
          <span style={{fontSize:10,color:"var(--dim)",fontFamily:"Source Code Pro,monospace"}}>{displayed.length} expense{displayed.length!==1?"s":""}</span>
        </div>
        {loading ? (
          <div style={{padding:"20px 16px",fontSize:13,color:"var(--dim)"}}>Loading expenses…</div>
        ) : displayed.length === 0 ? (
          <div style={{padding:"32px 16px",fontSize:13,color:"var(--dim)",textAlign:"center"}}>No expenses yet — upload a receipt or click Add Expense.</div>
        ) : (
          <table className="gl-table">
            <thead>
              <tr>
                <th>Date</th>{view==="all"&&<th>Submitted By</th>}<th>Supplier</th>
                <th>Description</th><th>Nominal</th><th>Method</th>
                <th>Status</th><th className="r">Amount</th><th></th>
              </tr>
            </thead>
            <tbody>
              {displayed.map(e => {
                const [sc,sbg] = statusPill(e.status);
                return (
                  <tr key={e.id} style={{cursor:"pointer"}} onClick={()=>{setSelected(selected===e.id?null:e.id);if(selected===e.id)setMatchData(null);}}>
                    <td className="mono" style={{fontSize:11}}>{fmtD(e.receipt_date)}</td>
                    {view==="all"&&<td style={{fontSize:11,color:"var(--muted)"}}>{e.submitted_by_name}</td>}
                    <td style={{fontWeight:500}}>{e.supplier}</td>
                    <td style={{fontSize:12,color:"var(--muted)",maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.description||"—"}</td>
                    <td style={{fontSize:11,color:"var(--dim)",fontFamily:"Source Code Pro,monospace"}}>{e.nominal_account}</td>
                    <td style={{fontSize:11}}>{pmIcon(e.payment_method)} <span style={{color:"var(--dim)",fontSize:10}}>{e.payment_method?.replace(/_/g," ")}</span></td>
                    <td><span className="pill" style={{color:sc,background:sbg}}>{e.status}</span></td>
                    <td className="r mono" style={{fontWeight:600}}>{fmt(e.amount)}</td>
                    <td onClick={ev=>ev.stopPropagation()} style={{paddingRight:8}}>
                      <div style={{display:"flex",gap:4,flexWrap:"nowrap"}}>
                        {isAdmin && e.status==="submitted" && (
                          <>
                            <button className="btn btn-p btn-sm" disabled={approvingId===e.id} onClick={()=>approve(e)} style={{fontSize:10,padding:"4px 9px"}}>{approvingId===e.id?"…":"✓ Approve"}</button>
                            <button className="btn btn-d btn-sm" onClick={()=>reject(e)} style={{fontSize:10,padding:"4px 9px"}}>✗ Reject</button>
                          </>
                        )}
                        {["company_card","bank_transfer"].includes(e.payment_method) && e.status==="posted" && !e.bank_txn_id && (
                          <button className="btn btn-s btn-sm" style={{fontSize:10}} onClick={()=>findMatches(e)}>🔗 Match</button>
                        )}
                        {e.bank_txn_id && <span style={{fontSize:10,color:"var(--teal)",fontFamily:"Source Code Pro,monospace",whiteSpace:"nowrap"}}>✓ Matched</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Expanded detail */}
        {selected && (() => {
          const e = displayed.find(x => x.id === selected);
          if (!e) return null;
          return (
            <div style={{padding:"14px 18px",background:"rgba(26,39,68,0.02)",borderTop:"1px solid var(--border)"}}>
              <div style={{fontSize:11,color:"var(--dim)",fontFamily:"Source Code Pro,monospace",marginBottom:10}}>EXPENSE DETAILS — {e.supplier}</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:14,marginBottom:10}}>
                {[["NOMINAL",`${e.nominal_account} ${e.nominal_name}`],["VAT",e.vat_amount?fmt(e.vat_amount):"—"],["NET",e.net_amount?fmt(e.net_amount):"—"],["PAYMENT",e.payment_method?.replace(/_/g," ")]].map(([l,v],i)=>(
                  <div key={i}><div style={{fontSize:10,color:"var(--dim)",fontFamily:"Source Code Pro,monospace",marginBottom:2}}>{l}</div><div style={{fontSize:12,textTransform:"capitalize"}}>{v}</div></div>
                ))}
              </div>
              {e.notes && <div style={{fontSize:12,color:"var(--muted)",marginBottom:8}}>{e.notes}</div>}
              {e.journal_id && <div style={{fontSize:11,color:"var(--teal)",fontFamily:"Source Code Pro,monospace",marginBottom:8}}>✓ Journal posted — EXP-{e.id.slice(0,6).toUpperCase()}</div>}

              {/* Bank transaction match results */}
              {matchData?.expenseId===e.id && (
                <div style={{marginTop:10}}>
                  <div style={{fontSize:11,color:"var(--dim)",fontFamily:"Source Code Pro,monospace",marginBottom:8}}>BANK TRANSACTIONS ±3 DAYS · SAME AMOUNT</div>
                  {matchData.rows.length===0 ? (
                    <div style={{fontSize:12,color:"var(--muted)"}}>No matching bank transactions found.</div>
                  ) : matchData.rows.map((r,i) => (
                    <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",background:"var(--surface2)",borderRadius:4,marginBottom:4,fontSize:12}}>
                      <div><span className="mono" style={{color:"var(--dim)",fontSize:11,marginRight:10}}>{r.date}</span>{r.description}</div>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <span className="mono" style={{fontWeight:600}}>{fmt(Math.abs(r.amount))}</span>
                        <button className="btn btn-p btn-sm" style={{fontSize:10}} onClick={async()=>{
                          await supabase.from("expenses").update({bank_txn_id:r.revolut_id}).eq("id",e.id);
                          setExpenses(p=>p.map(x=>x.id===e.id?{...x,bank_txn_id:r.revolut_id}:x));
                          setMatchData(null);
                        }}>Link</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation — module-level helpers
// ─────────────────────────────────────────────────────────────────────────────
function recTokenize(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 2);
}
function recFuzzyBonus(a, b) {
  const sa = new Set(recTokenize(a)), sb = new Set(recTokenize(b));
  let overlap = 0;
  for (const t of sa) if (sb.has(t)) overlap++;
  if (!overlap) return 0;
  const ratio = overlap / Math.min(sa.size || 1, sb.size || 1);
  return ratio >= 0.5 ? 15 : ratio >= 0.2 ? 10 : 0;
}
function recScoreCandidate(bt, cand) {
  const absBt = Math.abs(Number(bt.amount));
  // Score against outstanding balance (net of prior payments) — falls back to gross amount
  const outs  = Number(cand.outstanding ?? cand.amount);
  if (absBt <= 0 || outs <= 0) return 0;

  const diff    = absBt - outs;
  const diffAbs = Math.abs(diff);
  const days    = cand._date ? Math.abs(new Date(bt.date) - new Date(cand._date)) / 86400000 : 999;
  let base = 0;

  if (cand._type === 'journal') {
    // Journals: exact-amount-only match (existing categorise flow)
    if (diffAbs < 0.005) {
      base = days < 0.5 ? 85 : days <= 3 ? 70 : days <= 14 ? 45 : 0;
    }
  } else if (diffAbs < 0.005) {
    // Exact match on outstanding balance
    base = days < 0.5 ? 88 : days <= 3 ? 74 : days <= 14 ? 52 : days <= 30 ? 30 : 0;
  } else if (diffAbs <= 0.50) {
    // Within small-difference tolerance (€0.50) — settable via write-off
    base = days <= 3 ? 82 : days <= 14 ? 62 : days <= 30 ? 40 : 0;
  } else if (diff < 0 && absBt / outs >= 0.05) {
    // Instalment: bank line < invoice outstanding (partial payment of a large invoice)
    base = days <= 14 ? 42 : days <= 30 ? 24 : days <= 60 ? 12 : 0;
  } else if (diff > 0 && outs / absBt >= 0.05) {
    // Invoice outstanding < bank amount (one of several invoices in a multi-invoice settlement)
    base = 52;
  }

  if (!base) return 0;
  const candDesc = [cand.invoice_ref, cand.invoice_number, cand.client, cand.supplier, cand.description, cand.reference].filter(Boolean).join(' ');
  return Math.min(base + recFuzzyBonus(bt.description, candDesc), 100);
}

async function runMatchingEngine(companyId) {
  const { data: txns, error: txnErr } = await supabase
    .from('bank_transactions').select('id,date,description,amount')
    .eq('company_id', companyId).eq('reconciled', false).order('date', { ascending: false });
  if (txnErr) throw new Error(`Transactions: ${txnErr.message}`);
  if (!txns?.length) return 0;

  const { data: existing } = await supabase
    .from('bank_matches').select('bank_transaction_id,matched_id,status').eq('company_id', companyId);

  const confirmedBts   = new Set((existing || []).filter(m => m.status === 'confirmed').map(m => m.bank_transaction_id));
  const rejectedPairs  = new Set((existing || []).filter(m => m.status === 'rejected').map(m => `${m.bank_transaction_id}:${m.matched_id}`));
  const suggestedPairs = new Set((existing || []).filter(m => m.status === 'suggested').map(m => `${m.bank_transaction_id}:${m.matched_id}`));

  const unresolved = txns.filter(t => !confirmedBts.has(t.id));
  if (!unresolved.length) return 0;

  const [{ data: arInvs }, { data: apInvs }, { data: jnls }] = await Promise.all([
    supabase.from('invoices')
      .select('id,invoice_number,invoice_ref,client,total,amount,amount_paid,issue_date,invoice_date')
      .eq('company_id', companyId).in('status', ['sent', 'part_paid']),
    supabase.from('ap_invoices')
      .select('id,invoice_ref,supplier,amount,gross_amount,amount_paid,invoice_date')
      .eq('company_id', companyId).in('status', ['pending', 'approved', 'part_paid']),
    supabase.from('journals')
      .select('id,date,description,amount,reference,debit_account,credit_account').eq('company_id', companyId)
      .is('import_batch_id', null).order('date', { ascending: false }).limit(500),
  ]);

  const mapAR = x => {
    const total = Number(x.total || x.amount || 0);
    const outs  = Math.max(0, total - Number(x.amount_paid || 0));
    return { ...x, _type: 'invoice', _date: x.issue_date || x.invoice_date, amount: total, outstanding: outs };
  };
  const mapAP = x => {
    const total = Number(x.gross_amount || x.amount || 0);
    const outs  = Math.max(0, total - Number(x.amount_paid || 0));
    return { ...x, _type: 'ap_invoice', _date: x.invoice_date, amount: total, outstanding: outs };
  };

  const toInsert = [];

  for (const bt of unresolved) {
    const isIn  = Number(bt.amount) > 0;
    const isOut = Number(bt.amount) < 0;
    const candidates = [
      ...(isIn  ? (arInvs || []).map(mapAR).filter(x => x.outstanding > 0.005) : []),
      ...(isOut ? (apInvs || []).map(mapAP).filter(x => x.outstanding > 0.005) : []),
      ...(jnls  || []).map(x => ({ ...x, _type: 'journal', _date: x.date })),
    ];

    let best = null, bestScore = 0;
    for (const c of candidates) {
      const key = `${bt.id}:${c.id}`;
      if (rejectedPairs.has(key) || suggestedPairs.has(key)) continue;
      const s = recScoreCandidate(bt, c);
      if (s >= 60 && s > bestScore) { bestScore = s; best = c; }
    }
    if (!best) continue;

    // For journal-type matches, record the AI's suggested nominal so confirm paths
    // can detect whether the user accepted it as-is or changed it (suggestion_kept).
    const suggestedNominal = best._type === 'journal'
      ? (isIn ? best.credit_account : best.debit_account) ?? null
      : null;

    toInsert.push({
      company_id: companyId, bank_transaction_id: bt.id,
      matched_type: best._type, matched_id: best.id,
      confidence: bestScore, status: 'suggested', matched_by: 'auto',
      suggested_nominal_code: suggestedNominal,
    });
  }

  if (!toInsert.length) return 0;

  const { error: insErr } = await supabase.from('bank_matches').insert(toInsert);
  if (insErr) throw new Error(`Insert: ${insErr.message}`);

  return toInsert.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation page component
// ─────────────────────────────────────────────────────────────────────────────
function Reconciliation({ companyId, onNavigate }) {
  const [tab, setTab]                         = useState('suggested');
  const [loading, setLoading]                 = useState(true);
  const [matching, setMatching]               = useState(false);
  const [matchError, setMatchError]           = useState(null);
  const [stats, setStats]                     = useState({ unreconciled: 0, balance: 0, autoMatchRate: 0, lastImport: null });
  const [suggestedItems, setSuggestedItems]   = useState([]);
  const [unmatchedTxns, setUnmatchedTxns]     = useState([]);
  const [reconciledItems, setReconciledItems] = useState([]);
  const [findFor, setFindFor]                 = useState(null);
  const [searchQ, setSearchQ]                 = useState('');
  const [allCandidates, setAllCandidates]     = useState([]);
  const [createJnlFor, setCreateJnlFor]       = useState(null);
  const [jnlForm, setJnlForm]                 = useState(null);
  const [savingJnl, setSavingJnl]             = useState(false);
  const [toast, setToast]                     = useState(null);
  const [migrationNeeded, setMigrationNeeded] = useState(false);
  const [reconciledCount, setReconciledCount] = useState(0);
  const [reconciledPage, setReconciledPage]   = useState(0);
  const RECON_PAGE = 50;
  // Settlement modal state
  const [settleFor, setSettleFor]       = useState(null);   // bank transaction being settled
  const [settleCands, setSettleCands]   = useState([]);      // scored open-invoice candidates
  const [settleAllocs, setSettleAllocs] = useState([]);      // [{inv, invoice_type, allocated_amount, difference_amount, difference_nominal}]
  const [settleMode, setSettleMode]     = useState('invoice');  // 'invoice' | 'on_account'
  const [settleOnAcc, setSettleOnAcc]   = useState({ party_type: 'customer', party_name: '' });
  const [settleSaving, setSettleSaving] = useState(false);
  const [settleErr, setSettleErr]       = useState(null);

  useEffect(() => { if (companyId) loadAll(); }, [companyId]); // eslint-disable-line

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3200); };

  const loadReconciledPage = async (page) => {
    try {
      const offset = page * RECON_PAGE;
      const { data: rcMatches, error: rcErr } = await supabase
        .from('bank_matches').select('*').eq('company_id', companyId).eq('status', 'confirmed')
        .order('confirmed_at', { ascending: false }).range(offset, offset + RECON_PAGE - 1);
      if (rcErr || !rcMatches) return;
      const rcInvIds = [...new Set(rcMatches.filter(m => m.matched_type === 'invoice').map(m => m.matched_id))];
      const rcApIds  = [...new Set(rcMatches.filter(m => m.matched_type === 'ap_invoice').map(m => m.matched_id))];
      const rcJnlIds = [...new Set(rcMatches.filter(m => m.matched_type === 'journal').map(m => m.matched_id))];
      const rcBtIds  = rcMatches.map(m => m.bank_transaction_id);
      const [{ data: rcInvs }, { data: rcApInvs }, { data: rcJnls }, { data: rcBts }] = await Promise.all([
        rcInvIds.length  ? supabase.from('invoices').select('id,invoice_ref,client,amount,status').in('id', rcInvIds) : { data: [] },
        rcApIds.length   ? supabase.from('ap_invoices').select('id,invoice_ref,supplier,amount,status').in('id', rcApIds) : { data: [] },
        rcJnlIds.length  ? supabase.from('journals').select('id,date,description,amount,reference').in('id', rcJnlIds) : { data: [] },
        rcBtIds.length   ? supabase.from('bank_transactions').select('*').in('id', rcBtIds) : { data: [] },
      ]);
      const rcEntMap = {};
      for (const x of (rcInvs   || [])) rcEntMap[x.id] = { ...x, _type: 'invoice',    _label: `${x.invoice_ref} — ${x.client}` };
      for (const x of (rcApInvs || [])) rcEntMap[x.id] = { ...x, _type: 'ap_invoice', _label: `${x.invoice_ref} — ${x.supplier}` };
      for (const x of (rcJnls   || [])) rcEntMap[x.id] = { ...x, _type: 'journal',    _label: x.reference || x.description || 'Journal' };
      const rcTxnMap = Object.fromEntries((rcBts || []).map(t => [t.id, t]));
      const newItems = rcMatches.map(m => { const bt = rcTxnMap[m.bank_transaction_id]; return bt ? { match: m, bt, entity: rcEntMap[m.matched_id] || null } : null; }).filter(Boolean);
      if (page === 0) setReconciledItems(newItems);
      else setReconciledItems(prev => [...prev, ...newItems]);
      setReconciledPage(page);
    } catch (e) { console.error('[Reconciliation] loadReconciledPage:', e.message); }
  };

  const loadAll = async () => {
    setLoading(true);
    setReconciledPage(0);
    try {
      const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
      const [
        { data: txns },
        { data: suggestedMatches, error: matchErr },
        { count: rcCount },
        { count: autoConfCount },
        { count: totalConfCount },
      ] = await Promise.all([
        supabase.from('bank_transactions').select('*').eq('company_id', companyId).order('date', { ascending: false }).limit(500),
        supabase.from('bank_matches').select('*').eq('company_id', companyId).eq('status', 'suggested').order('created_at', { ascending: false }),
        supabase.from('bank_matches').select('*', { count: 'exact', head: true }).eq('company_id', companyId).eq('status', 'confirmed'),
        supabase.from('bank_matches').select('*', { count: 'exact', head: true }).eq('company_id', companyId).eq('status', 'confirmed').eq('matched_by', 'auto').gte('confirmed_at', monthStart.toISOString()),
        supabase.from('bank_matches').select('*', { count: 'exact', head: true }).eq('company_id', companyId).eq('status', 'confirmed').gte('confirmed_at', monthStart.toISOString()),
      ]);

      if (matchErr?.code === '42P01' || matchErr?.message?.includes('does not exist')) {
        setMigrationNeeded(true); setLoading(false); return;
      }

      const unreconciled = (txns || []).filter(t => !t.reconciled);
      const lastImport   = (txns || []).reduce((lx, t) => (!lx || new Date(t.created_at) > new Date(lx)) ? t.created_at : lx, null);
      const balance      = unreconciled.reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
      const autoRate     = (totalConfCount || 0) > 0 ? Math.round((autoConfCount || 0) / (totalConfCount || 1) * 100) : 0;
      setStats({ unreconciled: unreconciled.length, balance, autoMatchRate: autoRate, lastImport });
      setReconciledCount(rcCount || 0);

      const invIds = [...new Set((suggestedMatches || []).filter(m => m.matched_type === 'invoice').map(m => m.matched_id))];
      const apIds  = [...new Set((suggestedMatches || []).filter(m => m.matched_type === 'ap_invoice').map(m => m.matched_id))];
      const jnlIds = [...new Set((suggestedMatches || []).filter(m => m.matched_type === 'journal').map(m => m.matched_id))];
      const [{ data: invs }, { data: apInvs }, { data: jnls }] = await Promise.all([
        invIds.length  ? supabase.from('invoices').select('id,invoice_number,invoice_ref,client,total,amount,amount_paid,issue_date,invoice_date,status').in('id', invIds) : { data: [] },
        apIds.length   ? supabase.from('ap_invoices').select('id,invoice_ref,supplier,amount,gross_amount,amount_paid,invoice_date,status').in('id', apIds) : { data: [] },
        jnlIds.length  ? supabase.from('journals').select('id,date,description,amount,reference').in('id', jnlIds) : { data: [] },
      ]);
      const entMap = {};
      for (const x of (invs   || [])) {
        const tot  = Number(x.total || x.amount || 0);
        const outs = Math.max(0, tot - Number(x.amount_paid || 0));
        entMap[x.id] = { ...x, _type: 'invoice',    outstanding: outs, amount: tot, _label: `${x.invoice_number || x.invoice_ref} — ${x.client}` };
      }
      for (const x of (apInvs || [])) {
        const tot  = Number(x.gross_amount || x.amount || 0);
        const outs = Math.max(0, tot - Number(x.amount_paid || 0));
        entMap[x.id] = { ...x, _type: 'ap_invoice', outstanding: outs, amount: tot, _label: `${x.invoice_ref} — ${x.supplier}` };
      }
      for (const x of (jnls   || [])) entMap[x.id] = { ...x, _type: 'journal', _label: x.reference || x.description || 'Journal' };

      const txnMap   = Object.fromEntries((txns || []).map(t => [t.id, t]));
      const suggested = (suggestedMatches || [])
        .map(m => { const bt = txnMap[m.bank_transaction_id]; return bt ? { match: m, bt, entity: entMap[m.matched_id] || null } : null; })
        .filter(Boolean)
        .sort((a, b) => b.match.confidence - a.match.confidence);

      setSuggestedItems(suggested);
      setUnmatchedTxns((txns || []).filter(t => !t.reconciled));
      await loadReconciledPage(0);
    } catch (e) { console.error('[Reconciliation] loadAll:', e.message); }
    setLoading(false);
  };

  const runEngine = async () => {
    if (matching) return;
    setMatching(true); setMatchError(null);
    try {
      const n = await runMatchingEngine(companyId);
      showToast(`${n} new suggestion${n !== 1 ? 's' : ''} created`);
      await loadAll();
    } catch (e) { setMatchError(e.message); }
    setMatching(false);
  };

  // Journal-only confirm — thin wrapper over confirm_journal_match RPC (atomic)
  const confirmJournalMatch = async (match, bt) => {
    try {
      await confirmBankTxn(companyId, match.id, bt.id);
      showToast('Match confirmed');
      await loadAll();
    } catch (err) {
      showToast('Error: ' + err.message);
    }
  };

  const rejectMatch = async (matchId) => {
    await supabase.from('bank_matches').update({ status: 'rejected' }).eq('id', matchId);
    showToast('Match rejected');
    await loadAll();
  };

  // Bulk-confirm only journal matches (≥80%) — invoice settlements need individual review
  const confirmAll = async () => {
    const eligible = suggestedItems.filter(x => x.match.confidence >= 80 && x.match.matched_type === 'journal');
    if (!eligible.length) { showToast('No high-confidence journal suggestions to confirm'); return; }
    for (const x of eligible) await confirmJournalMatch(x.match, x.bt);
    showToast(`${eligible.length} journal match${eligible.length !== 1 ? 'es' : ''} confirmed`);
  };

  // Open settlement modal — loads scored open invoices, optionally pre-fills a suggested match
  const openSettleModal = async (bt, preloadEntity = null) => {
    setSettleFor(bt); setSettleAllocs([]); setSettleMode('invoice'); setSettleErr(null);
    setSettleOnAcc({ party_type: Number(bt.amount) >= 0 ? 'customer' : 'supplier', party_name: '' });
    const bankAbs = Math.abs(Number(bt.amount));
    const isIn    = Number(bt.amount) > 0;
    const isOut   = Number(bt.amount) < 0;
    const [{ data: arInvs }, { data: apInvs }] = await Promise.all([
      isIn  ? supabase.from('invoices').select('id,invoice_number,invoice_ref,client,total,amount,amount_paid,issue_date,invoice_date')
                .eq('company_id', companyId).in('status', ['sent','part_paid']).order('issue_date', { ascending: false }).limit(150)
            : { data: [] },
      isOut ? supabase.from('ap_invoices').select('id,invoice_ref,supplier,amount,gross_amount,amount_paid,invoice_date,nominal_code')
                .eq('company_id', companyId).in('status', ['pending','approved','part_paid']).order('invoice_date', { ascending: false }).limit(150)
            : { data: [] },
    ]);
    const mapAR = x => { const tot = Number(x.total||x.amount||0); const outs = Math.max(0, tot - Number(x.amount_paid||0)); return { ...x, _type:'invoice',    _date: x.issue_date||x.invoice_date, amount: tot, outstanding: outs, _label: `${x.invoice_number||x.invoice_ref||''} — ${x.client||'Unknown'}` }; };
    const mapAP = x => { const tot = Number(x.gross_amount||x.amount||0); const outs = Math.max(0, tot - Number(x.amount_paid||0)); return { ...x, _type:'ap_invoice', _date: x.invoice_date, amount: tot, outstanding: outs, _label: `${x.invoice_ref||''} — ${x.supplier||'Unknown'}` }; };
    const cands = [...(arInvs||[]).map(mapAR), ...(apInvs||[]).map(mapAP)]
      .filter(c => c.outstanding > 0.005)
      .map(c => ({ ...c, _score: recScoreCandidate(bt, c) }))
      .sort((a, b) => b._score - a._score);
    setSettleCands(cands);
    // Pre-populate allocation if a suggested match was passed
    if (preloadEntity && (preloadEntity._type === 'invoice' || preloadEntity._type === 'ap_invoice')) {
      const fresh = cands.find(c => c.id === preloadEntity.id);
      if (fresh && fresh.outstanding > 0.005) {
        setSettleAllocs([{
          inv: fresh, invoice_type: fresh._type === 'invoice' ? 'ar' : 'ap',
          allocated_amount: Math.round(Math.min(fresh.outstanding, bankAbs) * 100) / 100,
          difference_amount: 0, difference_nominal: '6500',
        }]);
      }
    }
  };

  // Post settlement journals + update invoices + record allocations
  // Settlement — thin wrapper over confirm_settlement RPC (atomic)
  const confirmSettlement = async () => {
    if (!settleFor || settleSaving) return;
    setSettleSaving(true); setSettleErr(null);
    const bt = settleFor;
    try {
      // Client-side pre-validation for immediate UX feedback (RPC also validates server-side)
      if (settleMode === 'invoice') {
        if (!settleAllocs.length) throw new Error('Add at least one invoice to settle');
        const totalAlloc = settleAllocs.reduce((s, a) => s + a.allocated_amount + (a.difference_amount || 0), 0);
        const bankAbs    = Math.abs(Number(bt.amount));
        if (Math.abs(totalAlloc - bankAbs) > 0.005)
          throw new Error(`Allocated ${fmtEUR(totalAlloc)} but bank line is ${fmtEUR(bankAbs)} — adjust amounts or use tolerance`);
      }

      const payload = settleMode === 'on_account'
        ? {
            p_company_id:            companyId,
            p_bt_id:                 bt.id,
            p_mode:                  'on_account',
            p_allocations:           null,
            p_on_account_party_type: settleOnAcc.party_type,
            p_on_account_party_name: settleOnAcc.party_name,
          }
        : {
            p_company_id:            companyId,
            p_bt_id:                 bt.id,
            p_mode:                  'invoice',
            p_allocations:           settleAllocs.map(a => ({
              invoice_id:         a.inv.id,
              invoice_type:       a.invoice_type,
              allocated_amount:   a.allocated_amount,
              difference_amount:  a.difference_amount  || 0,
              difference_nominal: a.difference_nominal || '6500',
            })),
            p_on_account_party_type: null,
            p_on_account_party_name: null,
          };

      const { data, error } = await supabase.rpc('confirm_settlement', payload);
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      showToast(settleMode === 'on_account'
        ? 'Recorded on account'
        : `Settlement posted — ${settleAllocs.length} invoice${settleAllocs.length !== 1 ? 's' : ''} cleared`
      );
      setSettleFor(null); setSettleAllocs([]);
      await loadAll();
    } catch (err) { setSettleErr(err.message); }
    setSettleSaving(false);
  };

  const openFindMatch = async (bt) => {
    setFindFor(bt); setSearchQ('');
    const [{ data: arInvs }, { data: apInvs }, { data: jnls }] = await Promise.all([
      supabase.from('invoices').select('id,invoice_ref,client,amount,invoice_date').eq('company_id', companyId).neq('status', 'paid'),
      supabase.from('ap_invoices').select('id,invoice_ref,supplier,amount,invoice_date').eq('company_id', companyId).neq('status', 'paid'),
      supabase.from('journals').select('id,date,description,amount,reference').eq('company_id', companyId).is('import_batch_id', null).order('date', { ascending: false }).limit(200),
    ]);
    setAllCandidates([
      ...(arInvs  || []).map(x => ({ ...x, _type: 'invoice',    _label: `${x.invoice_ref} — ${x.client}`,   _date: x.invoice_date })),
      ...(apInvs  || []).map(x => ({ ...x, _type: 'ap_invoice', _label: `${x.invoice_ref} — ${x.supplier}`, _date: x.invoice_date })),
      ...(jnls    || []).map(x => ({ ...x, _type: 'journal',    _label: x.reference || x.description || 'Journal', _date: x.date })),
    ]);
  };

  const linkManual = async (bt, cand) => {
    const { error } = await supabase.from('bank_matches').insert({
      company_id: companyId, bank_transaction_id: bt.id,
      matched_type: cand._type, matched_id: cand.id,
      confidence: 75, status: 'suggested', matched_by: 'user',
    });
    if (error) { showToast('Error: ' + error.message); return; }
    setFindFor(null);
    showToast('Linked — confirm it in the Suggested tab');
    await loadAll();
  };

  const openCreateJnl = (bt) => {
    const absAmt = Math.abs(Number(bt.amount));
    const isOut  = Number(bt.amount) < 0;
    setCreateJnlFor(bt);
    setJnlForm({ date: bt.date, description: bt.description || '', debit_account: isOut ? '6600' : '1000', credit_account: isOut ? '1000' : '4000', amount: absAmt.toFixed(2), reference: '' });
  };

  const saveJnl = async () => {
    if (!jnlForm || !createJnlFor || savingJnl) return;
    setSavingJnl(true);
    const ref = jnlForm.reference.trim() || `REC-${Date.now().toString(36).toUpperCase().slice(-5)}`;
    const { data: jnl, error } = await supabase.from('journals').insert({
      company_id: companyId, date: sanitiseDate(jnlForm.date),
      description: jnlForm.description, debit_account: jnlForm.debit_account,
      credit_account: jnlForm.credit_account, amount: parseFloat(jnlForm.amount), reference: ref,
    }).select().single();
    if (error) { showToast('Error: ' + error.message); setSavingJnl(false); return; }
    const now = new Date().toISOString();
    await supabase.from('bank_matches').insert({
      company_id: companyId, bank_transaction_id: createJnlFor.id,
      matched_type: 'journal', matched_id: jnl.id,
      confidence: 100, status: 'confirmed', matched_by: 'user', confirmed_at: now,
      suggestion_kept: false,
    });
    await supabase.from('bank_transactions').update({ reconciled: true, reconciled_at: now, settlement_type: 'categorise' }).eq('id', createJnlFor.id);
    setCreateJnlFor(null); setJnlForm(null);
    showToast('Journal posted and transaction reconciled');
    await loadAll();
    setSavingJnl(false);
  };

  // ── Render helpers ──
  const confBadge = (c) => {
    const col = c >= 80 ? 'var(--accent)' : c >= 60 ? 'var(--warn)' : 'var(--text-muted)';
    const bg  = c >= 80 ? 'var(--accent-dim)' : c >= 60 ? 'var(--warn-dim)' : 'var(--surface-2)';
    const brd = c >= 80 ? 'rgba(52,211,153,0.3)' : c >= 60 ? 'rgba(251,191,36,0.3)' : 'var(--border)';
    return <span style={{ background: bg, border: `1px solid ${brd}`, borderRadius: 'var(--radius-pill)', padding: '1px 8px', fontSize: 10, color: col, fontWeight: 700 }}>{Math.round(c)}%</span>;
  };
  const typeTag = (t) => {
    const map = { invoice: 'AR', ap_invoice: 'AP', journal: 'JNL' };
    const col = { invoice: 'var(--accent)', ap_invoice: 'var(--danger)', journal: 'var(--info)' };
    const bg  = { invoice: 'var(--accent-dim)', ap_invoice: 'var(--danger-dim)', journal: 'rgba(96,165,250,0.12)' };
    return <span style={{ background: bg[t] || 'var(--surface-2)', border: `1px solid ${col[t] || 'var(--border)'}40`, borderRadius: 3, padding: '1px 6px', fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: col[t] || 'var(--text-muted)' }}>{map[t] || t}</span>;
  };
  const fmtLastImport = (iso) => {
    if (!iso) return 'Never';
    const diff = Math.floor((Date.now() - new Date(iso).setHours(0,0,0,0)) / 86400000);
    return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : `${diff}d ago`;
  };
  const filteredCands = allCandidates.filter(c => !searchQ || (c._label || '').toLowerCase().includes(searchQ.toLowerCase()) || String(c.amount).includes(searchQ));

  // ── Row sub-components (used in all three tabs) ──
  const BtCell = ({ bt }) => (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <span style={{ fontSize: 11, color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' }}>{bt.date}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: Number(bt.amount) >= 0 ? 'var(--accent)' : 'var(--danger)', marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
          {Number(bt.amount) >= 0 ? '+' : ''}{fmtEUR(bt.amount)}
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{bt.description}</div>
    </div>
  );

  if (migrationNeeded) return (
    <div className="fade-up" style={{ maxWidth: 720 }}>
      <div style={{ background: 'var(--warn-dim)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 'var(--radius-card)', padding: '24px 28px' }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Migration required</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Run <code style={{ background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 3, fontSize: 12, color: 'var(--accent)' }}>supabase/add_bank_reconciliation.sql</code> in your Supabase SQL editor to enable this feature.
        </div>
      </div>
    </div>
  );

  return (
    <div className="fade-up" style={{ maxWidth: 1080 }}>

      {/* ── KPI stats ── */}
      <div className="kpi-grid">
        {[
          { lbl: 'UNRECONCILED',         val: loading ? '…' : stats.unreconciled,             sub: 'transactions',   c: stats.unreconciled > 0 ? 'var(--warn)' : 'var(--accent)' },
          { lbl: 'UNRECONCILED BALANCE', val: loading ? '…' : fmtEUR(stats.balance),          sub: 'awaiting match', c: 'var(--text)' },
          { lbl: 'AUTO-MATCH RATE',      val: loading ? '…' : `${stats.autoMatchRate}%`,      sub: 'this month',     c: stats.autoMatchRate >= 50 ? 'var(--accent)' : 'var(--text-muted)' },
          { lbl: 'LAST IMPORT',          val: loading ? '…' : fmtLastImport(stats.lastImport), sub: 'bank data',     c: 'var(--text-muted)' },
        ].map((k, i) => (
          <div key={i} className="kpi-card" style={{ '--tc': k.c }}>
            <div className="kpi-label">{k.lbl}</div>
            <div className="kpi-value" style={{ fontSize: 24, color: k.c }}>{k.val}</div>
            <div className="kpi-sub">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)' }}>
          {[
            { id: 'suggested',  label: `Suggested${suggestedItems.length ? ` (${suggestedItems.length})` : ''}` },
            { id: 'unmatched',  label: `Unmatched${unmatchedTxns.length  ? ` (${unmatchedTxns.length})`  : ''}` },
            { id: 'reconciled', label: `Reconciled${reconciledCount > 0   ? ` (${reconciledCount})`       : ''}` },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '8px 16px', fontSize: 12, fontWeight: tab === t.id ? 600 : 400,
              background: 'transparent', border: 'none', borderBottom: `2px solid ${tab === t.id ? 'var(--accent)' : 'transparent'}`,
              marginBottom: -1, cursor: 'pointer',
              color: tab === t.id ? 'var(--text)' : 'var(--text-muted)',
              transition: 'all 0.15s',
            }}>{t.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {tab === 'suggested' && suggestedItems.some(x => x.match.confidence >= 80 && x.match.matched_type === 'journal') && (
            <button className="btn btn-p btn-sm" onClick={confirmAll}>Confirm journals ≥80%</button>
          )}
          <button className="btn btn-s btn-sm" onClick={runEngine} disabled={matching}>
            {matching ? 'Matching…' : '⟳ Re-run matching'}
          </button>
        </div>
      </div>

      {matchError && (
        <div style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid var(--red)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontSize: 12, color: 'var(--red)', marginBottom: 12 }}>
          {matchError}
        </div>
      )}

      {/* ── Tab content ── */}
      <div className="card">

        {/* ─ Suggested ─ */}
        {tab === 'suggested' && (loading ? (
          <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>Loading…</div>
        ) : suggestedItems.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center' }}>
            <div style={{ fontSize: 30, opacity: 0.18, marginBottom: 10 }}>✓</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No pending suggestions — run matching or import transactions</div>
          </div>
        ) : suggestedItems.map((item, i) => (
          <div key={item.match.id} style={{ display: 'grid', gridTemplateColumns: '1fr 22px 1fr auto', alignItems: 'center', gap: 12, padding: '13px 18px', borderBottom: i < suggestedItems.length - 1 ? '1px solid var(--border)' : 'none' }}>
            <BtCell bt={item.bt} />
            <div style={{ textAlign: 'center', color: 'var(--text-faint)', fontSize: 14 }}>→</div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                {typeTag(item.entity ? item.entity._type : item.match.matched_type)}
                {confBadge(item.match.confidence)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {item.entity ? item.entity._label : `ID ${item.match.matched_id.slice(0, 8)}…`}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', marginTop: 1 }}>
                {item.entity ? (item.entity.outstanding != null ? `Outstanding: ${fmtEUR(item.entity.outstanding)}` : fmtEUR(item.entity.amount)) : ''}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              {item.match.matched_type === 'journal'
                ? <button className="btn btn-p btn-sm" onClick={() => confirmJournalMatch(item.match, item.bt)}>Confirm</button>
                : <button className="btn btn-p btn-sm" onClick={() => openSettleModal(item.bt, item.entity)}>Settle…</button>
              }
              <button className="btn btn-s btn-sm" style={{ color: 'var(--danger)', borderColor: 'rgba(248,113,113,0.35)' }} onClick={() => rejectMatch(item.match.id)}>Reject</button>
            </div>
          </div>
        )))}

        {/* ─ Unmatched ─ */}
        {tab === 'unmatched' && (loading ? (
          <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>Loading…</div>
        ) : unmatchedTxns.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center' }}>
            <div style={{ fontSize: 30, opacity: 0.18, marginBottom: 10 }}>✓</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No unmatched transactions</div>
          </div>
        ) : unmatchedTxns.map((bt) => (
          <div key={bt.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 18px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ flex: 1, minWidth: 0 }}><BtCell bt={bt} /></div>
              <button className="btn btn-p btn-sm" onClick={() => openSettleModal(bt)}>Settle…</button>
              <button className="btn btn-s btn-sm" onClick={() => createJnlFor?.id === bt.id ? setCreateJnlFor(null) : openCreateJnl(bt)}>
                {createJnlFor?.id === bt.id ? 'Close' : 'Categorise'}
              </button>
            </div>

            {/* Inline find-match */}
            {findFor?.id === bt.id && (
              <div style={{ padding: '12px 18px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                <input className="f-input" value={searchQ} autoFocus onChange={e => setSearchQ(e.target.value)}
                  placeholder="Search by ref, name, amount…" style={{ fontSize: 12, marginBottom: 8, width: '100%', boxSizing: 'border-box' }} />
                <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                  {filteredCands.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text-faint)', padding: '6px 0' }}>No candidates found</div>
                  ) : filteredCands.slice(0, 25).map(cand => (
                    <div key={cand.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', borderRadius: 4, marginBottom: 3, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 1 }}>
                          {typeTag(cand._type)}
                          <span style={{ fontSize: 10, color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' }}>{cand._date}</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cand._label}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmtEUR(cand.amount)}</span>
                        <button className="btn btn-p btn-sm" style={{ fontSize: 11 }} onClick={() => linkManual(bt, cand)}>Link</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Inline create journal */}
            {createJnlFor?.id === bt.id && jnlForm && (
              <div style={{ padding: '14px 18px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>CREATE JOURNAL — prefilled from bank transaction</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                  {[
                    { lbl: 'Date',           key: 'date',           type: 'date' },
                    { lbl: 'Amount',         key: 'amount',         type: 'number' },
                    { lbl: 'Debit Account',  key: 'debit_account',  type: 'text', placeholder: 'e.g. 6600' },
                    { lbl: 'Credit Account', key: 'credit_account', type: 'text', placeholder: 'e.g. 1000' },
                  ].map(f => (
                    <div key={f.key}>
                      <div style={{ fontSize: 10, color: 'var(--dim)', marginBottom: 3 }}>{f.lbl}</div>
                      <input className="f-input" type={f.type} step={f.type === 'number' ? '0.01' : undefined}
                        value={jnlForm[f.key]} placeholder={f.placeholder || ''}
                        onChange={e => setJnlForm(p => ({ ...p, [f.key]: e.target.value }))}
                        style={{ fontSize: 12 }} />
                    </div>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8, marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--dim)', marginBottom: 3 }}>Description</div>
                    <input className="f-input" value={jnlForm.description} onChange={e => setJnlForm(p => ({ ...p, description: e.target.value }))} style={{ fontSize: 12 }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--dim)', marginBottom: 3 }}>Reference (optional)</div>
                    <input className="f-input" value={jnlForm.reference} onChange={e => setJnlForm(p => ({ ...p, reference: e.target.value }))} placeholder="Auto-generated" style={{ fontSize: 12 }} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-p btn-sm" onClick={saveJnl} disabled={savingJnl}>{savingJnl ? 'Saving…' : 'Post & reconcile'}</button>
                  <button className="btn btn-s btn-sm" onClick={() => { setCreateJnlFor(null); setJnlForm(null); }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        )))}

        {/* ─ Reconciled ─ */}
        {tab === 'reconciled' && (loading ? (
          <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>Loading…</div>
        ) : reconciledItems.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center' }}>
            <div style={{ fontSize: 30, opacity: 0.18, marginBottom: 10 }}>⟳</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No reconciled transactions yet</div>
          </div>
        ) : (
          <>
            {reconciledItems.map((item, i) => (
              <div key={item.match.id} style={{ display: 'grid', gridTemplateColumns: '1fr 22px 1fr auto', alignItems: 'center', gap: 12, padding: '12px 18px', borderBottom: i < reconciledItems.length - 1 ? '1px solid var(--border)' : 'none', opacity: 0.82 }}>
                <BtCell bt={item.bt} />
                <div style={{ textAlign: 'center', color: 'var(--accent)', fontSize: 14 }}>✓</div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    {typeTag(item.entity ? item.entity._type : item.match.matched_type)}
                    {confBadge(item.match.confidence)}
                    {item.match.matched_by === 'auto' && <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--accent)', background: 'var(--accent-dim)', borderRadius: 3, padding: '1px 5px' }}>AUTO</span>}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.entity ? item.entity._label : `ID ${item.match.matched_id.slice(0, 8)}…`}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)', textAlign: 'right', flexShrink: 0 }}>
                  {item.match.confirmed_at ? new Date(item.match.confirmed_at).toLocaleDateString('en-IE', { day: '2-digit', month: 'short', year: '2-digit' }) : ''}
                </div>
              </div>
            ))}
            {reconciledItems.length < reconciledCount && (
              <div style={{ padding: '14px 18px', textAlign: 'center', borderTop: '1px solid var(--border)' }}>
                <button className="btn btn-s btn-sm" onClick={() => loadReconciledPage(reconciledPage + 1)}>
                  Load more ({reconciledCount - reconciledItems.length} remaining)
                </button>
              </div>
            )}
          </>
        ))}

      </div>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-pill)', padding: '10px 22px', fontSize: 13, zIndex: 9999, boxShadow: 'var(--shadow)' }}>
          {toast}
        </div>
      )}

      {/* ── Settlement Modal ── */}
      {settleFor && createPortal(
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.52)', zIndex: 9000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: 24 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 6, width: 'min(760px,95vw)', maxHeight: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column', flexShrink: 0, boxShadow: '0 8px 40px rgba(0,0,0,0.32)' }}>

            {/* Header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Settle Bank Transaction</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' }}>{settleFor.date}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: Number(settleFor.amount) >= 0 ? 'var(--accent)' : 'var(--danger)', fontVariantNumeric: 'tabular-nums' }}>
                    {Number(settleFor.amount) >= 0 ? '+' : ''}{fmtEUR(settleFor.amount)}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>{settleFor.description}</span>
                </div>
              </div>
              <button className="btn btn-s btn-sm" onClick={() => { setSettleFor(null); setSettleAllocs([]); setSettleErr(null); }}>✕</button>
            </div>

            {/* Body */}
            <div style={{ flex: '1 1 auto', overflowY: 'auto', minHeight: 0, padding: '16px 20px' }}>

              {/* Mode tabs */}
              <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
                {[['invoice','Match Invoice'],['on_account','On Account']].map(([m, label]) => (
                  <button key={m} onClick={() => setSettleMode(m)} style={{ padding: '6px 14px', fontSize: 12, fontWeight: settleMode === m ? 600 : 400, background: 'transparent', border: 'none', borderBottom: `2px solid ${settleMode === m ? 'var(--accent)' : 'transparent'}`, marginBottom: -1, cursor: 'pointer', color: settleMode === m ? 'var(--text)' : 'var(--text-muted)' }}>{label}</button>
                ))}
              </div>

              {settleMode === 'on_account' ? (
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.6 }}>
                    No matching invoice yet — record this line on account. Posts to a holding account; allocate to an invoice later.
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8, marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--dim)', marginBottom: 3 }}>Party Type</div>
                      <select className="f-input" value={settleOnAcc.party_type} onChange={e => setSettleOnAcc(p => ({ ...p, party_type: e.target.value }))}>
                        <option value="customer">Customer</option>
                        <option value="supplier">Supplier</option>
                      </select>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--dim)', marginBottom: 3 }}>Party Name</div>
                      <input className="f-input" value={settleOnAcc.party_name} onChange={e => setSettleOnAcc(p => ({ ...p, party_name: e.target.value }))} placeholder="Company name…" autoFocus />
                    </div>
                  </div>
                  <div style={{ padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 4, fontSize: 11, color: 'var(--text-faint)', fontFamily: 'Source Code Pro, monospace' }}>
                    {Number(settleFor.amount) >= 0
                      ? 'Dr Bank 1000  /  Cr Customer Advances 2350'
                      : 'Dr Supplier Prepayments 1250  /  Cr Bank 1000'}
                  </div>
                </div>
              ) : (
                <>
                  {/* Candidate list */}
                  <div style={{ marginBottom: 18 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-faint)', textTransform: 'uppercase', marginBottom: 8 }}>
                      {settleCands.length > 0 ? `${settleCands.length} open invoice${settleCands.length !== 1 ? 's' : ''}` : 'No open invoices found'}
                    </div>
                    {settleCands.slice(0, 12).map(cand => {
                      const alreadyAdded = settleAllocs.some(a => a.inv.id === cand.id);
                      return (
                        <div key={cand.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 4, marginBottom: 4, background: alreadyAdded ? 'var(--accent-dim)' : 'var(--surface-2)', border: `1px solid ${alreadyAdded ? 'rgba(52,211,153,0.25)' : 'var(--border)'}` }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                              {typeTag(cand._type)}
                              {cand._score >= 60 && confBadge(cand._score)}
                              <span style={{ fontSize: 10, color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' }}>{cand._date}</span>
                            </div>
                            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cand._label}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                              Outstanding: <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtEUR(cand.outstanding)}</strong>
                              {cand.outstanding !== cand.amount && <span style={{ color: 'var(--text-faint)' }}> / {fmtEUR(cand.amount)}</span>}
                            </div>
                          </div>
                          <button className="btn btn-s btn-sm" disabled={alreadyAdded} style={{ flexShrink: 0, opacity: alreadyAdded ? 0.45 : 1 }}
                            onClick={() => {
                              if (alreadyAdded) return;
                              const bankAbs   = Math.abs(Number(settleFor.amount));
                              const allocSum  = settleAllocs.reduce((s, a) => s + a.allocated_amount, 0);
                              const remaining = Math.max(0, bankAbs - allocSum);
                              const toAlloc   = Math.round(Math.min(cand.outstanding, remaining) * 100) / 100;
                              setSettleAllocs(prev => [...prev, { inv: cand, invoice_type: cand._type === 'invoice' ? 'ar' : 'ap', allocated_amount: toAlloc, difference_amount: 0, difference_nominal: '6500' }]);
                            }}>
                            {alreadyAdded ? '✓ Added' : '+ Add'}
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {/* Allocations */}
                  {settleAllocs.length > 0 && (
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-faint)', textTransform: 'uppercase', marginBottom: 8 }}>Allocations</div>
                      {settleAllocs.map((alloc, i) => {
                        const invRef = alloc.inv.invoice_number || alloc.inv.invoice_ref || '';
                        const party  = alloc.invoice_type === 'ar' ? (alloc.inv.client||'') : (alloc.inv.supplier||'');
                        return (
                          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 130px auto', gap: 8, alignItems: 'center', marginBottom: 5, padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 4, border: '1px solid var(--border)' }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{invRef}{party ? ` — ${party}` : ''}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' }}>Outstanding: {fmtEUR(alloc.inv.outstanding)}</div>
                            </div>
                            <input type="number" step="0.01" min="0" className="f-input" style={{ fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                              value={alloc.allocated_amount}
                              onChange={e => setSettleAllocs(prev => prev.map((a, j) => j === i ? { ...a, allocated_amount: parseFloat(e.target.value) || 0 } : a))}
                            />
                            <button className="btn btn-s btn-sm" style={{ color: 'var(--danger)' }} onClick={() => setSettleAllocs(prev => prev.filter((_, j) => j !== i))}>✕</button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Allocation progress + tolerance */}
                  {settleAllocs.length > 0 && (() => {
                    const bankAbs   = Math.abs(Number(settleFor.amount));
                    const allocated = settleAllocs.reduce((s, a) => s + a.allocated_amount, 0);
                    const withDiff  = settleAllocs.reduce((s, a) => s + a.allocated_amount + (a.difference_amount||0), 0);
                    const remaining = Math.round((bankAbs - allocated) * 100) / 100;
                    const matched   = Math.abs(bankAbs - withDiff) < 0.005;
                    const canTolerate = Math.abs(remaining) > 0.004 && Math.abs(remaining) <= 0.50;
                    return (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Allocated</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: matched ? 'var(--accent)' : 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                            {fmtEUR(withDiff)} / {fmtEUR(bankAbs)} {matched && '✓'}
                          </span>
                        </div>
                        <div style={{ height: 4, background: 'var(--surface-2)', borderRadius: 2, overflow: 'hidden', marginBottom: canTolerate ? 10 : 0 }}>
                          <div style={{ height: '100%', width: `${Math.min(withDiff / bankAbs * 100, 100)}%`, background: matched ? 'var(--accent)' : allocated > bankAbs ? 'var(--danger)' : 'var(--warn)', transition: 'width 0.15s', borderRadius: 2 }} />
                        </div>
                        {canTolerate && (
                          <div style={{ padding: '8px 10px', background: 'rgba(184,134,11,0.06)', border: '1px solid rgba(184,134,11,0.22)', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 11, color: 'var(--gold)', fontVariantNumeric: 'tabular-nums' }}>
                              {remaining > 0 ? 'Underpaid' : 'Overpaid'} by <strong>{fmtEUR(Math.abs(remaining))}</strong>
                            </span>
                            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                              <input type="checkbox" checked={(settleAllocs[settleAllocs.length-1]?.difference_amount||0) > 0}
                                onChange={e => {
                                  const last = settleAllocs.length - 1;
                                  setSettleAllocs(prev => prev.map((a, j) => j === last ? { ...a, difference_amount: e.target.checked ? Math.round(Math.abs(remaining) * 100) / 100 : 0 } : a));
                                }} />
                              Write off to
                            </label>
                            <select className="f-input" style={{ fontSize: 11, padding: '2px 6px', width: 'auto', height: 'auto' }}
                              value={settleAllocs[settleAllocs.length-1]?.difference_nominal || '6500'}
                              onChange={e => { const last = settleAllocs.length-1; setSettleAllocs(prev => prev.map((a, j) => j === last ? { ...a, difference_nominal: e.target.value } : a)); }}>
                              <option value="6500">6500 Bank Charges</option>
                              <option value="6750">6750 Settlement Rounding</option>
                              <option value="6600">6600 Sundry Expenses</option>
                            </select>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </>
              )}

              {settleErr && (
                <div style={{ marginTop: 8, padding: '7px 11px', background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.22)', borderRadius: 4, fontSize: 12, color: 'var(--danger)' }}>{settleErr}</div>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', flexShrink: 0, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-s" onClick={() => { setSettleFor(null); setSettleAllocs([]); setSettleErr(null); }}>Cancel</button>
              <button className="btn btn-p" onClick={confirmSettlement} disabled={settleSaving || (() => {
                if (settleMode === 'on_account') return !settleOnAcc.party_name.trim();
                if (!settleAllocs.length) return true;
                const bankAbs  = Math.abs(Number(settleFor.amount));
                const withDiff = settleAllocs.reduce((s, a) => s + a.allocated_amount + (a.difference_amount||0), 0);
                return Math.abs(withDiff - bankAbs) > 0.005;
              })()} style={{ opacity: (settleSaving || (() => {
                if (settleMode === 'on_account') return !settleOnAcc.party_name.trim();
                if (!settleAllocs.length) return true;
                const bankAbs  = Math.abs(Number(settleFor.amount));
                const withDiff = settleAllocs.reduce((s, a) => s + a.allocated_amount + (a.difference_amount||0), 0);
                return Math.abs(withDiff - bankAbs) > 0.005;
              })()) ? 0.4 : 1 }}>
                {settleSaving ? 'Posting…' : 'Confirm Settlement'}
              </button>
            </div>

          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

const NAV = [
  { section: "WORKSPACE", items: [
    { id: "overview", icon: "⌂", label: "Overview" },
    { id: "cashflow", icon: "↗", label: "Cash Flow" },
  ]},
  { section: "BANKING", items: [
    { id: "bank-import",    icon: "⇅", label: "Bank Import" },
    { id: "reconciliation", icon: "✓", label: "Reconciliation" },
    { id: "revenue",        icon: "₿", label: "Revenue Feed" },
  ]},
  { section: "SALES", items: [
    { id: "invoices",  icon: "◻", label: "AR Invoices" },
    { id: "contracts", icon: "📋", label: "Contracts" },
  ]},
  { section: "PURCHASES", items: [
    { id: "ap-invoices", icon: "◨", label: "AP Invoices" },
    { id: "expenses",    icon: "🧾", label: "Expenses" },
  ]},
  { section: "ACCOUNTING", items: [
    { id: "journals",       icon: "✎", label: "Journals" },
    { id: "gl",             icon: "⊞", label: "GL Reports" },
    { id: "fin-statements", icon: "§",  label: "Fin. Statements" },
  ]},
  { section: "COMPLIANCE", items: [
    { id: "compliance",   icon: "⊙", label: "Calendar" },
    { id: "vat-returns",  icon: "§",  label: "VAT Returns" },
    { id: "checklist",    icon: "☑", label: "Month End", badge: true },
  ]},
  { section: "PRACTICE", practiceOnly: true, items: [
    { id: "practice-clients",  icon: "◈", label: "Clients",      action: "practice"     },
    { id: "practice-add-co",   icon: "⊕", label: "Add Company",  action: "add-company"  },
  ]},
  { section: "SETTINGS", items: [
    { id: "settings", icon: "⚙", label: "Settings" },
  ]},
];

export default function App() {
  const { user, isLoaded } = useUser();
  const { isLoaded: orgsLoaded, userMemberships } = useOrganizationList({
    userMemberships: { pageSize: 50 },
  });

  // Dark-only — set attribute once so any residual data-theme selectors still resolve
  if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', 'dark');

  const [page, setPage] = useState("overview");

  // Collapsible nav sections
  const DEFAULT_OPEN_SECTIONS = ['WORKSPACE', 'BANKING', 'SALES', 'PURCHASES', 'ACCOUNTING', 'COMPLIANCE', 'PRACTICE'];
  const [openSections, setOpenSections] = useState(() => {
    try {
      const stored = localStorage.getItem('ff-nav-sections');
      if (stored) {
        const arr = JSON.parse(stored);
        if (Array.isArray(arr)) return new Set(arr);
      }
    } catch (_) {}
    return new Set(DEFAULT_OPEN_SECTIONS);
  });
  const toggleSection = s => setOpenSections(prev => {
    const next = new Set(prev);
    if (next.has(s)) next.delete(s); else next.add(s);
    try { localStorage.setItem('ff-nav-sections', JSON.stringify([...next])); } catch (_) {}
    return next;
  });
  const ensureSectionOpen = s => setOpenSections(prev => {
    if (prev.has(s)) return prev;
    const next = new Set(prev); next.add(s);
    try { localStorage.setItem('ff-nav-sections', JSON.stringify([...next])); } catch (_) {}
    return next;
  });

  const [companies, setCompanies] = useState([]);
  const [company, setCompany] = useState(null);
  const [onboarding, setOnboarding] = useState(false);
  const [companyLoading, setCompanyLoading] = useState(true);
  const [showPractice, setShowPractice] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [wizardInitStep, setWizardInitStep] = useState(1);
  const [showAddCompany, setShowAddCompany] = useState(false);

  // Global period state — YYYY-MM, lifted from Overview so all pages share one source of truth
  const [selPeriod, setSelPeriod] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  });
  const appPeriodOptions = useMemo(() => {
    const opts = [];
    const now = new Date();
    for (let i = 0; i < 25; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      opts.push({ val, label: d.toLocaleDateString("en-IE", { month: "short", year: "numeric" }), longLabel: d.toLocaleDateString("en-IE", { month: "long", year: "numeric" }) });
    }
    return opts;
  }, []);
  const appCurPeriod = appPeriodOptions[0]?.val ?? selPeriod;
  const [spY, spM] = selPeriod.split('-').map(Number);
  const period = new Date(spY, spM - 1, 1).toLocaleDateString("en-IE", { month: "long", year: "numeric" });
  const [showPeriodPicker, setShowPeriodPicker] = useState(false);
  const periodPickerRef = useRef(null);

  const companyName = company?.name || "Your Company";

  const [lastBankImport, setLastBankImport] = useState(null);
  useEffect(() => {
    if (!company?.id) return;
    supabase.from('bank_transactions').select('created_at').eq('company_id', company.id)
      .order('created_at', { ascending: false }).limit(1)
      .then(({ data }) => setLastBankImport(data?.[0]?.created_at || null));
  }, [company?.id]); // eslint-disable-line

  // Recurring journal catch-up: runs on company load, posts any missed periods
  const [recurringToast, setRecurringToast]     = useState(null);
  const [recurringSkipped, setRecurringSkipped] = useState(0);
  useEffect(() => {
    if (!company?.id) return;
    (async () => {
      try {
        const { data: templates } = await supabase
          .from('recurring_journals').select('*')
          .eq('company_id', company.id).eq('active', true);
        if (!templates?.length) return;

        const today = new Date();
        const todayStr = today.toISOString().slice(0, 10);
        let posted = 0, lockedSkips = 0;
        const monthLabels = new Set();

        // Fetch locked periods once; reused for every template and period iteration
        const lockedPeriods = await getLockedPeriods(company.id);

        for (const tpl of templates) {
          // Iterate months from start_date up to today's month
          const [sy, sm] = tpl.start_date.slice(0, 7).split('-').map(Number);
          const endY = today.getFullYear(), endM = today.getMonth() + 1;
          let y = sy, m = sm;
          while (y < endY || (y === endY && m <= endM)) {
            const period = `${y}-${String(m).padStart(2, '0')}`;
            // Check day has passed
            const lastDayOfMonth = new Date(y, m, 0).getDate();
            const dom = Math.min(tpl.day_of_month, lastDayOfMonth);
            const dueDate = `${period}-${String(dom).padStart(2, '0')}`;
            if (dueDate > todayStr) { if (m === 12) { y++; m = 1; } else { m++; } continue; }
            // Check end_date
            if (tpl.end_date && period > tpl.end_date.slice(0, 7)) { if (m === 12) { y++; m = 1; } else { m++; } continue; }

            // Period-lock check: don't post into a filed VAT period
            if (isDateLocked(dueDate, lockedPeriods)) {
              // Record skip idempotently so we don't re-check every load
              await supabase.from('recurring_journal_runs')
                .insert({ recurring_journal_id: tpl.id, period, status: 'skipped_locked' })
                .select('id').single();
              // Ignore 23505 conflict — already recorded as skipped
              lockedSkips++;
              if (m === 12) { y++; m = 1; } else { m++; }
              continue;
            }

            // Attempt idempotent insert of run row first
            const { error: runErr, data: runData } = await supabase
              .from('recurring_journal_runs')
              .insert({ recurring_journal_id: tpl.id, period, status: 'posted' })
              .select('id').single();

            if (runErr) { // 23505 = unique violation → already posted or already skipped
              if (m === 12) { y++; m = 1; } else { m++; }
              continue;
            }

            // Render description template tokens
            const monthName = new Date(y, m - 1, 1).toLocaleDateString('en-IE', { month: 'long' });
            const desc = (tpl.description_template || tpl.name)
              .replace(/\{month\}/gi, monthName).replace(/\{year\}/gi, String(y));

            // Post journal
            const jnlPayload = {
              company_id: company.id, date: dueDate, description: desc,
              debit_account: tpl.debit_account, credit_account: tpl.credit_account,
              amount: tpl.amount, reference: `REC-${period}-${tpl.id.slice(0, 6)}`,
              vat_code: tpl.vat_code || null,
              source_recurring_id: tpl.id, is_accrual_reversal: false,
            };
            const { data: jnl } = await supabase.from('journals').insert(jnlPayload).select('id').single();

            // Update run with journal_id
            if (jnl?.id) {
              await supabase.from('recurring_journal_runs').update({ journal_id: jnl.id }).eq('id', runData.id);
            }

            // Accrual reversal: debit/credit swapped, 1st of following month
            if (tpl.journal_type === 'accrual') {
              const nm = m === 12 ? 1 : m + 1;
              const ny = m === 12 ? y + 1 : y;
              const revDate = `${ny}-${String(nm).padStart(2, '0')}-01`;
              // Only post reversal if that date is also unlocked
              if (!isDateLocked(revDate, lockedPeriods)) {
                await supabase.from('journals').insert({
                  company_id: company.id, date: revDate,
                  description: `Reversal: ${desc}`,
                  debit_account: tpl.credit_account, credit_account: tpl.debit_account,
                  amount: tpl.amount, reference: `REV-${period}-${tpl.id.slice(0, 6)}`,
                  vat_code: null,
                  source_recurring_id: tpl.id, is_accrual_reversal: true,
                });
              }
            }

            posted++;
            monthLabels.add(new Date(y, m - 1, 1).toLocaleDateString('en-IE', { month: 'long', year: 'numeric' }));
            if (m === 12) { y++; m = 1; } else { m++; }
          }
        }

        if (posted > 0) {
          const label = monthLabels.size === 1 ? [...monthLabels][0] : `${monthLabels.size} periods`;
          setRecurringToast(`${posted} recurring journal${posted !== 1 ? 's' : ''} posted for ${label}`);
          setTimeout(() => setRecurringToast(null), 6000);
        }
        if (lockedSkips > 0) {
          setRecurringSkipped(lockedSkips);
        }
      } catch (err) {
        console.error('[recurring] engine error:', err.message);
      }
    })();
  }, [company?.id]); // eslint-disable-line

  const [chatOpen, setChatOpen] = useState(() => {
    try { return localStorage.getItem('ledgrly_chat_dock_state') === 'open'; } catch { return false; }
  });
  const openChat  = () => { setChatOpen(true);  try { localStorage.setItem('ledgrly_chat_dock_state', 'open');   } catch {} };
  const closeChat = () => { setChatOpen(false); try { localStorage.setItem('ledgrly_chat_dock_state', 'closed'); } catch {} };
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setChatOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!showPeriodPicker) return;
    const handler = (e) => { if (periodPickerRef.current && !periodPickerRef.current.contains(e.target)) setShowPeriodPicker(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPeriodPicker]); // eslint-disable-line

  // Compute user's role in active company's org
  const userRole = useMemo(() => {
    if (!company?.clerk_org_id) return 'owner';
    if (company.clerk_user_id === user?.id) return 'owner';
    const membership = (userMemberships?.data || []).find(
      m => m.organization.id === company.clerk_org_id
    );
    return membership?.role || 'org:member';
  }, [company, user, userMemberships?.data]);

  const isReadOnly = userRole === 'org:member';

  useEffect(() => {
    if (!isLoaded || !orgsLoaded) return;
    if (!user) { setCompanyLoading(false); return; }
    setCompanyLoading(true);

    const orgIds = (userMemberships?.data || []).map(m => m.organization.id).filter(Boolean);

    let query = supabase.from("companies").select("*");
    if (orgIds.length > 0) {
      query = query.or(`clerk_user_id.eq.${user.id},clerk_org_id.in.(${orgIds.join(',')})`);
    } else {
      query = query.eq("clerk_user_id", user.id);
    }

    query.then(({ data }) => {
      if (!data || data.length === 0) {
        setOnboarding(true);
      } else {
        setCompanies(data);
        setCompany(prev => prev ? (data.find(c => c.id === prev.id) || data[0]) : data[0]);
        setOnboarding(false);
      }
      setCompanyLoading(false);
    });
  }, [user?.id, isLoaded, orgsLoaded, userMemberships?.data?.length]);

  // Auto-open wizard when active company hasn't completed onboarding
  useEffect(() => {
    if (company?.id && company.onboarding_completed === false && !showWizard) {
      setShowWizard(true);
    }
  }, [company?.id, company?.onboarding_completed]); // eslint-disable-line

  // Signed-in user with no company yet → show wizard full-screen
  if (isLoaded && user && onboarding) return (
    <>
      <style>{CSS}</style>
      <OnboardingWizard
        user={user}
        company={null}
        onComplete={(c) => { setCompany(c); setCompanies([c]); setOnboarding(false); }}
        onUpdate={() => {}}
        onDismiss={() => {}}
        initStep={1}
      />
    </>
  );

  // Signed-in user, company check still in flight → hold render to avoid flash
  if (isLoaded && user && companyLoading && !company) return <style>{CSS}</style>;


  const titles = {
    overview:        ["Overview",         `${companyName} · ${period}`],
    cashflow:        ["Cash Flow",        "Forecasting · bank accounts · AP schedule"],
    invoices:        ["Invoices",         "AR ledger · aging · AI chase log"],
    "ap-invoices":   ["AP Invoices",      "Accounts payable · aged creditors · supplier invoices"],
    contracts:       ["Contracts",        "Active contracts · renewals · expiry tracking"],
    expenses:        ["Expenses",         "Receipts · approvals · GL posting"],
    checklist:       ["Month End Close",  `${period} · close checklist`],
    journals:     ["Journal Postings", `${period} · general ledger journals`],
    gl:           ["GL Reporting",     "Trial balance · P&L · Balance sheet · GL extract"],
    "bank-import":    ["Bank Import",      "Revolut Business · CSV import · journal posting"],
    reconciliation:   ["Reconciliation",  "Match transactions · clear outstanding items"],
    "practice-insights": ["Practice Insights", "Cross-client analytics · firm overview"],
    compliance:        ["Compliance",            "ROS · CRO · Revenue deadlines"],
    "vat-returns":     ["VAT Returns",           "VAT3 draft · T1/T2 computation · filing"],
    "fin-statements":  ["Financial Statements",  "FRS 105 · Micro-entity accounts · CRO filing"],
    settings:          ["Settings",              "Company settings · tax · compliance"],
  };

  const [title, subtitle] = showPractice
    ? ["Practice Dashboard", `${companies.length} workspaces`]
    : (titles[page] || ["", ""]);

  const openWizard = (step = 1) => { setWizardInitStep(step); setShowWizard(true); };

  const dismissGettingStarted = async () => {
    if (!company?.id) return;
    const { data } = await supabase.from('companies')
      .update({ onboarding_completed: true })
      .eq('id', company.id).select().single();
    if (data) {
      setCompany(data);
      setCompanies(prev => prev.map(x => x.id === data.id ? data : x));
    }
  };

  return (
    <AuthGate>
      <>
        <style>{CSS}</style>
        {showWizard && company && (
          <OnboardingWizard
            user={user}
            company={company}
            onComplete={(c) => { setCompany(c); setCompanies(prev => prev.map(x => x.id === c.id ? c : x)); setShowWizard(false); }}
            onUpdate={(c) => { setCompany(c); setCompanies(prev => prev.map(x => x.id === c.id ? c : x)); }}
            onDismiss={() => setShowWizard(false)}
            initStep={wizardInitStep}
          />
        )}
        {showAddCompany && user && (
          <AddCompanyModal
            user={user}
            onClose={() => setShowAddCompany(false)}
            onSuccess={(c, orgWarnMsg) => {
              setCompanies(prev => [...prev, c]);
              setCompany(c);
              setShowPractice(false);
              setPage("overview");
              setShowAddCompany(false);
              if (orgWarnMsg) setRecurringToast(orgWarnMsg);
            }}
          />
        )}
        {recurringToast && (
          <div style={{
            position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
            background: "var(--surface)", border: "1px solid rgba(52,211,153,0.4)",
            color: "var(--accent)", borderRadius: 8, padding: "10px 20px",
            fontSize: 13, fontWeight: 600, zIndex: 9999, boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <span>↻</span><span>{recurringToast}</span>
            <button onClick={() => setRecurringToast(null)} style={{ marginLeft: 8, background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: 14, lineHeight: 1 }}>×</button>
          </div>
        )}
        <div className={`app${chatOpen ? ' chat-is-open' : ''}`}>
          <div className="sidebar">
            <div className="sidebar-logo">
              <div className="logo-lockup">
                <svg className="logo-icon" width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <rect x="2" y="12" width="4" height="10" rx="1.5" fill="#34d399" opacity="0.6"/>
                  <rect x="10" y="7" width="4" height="15" rx="1.5" fill="#34d399"/>
                  <rect x="18" y="2" width="4" height="20" rx="1.5" fill="#34d399" opacity="0.8"/>
                </svg>
                <div className="logo-text-wrap">
                  <div className="logo-wordmark">Ledgrly</div>
                  <div className="logo-sub">Finance OS · Ireland</div>
                </div>
              </div>
            </div>
            <div className="nav">
              {NAV.filter(group => !group.practiceOnly || userRole === 'owner').map(group => {
                const isOpen = openSections.has(group.section);
                return (
                  <div key={group.section}>
                    <button className="nav-section-hdr" onClick={() => toggleSection(group.section)}>
                      <span className="nav-section-label">{group.section}</span>
                      <span className="nav-chevron">{isOpen ? "▾" : "▸"}</span>
                    </button>
                    <div className="nav-section-items" style={{ maxHeight: isOpen ? "400px" : "0" }}>
                      {group.items.map(item => {
                        const isActive = item.action === 'practice'
                          ? showPractice
                          : page === item.id && !showPractice;
                        return (
                          <button key={item.id}
                            className={`nav-item ${isActive ? "active" : ""}`}
                            onClick={() => {
                              if (item.action === 'practice') { setShowPractice(true); }
                              else if (item.action === 'add-company') { setShowAddCompany(true); }
                              else { setPage(item.id); setShowPractice(false); }
                              ensureSectionOpen(group.section);
                            }}>
                            <span className="nav-icon">{item.icon}</span>{item.label}
                            {item.badge && <span className="nav-badge">!</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="sidebar-footer">
              <CompanySwitcher
                companies={companies}
                company={company}
                onSwitch={c => { setCompany(c); setShowPractice(false); setPage("overview"); }}
                onPractice={() => { setShowPractice(true); }}
                onAddCompany={() => setShowAddCompany(true)}
              />
              <button className="sidebar-footer-btn" onClick={() => setPage("settings")}>
                <span style={{fontSize:13}}>⚙</span> Settings
              </button>
            </div>
          </div>
          <div className="main">
            {(() => {
              const hour = new Date().getHours();
              const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
              const bankDays = lastBankImport ? Math.floor((Date.now() - new Date(lastBankImport)) / 86400000) : null;
              const bankFresh = bankDays !== null && bankDays < 7;
              return (
                <div className="topbar">
                  <div style={{overflow:"hidden"}}>
                    <div className="topbar-greeting">{greeting}, I'm Ledgrly AI 👋</div>
                    <div className="topbar-sub">Here's what's happening with <strong style={{color:"var(--text)"}}>{companyName}</strong> today.</div>
                  </div>
                  <div className="topbar-right">
                    {bankDays === null ? null : (
                      <div className={`bank-pill ${bankFresh ? "bank-pill-ok" : "bank-pill-warn"}`}>
                        <span className="bank-dot" />
                        {bankFresh ? "AIB · Live" : `AIB · Updated ${bankDays}d ago`}
                      </div>
                    )}
                    <div ref={periodPickerRef} style={{ position: "relative" }}>
                      <button className="period-pill" style={{ cursor: "pointer" }} onClick={() => setShowPeriodPicker(p => !p)}>
                        📅 {period}
                        <svg width="10" height="10" viewBox="0 0 10 10" style={{ transform: showPeriodPicker ? "rotate(180deg)" : "none", transition: "transform 0.15s", opacity: 0.5, marginLeft: 4 }}>
                          <path d="M1 3 L5 7 L9 3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
                        </svg>
                      </button>
                      {showPeriodPicker && (
                        <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 400, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-card)", boxShadow: "0 8px 24px rgba(0,0,0,0.4)", minWidth: 160, maxHeight: 300, overflowY: "auto" }}>
                          {appPeriodOptions.map(opt => (
                            <div key={opt.val}
                              onClick={() => { setSelPeriod(opt.val); setShowPeriodPicker(false); }}
                              style={{ padding: "9px 16px", fontSize: 12, cursor: "pointer", background: opt.val === selPeriod ? "var(--accent-dim)" : "transparent", color: opt.val === selPeriod ? "var(--accent)" : "var(--text)", fontWeight: opt.val === appCurPeriod ? 600 : 400, borderBottom: opt.val === appCurPeriod ? "1px solid var(--border)" : "none" }}
                              onMouseEnter={e => { if (opt.val !== selPeriod) e.currentTarget.style.background = "var(--surface-2)"; }}
                              onMouseLeave={e => { e.currentTarget.style.background = opt.val === selPeriod ? "var(--accent-dim)" : "transparent"; }}
                            >
                              {opt.val === appCurPeriod ? `${opt.label} (current)` : opt.label}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <UserChip />
                    {window.location.pathname !== '/mobile' && !chatOpen && (
                      <button className="chat-dock-trigger" onClick={openChat}>
                        ⚡ Ask Ledgrly AI
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}

            <div className="content">
              {showPractice ? (
                <PracticeDashboard
                  companies={companies}
                  onSelectCompany={c => { setCompany(c); setShowPractice(false); setPage("overview"); }}
                  onAddCompany={() => setShowAddCompany(true)}
                />
              ) : (
                <>
                  {page === "overview"     && <Overview period={period} selPeriod={selPeriod} setSelPeriod={setSelPeriod} appCurPeriod={appCurPeriod} companyId={company?.id} company={company} onNavigate={setPage} recurringPosted={recurringToast} recurringSkipped={recurringSkipped} onOpenWizard={openWizard} onDismissGetStarted={dismissGettingStarted} />}
                  {page === "cashflow"     && <CashFlow selPeriod={selPeriod} onNavigate={setPage} companyId={company?.id} company={company} />}
                  {page === "invoices"     && <Invoices companyName={companyName} companyId={company?.id} company={company} />}
                  {page === "ap-invoices"  && <APInvoices companyName={companyName} company={company} />}
                  {page === "contracts"    && <Contracts companyName={companyName} companyId={company?.id} />}
                  <div style={{display: page === "expenses" ? "block" : "none"}}>
                    <Expenses companyName={companyName} isAdmin={!isReadOnly} companyId={company?.id} />
                  </div>
                  {page === "checklist"    && <Checklist period={period} selPeriod={selPeriod} companyId={company?.id} company={company} />}
                  {page === "checklist"    && <SuggestedJournals period={selPeriod || period} companyId={company?.id} company={company} />}
                  {page === "journals"     && <Journals period={period} selPeriod={selPeriod} companyName={companyName} companyId={company?.id} readOnly={isReadOnly} />}
                  {page === "gl"           && <GLReport period={period} selPeriod={selPeriod} companyId={company?.id} companyName={companyName} company={company} readOnly={isReadOnly} />}
                  <div style={{display: page === "bank-import" ? "block" : "none"}}>
                    <BankImportErrorBoundary><BankImport companyId={company?.id} /></BankImportErrorBoundary>
                  </div>
                  {page === "reconciliation" && <Reconciliation companyId={company?.id} onNavigate={setPage} />}
                  {page === "revenue"        && <RevenueFeed companyId={company?.id} company={company} />}
                  {page === "compliance"      && <Compliance company={company} onNavigate={setPage} />}
                  {page === "vat-returns"    && <VATReturns company={company} onNavigate={setPage} />}
                  {page === "fin-statements" && <FinancialStatements company={company} companyName={companyName} />}
                  {page === "settings"       && <Settings company={company} onUpdate={c => { setCompany(c); setCompanies(prev => prev.map(x => x.id === c.id ? c : x)); }} />}
                </>
              )}
            </div>
          </div>
          {window.location.pathname !== '/mobile' && (
            <div className={`chat-dock${chatOpen ? ' chat-dock-open' : ''}`}>
              <Chat page={title} companyName={companyName} period={period} selPeriod={selPeriod} companyId={company?.id} company={company} onClose={closeChat} />
            </div>
          )}
        </div>
      </>
    </AuthGate>
  );
}




