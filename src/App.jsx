import { useState, useEffect, useRef } from "react";

// ─── MOCK DATA ────────────────────────────────────────────────────────────────
const COMPANY = "Brennan & Sons Ltd";
const PERIOD = "April 2026";

const cashData = {
  position: 47820, change: 3240,
  forecast: [
    { label: "Today", value: 47820 },
    { label: "30 Days", value: 52400 },
    { label: "60 Days", value: 38900 },
    { label: "90 Days", value: 61200 },
  ],
  upcomingAP: [
    { name: "Office Lease", amount: 2400, due: "02 May" },
    { name: "Payroll Run", amount: 18600, due: "07 May" },
    { name: "VAT3 Payment", amount: 6120, due: "19 May" },
  ],
};

const invoices = [
  { id: "INV-0091", client: "Murphy Retail", amount: 4800, days: 62, status: "escalated" },
  { id: "INV-0087", client: "Clancy Engineering", amount: 2200, days: 44, status: "chased" },
  { id: "INV-0094", client: "Aoife Design Co.", amount: 1650, days: 31, status: "chased" },
  { id: "INV-0096", client: "West Cork Meats", amount: 960, days: 18, status: "pending" },
];

const compliance = [
  { title: "VAT3 Return", period: "Mar/Apr", deadline: "19 May", daysLeft: 19, status: "prep-ready" },
  { title: "CT1 Filing", period: "FY 2024", deadline: "23 Jun", daysLeft: 54, status: "upcoming" },
  { title: "Annual Return (CRO)", period: "2024", deadline: "14 Jul", daysLeft: 75, status: "upcoming" },
  { title: "P30 Payroll", period: "April", deadline: "14 May", daysLeft: 14, status: "action-needed" },
];

const anomalies = [
  { text: "Duplicate payment flagged — €340 to Limerick Supplies (27 Apr & 28 Apr)", severity: "high" },
  { text: "Contractor spend up 34% vs last quarter — review recommended", severity: "medium" },
];

const CHECKLIST_SECTIONS = [
  { title: "Bank & Cash", items: [
    { id: "b1", label: "Download & import bank statements for all accounts", auto: false },
    { id: "b2", label: "Complete bank reconciliation — all accounts", auto: false },
    { id: "b3", label: "Investigate and clear all reconciling items", auto: false },
    { id: "b4", label: "Confirm petty cash balance matches ledger", auto: false },
  ]},
  { title: "Accounts Receivable", items: [
    { id: "ar1", label: "Review aged debtor report — chase 30/60/90+ day balances", auto: true },
    { id: "ar2", label: "Post all sales invoices and credit notes", auto: false },
    { id: "ar3", label: "Confirm all cash receipts allocated correctly", auto: false },
    { id: "ar4", label: "Review bad debt provision — update if required", auto: false },
    { id: "ar5", label: "Reconcile debtors ledger to control account", auto: false },
  ]},
  { title: "Accounts Payable", items: [
    { id: "ap1", label: "Post all supplier invoices received", auto: false },
    { id: "ap2", label: "Reconcile supplier statements to ledger", auto: false },
    { id: "ap3", label: "Confirm all payments allocated correctly", auto: false },
    { id: "ap4", label: "Review creditors ledger to control account", auto: false },
    { id: "ap5", label: "Identify invoices due in next 30 days", auto: true },
  ]},
  { title: "Payroll", items: [
    { id: "p1", label: "Process monthly payroll run", auto: false },
    { id: "p2", label: "Submit P30 to Revenue via ROS", auto: false },
    { id: "p3", label: "Post payroll journals to GL", auto: false },
    { id: "p4", label: "Confirm PAYE/PRSI/USC liabilities cleared", auto: false },
  ]},
  { title: "VAT & Compliance", items: [
    { id: "v1", label: "Prepare VAT3 return workings", auto: true },
    { id: "v2", label: "Review VAT on purchases — confirm reclaim eligibility", auto: false },
    { id: "v3", label: "Submit VAT3 on ROS before deadline", auto: false },
    { id: "v4", label: "Check ROS for any Revenue correspondence", auto: false },
  ]},
  { title: "General Ledger", items: [
    { id: "g1", label: "Post accruals and prepayments", auto: false },
    { id: "g2", label: "Post depreciation journals", auto: true },
    { id: "g3", label: "Review intercompany balances — confirm agree", auto: false },
    { id: "g4", label: "Clear suspense accounts — all items resolved", auto: false },
    { id: "g5", label: "Run trial balance — review for unusual items", auto: true },
    { id: "g6", label: "Lock prior period to prevent late postings", auto: false },
  ]},
  { title: "Reporting", items: [
    { id: "r1", label: "Prepare P&L vs budget — investigate variances >5%", auto: false },
    { id: "r2", label: "Prepare balance sheet with prior month comparatives", auto: false },
    { id: "r3", label: "Prepare cash flow statement", auto: true },
    { id: "r4", label: "Board pack / management accounts distributed", auto: false },
    { id: "r5", label: "File month end sign-off with date and preparer", auto: false },
  ]},
];

const GL_ACCOUNTS = [
  { code: "1000", name: "Bank — Current Account", type: "Asset" },
  { code: "1010", name: "Bank — Deposit Account", type: "Asset" },
  { code: "1100", name: "Trade Debtors", type: "Asset" },
  { code: "1200", name: "Prepayments", type: "Asset" },
  { code: "1500", name: "Plant & Machinery (Cost)", type: "Asset" },
  { code: "1510", name: "Plant & Machinery (Dep'n)", type: "Asset" },
  { code: "2000", name: "Trade Creditors", type: "Liability" },
  { code: "2100", name: "VAT Liability", type: "Liability" },
  { code: "2200", name: "PAYE/PRSI Liability", type: "Liability" },
  { code: "2300", name: "Accruals", type: "Liability" },
  { code: "3000", name: "Share Capital", type: "Equity" },
  { code: "3100", name: "Retained Earnings", type: "Equity" },
  { code: "4000", name: "Sales Revenue", type: "Income" },
  { code: "4100", name: "Other Income", type: "Income" },
  { code: "5000", name: "Cost of Sales", type: "Expense" },
  { code: "6000", name: "Salaries & Wages", type: "Expense" },
  { code: "6100", name: "Rent & Rates", type: "Expense" },
  { code: "6200", name: "Motor & Travel", type: "Expense" },
  { code: "6300", name: "Telephone & Internet", type: "Expense" },
  { code: "6400", name: "Professional Fees", type: "Expense" },
  { code: "6500", name: "Depreciation", type: "Expense" },
  { code: "6600", name: "Sundry Expenses", type: "Expense" },
];

const GL_TB = [
  { code: "1000", name: "Bank — Current Account", type: "Asset", debit: 47820, credit: 0 },
  { code: "1010", name: "Bank — Deposit Account", type: "Asset", debit: 12400, credit: 0 },
  { code: "1100", name: "Trade Debtors", type: "Asset", debit: 89340, credit: 0 },
  { code: "1200", name: "Prepayments", type: "Asset", debit: 4200, credit: 0 },
  { code: "1500", name: "Plant & Machinery (Cost)", type: "Asset", debit: 85000, credit: 0 },
  { code: "1510", name: "Plant & Machinery (Dep'n)", type: "Asset", debit: 0, credit: 34000 },
  { code: "2000", name: "Trade Creditors", type: "Liability", debit: 0, credit: 31450 },
  { code: "2100", name: "VAT Liability", type: "Liability", debit: 0, credit: 6120 },
  { code: "2200", name: "PAYE/PRSI Liability", type: "Liability", debit: 0, credit: 4880 },
  { code: "2300", name: "Accruals", type: "Liability", debit: 0, credit: 8600 },
  { code: "3000", name: "Share Capital", type: "Equity", debit: 0, credit: 50000 },
  { code: "3100", name: "Retained Earnings", type: "Equity", debit: 0, credit: 62180 },
  { code: "4000", name: "Sales Revenue", type: "Income", debit: 0, credit: 148600 },
  { code: "4100", name: "Other Income", type: "Income", debit: 0, credit: 3200 },
  { code: "5000", name: "Cost of Sales", type: "Expense", debit: 74300, credit: 0 },
  { code: "6000", name: "Salaries & Wages", type: "Expense", debit: 38400, credit: 0 },
  { code: "6100", name: "Rent & Rates", type: "Expense", debit: 9600, credit: 0 },
  { code: "6200", name: "Motor & Travel", type: "Expense", debit: 4120, credit: 0 },
  { code: "6300", name: "Telephone & Internet", type: "Expense", debit: 1840, credit: 0 },
  { code: "6400", name: "Professional Fees", type: "Expense", debit: 6200, credit: 0 },
  { code: "6500", name: "Depreciation", type: "Expense", debit: 8500, credit: 0 },
  { code: "6600", name: "Sundry Expenses", type: "Expense", debit: 1510, credit: 0 },
];

const PNL = {
  revenue: [
    { name: "Sales Revenue", current: 148600, budget: 142000, prior: 131200 },
    { name: "Other Income", current: 3200, budget: 2500, prior: 2800 },
  ],
  cos: [{ name: "Cost of Sales", current: 74300, budget: 71000, prior: 65600 }],
  opex: [
    { name: "Salaries & Wages", current: 38400, budget: 37000, prior: 36000 },
    { name: "Rent & Rates", current: 9600, budget: 9600, prior: 9600 },
    { name: "Motor & Travel", current: 4120, budget: 3500, prior: 3200 },
    { name: "Telephone & Internet", current: 1840, budget: 1800, prior: 1750 },
    { name: "Professional Fees", current: 6200, budget: 5000, prior: 4800 },
    { name: "Depreciation", current: 8500, budget: 8500, prior: 8500 },
    { name: "Sundry Expenses", current: 1510, budget: 1200, prior: 980 },
  ],
};

const JOURNAL_TYPES = ["Accrual", "Prepayment", "Depreciation", "Payroll", "Correction", "Intercompany", "Other"];

const POSTED_JOURNALS = [
  { ref: "JNL-001", date: "30 Apr 2026", type: "Depreciation", description: "Monthly depreciation — Plant & Machinery", preparedBy: "System", status: "posted",
    lines: [{ account: "6500", name: "Depreciation", debit: 8500, credit: 0 }, { account: "1510", name: "Plant & Machinery (Dep'n)", debit: 0, credit: 8500 }] },
  { ref: "JNL-002", date: "30 Apr 2026", type: "Accrual", description: "Accrual — legal fees outstanding", preparedBy: "P. Brennan", status: "posted",
    lines: [{ account: "6400", name: "Professional Fees", debit: 3200, credit: 0 }, { account: "2300", name: "Accruals", debit: 0, credit: 3200 }] },
  { ref: "JNL-003", date: "30 Apr 2026", type: "Prepayment", description: "Prepayment — annual insurance premium", preparedBy: "P. Brennan", status: "posted",
    lines: [{ account: "1200", name: "Prepayments", debit: 4200, credit: 0 }, { account: "6600", name: "Sundry Expenses", debit: 0, credit: 4200 }] },
];

// ─── GL EXTRACT DATA ──────────────────────────────────────────────────────────
// Realistic transaction-level entries per account for April 2026
const GL_EXTRACT = {
  "1000": [
    { date: "01 Apr", ref: "OB-001",  type: "Opening",     narrative: "Opening balance brought forward",            debit: 44580, credit: 0 },
    { date: "03 Apr", ref: "RCP-041", type: "Receipt",     narrative: "Murphy Retail — receipt on account",         debit: 12000, credit: 0 },
    { date: "07 Apr", ref: "PAY-019", type: "Payment",     narrative: "Payroll run — March salaries",               debit: 0, credit: 38400 },
    { date: "10 Apr", ref: "RCP-042", type: "Receipt",     narrative: "Clancy Engineering — INV-0082 settlement",   debit: 5600,  credit: 0 },
    { date: "14 Apr", ref: "PAY-020", type: "Payment",     narrative: "PAYE/PRSI — March P30",                      debit: 0, credit: 4880  },
    { date: "19 Apr", ref: "PAY-021", type: "Payment",     narrative: "VAT3 — Feb/Mar payment",                     debit: 0, credit: 5820  },
    { date: "22 Apr", ref: "RCP-043", type: "Receipt",     narrative: "West Cork Meats — INV-0088 settlement",      debit: 3200,  credit: 0 },
    { date: "25 Apr", ref: "PAY-022", type: "Payment",     narrative: "Office lease — April",                       debit: 0, credit: 2400  },
    { date: "28 Apr", ref: "PAY-023", type: "Payment",     narrative: "Limerick Supplies — duplicate flagged",      debit: 0, credit: 340   },
    { date: "30 Apr", ref: "PAY-024", type: "Payment",     narrative: "Limerick Supplies — INV-LS-204",             debit: 0, credit: 340   },
    { date: "30 Apr", ref: "RCP-044", type: "Receipt",     narrative: "Aoife Design Co. — part payment",            debit: 8620,  credit: 0 },
  ],
  "1100": [
    { date: "01 Apr", ref: "OB-002",  type: "Opening",     narrative: "Opening balance brought forward",            debit: 85140, credit: 0 },
    { date: "03 Apr", ref: "INV-0089",type: "Invoice",     narrative: "Sales invoice — Murphy Retail",              debit: 4800,  credit: 0 },
    { date: "03 Apr", ref: "RCP-041", type: "Receipt",     narrative: "Murphy Retail — receipt on account",         debit: 0, credit: 12000 },
    { date: "10 Apr", ref: "RCP-042", type: "Receipt",     narrative: "Clancy Engineering — INV-0082 settlement",   debit: 0, credit: 5600  },
    { date: "14 Apr", ref: "INV-0091",type: "Invoice",     narrative: "Sales invoice — Clancy Engineering",         debit: 2200,  credit: 0 },
    { date: "18 Apr", ref: "INV-0092",type: "Invoice",     narrative: "Sales invoice — West Cork Meats",            debit: 960,   credit: 0 },
    { date: "22 Apr", ref: "RCP-043", type: "Receipt",     narrative: "West Cork Meats — INV-0088 settlement",      debit: 0, credit: 3200  },
    { date: "24 Apr", ref: "INV-0093",type: "Invoice",     narrative: "Sales invoice — Aoife Design Co.",           debit: 1650,  credit: 0 },
    { date: "30 Apr", ref: "RCP-044", type: "Receipt",     narrative: "Aoife Design Co. — part payment",            debit: 0, credit: 8620  },
    { date: "30 Apr", ref: "INV-0094",type: "Invoice",     narrative: "Sales invoice — O'Brien Logistics",          debit: 14390, credit: 0 },
  ],
  "4000": [
    { date: "01 Apr", ref: "OB-003",  type: "Opening",     narrative: "Opening balance brought forward",            debit: 0, credit: 118200 },
    { date: "03 Apr", ref: "INV-0089",type: "Invoice",     narrative: "Sales — Murphy Retail",                      debit: 0, credit: 4800  },
    { date: "14 Apr", ref: "INV-0091",type: "Invoice",     narrative: "Sales — Clancy Engineering",                 debit: 0, credit: 2200  },
    { date: "18 Apr", ref: "INV-0092",type: "Invoice",     narrative: "Sales — West Cork Meats",                    debit: 0, credit: 960   },
    { date: "24 Apr", ref: "INV-0093",type: "Invoice",     narrative: "Sales — Aoife Design Co.",                   debit: 0, credit: 1650  },
    { date: "30 Apr", ref: "INV-0094",type: "Invoice",     narrative: "Sales — O'Brien Logistics",                  debit: 0, credit: 14390 },
    { date: "30 Apr", ref: "INV-0095",type: "Invoice",     narrative: "Sales — Sundry cash sales",                  debit: 0, credit: 7400  },
  ],
  "6000": [
    { date: "01 Apr", ref: "OB-004",  type: "Opening",     narrative: "Opening balance brought forward",            debit: 0,     credit: 0 },
    { date: "07 Apr", ref: "PAY-019", type: "Payroll",     narrative: "Payroll — April gross salaries",             debit: 32000, credit: 0 },
    { date: "30 Apr", ref: "JNL-004", type: "Accrual",     narrative: "Accrual — bonus provision Q2",              debit: 6400,  credit: 0 },
  ],
  "6400": [
    { date: "01 Apr", ref: "OB-005",  type: "Opening",     narrative: "Opening balance brought forward",            debit: 3000,  credit: 0 },
    { date: "12 Apr", ref: "PUR-031", type: "Purchase",    narrative: "Arthur Cox — legal retainer April",          debit: 1800,  credit: 0 },
    { date: "20 Apr", ref: "PUR-032", type: "Purchase",    narrative: "McCann FitzGerald — commercial advice",      debit: 1400,  credit: 0 },
    { date: "30 Apr", ref: "JNL-002", type: "Accrual",     narrative: "Accrual — legal fees outstanding",           debit: 3200,  credit: 0 },
    { date: "30 Apr", ref: "JNL-002", type: "Reversal",    narrative: "Reversal — prior month accrual",             debit: 0, credit: 3200  },
  ],
  "2100": [
    { date: "01 Apr", ref: "OB-006",  type: "Opening",     narrative: "Opening balance brought forward",            debit: 0, credit: 5460  },
    { date: "03 Apr", ref: "VAT-APR", type: "VAT",         narrative: "VAT on sales — April invoices",              debit: 0, credit: 6120  },
    { date: "12 Apr", ref: "VAT-APR", type: "VAT",         narrative: "VAT on purchases — April reclaim",           debit: 2840,  credit: 0 },
    { date: "19 Apr", ref: "PAY-019", type: "Payment",     narrative: "VAT3 payment — Feb/Mar",                     debit: 5460,  credit: 0 },
  ],
};

const fmt = (n) => `€${Math.abs(n).toLocaleString("en-IE")}`;
const fmtK = (n) => n >= 1000 ? `€${(n / 1000).toFixed(0)}k` : fmt(n);
let jnlCounter = 4;

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&family=Source+Sans+3:wght@300;400;500;600&family=Source+Code+Pro:wght@400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #f4f2ee; --surface: #faf9f7; --surface2: #eeece8; --surface3: #e5e2db;
    --border: #d8d4cc; --border2: #c8c3b8;
    --navy: #1a2744; --navy2: #243058;
    --teal: #1d6b72; --teal2: #258a93;
    --gold: #b8860b; --gold2: #d4a017;
    --red: #8b2020; --green: #1a5c35;
    --text: #1a1a1a; --muted: #6b6560; --dim: #9e9990; --white: #faf9f7;
  }
  body { background: var(--bg); color: var(--text); font-family: 'Source Sans 3', sans-serif; font-size: 14px; }
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: var(--surface2); }
  ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }
  .app { display: flex; height: 100vh; overflow: hidden; }
  .sidebar { width: 225px; min-width: 225px; background: var(--navy); display: flex; flex-direction: column; border-right: 3px solid var(--gold); }
  .sidebar-logo { padding: 20px 20px 16px; border-bottom: 1px solid rgba(255,255,255,0.08); }
  .logo-mark { font-family: 'Playfair Display', serif; font-weight: 700; font-size: 22px; color: var(--white); }
  .logo-accent { color: var(--gold2); }
  .logo-sub { font-size: 10px; color: rgba(255,255,255,0.3); font-family: 'Source Code Pro', monospace; letter-spacing: 0.12em; text-transform: uppercase; margin-top: 3px; }
  .nav { padding: 12px 10px; flex: 1; overflow-y: auto; }
  .nav-label { font-size: 9px; font-family: 'Source Code Pro', monospace; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(255,255,255,0.22); padding: 10px 12px 4px; }
  .nav-item { display: flex; align-items: center; gap: 10px; padding: 9px 13px; border-radius: 3px; cursor: pointer; font-size: 13px; font-weight: 500; color: rgba(255,255,255,0.5); transition: all 0.14s; margin-bottom: 1px; border: none; background: none; width: 100%; text-align: left; font-family: 'Source Sans 3', sans-serif; }
  .nav-item:hover { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.8); }
  .nav-item.active { background: rgba(212,160,23,0.14); color: var(--gold2); border-left: 2px solid var(--gold2); padding-left: 11px; }
  .nav-icon { font-size: 13px; width: 18px; text-align: center; }
  .nav-badge { margin-left: auto; background: var(--red); color: white; font-size: 10px; font-weight: 600; padding: 1px 7px; border-radius: 10px; font-family: 'Source Code Pro', monospace; }
  .sidebar-footer { padding: 13px 18px; border-top: 1px solid rgba(255,255,255,0.07); }
  .co-pill { display: flex; align-items: center; gap: 8px; }
  .co-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--teal2); animation: blink-d 2.5s infinite; }
  @keyframes blink-d { 0%,100%{opacity:1} 50%{opacity:0.25} }
  .co-name { font-size: 11px; color: rgba(255,255,255,0.35); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .topbar { height: 52px; min-height: 52px; background: var(--surface); border-bottom: 2px solid var(--border); display: flex; align-items: center; justify-content: space-between; padding: 0 22px; box-shadow: 0 1px 4px rgba(0,0,0,0.05); }
  .pg-title { font-family: 'Playfair Display', serif; font-size: 16px; font-weight: 600; color: var(--navy); }
  .pg-sub { font-size: 10px; color: var(--dim); margin-top: 1px; font-family: 'Source Code Pro', monospace; }
  .period-badge { background: var(--surface2); border: 1px solid var(--border); border-radius: 3px; padding: 4px 12px; font-size: 11px; font-family: 'Source Code Pro', monospace; color: var(--muted); }
  .content { flex: 1; overflow: auto; padding: 18px 22px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 3px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
  .card-header { padding: 11px 15px 10px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; background: var(--surface2); }
  .card-title { font-family: 'Playfair Display', serif; font-size: 13px; font-weight: 600; color: var(--navy); }
  .card-body { padding: 13px 15px; }
  .kpi-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 11px; margin-bottom: 13px; }
  .kpi-card { background: var(--surface); border: 1px solid var(--border); border-top: 3px solid var(--tc, var(--navy)); border-radius: 3px; padding: 13px 15px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
  .kpi-label { font-size: 10px; font-family: 'Source Code Pro', monospace; letter-spacing: 0.1em; text-transform: uppercase; color: var(--dim); margin-bottom: 7px; }
  .kpi-value { font-family: 'Playfair Display', serif; font-size: 23px; font-weight: 700; }
  .kpi-sub { font-size: 11px; color: var(--muted); margin-top: 3px; }
  .pill { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 2px; font-size: 9px; font-weight: 600; font-family: 'Source Code Pro', monospace; text-transform: uppercase; letter-spacing: 0.05em; }
  .digest { background: var(--surface); border: 1px solid var(--border); border-left: 4px solid var(--navy); border-radius: 3px; padding: 12px 15px; margin-bottom: 11px; display: flex; gap: 11px; }
  .digest-label { font-size: 9px; font-family: 'Source Code Pro', monospace; letter-spacing: 0.12em; text-transform: uppercase; color: var(--navy); margin-bottom: 4px; font-weight: 600; }
  .digest-text { font-size: 13px; color: var(--muted); line-height: 1.6; }
  .anomaly { border-radius: 2px; padding: 8px 12px; margin-bottom: 6px; display: flex; align-items: center; gap: 9px; font-size: 12px; }
  .a-high { background: rgba(139,32,32,0.06); border-left: 3px solid var(--red); color: var(--red); }
  .a-med { background: rgba(184,134,11,0.06); border-left: 3px solid var(--gold); color: var(--gold); }
  .inv-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; border-radius: 2px; margin-bottom: 4px; transition: background 0.1s; }
  .inv-row:hover { background: var(--surface2); }
  .inv-id { font-size: 10px; font-family: 'Source Code Pro', monospace; color: var(--dim); margin-top: 2px; }
  .comp-row { display: flex; align-items: center; justify-content: space-between; padding: 9px 12px; border-radius: 2px; margin-bottom: 5px; background: var(--surface2); border: 1px solid var(--border); }
  .comp-days { font-family: 'Playfair Display', serif; font-size: 20px; font-weight: 700; }
  .bar-track { height: 4px; background: var(--surface3); border-radius: 2px; overflow: hidden; margin-top: 5px; }
  .bar-fill { height: 100%; border-radius: 2px; transition: width 1.2s ease; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 11px; margin-bottom: 11px; }
  .full-col { margin-bottom: 11px; }
  .pb-track { height: 5px; background: var(--surface3); border-radius: 2px; overflow: hidden; width: 180px; }
  .pb-fill { height: 100%; background: var(--teal); border-radius: 2px; transition: width 0.5s ease; }
  .sec-title { font-family: 'Playfair Display', serif; font-size: 12px; font-weight: 600; color: var(--navy); padding: 10px 14px 7px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; background: var(--surface2); }
  .sec-count { font-size: 10px; color: var(--dim); font-family: 'Source Code Pro', monospace; font-weight: 400; }
  .chk-item { display: flex; align-items: flex-start; gap: 9px; padding: 8px 14px; cursor: pointer; transition: background 0.1s; border-bottom: 1px solid var(--surface2); }
  .chk-item:last-child { border-bottom: none; }
  .chk-item:hover { background: var(--surface2); }
  .chk-item.done { opacity: 0.48; }
  .chk-box { width: 16px; height: 16px; border-radius: 2px; flex-shrink: 0; border: 1.5px solid var(--border2); background: white; display: flex; align-items: center; justify-content: center; transition: all 0.12s; margin-top: 2px; }
  .chk-item.done .chk-box { background: var(--teal); border-color: var(--teal); }
  .chk-tick { color: white; font-size: 10px; font-weight: 700; }
  .chk-label { font-size: 13px; line-height: 1.4; }
  .chk-item.done .chk-label { text-decoration: line-through; color: var(--dim); }
  .ai-badge { margin-left: auto; flex-shrink: 0; font-size: 9px; font-family: 'Source Code Pro', monospace; color: var(--teal); background: rgba(29,107,114,0.08); padding: 1px 7px; border-radius: 2px; letter-spacing: 0.06em; margin-top: 3px; border: 1px solid rgba(29,107,114,0.18); }
  .gl-tabs { display: flex; gap: 1px; margin-bottom: 14px; border: 1px solid var(--border); border-radius: 3px; overflow: hidden; }
  .gl-tab { padding: 8px 20px; cursor: pointer; font-size: 12px; font-weight: 600; border: none; background: var(--surface2); color: var(--muted); transition: all 0.12s; flex: 1; text-align: center; font-family: 'Source Sans 3', sans-serif; }
  .gl-tab.active { background: var(--navy); color: var(--gold2); }
  .gl-tab:hover:not(.active) { background: var(--surface3); color: var(--navy); }
  .gl-table { width: 100%; border-collapse: collapse; }
  .gl-table th { font-size: 10px; font-family: 'Source Code Pro', monospace; text-transform: uppercase; letter-spacing: 0.08em; color: var(--navy); padding: 8px 12px; text-align: left; background: var(--surface2); border-bottom: 2px solid var(--border2); font-weight: 600; }
  .gl-table th.r { text-align: right; }
  .gl-table td { padding: 7px 12px; font-size: 12px; border-bottom: 1px solid var(--surface2); }
  .gl-table tr:hover td { background: #f0ede7; }
  .gl-table .mono { font-family: 'Source Code Pro', monospace; font-size: 11px; }
  .gl-table .r { text-align: right; }
  .gl-table .tot td { font-weight: 700; border-top: 2px solid var(--border2); border-bottom: none; background: var(--surface2); }
  .pnl-row { display: flex; align-items: center; padding: 7px 14px; font-size: 12px; border-bottom: 1px solid var(--surface2); }
  .pnl-row:hover { background: #f0ede7; }
  .pnl-n { flex: 1; }
  .pnl-v { width: 90px; text-align: right; font-family: 'Source Code Pro', monospace; font-size: 11px; }
  .pnl-var { width: 70px; text-align: right; font-size: 10px; font-family: 'Source Code Pro', monospace; }
  .pnl-sec { background: rgba(26,39,68,0.04); }
  .pnl-sec .pnl-n { font-family: 'Playfair Display', serif; font-weight: 600; font-size: 12px; color: var(--navy); }
  .pnl-tot { background: var(--surface2); }
  .pnl-tot .pnl-n { font-weight: 600; }
  .vp { color: var(--green); } .vn { color: var(--red); } .vz { color: var(--dim); }
  .jnl-list { display: flex; flex-direction: column; gap: 9px; margin-bottom: 16px; }
  .jnl-card { background: var(--surface); border: 1px solid var(--border); border-radius: 3px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
  .jnl-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: var(--surface2); border-bottom: 1px solid var(--border); cursor: pointer; }
  .jnl-ref { font-family: 'Source Code Pro', monospace; font-size: 11px; color: var(--navy); font-weight: 600; }
  .jnl-desc { font-size: 13px; color: var(--text); margin-top: 1px; }
  .jnl-meta { font-size: 10px; color: var(--dim); font-family: 'Source Code Pro', monospace; margin-top: 2px; }
  .jl-hdr { display: flex; padding: 5px 14px; background: rgba(26,39,68,0.04); border-bottom: 1px solid var(--border); }
  .jl-hdr span { font-size: 9px; font-family: 'Source Code Pro', monospace; text-transform: uppercase; letter-spacing: 0.1em; color: var(--dim); font-weight: 600; }
  .jl-row { display: flex; padding: 7px 14px; border-bottom: 1px solid var(--surface2); font-size: 12px; }
  .jl-row:last-child { border-bottom: none; }
  .jl-row:hover { background: #f0ede7; }
  .jl-code { width: 55px; font-family: 'Source Code Pro', monospace; font-size: 11px; color: var(--dim); }
  .jl-name { flex: 1; }
  .jl-dr, .jl-cr { width: 110px; text-align: right; font-family: 'Source Code Pro', monospace; font-size: 11px; color: var(--navy); }
  .jnl-form { background: var(--surface); border: 1px solid var(--border); border-radius: 3px; overflow: hidden; margin-bottom: 14px; }
  .jnl-fh { padding: 12px 16px; background: var(--navy); color: white; display: flex; align-items: center; justify-content: space-between; }
  .jnl-ft { font-family: 'Playfair Display', serif; font-size: 14px; font-weight: 600; }
  .jnl-fb { padding: 15px; }
  .f-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 13px; }
  .f-group { display: flex; flex-direction: column; gap: 4px; }
  .f-label { font-size: 10px; font-family: 'Source Code Pro', monospace; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-weight: 600; }
  .f-input { background: white; border: 1px solid var(--border2); border-radius: 2px; padding: 6px 9px; font-size: 13px; font-family: 'Source Sans 3', sans-serif; color: var(--text); outline: none; transition: border-color 0.14s; }
  .f-input:focus { border-color: var(--navy); box-shadow: 0 0 0 2px rgba(26,39,68,0.08); }
  .lines-tbl { width: 100%; border-collapse: collapse; margin-bottom: 9px; }
  .lines-tbl th { font-size: 9px; font-family: 'Source Code Pro', monospace; text-transform: uppercase; letter-spacing: 0.1em; color: var(--dim); padding: 6px 8px; text-align: left; background: var(--surface2); border-bottom: 2px solid var(--border); font-weight: 600; }
  .lines-tbl th.r { text-align: right; }
  .lines-tbl td { padding: 3px 3px; border-bottom: 1px solid var(--surface2); }
  .l-input { width: 100%; background: white; border: 1px solid var(--border); border-radius: 2px; padding: 5px 7px; font-size: 12px; font-family: 'Source Sans 3', sans-serif; color: var(--text); outline: none; }
  .l-input:focus { border-color: var(--navy); }
  .l-input.num { text-align: right; font-family: 'Source Code Pro', monospace; }
  .bal-row { display: flex; justify-content: flex-end; align-items: center; gap: 20px; padding: 7px 3px; border-top: 2px solid var(--border2); margin-bottom: 13px; font-family: 'Source Code Pro', monospace; font-size: 12px; }
  .bal-ok { color: var(--green); font-weight: 600; }
  .bal-err { color: var(--red); font-weight: 600; }
  .btn { padding: 7px 16px; border-radius: 2px; font-size: 13px; font-weight: 600; font-family: 'Source Sans 3', sans-serif; cursor: pointer; border: none; transition: all 0.13s; }
  .btn-p { background: var(--navy); color: var(--gold2); }
  .btn-p:hover { background: var(--navy2); }
  .btn-s { background: var(--surface2); color: var(--muted); border: 1px solid var(--border2); }
  .btn-s:hover { background: var(--surface3); color: var(--navy); }
  .btn-sm { padding: 5px 11px; font-size: 11px; }
  .btn-d { background: rgba(139,32,32,0.07); color: var(--red); border: 1px solid rgba(139,32,32,0.18); }
  .btn-d:hover { background: rgba(139,32,32,0.13); }
  .chat-panel { width: 295px; min-width: 295px; border-left: 1px solid var(--border); display: flex; flex-direction: column; background: var(--surface); }
  .chat-hdr { padding: 12px 14px; border-bottom: 1px solid var(--border); background: var(--navy); display: flex; align-items: center; gap: 10px; }
  .chat-av { width: 30px; height: 30px; border-radius: 2px; background: rgba(212,160,23,0.18); border: 1px solid var(--gold); display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; }
  .chat-ttl { font-family: 'Playfair Display', serif; font-size: 13px; color: white; font-weight: 600; }
  .chat-st { font-size: 10px; color: var(--gold2); font-family: 'Source Code Pro', monospace; }
  .chat-msgs { flex: 1; overflow: auto; padding: 11px 11px; display: flex; flex-direction: column; gap: 8px; }
  .msg { max-width: 93%; padding: 8px 11px; border-radius: 3px; font-size: 12px; line-height: 1.62; }
  .msg-a { background: var(--surface2); color: var(--muted); border: 1px solid var(--border); align-self: flex-start; }
  .msg-u { background: var(--navy); color: rgba(255,255,255,0.82); align-self: flex-end; }
  .dot { width: 5px; height: 5px; border-radius: 50%; background: var(--dim); display: inline-block; margin: 0 2px; }
  .dot:nth-child(1){animation:blink 1.2s 0s infinite} .dot:nth-child(2){animation:blink 1.2s .2s infinite} .dot:nth-child(3){animation:blink 1.2s .4s infinite}
  @keyframes blink{0%,100%{opacity:0.2}50%{opacity:1}}
  .chat-sugg { padding: 7px 11px; display: flex; flex-direction: column; gap: 4px; }
  .sugg { background: var(--surface2); border: 1px solid var(--border); border-radius: 2px; padding: 5px 9px; font-size: 11px; color: var(--muted); cursor: pointer; transition: all 0.11s; text-align: left; }
  .sugg:hover { border-color: var(--navy); color: var(--navy); background: var(--surface3); }
  .chat-inp-area { padding: 9px 11px; border-top: 1px solid var(--border); display: flex; gap: 6px; }
  .chat-inp { flex: 1; background: white; border: 1px solid var(--border2); border-radius: 2px; color: var(--text); padding: 6px 9px; font-size: 12px; font-family: 'Source Sans 3', sans-serif; outline: none; transition: border-color 0.13s; }
  .chat-inp:focus { border-color: var(--navy); }
  .send-btn { background: var(--navy); border: none; border-radius: 2px; color: var(--gold2); padding: 6px 11px; cursor: pointer; font-size: 13px; transition: background 0.12s; }
  .send-btn:hover { background: var(--navy2); }
  @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  .fade-up{animation:fadeUp 0.32s ease forwards}
  /* ── LOGIN ── */
  .login-wrap { min-height: 100vh; background: var(--navy); display: flex; align-items: center; justify-content: center; }
  .login-card { background: var(--surface); width: 380px; border-radius: 4px; overflow: hidden; box-shadow: 0 24px 64px rgba(0,0,0,0.35); }
  .login-hdr { background: var(--navy); padding: 28px 30px 24px; border-bottom: 3px solid var(--gold); }
  .login-logo { font-family: 'Playfair Display', serif; font-size: 26px; font-weight: 700; color: white; }
  .login-logo span { color: var(--gold2); }
  .login-tagline { font-size: 11px; color: rgba(255,255,255,0.35); font-family: 'Source Code Pro', monospace; letter-spacing: 0.12em; text-transform: uppercase; margin-top: 4px; }
  .login-body { padding: 28px 30px; }
  .login-title { font-family: 'Playfair Display', serif; font-size: 18px; font-weight: 600; color: var(--navy); margin-bottom: 6px; }
  .login-sub { font-size: 12px; color: var(--dim); margin-bottom: 22px; }
  .login-field { margin-bottom: 14px; }
  .login-label { display: block; font-size: 10px; font-family: 'Source Code Pro', monospace; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); margin-bottom: 5px; font-weight: 600; }
  .login-input { width: 100%; background: white; border: 1px solid var(--border2); border-radius: 2px; padding: 10px 13px; font-size: 13px; font-family: 'Source Sans 3', sans-serif; color: var(--text); outline: none; transition: border-color 0.14s; }
  .login-input:focus { border-color: var(--navy); box-shadow: 0 0 0 3px rgba(26,39,68,0.08); }
  .login-btn { width: 100%; background: var(--navy); color: var(--gold2); border: none; border-radius: 2px; padding: 11px; font-size: 14px; font-weight: 600; font-family: 'Source Sans 3', sans-serif; cursor: pointer; margin-top: 6px; transition: background 0.14s; letter-spacing: 0.02em; }
  .login-btn:hover { background: var(--navy2); }
  .login-demo-hint { text-align: center; margin-top: 13px; font-size: 11px; color: var(--dim); }
  .login-demo-hint span { color: var(--navy); font-weight: 600; cursor: pointer; text-decoration: underline; }
  .login-footer { padding: 12px 30px; background: var(--surface2); border-top: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
  .login-badges { display: flex; gap: 8px; }
  .login-badge { font-size: 9px; font-family: 'Source Code Pro', monospace; color: var(--dim); background: var(--surface3); padding: 2px 8px; border-radius: 2px; border: 1px solid var(--border); }
  /* ── TOPBAR EXTRAS ── */
  .feed-pill { display: flex; align-items: center; gap: 5px; background: rgba(26,92,53,0.08); border: 1px solid rgba(26,92,53,0.2); border-radius: 3px; padding: 4px 10px; font-size: 10px; font-family: 'Source Code Pro', monospace; color: var(--green); }
  .feed-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); animation: blink-d 2.5s infinite; flex-shrink: 0; }
  .user-chip { display: flex; align-items: center; gap: 8px; padding: 4px 10px; border: 1px solid var(--border); border-radius: 3px; background: var(--surface2); cursor: pointer; }
  .user-av { width: 24px; height: 24px; border-radius: 2px; background: var(--navy); color: var(--gold2); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; font-family: 'Source Code Pro', monospace; }
  .user-name { font-size: 11px; color: var(--muted); font-family: 'Source Sans 3', sans-serif; }
  /* ── CASH FLOW PAGE ── */
  .cf-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 11px; margin-bottom: 13px; }
  .cf-chart { background: var(--surface); border: 1px solid var(--border); border-radius: 3px; padding: 16px; }
  .cf-bar-wrap { display: flex; align-items: flex-end; gap: 7px; height: 100px; margin-top: 12px; }
  .cf-bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .cf-bar { width: 100%; border-radius: 2px 2px 0 0; transition: height 1s ease; }
  .cf-bar-label { font-size: 10px; font-family: 'Source Code Pro', monospace; color: var(--dim); }
  .cf-bar-val { font-size: 10px; font-family: 'Source Code Pro', monospace; color: var(--navy); font-weight: 600; }
  .ap-sched-row { display: flex; align-items: center; padding: 8px 14px; border-bottom: 1px solid var(--surface2); font-size: 12px; }
  .ap-sched-row:last-child { border-bottom: none; }
  /* ── INVOICES PAGE ── */
  .inv-page-row { display: flex; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--surface2); font-size: 12px; gap: 10px; cursor: pointer; transition: background 0.1s; }
  .inv-page-row:hover { background: var(--surface2); }
  .inv-days-bar { height: 3px; background: var(--surface3); border-radius: 2px; overflow: hidden; margin-top: 3px; width: 80px; }
  .inv-days-fill { height: 100%; border-radius: 2px; }
  /* ── COMPLIANCE PAGE ── */
  .comp-card { background: var(--surface); border: 1px solid var(--border); border-radius: 3px; padding: 14px 16px; margin-bottom: 9px; display: flex; align-items: center; gap: 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
  .comp-icon { width: 36px; height: 36px; border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
  .comp-deadline-ring { width: 48px; height: 48px; flex-shrink: 0; position: relative; }
  .ros-tag { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; font-family: 'Source Code Pro', monospace; color: white; background: var(--teal); padding: 2px 8px; border-radius: 2px; margin-top: 4px; }
  .gl-extract-toolbar { display: flex; align-items: center; gap: 10px; padding: 11px 15px; background: var(--surface2); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
  .gl-extract-select { background: white; border: 1px solid var(--border2); border-radius: 2px; padding: 5px 9px; font-size: 12px; font-family: 'Source Sans 3', sans-serif; color: var(--text); outline: none; cursor: pointer; }
  .gl-extract-select:focus { border-color: var(--navy); }
  .gl-acct-header { padding: 9px 15px; background: rgba(26,39,68,0.04); border-bottom: 1px solid var(--border); display: flex; align-items: baseline; gap: 10px; }
  .gl-acct-code { font-family: 'Source Code Pro', monospace; font-size: 12px; color: var(--dim); }
  .gl-acct-name { font-family: 'Playfair Display', serif; font-size: 14px; font-weight: 600; color: var(--navy); }
  .gl-acct-type { font-size: 10px; font-family: 'Source Code Pro', monospace; color: var(--dim); margin-left: auto; }
  .glex-table { width: 100%; border-collapse: collapse; }
  .glex-table th { font-size: 10px; font-family: 'Source Code Pro', monospace; text-transform: uppercase; letter-spacing: 0.08em; color: var(--navy); padding: 7px 12px; text-align: left; background: var(--surface2); border-bottom: 2px solid var(--border2); font-weight: 600; }
  .glex-table th.r { text-align: right; }
  .glex-table td { padding: 7px 12px; font-size: 12px; border-bottom: 1px solid var(--surface2); vertical-align: middle; }
  .glex-table tr:hover td { background: #f0ede7; }
  .glex-table .mono { font-family: 'Source Code Pro', monospace; font-size: 11px; }
  .glex-table .r { text-align: right; }
  .glex-table .dr { color: var(--navy); }
  .glex-table .cr { color: var(--teal); }
  .glex-table .bal-pos { color: var(--navy); font-weight: 600; }
  .glex-table .bal-neg { color: var(--red); font-weight: 600; }
  .glex-type-pill { display: inline-block; font-size: 9px; font-family: 'Source Code Pro', monospace; text-transform: uppercase; letter-spacing: 0.05em; padding: 1px 6px; border-radius: 2px; background: var(--surface3); color: var(--muted); }
  .glex-type-receipt { background: rgba(26,92,53,0.08); color: var(--green); }
  .glex-type-payment { background: rgba(139,32,32,0.08); color: var(--red); }
  .glex-type-accrual { background: rgba(184,134,11,0.08); color: var(--gold); }
  .glex-type-invoice  { background: rgba(26,39,68,0.08); color: var(--navy); }
  .glex-type-vat      { background: rgba(29,107,114,0.08); color: var(--teal); }
  .glex-type-payroll  { background: rgba(83,74,183,0.08); color: #534ab7; }
  .glex-totrow td { font-weight: 700; border-top: 2px solid var(--border2); border-bottom: none; background: var(--surface2); }
  .gl-no-data { padding: 40px; text-align: center; color: var(--dim); font-size: 13px; }
`;

// ─── LOGIN ────────────────────────────────────────────────────────────────────
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
          <div className="login-logo">Fin<span>flow</span></div>
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

// ─── CASH FLOW PAGE ───────────────────────────────────────────────────────────
function CashFlow() {
  const maxF = Math.max(...cashData.forecast.map(f => f.value));
  const apSchedule = [
    { name: "Office Lease", supplier: "Dublin Workspace Ltd", amount: 2400, due: "02 May", category: "Overhead", status: "scheduled" },
    { name: "Payroll Run", supplier: "Internal — 14 staff", amount: 18600, due: "07 May", category: "Payroll", status: "scheduled" },
    { name: "VAT3 Payment", supplier: "Revenue Commissioners", amount: 6120, due: "19 May", category: "Tax", status: "prep-ready" },
    { name: "Arthur Cox — Retainer", supplier: "Arthur Cox LLP", amount: 1800, due: "25 May", category: "Professional", status: "upcoming" },
    { name: "Annual Software Licences", supplier: "Various", amount: 4200, due: "30 May", category: "Overhead", status: "upcoming" },
  ];
  const catColour = c => ({ Payroll: "var(--navy)", Tax: "var(--red)", Overhead: "var(--teal)", Professional: "var(--gold)" })[c] || "var(--dim)";
  return (
    <div className="fade-up">
      <div className="kpi-grid">
        {[
          { label: "Current Cash", value: fmt(cashData.position), sub: "AIB Business Current", c: "var(--teal)" },
          { label: "30-Day Forecast", value: fmtK(cashData.forecast[1].value), sub: "after scheduled AP", c: "var(--navy)" },
          { label: "Committed AP", value: fmt(apSchedule.reduce((s,a) => s + a.amount, 0)), sub: "next 30 days", c: "var(--gold)" },
          { label: "Net Position", value: fmtK(cashData.forecast[1].value - apSchedule.reduce((s,a) => s + a.amount, 0)), sub: "30-day net", c: "var(--green)" },
        ].map((k, i) => (
          <div key={i} className="kpi-card" style={{ "--tc": k.c }}>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value" style={{ color: k.c }}>{k.value}</div>
            <div className="kpi-sub">{k.sub}</div>
          </div>
        ))}
      </div>
      <div className="two-col" style={{ marginBottom: 13 }}>
        <div className="card">
          <div className="card-header"><span className="card-title">90-Day Cash Forecast</span><span style={{ fontSize: 10, color: "var(--dim)", fontFamily: "Source Code Pro, monospace" }}>OPEN BANKING</span></div>
          <div className="card-body">
            <div className="cf-bar-wrap">
              {cashData.forecast.map((f, i) => (
                <div key={i} className="cf-bar-col">
                  <div className="cf-bar-val">{fmtK(f.value)}</div>
                  <div className="cf-bar" style={{ height: `${(f.value / maxF) * 72}px`, background: i === 2 ? "var(--gold)" : "var(--navy)", opacity: i === 0 ? 1 : 0.7 + i * 0.05 }} />
                  <div className="cf-bar-label">{f.label}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, padding: "8px 0", borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--dim)" }}>
              ⚠ 60-day dip driven by VAT3 + payroll overlap. AI recommends reviewing AR chase on Murphy Retail.
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-header"><span className="card-title">Bank Accounts</span><span className="feed-pill"><span className="feed-dot" />Live</span></div>
          <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {[
              { bank: "AIB", name: "Business Current", iban: "IE29 AIBK 9311 5212 3456 78", balance: 47820, updated: "2 min ago" },
              { bank: "AIB", name: "Business Deposit", iban: "IE29 AIBK 9311 5212 3456 79", balance: 12400, updated: "2 min ago" },
            ].map((acc, i) => (
              <div key={i} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 2, padding: "10px 13px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{acc.bank} · {acc.name}</span>
                  <span style={{ fontFamily: "Source Code Pro, monospace", fontSize: 14, fontWeight: 700, color: "var(--teal)" }}>{fmt(acc.balance)}</span>
                </div>
                <div style={{ fontSize: 10, color: "var(--dim)", fontFamily: "Source Code Pro, monospace", marginTop: 3 }}>{acc.iban} · synced {acc.updated}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="card full-col">
        <div className="card-header"><span className="card-title">AP Payment Schedule — Next 30 Days</span><span style={{ fontSize: 10, fontFamily: "Source Code Pro, monospace", color: "var(--dim)" }}>5 items · {fmt(apSchedule.reduce((s,a)=>s+a.amount,0))}</span></div>
        <table className="gl-table" style={{ width: "100%" }}>
          <thead><tr><th>Payee</th><th>Category</th><th>Due</th><th>Status</th><th className="r">Amount</th></tr></thead>
          <tbody>
            {apSchedule.map((ap, i) => (
              <tr key={i}>
                <td><div style={{ fontWeight: 500 }}>{ap.name}</div><div style={{ fontSize: 10, color: "var(--dim)", fontFamily: "Source Code Pro, monospace" }}>{ap.supplier}</div></td>
                <td><span style={{ fontSize: 10, fontFamily: "Source Code Pro, monospace", color: catColour(ap.category), background: "rgba(0,0,0,0.04)", padding: "2px 7px", borderRadius: 2 }}>{ap.category}</span></td>
                <td className="mono">{ap.due}</td>
                <td><SPill status={ap.status} /></td>
                <td className="r mono" style={{ fontWeight: 600, color: "var(--navy)" }}>{fmt(ap.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── INVOICES PAGE ────────────────────────────────────────────────────────────
function Invoices() {
  const allInvoices = [
    { id: "INV-0091", client: "Murphy Retail", amount: 4800, issued: "01 Mar", due: "31 Mar", days: 62, status: "escalated", contact: "Sean Murphy" },
    { id: "INV-0087", client: "Clancy Engineering", amount: 2200, issued: "18 Mar", due: "17 Apr", days: 44, status: "chased", contact: "Aoife Clancy" },
    { id: "INV-0094", client: "Aoife Design Co.", amount: 1650, issued: "01 Apr", due: "01 May", days: 31, status: "chased", contact: "Aoife Riordan" },
    { id: "INV-0096", client: "West Cork Meats", amount: 960, issued: "14 Apr", due: "14 May", days: 18, status: "pending", contact: "Ciarán Walsh" },
    { id: "INV-0097", client: "O'Brien Logistics", amount: 14390, issued: "30 Apr", due: "30 May", days: 6, status: "pending", contact: "Niamh O'Brien" },
    { id: "INV-0098", client: "Limerick Supplies", amount: 3400, issued: "30 Apr", due: "30 May", days: 6, status: "pending", contact: "Padraig Daly" },
  ];
  const [selected, setSelected] = useState(null);
  const total = allInvoices.reduce((s, i) => s + i.amount, 0);
  const overdue = allInvoices.filter(i => i.days > 30).reduce((s, i) => s + i.amount, 0);
  const daysColour = d => d > 60 ? "var(--red)" : d > 30 ? "var(--gold)" : "var(--teal)";
  return (
    <div className="fade-up">
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
        {[
          { label: "Total Outstanding AR", value: fmt(total), sub: `${allInvoices.length} open invoices`, c: "var(--navy)" },
          { label: "Overdue (>30 days)", value: fmt(overdue), sub: "3 invoices", c: "var(--red)" },
          { label: "Due This Month", value: fmt(allInvoices.filter(i => i.days <= 30).reduce((s,i) => s + i.amount, 0)), sub: "3 invoices", c: "var(--teal)" },
        ].map((k, i) => (
          <div key={i} className="kpi-card" style={{ "--tc": k.c }}>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value" style={{ color: k.c }}>{k.value}</div>
            <div className="kpi-sub">{k.sub}</div>
          </div>
        ))}
      </div>
      <div className="card full-col">
        <div className="card-header">
          <span className="card-title">Accounts Receivable Ledger</span>
          <span style={{ fontSize: 10, color: "var(--teal)", fontFamily: "Source Code Pro, monospace" }}>AI CHASING ACTIVE</span>
        </div>
        <table className="gl-table">
          <thead><tr><th>Invoice</th><th>Client</th><th>Contact</th><th>Issued</th><th>Due</th><th>Days</th><th>Status</th><th className="r">Amount</th></tr></thead>
          <tbody>
            {allInvoices.map((inv, i) => (
              <tr key={i} style={{ cursor: "pointer" }} onClick={() => setSelected(selected === i ? null : i)}>
                <td className="mono" style={{ color: "var(--navy)", fontWeight: 600 }}>{inv.id}</td>
                <td style={{ fontWeight: 500 }}>{inv.client}</td>
                <td style={{ color: "var(--dim)", fontSize: 11 }}>{inv.contact}</td>
                <td className="mono">{inv.issued}</td>
                <td className="mono">{inv.due}</td>
                <td>
                  <div style={{ fontFamily: "Source Code Pro, monospace", fontSize: 12, fontWeight: 700, color: daysColour(inv.days) }}>{inv.days}d</div>
                  <div className="inv-days-bar"><div className="inv-days-fill" style={{ width: `${Math.min((inv.days / 90) * 100, 100)}%`, background: daysColour(inv.days) }} /></div>
                </td>
                <td><SPill status={inv.status} /></td>
                <td className="r mono" style={{ fontWeight: 600 }}>{fmt(inv.amount)}</td>
              </tr>
            ))}
            <tr className="tot"><td colSpan={7} style={{ fontFamily: "Playfair Display, serif", fontSize: 12, paddingLeft: 12 }}>Total Outstanding</td><td className="r mono" style={{ fontWeight: 700, fontSize: 13 }}>{fmt(total)}</td></tr>
          </tbody>
        </table>
        {selected !== null && (
          <div style={{ padding: "12px 16px", background: "rgba(26,39,68,0.03)", borderTop: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, color: "var(--dim)", fontFamily: "Source Code Pro, monospace", marginBottom: 8 }}>AI CHASE LOG — {allInvoices[selected].id}</div>
            {[
              `Automated reminder sent to ${allInvoices[selected].contact} on ${allInvoices[selected].issued} + 7 days`,
              `Second reminder sent at 14 days. No response recorded.`,
              allInvoices[selected].days > 30 ? `Escalation email sent. Flagged for manual follow-up.` : null,
            ].filter(Boolean).map((log, li) => (
              <div key={li} style={{ fontSize: 12, color: "var(--muted)", padding: "5px 0", borderBottom: "1px solid var(--surface2)" }}>· {log}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── COMPLIANCE PAGE ──────────────────────────────────────────────────────────
function Compliance() {
  const items = [
    { title: "VAT3 Return", body: "Feb/Mar bi-monthly return. AI has prepared T1/T2 workings. Net VAT payable €6,120.", period: "Feb/Mar 2026", deadline: "19 May 2026", daysLeft: 19, status: "prep-ready", icon: "📋", api: "ROS", action: "Review & Submit" },
    { title: "P30 Payroll Return", body: "April PAYE/PRSI/USC. Payroll processed 7 May. Returns auto-prepared.", period: "April 2026", deadline: "14 May 2026", daysLeft: 14, status: "action-needed", icon: "👥", api: "ROS", action: "Submit Now" },
    { title: "CT1 Corporation Tax", body: "FY2024 corporation tax filing. Accounts to be finalised before submission.", period: "FY 2024", deadline: "23 Jun 2026", daysLeft: 54, status: "upcoming", icon: "🏢", api: "ROS", action: "Begin Prep" },
    { title: "Annual Return (B1)", body: "CRO annual return due. Financial statements to be attached. No late filing penalty if filed on time.", period: "FY 2024", deadline: "14 Jul 2026", daysLeft: 75, status: "upcoming", icon: "📁", api: "CRO", action: "Begin Prep" },
    { title: "P35 Employer Return", body: "Annual employer return — all employee PAYE data for FY2025. Auto-prepared from payroll.", period: "FY 2025", deadline: "15 Feb 2027", daysLeft: 285, status: "upcoming", icon: "📊", api: "ROS", action: "View" },
  ];
  const urgencyColour = d => d < 15 ? "var(--red)" : d < 30 ? "var(--gold)" : "var(--teal)";
  return (
    <div className="fade-up">
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3,1fr)", marginBottom: 16 }}>
        {[
          { label: "Action Required", value: "2", sub: "P30 + VAT3", c: "var(--red)" },
          { label: "Next Deadline", value: "14 May", sub: "P30 Payroll Return", c: "var(--gold)" },
          { label: "ROS Connected", value: "✓", sub: "Auto-submit enabled", c: "var(--green)" },
        ].map((k, i) => (
          <div key={i} className="kpi-card" style={{ "--tc": k.c }}>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value" style={{ color: k.c, fontSize: 20 }}>{k.value}</div>
            <div className="kpi-sub">{k.sub}</div>
          </div>
        ))}
      </div>
      {items.map((item, i) => (
        <div key={i} className="comp-card">
          <div className="comp-icon" style={{ background: `${urgencyColour(item.daysLeft)}14` }}>{item.icon}</div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
              <span style={{ fontFamily: "Playfair Display, serif", fontSize: 14, fontWeight: 600, color: "var(--navy)" }}>{item.title}</span>
              <span className="ros-tag">{item.api}</span>
              <SPill status={item.status} />
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5, marginBottom: 5 }}>{item.body}</div>
            <div style={{ fontSize: 10, color: "var(--dim)", fontFamily: "Source Code Pro, monospace" }}>Period: {item.period} · Deadline: {item.deadline}</div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
            <div style={{ fontFamily: "Playfair Display, serif", fontSize: 26, fontWeight: 700, color: urgencyColour(item.daysLeft), lineHeight: 1 }}>
              {item.daysLeft}<span style={{ fontSize: 11, fontWeight: 400, color: "var(--dim)" }}>d</span>
            </div>
            <button style={{ marginTop: 8, background: item.daysLeft < 20 ? "var(--navy)" : "var(--surface2)", color: item.daysLeft < 20 ? "var(--gold2)" : "var(--muted)", border: item.daysLeft < 20 ? "none" : "1px solid var(--border2)", borderRadius: 2, padding: "4px 11px", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "Source Sans 3, sans-serif" }}>
              {item.action}
            </button>
          </div>
        </div>
      ))}
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

function Overview() {
  const totalAR = invoices.reduce((s, i) => s + i.amount, 0);
  const totalAP = cashData.upcomingAP.reduce((s, i) => s + i.amount, 0);
  const maxF = Math.max(...cashData.forecast.map(f => f.value));
  return (
    <div className="fade-up">
      <div className="digest">
        <span style={{ fontSize: 17, flexShrink: 0 }}>📋</span>
        <div>
          <div className="digest-label">AI Weekly Digest — {PERIOD}</div>
          <div className="digest-text">Cash improved €3.2k this week. Murphy Retail invoice now 62 days overdue — escalation issued automatically. VAT3 figures are prepared and ready for review. Payroll due in 7 days. Two items require your attention.</div>
        </div>
      </div>
      {anomalies.map((a, i) => <div key={i} className={`anomaly ${a.severity === "high" ? "a-high" : "a-med"}`}><span>{a.severity === "high" ? "⚠" : "!"}</span><span>{a.text}</span></div>)}
      <div style={{ height: 10 }} />
      <div className="kpi-grid">
        {[
          { label: "Cash Position", value: fmt(cashData.position), sub: `↑ ${fmt(cashData.change)} this week`, c: "var(--teal)" },
          { label: "Overdue AR", value: fmt(totalAR), sub: `${invoices.length} invoices`, c: "var(--red)" },
          { label: "Upcoming AP", value: fmt(totalAP), sub: "next 30 days", c: "var(--gold)" },
          { label: "Net 30-Day", value: fmtK(cashData.forecast[1].value - totalAP), sub: "forecast position", c: "var(--navy)" },
        ].map((k, i) => (
          <div key={i} className="kpi-card" style={{ "--tc": k.c }}>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value" style={{ color: k.c }}>{k.value}</div>
            <div className="kpi-sub">{k.sub}</div>
          </div>
        ))}
      </div>
      <div className="two-col">
        <div className="card">
          <div className="card-header"><span className="card-title">Overdue Invoices</span><span style={{ fontSize: 10, color: "var(--teal)", fontFamily: "Source Code Pro, monospace" }}>AI CHASING ACTIVE</span></div>
          <div className="card-body">
            {invoices.map((inv, i) => (
              <div key={i} className="inv-row">
                <div><div style={{ fontSize: 13, fontWeight: 500 }}>{inv.client}</div><div className="inv-id">{inv.id} · {inv.days}d overdue</div></div>
                <div style={{ textAlign: "right" }}><div style={{ fontFamily: "Source Code Pro, monospace", fontSize: 13 }}>{fmt(inv.amount)}</div><div style={{ marginTop: 4 }}><SPill status={inv.status} /></div></div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-header"><span className="card-title">Compliance Deadlines</span></div>
          <div className="card-body">
            {compliance.map((c, i) => (
              <div key={i} className="comp-row">
                <div><div style={{ fontSize: 13, fontWeight: 500 }}>{c.title}</div><div style={{ fontSize: 10, color: "var(--dim)", fontFamily: "Source Code Pro, monospace", marginTop: 3 }}>{c.period} · {c.deadline}</div></div>
                <div style={{ textAlign: "right" }}><div className="comp-days" style={{ color: c.daysLeft < 20 ? "var(--red)" : "var(--navy)" }}>{c.daysLeft}<span style={{ fontSize: 11, fontWeight: 400, color: "var(--dim)" }}>d</span></div><div style={{ marginTop: 4 }}><SPill status={c.status} /></div></div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="card full-col">
        <div className="card-header"><span className="card-title">Cash Flow Forecast</span></div>
        <div className="card-body">
          <div style={{ display: "flex", gap: 18, marginBottom: 16 }}>
            {cashData.forecast.map((f, i) => (
              <div key={i} style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <span style={{ fontSize: 11, color: "var(--dim)" }}>{f.label}</span>
                  <span style={{ fontSize: 12, fontFamily: "Source Code Pro, monospace", fontWeight: 500 }}>{fmtK(f.value)}</span>
                </div>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${(f.value / maxF) * 100}%`, background: i === 2 ? "var(--gold)" : "var(--navy)" }} /></div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 9 }}>
            {cashData.upcomingAP.map((ap, i) => (
              <div key={i} style={{ flex: 1, background: "var(--surface2)", borderRadius: 2, padding: "8px 11px", border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 10, color: "var(--dim)", fontFamily: "Source Code Pro, monospace" }}>Due {ap.due}</div>
                <div style={{ fontSize: 13, fontWeight: 500, marginTop: 3 }}>{ap.name}</div>
                <div style={{ fontSize: 13, fontFamily: "Source Code Pro, monospace", color: "var(--gold)", marginTop: 2 }}>{fmt(ap.amount)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Checklist() {
  const allItems = CHECKLIST_SECTIONS.flatMap(s => s.items);
  const [checked, setChecked] = useState(Object.fromEntries(allItems.map(i => [i.id, false])));
  const toggle = id => setChecked(p => ({ ...p, [id]: !p[id] }));
  const done = Object.values(checked).filter(Boolean).length;
  const total = allItems.length;
  const pct = Math.round((done / total) * 100);
  return (
    <div className="fade-up">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: "Playfair Display, serif", fontSize: 17, fontWeight: 700, color: "var(--navy)", marginBottom: 2 }}>Month End Close — {PERIOD}</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Work through each section. Items marked AI are automated by Finflow.</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "Playfair Display, serif", fontSize: 22, fontWeight: 700, color: "var(--navy)", marginBottom: 4 }}>{done}<span style={{ fontSize: 13, fontWeight: 400, color: "var(--dim)" }}> / {total}</span></div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div className="pb-track"><div className="pb-fill" style={{ width: `${pct}%` }} /></div>
            <span style={{ fontSize: 11, fontFamily: "Source Code Pro, monospace", color: "var(--teal)", fontWeight: 600 }}>{pct}%</span>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button className="btn btn-s btn-sm" onClick={() => setChecked(Object.fromEntries(allItems.map(i => [i.id, false])))}>Reset All</button>
        <button className="btn btn-sm" style={{ background: "rgba(29,107,114,0.08)", color: "var(--teal)", border: "1px solid rgba(29,107,114,0.2)" }}
          onClick={() => setChecked(p => ({ ...p, ...Object.fromEntries(allItems.filter(i => i.auto).map(i => [i.id, true])) }))}>
          ⚡ Auto-complete AI items
        </button>
      </div>
      {CHECKLIST_SECTIONS.map((section, si) => {
        const sDone = section.items.filter(i => checked[i.id]).length;
        return (
          <div key={si} className="card" style={{ marginBottom: 9 }}>
            <div className="sec-title">{section.title}<span className="sec-count">{sDone}/{section.items.length}</span></div>
            {section.items.map(item => (
              <div key={item.id} className={`chk-item ${checked[item.id] ? "done" : ""}`} onClick={() => toggle(item.id)}>
                <div className="chk-box">{checked[item.id] && <span className="chk-tick">✓</span>}</div>
                <span className="chk-label">{item.label}</span>
                {item.auto && <span className="ai-badge">AI</span>}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function GLReport() {
  const [tab, setTab] = useState("tb");
  const tbTot = { dr: GL_TB.reduce((s, r) => s + r.debit, 0), cr: GL_TB.reduce((s, r) => s + r.credit, 0) };
  const totRev = PNL.revenue.reduce((s, r) => s + r.current, 0);
  const totCOS = PNL.cos.reduce((s, r) => s + r.current, 0);
  const gp = totRev - totCOS;
  const totOpex = PNL.opex.reduce((s, r) => s + r.current, 0);
  const np = gp - totOpex;
  const totRevB = PNL.revenue.reduce((s, r) => s + r.budget, 0);
  const gpB = totRevB - PNL.cos.reduce((s, r) => s + r.budget, 0);
  const npB = gpB - PNL.opex.reduce((s, r) => s + r.budget, 0);
  const vc = v => v > 0 ? "vp" : v < 0 ? "vn" : "vz";
  const PRow = ({ row, isExp }) => {
    const bv = isExp ? row.budget - row.current : row.current - row.budget;
    return (
      <div className="pnl-row">
        <span className="pnl-n">{row.name}</span>
        <span className="pnl-v">{fmt(row.current)}</span>
        <span className="pnl-v">{fmt(row.budget)}</span>
        <span className={`pnl-var ${vc(bv)}`}>{bv >= 0 ? "+" : ""}{fmt(bv)}</span>
        <span className="pnl-v">{fmt(row.prior)}</span>
      </div>
    );
  };
  return (
    <div className="fade-up">
      <div className="gl-tabs">
        {[{ id: "tb", label: "Trial Balance" }, { id: "pnl", label: "Profit & Loss" }, { id: "bs", label: "Balance Sheet" }, { id: "gl", label: "General Ledger" }].map(t => (
          <button key={t.id} className={`gl-tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      {tab === "tb" && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Trial Balance — {PERIOD}</span>
            <span style={{ fontSize: 10, color: tbTot.dr === tbTot.cr ? "var(--green)" : "var(--red)", fontFamily: "Source Code Pro, monospace", fontWeight: 600 }}>{tbTot.dr === tbTot.cr ? "✓ BALANCED" : "⚠ OUT OF BALANCE"}</span>
          </div>
          <table className="gl-table">
            <thead><tr><th style={{ width: 55 }}>Code</th><th>Account Name</th><th>Type</th><th className="r">Debit (€)</th><th className="r">Credit (€)</th></tr></thead>
            <tbody>
              {GL_TB.map((r, i) => (
                <tr key={i}><td className="mono" style={{ color: "var(--dim)" }}>{r.code}</td><td>{r.name}</td>
                  <td><span style={{ fontSize: 10, color: "var(--dim)", fontFamily: "Source Code Pro, monospace" }}>{r.type}</span></td>
                  <td className="r mono">{r.debit > 0 ? fmt(r.debit) : "—"}</td>
                  <td className="r mono">{r.credit > 0 ? fmt(r.credit) : "—"}</td></tr>
              ))}
              <tr className="tot"><td colSpan={3} style={{ fontFamily: "Playfair Display, serif" }}>Total</td><td className="r mono">{fmt(tbTot.dr)}</td><td className="r mono">{fmt(tbTot.cr)}</td></tr>
            </tbody>
          </table>
        </div>
      )}
      {tab === "pnl" && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Profit & Loss — {PERIOD}</span>
            <div style={{ display: "flex", gap: 8, fontSize: 10, fontFamily: "Source Code Pro, monospace", color: "var(--dim)" }}>
              <span style={{ width: 90, textAlign: "right" }}>Current</span><span style={{ width: 90, textAlign: "right" }}>Budget</span><span style={{ width: 70, textAlign: "right" }}>Var</span><span style={{ width: 90, textAlign: "right" }}>Prior</span>
            </div>
          </div>
          <div>
            <div className="pnl-row pnl-sec"><span className="pnl-n">Revenue</span></div>
            {PNL.revenue.map((r, i) => <PRow key={i} row={r} isExp={false} />)}
            <div className="pnl-row pnl-tot"><span className="pnl-n">Total Revenue</span><span className="pnl-v">{fmt(totRev)}</span><span className="pnl-v">{fmt(totRevB)}</span><span className={`pnl-var ${vc(totRev - totRevB)}`}>{totRev >= totRevB ? "+" : ""}{fmt(totRev - totRevB)}</span><span className="pnl-v">—</span></div>
            <div className="pnl-row pnl-sec"><span className="pnl-n">Cost of Sales</span></div>
            {PNL.cos.map((r, i) => <PRow key={i} row={r} isExp={true} />)}
            <div className="pnl-row pnl-tot"><span className="pnl-n">Gross Profit</span><span className="pnl-v" style={{ color: "var(--green)", fontWeight: 700 }}>{fmt(gp)}</span><span className="pnl-v">{fmt(gpB)}</span><span className={`pnl-var ${vc(gp - gpB)}`}>{gp >= gpB ? "+" : ""}{fmt(gp - gpB)}</span><span className="pnl-v">—</span></div>
            <div className="pnl-row pnl-sec"><span className="pnl-n">Operating Expenses</span></div>
            {PNL.opex.map((r, i) => <PRow key={i} row={r} isExp={true} />)}
            <div className="pnl-row pnl-tot" style={{ borderTop: "2px solid var(--navy)", background: "rgba(26,39,68,0.05)" }}>
              <span className="pnl-n" style={{ color: "var(--navy)", fontFamily: "Playfair Display, serif" }}>Net Profit</span>
              <span className="pnl-v" style={{ color: np > 0 ? "var(--green)" : "var(--red)", fontWeight: 700 }}>{fmt(np)}</span>
              <span className="pnl-v">{fmt(npB)}</span><span className={`pnl-var ${vc(np - npB)}`}>{np >= npB ? "+" : ""}{fmt(np - npB)}</span><span className="pnl-v">—</span>
            </div>
          </div>
        </div>
      )}
      {tab === "bs" && (
        <div className="card">
          <div className="card-header"><span className="card-title">Balance Sheet — {PERIOD}</span></div>
          {[
            { label: "Non-Current Assets", rows: [{ name: "Plant & Machinery (NBV)", amount: 51000 }] },
            { label: "Current Assets", rows: [{ name: "Trade Debtors", amount: 89340 }, { name: "Bank — Current Account", amount: 47820 }, { name: "Bank — Deposit Account", amount: 12400 }, { name: "Prepayments", amount: 4200 }] },
            { label: "Current Liabilities", rows: [{ name: "Trade Creditors", amount: -31450 }, { name: "VAT Liability", amount: -6120 }, { name: "PAYE/PRSI Liability", amount: -4880 }, { name: "Accruals", amount: -8600 }] },
            { label: "Equity", rows: [{ name: "Share Capital", amount: 50000 }, { name: "Retained Earnings", amount: 62180 }, { name: "Profit YTD", amount: 41530 }] },
          ].map((sec, si) => (
            <div key={si}>
              <div className="pnl-row pnl-sec"><span className="pnl-n">{sec.label}</span></div>
              {sec.rows.map((row, ri) => (
                <div key={ri} className="pnl-row"><span className="pnl-n">{row.name}</span>
                  <span style={{ fontFamily: "Source Code Pro, monospace", fontSize: 11, color: row.amount < 0 ? "var(--red)" : "var(--text)" }}>{row.amount < 0 ? `(${fmt(Math.abs(row.amount))})` : fmt(row.amount)}</span>
                </div>
              ))}
            </div>
          ))}
          <div className="pnl-row pnl-tot" style={{ borderTop: "2px solid var(--navy)", background: "rgba(26,39,68,0.05)" }}>
            <span className="pnl-n" style={{ fontFamily: "Playfair Display, serif", color: "var(--navy)" }}>Total Equity</span>
            <span style={{ fontFamily: "Source Code Pro, monospace", fontSize: 12, fontWeight: 700, color: "var(--green)" }}>{fmt(153710)}</span>
          </div>
        </div>
      )}
      {tab === "gl" && <GLExtract />}
    </div>
  );
}

function GLExtract() {
  const accountsWithData = GL_ACCOUNTS.filter(a => GL_EXTRACT[a.code]);
  const [selectedCode, setSelectedCode] = useState(accountsWithData[0]?.code || "1000");
  const account = GL_ACCOUNTS.find(a => a.code === selectedCode);
  const lines = GL_EXTRACT[selectedCode] || [];

  // Calculate running balance
  const withBalance = lines.reduce((acc, line) => {
    const prev = acc.length > 0 ? acc[acc.length - 1].balance : 0;
    const balance = prev + line.debit - line.credit;
    return [...acc, { ...line, balance }];
  }, []);

  const totDr = lines.reduce((s, l) => s + l.debit, 0);
  const totCr = lines.reduce((s, l) => s + l.credit, 0);
  const closingBal = totDr - totCr;

  const typeClass = t => {
    const m = { Receipt: "receipt", Payment: "payment", Accrual: "accrual", Reversal: "accrual", Invoice: "invoice", VAT: "vat", Payroll: "payroll" };
    return `glex-type-pill glex-type-${m[t] || ""}`;
  };

  return (
    <div className="card fade-up">
      <div className="card-header">
        <span className="card-title">General Ledger Extract — {PERIOD}</span>
        <span style={{ fontSize: 10, color: "var(--dim)", fontFamily: "Source Code Pro, monospace" }}>{lines.length} entries</span>
      </div>

      <div className="gl-extract-toolbar">
        <span style={{ fontSize: 10, fontFamily: "Source Code Pro, monospace", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Account</span>
        <select className="gl-extract-select" value={selectedCode} onChange={e => setSelectedCode(e.target.value)} style={{ minWidth: 280 }}>
          {accountsWithData.map(a => (
            <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
          ))}
        </select>
        <span style={{ fontSize: 10, fontFamily: "Source Code Pro, monospace", color: "var(--dim)", marginLeft: "auto" }}>
          Period: {PERIOD}
        </span>
      </div>

      {account && (
        <div className="gl-acct-header">
          <span className="gl-acct-code">{account.code}</span>
          <span className="gl-acct-name">{account.name}</span>
          <span className="gl-acct-type">{account.type}</span>
        </div>
      )}

      {withBalance.length === 0 ? (
        <div className="gl-no-data">No transactions for this account in {PERIOD}</div>
      ) : (
        <table className="glex-table">
          <thead>
            <tr>
              <th style={{ width: 70 }}>Date</th>
              <th style={{ width: 90 }}>Ref</th>
              <th style={{ width: 80 }}>Type</th>
              <th>Narrative</th>
              <th className="r" style={{ width: 100 }}>Debit (€)</th>
              <th className="r" style={{ width: 100 }}>Credit (€)</th>
              <th className="r" style={{ width: 110 }}>Balance (€)</th>
            </tr>
          </thead>
          <tbody>
            {withBalance.map((line, i) => (
              <tr key={i} style={{ opacity: line.type === "Opening" ? 0.65 : 1 }}>
                <td className="mono" style={{ color: "var(--dim)" }}>{line.date}</td>
                <td className="mono" style={{ color: "var(--navy)", fontSize: 10 }}>{line.ref}</td>
                <td><span className={typeClass(line.type)}>{line.type}</span></td>
                <td style={{ color: "var(--muted)" }}>{line.narrative}</td>
                <td className="r mono dr">{line.debit > 0 ? fmt(line.debit) : "—"}</td>
                <td className="r mono cr">{line.credit > 0 ? fmt(line.credit) : "—"}</td>
                <td className={`r mono ${line.balance >= 0 ? "bal-pos" : "bal-neg"}`}>
                  {line.balance < 0 ? `(${fmt(Math.abs(line.balance))})` : fmt(line.balance)}
                </td>
              </tr>
            ))}
            <tr className="glex-totrow">
              <td colSpan={4} style={{ fontFamily: "Playfair Display, serif", fontSize: 12 }}>Period Total</td>
              <td className="r mono">{fmt(totDr)}</td>
              <td className="r mono cr">{fmt(totCr)}</td>
              <td className={`r mono ${closingBal >= 0 ? "bal-pos" : "bal-neg"}`}>
                {closingBal < 0 ? `(${fmt(Math.abs(closingBal))})` : fmt(closingBal)}
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}


function Journals() {
  const [journals, setJournals] = useState(POSTED_JOURNALS);
  const [expanded, setExpanded] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiText, setAiText] = useState("");
  const emptyLine = () => ({ id: Date.now() + Math.random(), account: "", debit: "", credit: "" });
  const [form, setForm] = useState({ date: "30 Apr 2026", type: "Accrual", description: "", preparedBy: "", lines: [emptyLine(), emptyLine()] });
  const totDr = form.lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totCr = form.lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const balanced = Math.abs(totDr - totCr) < 0.01 && totDr > 0;
  const upd = (id, f, v) => setForm(p => ({ ...p, lines: p.lines.map(l => l.id === id ? { ...l, [f]: v } : l) }));
  const addLine = () => setForm(p => ({ ...p, lines: [...p.lines, emptyLine()] }));
  const remLine = id => setForm(p => ({ ...p, lines: p.lines.filter(l => l.id !== id) }));
  const post = () => {
    if (!balanced || !form.description) return;
    const ref = `JNL-${String(jnlCounter++).padStart(3, "0")}`;
    setJournals(j => [{ ref, date: form.date, type: form.type, description: form.description, preparedBy: form.preparedBy || "User", status: "posted",
      lines: form.lines.filter(l => l.account).map(l => { const acc = GL_ACCOUNTS.find(a => a.code === l.account); return { account: l.account, name: acc?.name || "", debit: parseFloat(l.debit) || 0, credit: parseFloat(l.credit) || 0 }; }) }, ...j]);
    setForm({ date: "30 Apr 2026", type: "Accrual", description: "", preparedBy: "", lines: [emptyLine(), emptyLine()] });
    setShowForm(false);
  };
  const suggest = async () => {
    setAiOpen(true); setAiLoading(true); setAiText("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000,
          system: `You are an expert Irish chartered accountant. For ${COMPANY} April 2026 month end, suggest outstanding journal entries. Available accounts: ${GL_ACCOUNTS.map(a => `${a.code} ${a.name}`).join(", ")}. Already posted: Depreciation JNL-001, Accrual for legal fees JNL-002, Prepayment for insurance JNL-003. Suggest 2-3 journals with account codes, amounts and brief rationale. Be concise and professional.`,
          messages: [{ role: "user", content: "What journal entries should I post for April month end?" }] })
      });
      const data = await res.json();
      setAiText(data.content?.[0]?.text || "No suggestions returned.");
    } catch { setAiText("Unable to reach AI. Please try again."); }
    setAiLoading(false);
  };
  return (
    <div className="fade-up">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: "Playfair Display, serif", fontSize: 17, fontWeight: 700, color: "var(--navy)", marginBottom: 2 }}>Journal Postings — {PERIOD}</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>{journals.length} journals posted this period</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-s" onClick={suggest}>⚡ AI Suggest</button>
          <button className="btn btn-p" onClick={() => { setShowForm(true); setAiOpen(false); }}>+ New Journal</button>
        </div>
      </div>

      {aiOpen && (
        <div className="card full-col" style={{ marginBottom: 12, borderLeft: "4px solid var(--teal)" }}>
          <div className="card-header" style={{ background: "rgba(29,107,114,0.05)" }}>
            <span className="card-title" style={{ color: "var(--teal)" }}>AI Journal Suggestions</span>
            <button className="btn btn-s btn-sm" onClick={() => setAiOpen(false)}>Dismiss</button>
          </div>
          <div className="card-body">
            {aiLoading
              ? <div style={{ color: "var(--dim)", fontSize: 13 }}><span className="dot" /><span className="dot" /><span className="dot" /> Analysing month end position...</div>
              : <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{aiText}</div>}
          </div>
        </div>
      )}

      {showForm && (
        <div className="jnl-form">
          <div className="jnl-fh"><span className="jnl-ft">New Journal Entry</span><button className="btn btn-s btn-sm" onClick={() => setShowForm(false)}>Cancel</button></div>
          <div className="jnl-fb">
            <div className="f-row">
              <div className="f-group"><label className="f-label">Date</label><input className="f-input" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} /></div>
              <div className="f-group"><label className="f-label">Journal Type</label>
                <select className="f-input" value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}>
                  {JOURNAL_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="f-group"><label className="f-label">Prepared By</label><input className="f-input" value={form.preparedBy} onChange={e => setForm(p => ({ ...p, preparedBy: e.target.value }))} placeholder="Name" /></div>
            </div>
            <div className="f-group" style={{ marginBottom: 14 }}>
              <label className="f-label">Narrative / Description</label>
              <input className="f-input" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Brief description of this journal entry" />
            </div>
            <table className="lines-tbl">
              <thead><tr><th style={{ width: 140 }}>Account</th><th>Type</th><th className="r" style={{ width: 110 }}>Debit (€)</th><th className="r" style={{ width: 110 }}>Credit (€)</th><th style={{ width: 34 }}></th></tr></thead>
              <tbody>
                {form.lines.map(line => {
                  const acc = GL_ACCOUNTS.find(a => a.code === line.account);
                  return (
                    <tr key={line.id}>
                      <td><select className="l-input" value={line.account} onChange={e => upd(line.id, "account", e.target.value)}>
                        <option value="">Select...</option>
                        {GL_ACCOUNTS.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                      </select></td>
                      <td><div style={{ padding: "5px 7px", fontSize: 11, color: "var(--dim)", fontFamily: "Source Code Pro, monospace" }}>{acc ? acc.type : ""}</div></td>
                      <td><input className="l-input num" type="number" min="0" placeholder="0.00" value={line.debit} onChange={e => upd(line.id, "debit", e.target.value)} /></td>
                      <td><input className="l-input num" type="number" min="0" placeholder="0.00" value={line.credit} onChange={e => upd(line.id, "credit", e.target.value)} /></td>
                      <td><button className="btn btn-d btn-sm" onClick={() => remLine(line.id)} style={{ padding: "4px 8px" }}>✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ marginBottom: 9 }}><button className="btn btn-s btn-sm" onClick={addLine}>+ Add Line</button></div>
            <div className="bal-row">
              <span style={{ color: "var(--dim)", fontSize: 11 }}>Debits: <strong style={{ color: "var(--navy)", fontFamily: "Source Code Pro, monospace" }}>{fmt(totDr)}</strong></span>
              <span style={{ color: "var(--dim)", fontSize: 11 }}>Credits: <strong style={{ color: "var(--navy)", fontFamily: "Source Code Pro, monospace" }}>{fmt(totCr)}</strong></span>
              <span className={balanced ? "bal-ok" : "bal-err"}>{totDr === 0 ? "Enter amounts" : balanced ? "✓ Balanced" : `Out by ${fmt(Math.abs(totDr - totCr))}`}</span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-p" onClick={post} disabled={!balanced || !form.description} style={{ opacity: (!balanced || !form.description) ? 0.42 : 1 }}>Post Journal</button>
              <button className="btn btn-s" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="jnl-list">
        {journals.map((j, ji) => (
          <div key={ji} className="jnl-card">
            <div className="jnl-head" onClick={() => setExpanded(expanded === ji ? null : ji)}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="jnl-ref">{j.ref}</span>
                  <span style={{ fontSize: 10, fontFamily: "Source Code Pro, monospace", color: "var(--dim)" }}>{j.type}</span>
                  <SPill status={j.status} />
                </div>
                <div className="jnl-desc">{j.description}</div>
                <div className="jnl-meta">{j.date} · Prepared by {j.preparedBy}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 10, color: "var(--dim)", fontFamily: "Source Code Pro, monospace" }}>Total</div>
                  <div style={{ fontFamily: "Source Code Pro, monospace", fontSize: 13, fontWeight: 600, color: "var(--navy)" }}>{fmt(j.lines.reduce((s, l) => s + l.debit, 0))}</div>
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
                  <span className="jl-code" /><span className="jl-name" style={{ fontFamily: "Playfair Display, serif", fontSize: 12 }}>Total</span>
                  <span className="jl-dr" style={{ fontWeight: 700 }}>{fmt(j.lines.reduce((s, l) => s + l.debit, 0))}</span>
                  <span className="jl-cr" style={{ fontWeight: 700 }}>{fmt(j.lines.reduce((s, l) => s + l.credit, 0))}</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const SUGGS = ["Will I have enough cash for payroll?", "What journals should I post at month end?", "What's net profit vs budget?", "Which invoices are most at risk?"];

function Chat({ page }) {
  const [msgs, setMsgs] = useState([{ role: "assistant", text: `Good morning. Your ${PERIOD} accounts are loaded. Cash is up €3.2k, VAT3 is ready, Murphy Retail at 62 days. What do you need?` }]);
  const [inp, setInp] = useState("");
  const [typing, setTyping] = useState(false);
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, typing]);
  const send = async (text) => {
    const msg = text || inp; if (!msg.trim()) return;
    setInp(""); setMsgs(p => [...p, { role: "user", text: msg }]); setTyping(true);
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000,
          system: `You are Finflow AI — a sharp, concise finance assistant built into Finflow, an Irish SME ERP. You are currently assisting the financial controller of ${COMPANY}.

COMPANY FINANCIALS (${PERIOD}):
- Cash: €47,820 (AIB Business Current) + €12,400 (Deposit) = €60,220 total
- Cash change: +€3,240 this week
- Revenue: €151,800 actual vs €144,500 budget (+€7,300 favourable)
- Gross Profit: €77,500 (51% margin)
- Net Profit: €8,330 vs budget €11,700 (€3,370 adverse — driven by professional fees overspend)
- Overdue AR: €9,610 across 4 invoices. Murphy Retail (INV-0091, €4,800, 62 days) is highest risk.
- Total AR outstanding: €27,400 across 6 invoices
- Upcoming AP next 30 days: €33,120 (Payroll €18,600 on 7 May, VAT3 €6,120 on 19 May, lease €2,400 on 2 May)
- 30-day cash forecast after AP: €27,100
- VAT3 (Feb/Mar): €6,120 payable, prepared, due 19 May — 19 days
- P30 (April): prepared, due 14 May — 14 days — ACTION NEEDED
- CT1 (FY2024): due 23 Jun — 54 days
- 3 journals posted: depreciation, legal accrual, insurance prepayment
- Anomaly: duplicate payment €340 to Limerick Supplies flagged
- Contractor spend: up 34% vs last quarter

RULES: Max 2–3 sentences. Be direct and specific — cite actual figures. Use Irish accounting terminology (ROS, CRO, CT1, P30, VAT3). Current page: ${page}.`,
          messages: [...msgs.map(m => ({ role: m.role, content: m.text })), { role: "user", content: msg }] }) });
      const data = await res.json();
      setMsgs(p => [...p, { role: "assistant", text: data.content?.[0]?.text || "Unable to respond." }]);
    } catch { setMsgs(p => [...p, { role: "assistant", text: "Connection error. Please try again." }]); }
    setTyping(false);
  };
  return (
    <div className="chat-panel">
      <div className="chat-hdr"><div className="chat-av">⚡</div><div><div className="chat-ttl">Finflow AI</div><div className="chat-st">● Online</div></div></div>
      <div className="chat-msgs">
        {msgs.map((m, i) => <div key={i} className={`msg ${m.role === "assistant" ? "msg-a" : "msg-u"}`}>{m.text}</div>)}
        {typing && <div className="msg msg-a"><span className="dot" /><span className="dot" /><span className="dot" /></div>}
        <div ref={endRef} />
      </div>
      <div className="chat-sugg">{SUGGS.map((s, i) => <button key={i} className="sugg" onClick={() => send(s)}>{s}</button>)}</div>
      <div className="chat-inp-area">
        <input className="chat-inp" value={inp} onChange={e => setInp(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} placeholder="Ask anything..." />
        <button className="send-btn" onClick={() => send()}>↑</button>
      </div>
    </div>
  );
}

const NAV = [
  { id: "overview", icon: "◈", label: "Overview" },
  { id: "cashflow", icon: "⟁", label: "Cash Flow" },
  { id: "invoices", icon: "◻", label: "Invoices" },
  { id: "checklist", icon: "☑", label: "Month End", badge: true },
  { id: "journals", icon: "✎", label: "Journals" },
  { id: "gl", icon: "⊞", label: "GL Reports" },
  { id: "compliance", icon: "⊙", label: "Compliance" },
];

const TITLES = {
  overview:   ["Overview",         `${COMPANY} · ${PERIOD}`],
  cashflow:   ["Cash Flow",        "Forecasting · bank accounts · AP schedule"],
  invoices:   ["Invoices",         "AR ledger · aging · AI chase log"],
  checklist:  ["Month End Close",  `${PERIOD} · close checklist`],
  journals:   ["Journal Postings", `${PERIOD} · general ledger journals`],
  gl:         ["GL Reporting",     "Trial balance · P&L · Balance sheet · GL extract"],
  compliance: ["Compliance",       "ROS · CRO · Revenue deadlines"],
};

export default function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [page, setPage] = useState("overview");
  const allItems = CHECKLIST_SECTIONS.flatMap(s => s.items);
  const [title, subtitle] = TITLES[page] || ["", ""];

  if (!loggedIn) return (
    <>
      <style>{CSS}</style>
      <Login onLogin={() => setLoggedIn(true)} />
    </>
  );

  return (
    <>
      <style>{CSS}</style>
      <div className="app">
        <div className="sidebar">
          <div className="sidebar-logo">
            <div className="logo-mark">Fin<span className="logo-accent">flow</span></div>
            <div className="logo-sub">Finance OS · Ireland</div>
          </div>
          <div className="nav">
            <div className="nav-label">Workspace</div>
            {NAV.map(item => (
              <button key={item.id} className={`nav-item ${page === item.id ? "active" : ""}`} onClick={() => setPage(item.id)}>
                <span className="nav-icon">{item.icon}</span>{item.label}
                {item.badge && <span className="nav-badge">{allItems.length}</span>}
              </button>
            ))}
          </div>
          <div className="sidebar-footer">
            <div className="co-pill"><div className="co-dot" /><span className="co-name">{COMPANY}</span></div>
          </div>
        </div>
        <div className="main">
          <div className="topbar">
            <div><div className="pg-title">{title}</div><div className="pg-sub">{subtitle}</div></div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div className="feed-pill"><span className="feed-dot" />AIB · Live</div>
              <div className="period-badge">{PERIOD}</div>
              <div className="user-chip">
                <div className="user-av">PB</div>
                <span className="user-name">P. Brennan</span>
              </div>
            </div>
          </div>
          <div className="content">
            {page === "overview"   && <Overview />}
            {page === "cashflow"   && <CashFlow />}
            {page === "invoices"   && <Invoices />}
            {page === "checklist"  && <Checklist />}
            {page === "journals"   && <Journals />}
            {page === "gl"         && <GLReport />}
            {page === "compliance" && <Compliance />}
          </div>
        </div>
        <Chat page={title} />
      </div>
    </>
  );
}
