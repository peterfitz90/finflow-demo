// src/entitlements.js
// Single source of truth for plan entitlements.
// Always use can(company, 'feature') / limit(company, 'key') / isPending(company).
// Never hardcode a plan check anywhere else.

export const PLAN_META = {
  pending:    { label: 'Pending Activation' },
  personal:   { label: 'Personal' },
  founder:    { label: 'Founder' },
  practice:   { label: 'Practice' },
  enterprise: { label: 'Enterprise' },
};

export const FEATURE_LABELS = {
  bank_feeds:         'Live Bank Feeds',
  cash_flow:          'Cash Flow Forecasting',
  revenue_feed:       'Revenue Feed',
  ar_invoicing:       'AR Invoicing',
  ar_import:          'Bulk AR Import',
  ap_invoicing:       'Bills & Payables',
  contracts:          'Contract Management',
  expenses:           'Expense Management',
  vat_returns:        'VAT Returns',
  compliance:         'Compliance Calendar',
  month_end:          'Month-End Checklist',
  fin_statements:     'Financial Statements',
  recurring_journals: 'Recurring Journals',
  payroll_import:     'Payroll Import',
  opening_balances:   'Opening Balances',
  fixed_assets:       'Fixed Asset Register',
  form_11:            'Form 11 Working Paper',
  ai_chat:            'Ask Ledgrly AI',
  ap_mailbox:         'AP Email Inbox',
  practice_dashboard: 'Practice Dashboard',
  ct_pack:            'Corporation Tax Pack',
  api_access:         'API Access',
};

export const FEATURE_VALUE = {
  bank_feeds:         'Connect your bank account directly — transactions sync automatically, no CSV exports needed',
  cash_flow:          '13-week rolling forecast, bank snapshots, and AP schedule in one view',
  revenue_feed:       'Connect Stripe and other revenue providers for automatic reconciliation',
  ar_invoicing:       'Send invoices, chase overdue accounts, and track aged debtors',
  ar_import:          'Bulk-import AR invoices from a spreadsheet in one step',
  ap_invoicing:       'Manage supplier bills, aged creditors, and payment schedules',
  contracts:          'Track active contracts, renewal dates, and expiry alerts',
  expenses:           'Capture receipts, approve claims, and post to the GL automatically',
  vat_returns:        'Auto-compute VAT3 — T1/T2 breakdown, one-click ROS submission',
  compliance:         'Never miss a deadline — Revenue, CRO, and PAYE calendar in one place',
  month_end:          'Guided month-end close checklist with auto-evaluation',
  fin_statements:     'FRS 105 micro-entity accounts and CRO filing pack',
  recurring_journals: 'Set-and-forget journals — prepayments, accruals, rent, wages',
  payroll_import:     'Import payroll journals directly from BrightPay',
  opening_balances:   'Set historical balances and migrate existing AR/AP in one step',
  fixed_assets:       'Full asset register with depreciation, disposals, and Irish W&T schedules',
  form_11:            'Sole trader Form 11 working paper — extracts, capital allowances, and flagged nominals',
  ai_chat:            'Ask any question about your financials — Ledgrly AI answers instantly',
  ap_mailbox:         'Forward supplier invoices to your dedicated mailbox — auto-parsed and queued',
  practice_dashboard: 'Manage multiple clients from one dashboard with cross-client analytics',
  ct_pack:            'Corporation Tax computations and CT1 filing preparation',
  api_access:         'Programmatic access to your financial data via REST API',
};

// Which plan first unlocks a feature — used in upgrade card copy
export const FEATURE_FIRST_PLAN = {
  bank_feeds:         'founder',
  cash_flow:          'founder',
  revenue_feed:       'founder',
  ar_invoicing:       'founder',
  ar_import:          'founder',
  ap_invoicing:       'founder',
  contracts:          'founder',
  expenses:           'founder',
  vat_returns:        'founder',
  compliance:         'founder',
  month_end:          'founder',
  fin_statements:     'founder',
  recurring_journals: 'founder',
  payroll_import:     'founder',
  opening_balances:   'founder',
  fixed_assets:       'founder',
  form_11:            'founder',
  ai_chat:            'founder',
  ap_mailbox:         'founder',
  practice_dashboard: 'practice',
  ct_pack:            'founder',
  api_access:         'enterprise',
};

const _ALL_ON = {
  bank_feeds: true,
  cash_flow: true, revenue_feed: true, ar_invoicing: true, ar_import: true,
  ap_invoicing: true, contracts: true, expenses: true, vat_returns: true,
  compliance: true, month_end: true, fin_statements: true, recurring_journals: true,
  payroll_import: true, opening_balances: true, fixed_assets: true, form_11: true,
  ai_chat: true, ap_mailbox: true, practice_dashboard: false,
  ct_pack: true, api_access: false,
};

const PLAN_FEATURES = {
  pending: {},
  personal: {
    bank_feeds: false,
    cash_flow: false, revenue_feed: false, ar_invoicing: false, ar_import: false,
    ap_invoicing: false, contracts: false, expenses: false, vat_returns: false,
    compliance: false, month_end: false, fin_statements: false, recurring_journals: false,
    payroll_import: false, opening_balances: false, fixed_assets: false, form_11: false,
    ai_chat: false, ap_mailbox: false, practice_dashboard: false,
    ct_pack: false, api_access: false,
  },
  founder:    { ..._ALL_ON },
  practice:   { ..._ALL_ON, practice_dashboard: true },
  enterprise: { ..._ALL_ON, practice_dashboard: true, api_access: true },
};

const PLAN_LIMITS = {
  pending:    { companies: 0,    bank_txns_per_month: 0    },
  personal:   { companies: 1,    bank_txns_per_month: 100  },
  founder:    { companies: 1,    bank_txns_per_month: null },
  practice:   { companies: null, bank_txns_per_month: null },
  enterprise: { companies: null, bank_txns_per_month: null },
};

function _resolvePlan(company) {
  const p = company?.plan;
  if (p === 'pending') return 'pending'; // explicit — must not fall through
  if (PLAN_FEATURES[p]) return p;
  if (p != null) console.warn('[entitlements] unrecognised plan:', p, '— defaulting to founder');
  return 'founder'; // null / undefined / unrecognised → open, never lock a paying user out
}

export function can(company, feature) {
  return PLAN_FEATURES[_resolvePlan(company)]?.[feature] === true;
}

export function limit(company, key) {
  return PLAN_LIMITS[_resolvePlan(company)]?.[key] ?? null;
}

export function isPending(company) {
  return company?.plan === 'pending';
}

export function planLabel(company) {
  return PLAN_META[_resolvePlan(company)]?.label ?? 'Founder';
}

export function planFor(feature) {
  return PLAN_META[FEATURE_FIRST_PLAN[feature] || 'founder']?.label ?? 'Founder';
}

export { PLAN_FEATURES, PLAN_LIMITS };
