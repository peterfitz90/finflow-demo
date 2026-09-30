// Transaction rules engine — the transaction_rules patterns BankImport, Needs Review and expense
// capture all categorise with. Shared by the full app and /mobile. (api/yapily/ingest.js keeps
// its own server-side copy of applyRules/preCleanDesc.)
import { useState, useEffect } from 'react';
import { supabase } from '../supabase.js';

// ── System rule seed (mirrors SQL seed — used for client-side auto-seeding if table is empty) ──
export const SYSTEM_RULES_SEED = [
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

export function useTransactionRules(companyId) {
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

// Strip AIB-style prefixes and trailing junk to get a clean merchant name for pattern matching.
// Example: "*INET BWAGES IE25121264477151 TxnDate: 12Dec2025" → "inet bwages"
export function preCleanDesc(raw) {
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

// Applies transaction_rules from the DB against a description + amount.
// Rules are sorted: user > learned > system, then exact > startswith > contains > regex,
// then longer patterns first (more specific wins within same match_type).
// Returns matched rule object or null.
export function applyRules(description, amount, rules) {
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
