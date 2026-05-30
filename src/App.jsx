import { useState, useEffect, useRef } from "react";
import { useUser } from "@clerk/clerk-react";
import { AuthGate, UserChip } from "./auth.jsx"
import { supabase, getCompanyClient } from "./supabase.js"


const GL_ACCOUNTS = [
  // Assets
  { code: "1000", name: "Bank — Current Account",  type: "Asset" },
  { code: "1100", name: "Trade Debtors",            type: "Asset" },
  { code: "1200", name: "Prepayments",              type: "Asset" },
  { code: "1500", name: "Fixed Assets",             type: "Asset" },
  { code: "1600", name: "VAT Receivable",           type: "Asset" },
  // Liabilities
  { code: "2000", name: "Trade Creditors",          type: "Liability" },
  { code: "2100", name: "VAT Control",              type: "Liability" },
  { code: "2200", name: "PAYE & PRSI Payable",      type: "Liability" },
  { code: "2300", name: "Accruals",                 type: "Liability" },
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
  { code: "6700", name: "Marketing & Advertising",  type: "Expense" },
  { code: "6800", name: "Insurance",                type: "Expense" },
  { code: "6900", name: "Repairs & Maintenance",    type: "Expense" },
  { code: "6950", name: "Depreciation",             type: "Expense" },
];

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
    "Prepare management accounts pack",
  ]},
];

const PNL = { revenue: [], cos: [], opex: [] };

const JOURNAL_TYPES = ["Accrual", "Prepayment", "Depreciation", "Payroll", "Correction", "Intercompany", "Other"];


const GL_EXTRACT = {};

const fmt = (n) => `€${Math.abs(n).toLocaleString("en-IE")}`;
const fmtK = (n) => n >= 1000 ? `€${(n / 1000).toFixed(0)}k` : fmt(n);
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
    --bg: #f3f4f6; --surface: #ffffff; --surface2: #f9fafb; --surface3: #f3f4f6;
    --border: #e5e7eb; --border2: #d1d5db;
    --sidebar: #16213e; --sidebar2: #1e2d4e;
    --teal: #1d6b72; --teal2: #258a93;
    --gold: #b8860b; --gold2: #d4a017;
    --red: #dc2626; --green: #16a34a;
    --text: #111827; --muted: #6b7280; --dim: #9ca3af; --white: #ffffff;
    --shadow-sm: 0 1px 3px rgba(0,0,0,0.06),0 1px 2px rgba(0,0,0,0.04);
    --shadow: 0 4px 6px rgba(0,0,0,0.05),0 1px 3px rgba(0,0,0,0.08);
    --radius: 8px; --radius-sm: 6px; --radius-lg: 12px;
  }
  body { background: var(--bg); color: var(--text); font-family: 'Inter', system-ui, -apple-system, sans-serif; font-size: 14px; -webkit-font-smoothing: antialiased; }
  ::-webkit-scrollbar { width: 5px; height: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 10px; }
  .app { display: flex; height: 100vh; overflow: hidden; }
  .sidebar { width: 220px; min-width: 220px; background: var(--sidebar); display: flex; flex-direction: column; }
  .sidebar-logo { padding: 22px 18px 18px; border-bottom: 1px solid rgba(255,255,255,0.07); }
  .logo-mark { font-family: 'Playfair Display', serif; font-weight: 700; font-size: 22px; color: #fff; letter-spacing: -0.02em; }
  .logo-accent { color: var(--gold2); }
  .logo-sub { font-size: 10px; color: rgba(255,255,255,0.25); font-family: 'Source Code Pro', monospace; letter-spacing: 0.1em; text-transform: uppercase; margin-top: 3px; }
  .nav { padding: 10px 8px; flex: 1; overflow-y: auto; }
  .nav-label { font-size: 9px; font-family: 'Source Code Pro', monospace; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.2); padding: 8px 10px 4px; }
  .nav-item { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: var(--radius); cursor: pointer; font-size: 13px; font-weight: 500; color: rgba(255,255,255,0.45); transition: all 0.13s; margin-bottom: 2px; border: none; background: none; width: 100%; text-align: left; font-family: 'Inter', system-ui, sans-serif; }
  .nav-item:hover { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.85); }
  .nav-item.active { background: rgba(255,255,255,0.13); color: #fff; font-weight: 600; }
  .nav-icon { font-size: 14px; width: 20px; text-align: center; flex-shrink: 0; }
  .nav-badge { margin-left: auto; background: #ef4444; color: white; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 10px; }
  .sidebar-footer { padding: 13px 16px; border-top: 1px solid rgba(255,255,255,0.07); }
  .co-pill { display: flex; align-items: center; gap: 8px; }
  .co-dot { width: 7px; height: 7px; border-radius: 50%; background: #34d399; animation: blink-d 2.5s infinite; }
  @keyframes blink-d { 0%,100%{opacity:1} 50%{opacity:0.3} }
  .co-name { font-size: 12px; color: rgba(255,255,255,0.38); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .topbar { height: 56px; min-height: 56px; background: var(--white); border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; padding: 0 24px; }
  .pg-title { font-family: 'Playfair Display', serif; font-size: 17px; font-weight: 600; color: var(--text); letter-spacing: -0.01em; }
  .pg-sub { font-size: 11px; color: var(--dim); margin-top: 1px; font-family: 'Source Code Pro', monospace; }
  .period-badge { background: var(--surface2); border: 1px solid var(--border); border-radius: 20px; padding: 4px 14px; font-size: 11px; font-family: 'Source Code Pro', monospace; color: var(--muted); }
  .content { flex: 1; overflow: auto; padding: 20px 24px; }
  .card { background: var(--white); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-sm); }
  .card-header { padding: 14px 18px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
  .card-title { font-family: 'Playfair Display', serif; font-size: 14px; font-weight: 600; color: var(--text); }
  .card-body { padding: 16px 18px; }
  .kpi-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 12px; margin-bottom: 16px; }
  .kpi-card { background: var(--white); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px 20px; box-shadow: var(--shadow-sm); position: relative; overflow: hidden; }
  .kpi-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: var(--tc, var(--teal)); border-radius: var(--radius) var(--radius) 0 0; }
  .kpi-label { font-size: 11px; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; color: var(--dim); margin-bottom: 10px; }
  .kpi-value { font-family: 'Playfair Display', serif; font-size: 26px; font-weight: 700; letter-spacing: -0.02em; line-height: 1; }
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
  .comp-days { font-family: 'Playfair Display', serif; font-size: 22px; font-weight: 700; }
  .bar-track { height: 4px; background: var(--border); border-radius: 4px; overflow: hidden; margin-top: 5px; }
  .bar-fill { height: 100%; border-radius: 4px; transition: width 1.2s ease; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
  .full-col { margin-bottom: 14px; }
  .pb-track { height: 5px; background: var(--border); border-radius: 4px; overflow: hidden; width: 180px; }
  .pb-fill { height: 100%; background: var(--teal); border-radius: 4px; transition: width 0.5s ease; }
  .sec-title { font-family: 'Playfair Display', serif; font-size: 13px; font-weight: 600; color: var(--text); padding: 12px 18px 10px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; background: var(--surface2); border-radius: var(--radius) var(--radius) 0 0; }
  .sec-count { font-size: 11px; color: var(--dim); font-family: 'Source Code Pro', monospace; font-weight: 400; }
  .chk-item { display: flex; align-items: flex-start; gap: 10px; padding: 10px 18px; cursor: pointer; transition: background 0.1s; border-bottom: 1px solid var(--border); }
  .chk-item:last-child { border-bottom: none; }
  .chk-item:hover { background: var(--surface2); }
  .chk-item.done { opacity: 0.5; }
  .chk-box { width: 17px; height: 17px; border-radius: 4px; flex-shrink: 0; border: 1.5px solid var(--border2); background: white; display: flex; align-items: center; justify-content: center; transition: all 0.12s; margin-top: 2px; }
  .chk-item.done .chk-box { background: var(--teal); border-color: var(--teal); }
  .chk-tick { color: white; font-size: 10px; font-weight: 700; }
  .chk-label { font-size: 13px; line-height: 1.5; }
  .chk-item.done .chk-label { text-decoration: line-through; color: var(--dim); }
  .ai-badge { margin-left: auto; flex-shrink: 0; font-size: 9px; font-family: 'Source Code Pro', monospace; color: var(--teal); background: rgba(29,107,114,0.08); padding: 2px 8px; border-radius: 20px; letter-spacing: 0.06em; margin-top: 3px; border: 1px solid rgba(29,107,114,0.15); }
  .gl-tabs { display: flex; gap: 2px; margin-bottom: 16px; background: var(--white); border: 1px solid var(--border); border-radius: var(--radius); padding: 4px; box-shadow: var(--shadow-sm); }
  .gl-tab { padding: 8px 20px; cursor: pointer; font-size: 12px; font-weight: 500; border: none; background: transparent; color: var(--muted); transition: all 0.13s; flex: 1; text-align: center; font-family: 'Inter', system-ui, sans-serif; border-radius: var(--radius-sm); }
  .gl-tab.active { background: var(--teal); color: white; font-weight: 600; box-shadow: var(--shadow-sm); }
  .gl-tab:hover:not(.active) { background: var(--surface2); color: var(--text); }
  .gl-table { width: 100%; border-collapse: collapse; }
  .gl-table th { font-size: 10px; font-family: 'Source Code Pro', monospace; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); padding: 10px 16px; text-align: left; background: var(--surface2); border-bottom: 1px solid var(--border); font-weight: 600; }
  .gl-table th.r { text-align: right; }
  .gl-table td { padding: 9px 16px; font-size: 13px; border-bottom: 1px solid var(--border); }
  .gl-table tr:nth-child(even) td { background: var(--surface2); }
  .gl-table tr:hover td { background: #eff6ff; }
  .gl-table .mono { font-family: 'Source Code Pro', monospace; font-size: 12px; }
  .gl-table .r { text-align: right; }
  .gl-table .tot td { font-weight: 700; border-top: 2px solid var(--border2); border-bottom: none; background: var(--surface2); }
  .pnl-row { display: flex; align-items: center; padding: 9px 18px; font-size: 13px; border-bottom: 1px solid var(--border); }
  .pnl-row:hover { background: var(--surface2); }
  .pnl-n { flex: 1; }
  .pnl-v { width: 100px; text-align: right; font-family: 'Source Code Pro', monospace; font-size: 12px; }
  .pnl-var { width: 70px; text-align: right; font-size: 11px; font-family: 'Source Code Pro', monospace; }
  .pnl-sec { background: var(--surface2); }
  .pnl-sec .pnl-n { font-family: 'Playfair Display', serif; font-weight: 600; font-size: 13px; color: var(--text); }
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
  .jnl-fh { padding: 14px 18px; background: var(--teal); color: white; display: flex; align-items: center; justify-content: space-between; }
  .jnl-ft { font-family: 'Playfair Display', serif; font-size: 15px; font-weight: 600; }
  .jnl-fb { padding: 18px; }
  .f-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; margin-bottom: 14px; }
  .f-group { display: flex; flex-direction: column; gap: 5px; }
  .f-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
  .f-input { background: white; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 8px 12px; font-size: 13px; font-family: 'Inter', system-ui, sans-serif; color: var(--text); outline: none; transition: border-color 0.14s, box-shadow 0.14s; }
  .f-input:focus { border-color: var(--teal); box-shadow: 0 0 0 3px rgba(29,107,114,0.1); }
  .lines-tbl { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  .lines-tbl th { font-size: 10px; font-family: 'Source Code Pro', monospace; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); padding: 8px 10px; text-align: left; background: var(--surface2); border-bottom: 1px solid var(--border); font-weight: 600; }
  .lines-tbl th.r { text-align: right; }
  .lines-tbl td { padding: 4px 4px; border-bottom: 1px solid var(--border); }
  .l-input { width: 100%; background: white; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 6px 9px; font-size: 12px; font-family: 'Inter', system-ui, sans-serif; color: var(--text); outline: none; }
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
  .chat-panel { width: 295px; min-width: 295px; border-left: 1px solid var(--border); display: flex; flex-direction: column; background: var(--surface); }
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
  .chat-inp { flex: 1; background: white; border: 1px solid var(--border2); border-radius: var(--radius-sm); color: var(--text); padding: 6px 9px; font-size: 12px; font-family: 'Inter', system-ui, sans-serif; outline: none; transition: border-color 0.13s; }
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
  .login-input { width: 100%; background: white; border: 1px solid var(--border2); border-radius: var(--radius-sm); padding: 10px 13px; font-size: 13px; font-family: 'Inter', system-ui, sans-serif; color: var(--text); outline: none; transition: border-color 0.14s; }
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
  .gl-extract-select { background: white; border: 1px solid var(--border2); border-radius: var(--radius-sm); padding: 5px 9px; font-size: 12px; font-family: 'Inter', system-ui, sans-serif; color: var(--text); outline: none; cursor: pointer; }
  .gl-extract-select:focus { border-color: var(--teal); box-shadow: 0 0 0 2px rgba(29,107,114,0.1); }
  .gl-acct-header { padding: 9px 15px; background: var(--surface2); border-bottom: 1px solid var(--border); display: flex; align-items: baseline; gap: 10px; }
  .gl-acct-code { font-family: 'Source Code Pro', monospace; font-size: 12px; color: var(--dim); }
  .gl-acct-name { font-family: 'Playfair Display', serif; font-size: 14px; font-weight: 600; color: var(--text); }
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
  .ob-input { background: white; border: 1px solid var(--border2); border-radius: var(--radius-sm); padding: 9px 11px; font-size: 13px; font-family: 'Inter', system-ui, sans-serif; color: var(--text); outline: none; transition: border-color 0.14s; }
  .ob-input:focus { border-color: var(--teal); box-shadow: 0 0 0 3px rgba(29,107,114,0.1); }
  .ob-toggle { display: flex; border: 1px solid var(--border2); border-radius: var(--radius-sm); overflow: hidden; }
  .ob-toggle-btn { flex: 1; padding: 9px; font-size: 12px; font-weight: 600; font-family: 'Inter', system-ui, sans-serif; border: none; cursor: pointer; background: white; color: var(--muted); transition: all 0.12s; }
  .ob-toggle-btn.active { background: var(--teal); color: white; }
  .ob-submit { width: 100%; background: var(--teal); color: white; border: none; border-radius: var(--radius-sm); padding: 13px; font-size: 14px; font-weight: 600; font-family: 'Inter', system-ui, sans-serif; cursor: pointer; margin-top: 6px; transition: background 0.14s; letter-spacing: 0.02em; }
  .ob-submit:hover:not(:disabled) { background: var(--teal2); }
  .ob-submit:disabled { opacity: 0.45; cursor: not-allowed; }
  .ob-footer { padding: 12px 30px; background: var(--surface2); border-top: 1px solid var(--border); font-size: 10px; color: var(--dim); font-family: 'Source Code Pro', monospace; }
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
  .bi-nom-sel { font-size: 11px; font-family: 'Inter', system-ui, sans-serif; background: white; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 3px 6px; color: var(--text); outline: none; width: 100%; }
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
        <div className="mm-idle-logo">Fin<span>flow</span></div>
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

// ─── ONBOARDING ───────────────────────────────────────────────────────────────
const OB_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const OB_CURRENCIES = ["EUR","GBP","USD"];
const OB_TYPES = ["Limited Company","Sole Trader","Partnership"];

function Onboarding({ user, onComplete }) {
  const [form, setForm] = useState({
    name: user.firstName ? `${user.firstName} ${user.lastName ?? ""}`.trim() : "",
    companyType: "Limited Company",
    vatRegistered: false,
    vatNumber: "",
    periodStart: 1,
    currency: "EUR",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const valid = form.name.trim().length > 0 &&
    (!form.vatRegistered || form.vatNumber.trim().length > 0);

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true); setError(null);
    const { data, error: err } = await supabase.from("companies").insert({
      clerk_user_id: user.id,
      name: form.name.trim(),
      company_type: form.companyType,
      vat_registered: form.vatRegistered,
      vat_number: form.vatRegistered ? form.vatNumber.trim() || null : null,
      period_start: form.periodStart,
      currency: form.currency,
    }).select().single();
    if (err) { setError(`Could not save: ${err.message}`); setSaving(false); return; }
    onComplete(data);
  };

  return (
    <div className="ob-wrap">
      <div className="ob-card">
        <div className="ob-header">
          <div className="ob-logo">Fin<span>flow</span></div>
          <div className="ob-tagline">Finance OS · Ireland</div>
        </div>
        <div className="ob-body">
          <div className="ob-step">Workspace Setup — Step 1 of 1</div>
          <p className="ob-title">Set up your company</p>
          <p className="ob-sub">Takes 60 seconds. You can update these details later in Settings.</p>

          <div className="ob-row full">
            <div className="ob-group">
              <label className="ob-label">Company / Trading Name</label>
              <input className="ob-input" value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Brennan & Sons Ltd" onKeyDown={e => e.key === "Enter" && submit()} />
            </div>
          </div>

          <div className="ob-row">
            <div className="ob-group">
              <label className="ob-label">Company Type</label>
              <select className="ob-input" value={form.companyType}
                onChange={e => setForm(p => ({ ...p, companyType: e.target.value }))}>
                {OB_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="ob-group">
              <label className="ob-label">Base Currency</label>
              <select className="ob-input" value={form.currency}
                onChange={e => setForm(p => ({ ...p, currency: e.target.value }))}>
                {OB_CURRENCIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="ob-row">
            <div className="ob-group">
              <label className="ob-label">VAT Registered?</label>
              <div className="ob-toggle">
                <button className={`ob-toggle-btn ${!form.vatRegistered ? "active" : ""}`}
                  onClick={() => setForm(p => ({ ...p, vatRegistered: false, vatNumber: "" }))}>No</button>
                <button className={`ob-toggle-btn ${form.vatRegistered ? "active" : ""}`}
                  onClick={() => setForm(p => ({ ...p, vatRegistered: true }))}>Yes</button>
              </div>
            </div>
            <div className="ob-group">
              <label className="ob-label">Accounting Year Start</label>
              <select className="ob-input" value={form.periodStart}
                onChange={e => setForm(p => ({ ...p, periodStart: parseInt(e.target.value) }))}>
                {OB_MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
              </select>
            </div>
          </div>

          {form.vatRegistered && (
            <div className="ob-row full">
              <div className="ob-group">
                <label className="ob-label">VAT Number</label>
                <input className="ob-input" value={form.vatNumber}
                  onChange={e => setForm(p => ({ ...p, vatNumber: e.target.value }))}
                  placeholder="IE 1234567A" />
              </div>
            </div>
          )}

          {error && (
            <div style={{ marginBottom: 12, fontSize: 12, color: "var(--red)", background: "rgba(139,32,32,0.06)", border: "1px solid rgba(139,32,32,0.2)", borderRadius: 2, padding: "8px 12px" }}>
              {error}
            </div>
          )}

          <button className="ob-submit" onClick={submit} disabled={!valid || saving}>
            {saving ? "Setting up workspace…" : "Launch my workspace →"}
          </button>
        </div>
        <div className="ob-footer">
          Signed in as {user.emailAddresses[0].emailAddress} · Irish GAAP · SOC 2 · GDPR
        </div>
      </div>
    </div>
  );
}

// ─── CASH FLOW PAGE ───────────────────────────────────────────────────────────
function CashFlow({ onNavigate, companyId }) {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const [loading, setLoading]               = useState(true);
  const [txns, setTxns]                     = useState([]);
  const [allInvoices, setAllInvoices]       = useState([]);
  const [selectedPeriod, setSelectedPeriod] = useState(currentMonth);
  const [periodLoading, setPeriodLoading]   = useState(false);

  // Last 12 months for the dropdown
  const periodOptions = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return { val, label: d.toLocaleDateString("en-IE", { month: "long", year: "numeric" }) };
  });

  useEffect(() => {
    if (!companyId) { setLoading(false); return; }
    (async () => {
      setLoading(true);
      const db = getCompanyClient(companyId);
      const [txRes, invRes] = await Promise.all([
        db.from('bank_transactions').select('*').eq('company_id', companyId).order('date', { ascending: true }),
        db.from('invoices').select('*').eq('company_id', companyId)
          .in('status', ['pending', 'chased']).order('due_date', { ascending: true }),
      ]);
      if (txRes.data)  setTxns(txRes.data);
      if (invRes.data) setAllInvoices(invRes.data);
      setLoading(false);
    })();
  }, [companyId]);

  const handlePeriodChange = (val) => {
    setPeriodLoading(true);
    setSelectedPeriod(val);
    setTimeout(() => setPeriodLoading(false), 250);
  };

  // ── Empty state ──
  if (!loading && txns.length === 0) return (
    <div className="fade-up" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 340, textAlign: "center", padding: 48 }}>
      <div style={{ fontSize: 38, marginBottom: 16, color: "var(--dim)" }}>⟁</div>
      <div style={{ fontFamily: "Playfair Display, serif", fontSize: 18, fontWeight: 600, color: "var(--navy)", marginBottom: 8 }}>No bank data imported yet</div>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 24, maxWidth: 400, lineHeight: 1.7 }}>
        Upload a Revolut Business CSV in Bank Import to populate your cash flow forecast, account balances, and AP schedule.
      </div>
      <button className="btn btn-p" onClick={() => onNavigate("bank-import")}>Go to Bank Import</button>
    </div>
  );

  // ── Period bounds ──
  const isCurrentPeriod = selectedPeriod === currentMonth;
  const [py, pm] = selectedPeriod.split('-').map(Number);
  const periodStart    = `${selectedPeriod}-01`;
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

  const fmtBal  = v => `${v < 0 ? '-' : ''}€${Math.abs(v).toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = d => new Date(d + 'T12:00:00').toLocaleDateString("en-IE", { day: "2-digit", month: "short" });

  const baseLabel = isCurrentPeriod ? "Today" : fmtDate(periodEndStr);
  const forecast = [
    { label: baseLabel, days: 0,  val: currentBal },
    { label: "+30d",    days: 30, val: currentBal + avgDaily * 30 },
    { label: "+60d",    days: 60, val: currentBal + avgDaily * 60 },
    { label: "+90d",    days: 90, val: currentBal + avgDaily * 90 },
  ];

  const maxAbs  = Math.max(...forecast.map(f => Math.abs(f.val)), 1);
  const barH    = v => Math.max((Math.abs(v) / maxAbs) * 80, 4);

  const recent10 = [...periodTxns].reverse().slice(0, 10);

  // AP: invoices due in the 30 days after the period end
  const ap30End = new Date(periodEndDate.getTime() + 30 * 86400000).toISOString().slice(0, 10);
  const upcomingAP = allInvoices.filter(inv => inv.due_date > periodEndStr && inv.due_date <= ap30End);

  return (
    <div className="fade-up">
      {loading && <div style={{ padding: "32px 0", textAlign: "center", color: "var(--dim)", fontSize: 12, fontFamily: "Source Code Pro, monospace" }}>Loading cash flow data…</div>}

      {!loading && (
        <>
          {/* ── Period selector ── */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "Source Code Pro, monospace" }}>Period</span>
            <select
              value={selectedPeriod}
              onChange={e => handlePeriodChange(e.target.value)}
              style={{ fontSize: 12, fontFamily: "Source Code Pro, monospace", padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--navy)", cursor: "pointer" }}
            >
              {periodOptions.map(o => (
                <option key={o.val} value={o.val}>{o.label}{o.val === currentMonth ? " (current)" : ""}</option>
              ))}
            </select>
            {periodLoading && <span style={{ fontSize: 11, color: "var(--dim)", fontFamily: "Source Code Pro, monospace" }}>Updating…</span>}
          </div>

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
                      <span className="cf-bar-val" style={{ color: f.val >= 0 ? "var(--navy)" : "var(--red)", fontSize: 10 }}>{fmtBal(f.val)}</span>
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
        </>
      )}
    </div>
  );
}

// ─── INVOICES PAGE ────────────────────────────────────────────────────────────
function Invoices({ companyName = "Company" }) {
  const { user } = useUser();
  const [invoices, setInvoices] = useState([]);
  const [companyId, setCompanyId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const today = new Date();
  const daysFromToday = (d) => Math.floor((today - new Date(d)) / 86400000);
  const fmtDate = (d) => new Date(d).toLocaleDateString("en-IE", { day: "2-digit", month: "short" });
  const daysColour = d => d > 60 ? "var(--red)" : d > 30 ? "var(--gold)" : "var(--teal)";

  const emptyForm = () => ({
    invoice_ref: "", client: "", amount: "",
    invoice_date: today.toISOString().slice(0, 10),
    due_date: "", status: "pending",
  });
  const [form, setForm] = useState(emptyForm());

  const resolveCompanyId = async () => {
    let { data: companies } = await supabase
      .from("companies").select("id").eq("clerk_user_id", user.id).limit(1);
    if (companies && companies.length > 0) return companies[0].id;
    const companyName = user.firstName
      ? `${user.firstName} ${user.lastName ?? ""}`.trim()
      : user.emailAddresses[0].emailAddress;
    const { data: created, error: createErr } = await supabase
      .from("companies").insert({ clerk_user_id: user.id, name: companyName }).select("id").single();
    if (createErr) throw new Error(`Could not create workspace: ${createErr.message}`);
    return created.id;
  };

  useEffect(() => {
    if (!user) return;
    async function init() {
      setLoading(true);
      try {
        const cid = await resolveCompanyId();
        setCompanyId(cid);
        const db = getCompanyClient(cid);
        const { data: rows, error: rowsErr } = await db
          .from("invoices").select("*").eq("company_id", cid).order("due_date", { ascending: true });
        if (rowsErr) throw new Error(rowsErr.message);
        if (rows) setInvoices(rows);
      } catch (err) {
        console.error("[invoices] init failed:", err.message);
      }
      setLoading(false);
    }
    init();
  }, [user]);

  const formValid = !!(form.invoice_ref && form.client && form.amount &&
    parseFloat(form.amount) > 0 && form.invoice_date && form.due_date);

  const save = async () => {
    if (!formValid) return;
    setSaveError(null);
    let cid = companyId;
    if (!cid) {
      try { cid = await resolveCompanyId(); setCompanyId(cid); }
      catch (err) { setSaveError(err.message); return; }
    }
    const { data: inserted, error } = await getCompanyClient(cid).from("invoices").insert({
      company_id: cid,
      invoice_ref: form.invoice_ref,
      client: form.client,
      amount: parseFloat(form.amount),
      invoice_date: form.invoice_date,
      due_date: form.due_date,
      status: form.status,
    }).select().single();
    if (error) { setSaveError(`Save failed: ${error.message}`); return; }
    setInvoices(prev => [...prev, inserted].sort((a, b) => new Date(a.due_date) - new Date(b.due_date)));
    setForm(emptyForm());
    setShowForm(false);
  };

  const chase = async (inv, e) => {
    e.stopPropagation();
    const now = new Date().toISOString();
    const { error } = await getCompanyClient(companyId).from("invoices")
      .update({ status: "chased", last_chased_at: now }).eq("id", inv.id);
    if (!error) setInvoices(prev =>
      prev.map(i => i.id === inv.id ? { ...i, status: "chased", last_chased_at: now } : i));
  };

  const total = invoices.reduce((s, i) => s + (i.amount || 0), 0);
  const overdueInvs = invoices.filter(i => daysFromToday(i.due_date) > 30);
  const dueMonthInvs = invoices.filter(i => { const d = daysFromToday(i.due_date); return d >= 0 && d <= 30; });

  return (
    <div className="fade-up">
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
        {[
          { label: "Total Outstanding AR", value: fmt(total), sub: `${invoices.length} open invoice${invoices.length !== 1 ? "s" : ""}`, c: "var(--navy)" },
          { label: "Overdue (>30 days)", value: fmt(overdueInvs.reduce((s,i) => s + i.amount, 0)), sub: `${overdueInvs.length} invoice${overdueInvs.length !== 1 ? "s" : ""}`, c: "var(--red)" },
          { label: "Due This Month", value: fmt(dueMonthInvs.reduce((s,i) => s + i.amount, 0)), sub: `${dueMonthInvs.length} invoice${dueMonthInvs.length !== 1 ? "s" : ""}`, c: "var(--teal)" },
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
          <button className="btn btn-s" onClick={() => downloadCSV(`invoices-${fmtIE(new Date().toISOString().slice(0,10)).replace(/\//g,"-")}.csv`, [
            ["FinFlow — Accounts Receivable", companyName, `Exported ${fmtIE(new Date().toISOString().slice(0,10))}`],
            [],
            ["Invoice Ref", "Client", "Amount (€)", "Invoice Date", "Due Date", "Status", "Days Overdue"],
            ...invoices.map(inv => [inv.invoice_ref, inv.client, fmtEUR(inv.amount), fmtIE(inv.invoice_date), fmtIE(inv.due_date), inv.status, daysFromToday(inv.due_date)]),
          ])}>
            ⬇ Export CSV
          </button>
        )}
        <button className="btn btn-p" onClick={() => { setShowForm(v => !v); setSaveError(null); }}>
          {showForm ? "Cancel" : "+ New Invoice"}
        </button>
      </div>

      {showForm && (
        <div className="jnl-form" style={{ marginBottom: 12 }}>
          <div className="jnl-fh">
            <span className="jnl-ft">New Invoice</span>
            <button className="btn btn-s btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
          <div className="jnl-fb">
            <div className="f-row">
              <div className="f-group">
                <label className="f-label">Invoice Ref</label>
                <input className="f-input" value={form.invoice_ref} onChange={e => setForm(p => ({ ...p, invoice_ref: e.target.value }))} placeholder="INV-0099" />
              </div>
              <div className="f-group">
                <label className="f-label">Client</label>
                <input className="f-input" value={form.client} onChange={e => setForm(p => ({ ...p, client: e.target.value }))} placeholder="Client name" />
              </div>
              <div className="f-group">
                <label className="f-label">Amount (€)</label>
                <input className="f-input" type="number" min="0" step="0.01" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} placeholder="0.00" />
              </div>
            </div>
            <div className="f-row">
              <div className="f-group">
                <label className="f-label">Invoice Date</label>
                <input className="f-input" type="date" value={form.invoice_date} onChange={e => setForm(p => ({ ...p, invoice_date: e.target.value }))} />
              </div>
              <div className="f-group">
                <label className="f-label">Due Date</label>
                <input className="f-input" type="date" value={form.due_date} onChange={e => setForm(p => ({ ...p, due_date: e.target.value }))} />
              </div>
              <div className="f-group">
                <label className="f-label">Status</label>
                <select className="f-input" value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
                  {["pending", "chased", "escalated"].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            {saveError && (
              <div style={{ marginBottom: 10, fontSize: 12, color: "var(--red)", background: "rgba(139,32,32,0.06)", border: "1px solid rgba(139,32,32,0.2)", borderRadius: 2, padding: "7px 11px" }}>
                {saveError}
              </div>
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
          <span className="card-title">Accounts Receivable Ledger</span>
          <span style={{ fontSize: 10, color: "var(--teal)", fontFamily: "Source Code Pro, monospace" }}>AI CHASING ACTIVE</span>
        </div>
        {loading ? (
          <div style={{ padding: "20px 16px", fontSize: 13, color: "var(--dim)" }}>Loading invoices…</div>
        ) : invoices.length === 0 ? (
          <div style={{ padding: "32px 16px", fontSize: 13, color: "var(--dim)", textAlign: "center" }}>No invoices yet — add one above.</div>
        ) : (
          <table className="gl-table">
            <thead>
              <tr>
                <th>Invoice</th><th>Client</th><th>Issued</th><th>Due</th>
                <th>Days</th><th>Status</th><th className="r">Amount</th><th></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const days = daysFromToday(inv.due_date);
                const isSelected = selected === inv.id;
                const canChase = inv.status === "pending";
                return (
                  <tr key={inv.id} style={{ cursor: "pointer" }} onClick={() => setSelected(isSelected ? null : inv.id)}>
                    <td className="mono" style={{ color: "var(--navy)", fontWeight: 600 }}>{inv.invoice_ref}</td>
                    <td style={{ fontWeight: 500 }}>{inv.client}</td>
                    <td className="mono">{fmtDate(inv.invoice_date)}</td>
                    <td className="mono">{fmtDate(inv.due_date)}</td>
                    <td>
                      <div style={{ fontFamily: "Source Code Pro, monospace", fontSize: 12, fontWeight: 700, color: daysColour(days) }}>{days}d</div>
                      <div className="inv-days-bar"><div className="inv-days-fill" style={{ width: `${Math.min((days / 90) * 100, 100)}%`, background: daysColour(days) }} /></div>
                    </td>
                    <td><SPill status={inv.status} /></td>
                    <td className="r mono" style={{ fontWeight: 600 }}>{fmt(inv.amount)}</td>
                    <td onClick={e => e.stopPropagation()} style={{ paddingRight: 10 }}>
                      <button
                        className="btn btn-s btn-sm"
                        disabled={!canChase}
                        style={{ whiteSpace: "nowrap", opacity: canChase ? 1 : 0.38 }}
                        onClick={e => chase(inv, e)}
                      >Chase</button>
                    </td>
                  </tr>
                );
              })}
              <tr className="tot">
                <td colSpan={7} style={{ fontFamily: "Playfair Display, serif", fontSize: 12, paddingLeft: 12 }}>Total Outstanding</td>
                <td className="r mono" style={{ fontWeight: 700, fontSize: 13 }}>{fmt(total)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        )}
        {selected && (() => {
          const inv = invoices.find(i => i.id === selected);
          if (!inv) return null;
          const days = daysFromToday(inv.due_date);
          return (
            <div style={{ padding: "12px 16px", background: "rgba(26,39,68,0.03)", borderTop: "1px solid var(--border)" }}>
              <div style={{ fontSize: 11, color: "var(--dim)", fontFamily: "Source Code Pro, monospace", marginBottom: 8 }}>AI CHASE LOG — {inv.invoice_ref}</div>
              {[
                `Automated reminder sent on ${fmtDate(inv.invoice_date)} + 7 days`,
                `Second reminder sent at 14 days. No response recorded.`,
                inv.last_chased_at ? `Manually chased on ${new Date(inv.last_chased_at).toLocaleDateString("en-IE")}.` : null,
                days > 30 ? `Escalation email sent. Flagged for manual follow-up.` : null,
              ].filter(Boolean).map((log, li) => (
                <div key={li} style={{ fontSize: 12, color: "var(--muted)", padding: "5px 0", borderBottom: "1px solid var(--surface2)" }}>· {log}</div>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ─── COMPLIANCE PAGE ──────────────────────────────────────────────────────────
const MONTH_NAMES_LONG  = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTH_NAMES_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function getVATPeriods(vatPeriodType) {
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
        due:   new Date(y, m + 1, 19).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" }),
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
        due:   new Date(dy, dm % 12, 19).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" }),
      });
    }
  }
  return periods;
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
      const { data } = await getCompanyClient(company.id).from('journals')
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
    ["FinFlow — VAT3 Return Summary", company?.name || "Company", vatPeriod.label],
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
      <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 24, fontWeight: 700, color, lineHeight: 1 }}>{fmtEUR(value)}</div>
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
            style={{ fontSize: 11, fontFamily: "Source Code Pro, monospace", padding: "3px 7px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--navy)", cursor: "pointer" }}
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

function Compliance({ company }) {
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

  const today = new Date(); today.setHours(0,0,0,0);
  const daysDiff  = d => Math.floor((d - today) / 86400000);
  const fmtDate   = d => d.toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });
  const getStatus = d => { const n = daysDiff(d); return n < 0 ? 'overdue' : n <= 14 ? 'soon' : 'upcoming'; };
  const statusCol = s => ({ overdue: 'var(--red)', soon: 'var(--gold)', upcoming: 'var(--teal)' }[s]);
  const statusLbl = s => ({ overdue: 'Overdue', soon: 'Due soon', upcoming: 'Upcoming' }[s]);

  const deadlines = [];

  // P30 — PAYE/PRSI due 14th of following month; show ±2 months
  for (let i = -1; i <= 2; i++) {
    const m = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const due = new Date(today.getFullYear(), today.getMonth() + i + 1, 14);
    if (daysDiff(due) >= -60)
      deadlines.push({ type: "P30", desc: `PAYE/PRSI — ${MONTH_NAMES_LONG[m.getMonth()]} ${m.getFullYear()}`, detail: "Monthly employer payroll return to Revenue", due });
  }

  // VAT3 — bimonthly or monthly
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

  // CT1 — due 23rd day of 9th month after year end
  const yem = Number(settings.year_end_month) || 12;
  for (let y = today.getFullYear() - 1; y <= today.getFullYear() + 1; y++) {
    const due = new Date(y, yem - 1 + 9, 23); // Date handles month overflow
    const d = daysDiff(due);
    if (d >= -60 && d <= 400)
      deadlines.push({ type: "CT1", desc: `Corporation Tax Return — FY${y}`, detail: `Annual CT return for year ending ${MONTH_NAMES_SHORT[yem-1]} ${y}`, due });
  }

  // P35 — Annual employer return due 15 February following the year
  for (let y = today.getFullYear() - 1; y <= today.getFullYear(); y++) {
    const due = new Date(y+1, 1, 15);
    const d = daysDiff(due);
    if (d >= -60 && d <= 365)
      deadlines.push({ type: "P35", desc: `Annual Employer Return — ${y}`, detail: `Annual return of employees and payroll details for ${y}`, due });
  }

  // CRO Annual Return — B1 due 56 days after ARD (electronic filing)
  if (settings.ard_month && settings.ard_day) {
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
    const { error } = await getCompanyClient(company.id).from('companies').update({
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
            <tr><th style={{ width: 70 }}>Type</th><th>Description</th><th style={{ width: 200 }}>Detail</th><th className="r" style={{ width: 120 }}>Due Date</th><th className="r" style={{ width: 90 }}>Status</th></tr>
          </thead>
          <tbody>
            {deadlines.map((dl, i) => {
              const s = getStatus(dl.due);
              const diff = daysDiff(dl.due);
              return (
                <tr key={i}>
                  <td><span style={{ fontSize: 10, fontFamily: "Source Code Pro, monospace", fontWeight: 700, color: "var(--navy)" }}>{dl.type}</span></td>
                  <td style={{ fontWeight: 500 }}>{dl.desc}</td>
                  <td style={{ fontSize: 11, color: "var(--muted)" }}>{dl.detail}</td>
                  <td className="r mono" style={{ color: statusCol(s) }}>{fmtDate(dl.due)}</td>
                  <td className="r" style={{ fontFamily: "Source Code Pro, monospace", fontSize: 10, fontWeight: 700, color: statusCol(s) }}>
                    {diff < 0 ? `${Math.abs(diff)}d overdue` : diff === 0 ? "Today" : `${diff}d`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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

function Overview({ period, companyId, company }) {
  const [loading, setLoading]         = useState(true);
  const [cashPos, setCashPos]         = useState(null);
  const [net30, setNet30]             = useState(null);
  const [overdueInvs, setOverdueInvs] = useState([]);
  const [overdueTotal, setOverdueTotal] = useState(0);

  useEffect(() => {
    if (!companyId) { setLoading(false); return; }
    (async () => {
      setLoading(true);
      const db = getCompanyClient(companyId);
      const today = new Date().toISOString().slice(0, 10);
      const net30start = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const [btAll, bt30, overdue] = await Promise.all([
        db.from('bank_transactions').select('amount').eq('company_id', companyId),
        db.from('bank_transactions').select('amount').eq('company_id', companyId).gte('date', net30start),
        db.from('invoices').select('*').eq('company_id', companyId).lt('due_date', today).neq('status', 'paid').order('due_date'),
      ]);
      if (btAll.data)   setCashPos(btAll.data.reduce((s, r) => s + Number(r.amount), 0));
      if (bt30.data)    setNet30(bt30.data.reduce((s, r) => s + Number(r.amount), 0));
      if (overdue.data) {
        setOverdueInvs(overdue.data.slice(0, 5));
        setOverdueTotal(overdue.data.reduce((s, r) => s + Number(r.amount), 0));
      }
      setLoading(false);
    })();
  }, [companyId]);

  const todayDate = new Date(); todayDate.setHours(0,0,0,0);
  const daysOverdue = d => Math.floor((todayDate - new Date(d)) / 86400000);

  // Next P30 deadline
  const p30Due = new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 14);
  const p30Days = Math.floor((p30Due - todayDate) / 86400000);
  const p30Col = p30Days <= 7 ? "var(--red)" : p30Days <= 14 ? "var(--gold)" : "var(--teal)";

  const kpis = [
    {
      label: "Cash Position",
      value: loading ? '…' : cashPos === null ? '—' : fmt(Math.abs(cashPos)),
      sub: loading ? 'Loading…' : cashPos === null ? 'No bank data yet' : `${cashPos >= 0 ? 'Net inflow' : 'Net outflow'} all time`,
      c: "var(--teal)",
    },
    {
      label: "Overdue AR",
      value: loading ? '…' : fmt(overdueTotal),
      sub: loading ? 'Loading…' : overdueInvs.length === 0 ? 'No overdue invoices' : `${overdueInvs.length} invoice${overdueInvs.length !== 1 ? 's' : ''} past due`,
      c: "var(--red)",
    },
    { label: "Upcoming AP", value: "—", sub: "Coming soon", c: "var(--gold)" },
    {
      label: "Net 30-Day",
      value: loading ? '…' : net30 === null ? '—' : `${net30 >= 0 ? '+' : ''}${fmt(Math.abs(net30))}`,
      sub: loading ? 'Loading…' : net30 === null ? 'No bank data' : 'Bank movements last 30 days',
      c: "var(--navy)",
    },
  ];

  return (
    <div className="fade-up">
      <div className="digest">
        <span style={{ fontSize: 17, flexShrink: 0 }}>📋</span>
        <div>
          <div className="digest-label">AI Weekly Digest — {period}</div>
          <div className="digest-text">Connect your bank data to generate your AI digest. Upload a Revolut Business CSV in Bank Import to get started.</div>
        </div>
      </div>
      <div style={{ padding: "9px 13px", background: "rgba(107,101,96,0.05)", border: "1px solid var(--border)", borderRadius: 3, fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
        {companyId ? "Monitoring for anomalies — import more bank transactions to improve detection." : "Import bank transactions to enable AI anomaly detection."}
      </div>
      <div style={{ height: 4 }} />
      <div className="kpi-grid">
        {kpis.map((k, i) => (
          <div key={i} className="kpi-card" style={{ "--tc": k.c }}>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value" style={{ color: k.c, fontSize: 20 }}>{k.value}</div>
            <div className="kpi-sub">{k.sub}</div>
          </div>
        ))}
      </div>
      <div className="two-col">
        <div className="card">
          <div className="card-header"><span className="card-title">Overdue Invoices</span><span style={{ fontSize: 10, fontFamily: "Source Code Pro, monospace", color: "var(--dim)" }}>Top 5</span></div>
          {loading ? (
            <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--dim)", fontSize: 12 }}>Loading…</div>
          ) : overdueInvs.length === 0 ? (
            <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--dim)", fontSize: 12 }}>No overdue invoices — all clear.</div>
          ) : (
            <table className="gl-table">
              <thead><tr><th>Client</th><th>Ref</th><th className="r">Amount</th><th className="r">Days</th></tr></thead>
              <tbody>
                {overdueInvs.map((inv, i) => {
                  const d = daysOverdue(inv.due_date);
                  return (
                    <tr key={i}>
                      <td style={{ fontWeight: 500 }}>{inv.client}</td>
                      <td className="mono" style={{ fontSize: 10, color: "var(--dim)" }}>{inv.invoice_ref}</td>
                      <td className="r mono" style={{ color: "var(--red)" }}>{fmt(inv.amount)}</td>
                      <td className="r" style={{ fontFamily: "Source Code Pro, monospace", fontSize: 11, fontWeight: 700, color: d > 60 ? "var(--red)" : "var(--gold)" }}>{d}d</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <div className="card-header"><span className="card-title">Next Compliance Deadline</span></div>
          <div style={{ padding: "20px 16px" }}>
            <div style={{ fontFamily: "Source Code Pro, monospace", fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>P30 — PAYE/PRSI</div>
            <div style={{ fontFamily: "Playfair Display, serif", fontSize: 15, fontWeight: 700, color: "var(--navy)", marginBottom: 4 }}>
              {MONTH_NAMES_LONG[todayDate.getMonth()]} {todayDate.getFullYear()}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 12 }}>
              Due {p30Due.toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric" })}
            </div>
            <div style={{ fontFamily: "Source Code Pro, monospace", fontSize: 28, fontWeight: 700, color: p30Col }}>{p30Days}d</div>
            <div style={{ fontSize: 11, color: "var(--dim)", marginTop: 12 }}>See Compliance page for full calendar →</div>
          </div>
        </div>
      </div>
      <div className="card full-col">
        <div className="card-header"><span className="card-title">Cash Flow Forecast</span></div>
        <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--dim)", fontSize: 12, lineHeight: 1.6 }}>No bank data imported yet — upload a Revolut CSV in Bank Import to populate your cash flow forecast.</div>
      </div>
    </div>
  );
}

function Checklist({ period, companyId }) {
  const { user } = useUser();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [loadingDefaults, setLoadingDefaults] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newSection, setNewSection] = useState("General");
  const [chkError, setChkError] = useState(null);
  const [resolvedCid, setResolvedCid] = useState(null);

  const getCid = async () => {
    if (companyId) return companyId;
    const { data } = await supabase.from("companies").select("id").eq("clerk_user_id", user.id).limit(1);
    if (data && data.length) return data[0].id;
    throw new Error("No company found");
  };

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      try {
        const cid = await getCid();
        setResolvedCid(cid);
        const db = getCompanyClient(cid);
        const { data, error } = await db.from("checklists")
          .select("*").eq("company_id", cid).eq("period", period).order("created_at");
        if (error) throw error;
        setItems(data || []);
      } catch (e) { setChkError(e.message); }
      setLoading(false);
    })();
  }, [user, period, companyId]);

  const toggle = async (item) => {
    const db = getCompanyClient(resolvedCid || companyId);
    const { error } = await db.from("checklists").update({ checked: !item.checked }).eq("id", item.id);
    if (!error) setItems(prev => prev.map(i => i.id === item.id ? { ...i, checked: !i.checked } : i));
  };

  const addItem = async () => {
    if (!newLabel.trim()) return;
    try {
      const cid = await getCid();
      setResolvedCid(cid);
      const db = getCompanyClient(cid);
      const { data, error } = await db.from("checklists")
        .insert({ company_id: cid, section: newSection.trim() || "General", item_label: newLabel.trim(), is_auto: false, checked: false, period })
        .select().single();
      if (error) throw error;
      setItems(prev => [...prev, data]);
      setNewLabel(""); setAdding(false);
    } catch (e) { setChkError(e.message); }
  };

  const loadDefaults = async () => {
    setLoadingDefaults(true);
    setChkError(null);
    try {
      const cid = await getCid();
      setResolvedCid(cid);
      const db = getCompanyClient(cid);
      const rows = CHECKLIST_TEMPLATE.flatMap(({ section, items }) =>
        items.map(item_label => ({ company_id: cid, section, item_label, is_auto: false, checked: false, period }))
      );
      const { data, error } = await db.from("checklists").insert(rows).select();
      if (error) throw error;
      setItems(data || []);
    } catch (e) { setChkError(e.message); }
    setLoadingDefaults(false);
  };

  const done = items.filter(i => i.checked).length;
  const total = items.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const sections = [...new Set(items.map(i => i.section))];

  if (loading) return <div style={{ padding: 48, textAlign: "center", color: "var(--dim)", fontFamily: "Source Code Pro, monospace", fontSize: 12 }}>Loading checklist…</div>;

  return (
    <div className="fade-up">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: "Playfair Display, serif", fontSize: 17, fontWeight: 700, color: "var(--navy)", marginBottom: 2 }}>Month End Close — {period}</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Work through each section. Items marked AI are automated by Finflow.</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "Playfair Display, serif", fontSize: 22, fontWeight: 700, color: "var(--navy)", marginBottom: 4 }}>
            {done}<span style={{ fontSize: 13, fontWeight: 400, color: "var(--dim)" }}> / {total}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div className="pb-track"><div className="pb-fill" style={{ width: `${pct}%` }} /></div>
            <span style={{ fontSize: 11, fontFamily: "Source Code Pro, monospace", color: "var(--teal)", fontWeight: 600 }}>{pct}%</span>
          </div>
        </div>
      </div>
      {chkError && <div style={{ padding: "9px 13px", background: "rgba(139,32,32,0.06)", border: "1px solid rgba(139,32,32,0.2)", color: "var(--red)", borderRadius: 3, fontSize: 12, marginBottom: 12 }}>{chkError}</div>}
      {total === 0 && !adding && (
        <div style={{ textAlign: "center", padding: "56px 40px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 3 }}>
          <div style={{ fontSize: 28, marginBottom: 12, color: "var(--dim)" }}>☑</div>
          <div style={{ fontFamily: "Playfair Display, serif", fontSize: 16, fontWeight: 600, color: "var(--navy)", marginBottom: 6 }}>No checklist items for {period}</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 20 }}>Load the standard Irish SME month-end template or add your own items.</div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button className="btn btn-p" onClick={loadDefaults} disabled={loadingDefaults}>
              {loadingDefaults ? "Loading…" : "Load Default Checklist"}
            </button>
            <button className="btn btn-s" onClick={() => setAdding(true)}>+ Add Item</button>
          </div>
        </div>
      )}
      {sections.map(section => {
        const sItems = items.filter(i => i.section === section);
        const sDone = sItems.filter(i => i.checked).length;
        return (
          <div key={section} className="card" style={{ marginBottom: 9 }}>
            <div className="sec-title">{section}<span className="sec-count">{sDone}/{sItems.length}</span></div>
            {sItems.map(item => (
              <div key={item.id} className={`chk-item ${item.checked ? "done" : ""}`} onClick={() => toggle(item)}>
                <div className="chk-box">{item.checked && <span className="chk-tick">✓</span>}</div>
                <span className="chk-label">{item.item_label}</span>
                {item.is_auto && <span className="ai-badge">AI</span>}
              </div>
            ))}
          </div>
        );
      })}
      {total > 0 && !adding && (
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

function GLReport({ period, companyId, companyName = "Company", company }) {
  const now = new Date();
  const propYYYYMM = (() => {
    const idx = {January:0,February:1,March:2,April:3,May:4,June:5,July:6,August:7,September:8,October:9,November:10,December:11};
    const [m, y] = period.split(' ');
    const mi = idx[m] ?? now.getMonth() - 1;
    const yr = parseInt(y) || now.getFullYear();
    return `${yr}-${String(mi + 1).padStart(2, '0')}`;
  })();

  const [tab, setTab]                         = useState("tb");
  const [journals, setJournals]               = useState([]);
  const [loading, setLoading]                 = useState(true);
  const [selectedPeriod, setSelectedPeriod]   = useState(propYYYYMM);
  const [periodLoading, setPeriodLoading]     = useState(false);
  const [ytdMode, setYtdMode]                 = useState(true);

  const periodOptions = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return { val, label: d.toLocaleDateString("en-IE", { month: "long", year: "numeric" }) };
  });
  const periodLabel = periodOptions.find(o => o.val === selectedPeriod)?.label
    || new Date(selectedPeriod + '-01').toLocaleDateString("en-IE", { month: "long", year: "numeric" });

  // YTD start: first month of the accounting year that contains selectedPeriod
  const yearEndMonth  = company?.year_end_month || 12; // 1–12
  const yearStartMonth = (yearEndMonth % 12) + 1;      // Dec(12)→Jan(1), Mar(3)→Apr(4)
  const [py, pm] = selectedPeriod.split('-').map(Number);
  const ytdStartYear  = pm >= yearStartMonth ? py : py - 1;
  const ytdStart      = `${ytdStartYear}-${String(yearStartMonth).padStart(2, '0')}-01`;
  const periodEnd     = new Date(py, pm, 0).toISOString().slice(0, 10);

  const rangeStart    = ytdMode ? ytdStart : `${selectedPeriod}-01`;
  const reportLabel   = ytdMode ? `YTD to ${periodLabel}` : `${periodLabel} only`;
  const slug          = ytdMode
    ? `ytd-to-${selectedPeriod}`
    : selectedPeriod;

  useEffect(() => {
    if (!companyId) { setLoading(false); return; }
    (async () => {
      setLoading(true);
      const db = getCompanyClient(companyId);
      const { data, error } = await db.from('journals').select('*')
        .eq('company_id', companyId).gte('date', rangeStart).lte('date', periodEnd).order('date');
      if (!error && data) setJournals(data);
      setLoading(false);
      setPeriodLoading(false);
    })();
  }, [companyId, selectedPeriod, ytdMode]);

  const handlePeriodChange = (val) => { setPeriodLoading(true); setSelectedPeriod(val); };

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
    const acct = GL_ACCOUNTS.find(a => a.code === code);
    const type = acct?.type || '—';
    const isDebitNormal = ['Asset', 'Expense'].includes(type);
    const net = isDebitNormal ? debit - credit : credit - debit;
    return { code, debit, credit, net, name: acct?.name || code, type };
  }).sort((a, b) => a.code.localeCompare(b.code));
  const tbTotDr  = tbRows.reduce((s, r) => s + r.debit,  0);
  const tbTotCr  = tbRows.reduce((s, r) => s + r.credit, 0);

  // P&L — net credits for income, net debits for costs/expenses
  const revenueMap = {}, cosMap = {}, opexMap = {};
  ledger.forEach(e => {
    const c = e.account;
    if (c >= '4000' && c < '5000')
      revenueMap[c] = (revenueMap[c] || 0) + (e.side === 'credit' ? e.amount : -e.amount);
    else if (c >= '5000' && c < '6000')
      cosMap[c]     = (cosMap[c]     || 0) + (e.side === 'debit'  ? e.amount : -e.amount);
    else if (c >= '6000' && c < '7000')
      opexMap[c]    = (opexMap[c]    || 0) + (e.side === 'debit'  ? e.amount : -e.amount);
  });
  const toRows = map => Object.entries(map)
    .map(([code, amount]) => ({ code, amount, name: GL_ACCOUNTS.find(a => a.code === code)?.name || code }))
    .sort((a, b) => a.code.localeCompare(b.code));
  const revRows = toRows(revenueMap), cosRows = toRows(cosMap), opexRows = toRows(opexMap);
  const totRev = revRows.reduce((s, r) => s + r.amount, 0);
  const gp = totRev - cosRows.reduce((s, r) => s + r.amount, 0);
  const np = gp - opexRows.reduce((s, r) => s + r.amount, 0);

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

  const exportDate = fmtIE(new Date().toISOString().slice(0, 10));

  const exportTB = () => downloadCSV(`trial-balance-${slug}.csv`, [
    ["FinFlow — Trial Balance", companyName, reportLabel],
    ["Exported", exportDate],
    [],
    ["Code", "Account", "Type", "Debit (€)", "Credit (€)", "Net Balance"],
    ...tbRows.map(r => [r.code, r.name, r.type, r.debit > 0 ? fmtEUR(r.debit) : "—", r.credit > 0 ? fmtEUR(r.credit) : "—", (r.net < 0 ? "-" : "") + fmtEUR(Math.abs(r.net))]),
    ["", "TOTAL", "", fmtEUR(tbTotDr), fmtEUR(tbTotCr), tbTotDr === tbTotCr ? "BALANCED" : fmtEUR(Math.abs(tbTotDr - tbTotCr))],
  ]);

  const exportPNL = () => downloadCSV(`profit-and-loss-${slug}.csv`, [
    ["FinFlow — Profit & Loss", companyName, reportLabel],
    ["Exported", exportDate],
    [],
    ["Section", "Code", "Account", "Amount (€)"],
    ["Revenue", "", "", ""],
    ...revRows.map(r => ["", r.code, r.name, fmtEUR(r.amount)]),
    ["", "", "Total Revenue", fmtEUR(totRev)],
    ["Cost of Sales", "", "", ""],
    ...cosRows.map(r => ["", r.code, r.name, fmtEUR(r.amount)]),
    ["", "", "Gross Profit", fmtEUR(gp)],
    ["Operating Expenses", "", "", ""],
    ...opexRows.map(r => ["", r.code, r.name, fmtEUR(r.amount)]),
    ["", "", "Net Profit", fmtEUR(np)],
  ]);

  const emptyMsg = (title, sub) => (
    <div style={{ padding: "40px 24px", textAlign: "center", color: "var(--dim)", fontSize: 13 }}>
      <div style={{ fontFamily: "Playfair Display, serif", fontSize: 15, color: "var(--muted)", marginBottom: 8 }}>{title}</div>
      {sub}
    </div>
  );

  if (loading) return <div style={{ padding: 48, textAlign: "center", color: "var(--dim)", fontSize: 12, fontFamily: "Source Code Pro, monospace" }}>Loading GL data…</div>;

  return (
    <div className="fade-up">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "Source Code Pro, monospace" }}>Period</span>
        <select
          value={selectedPeriod}
          onChange={e => handlePeriodChange(e.target.value)}
          style={{ fontSize: 12, fontFamily: "Source Code Pro, monospace", padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--navy)", cursor: "pointer" }}
        >
          {periodOptions.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
        </select>
        <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", marginLeft: 4 }}>
          {[{ id: false, label: "Month" }, { id: true, label: "YTD" }].map(({ id, label }) => (
            <button key={label} onClick={() => setYtdMode(id)} style={{
              padding: "4px 12px", fontSize: 11, fontFamily: "Source Code Pro, monospace",
              background: ytdMode === id ? "var(--navy)" : "var(--surface)",
              color: ytdMode === id ? "var(--white)" : "var(--muted)",
              border: "none", borderLeft: id ? "1px solid var(--border)" : "none",
              cursor: "pointer", fontWeight: ytdMode === id ? 600 : 400,
            }}>{label}</button>
          ))}
        </div>
        {periodLoading && <span style={{ fontSize: 11, color: "var(--dim)", fontFamily: "Source Code Pro, monospace" }}>Updating…</span>}
        {ytdMode && <span style={{ fontSize: 10, color: "var(--dim)", fontFamily: "Source Code Pro, monospace" }}>from {ytdStart}</span>}
      </div>

      <div className="gl-tabs">
        {[{ id: "tb", label: "Trial Balance" }, { id: "pnl", label: "Profit & Loss" }, { id: "bs", label: "Balance Sheet" }, { id: "gl", label: "General Ledger" }].map(t => (
          <button key={t.id} className={`gl-tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {tab === "tb" && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Trial Balance — {reportLabel}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {!noJournals && <span style={{ fontSize: 10, fontFamily: "Source Code Pro, monospace", fontWeight: 600, color: tbTotDr === tbTotCr ? "var(--green)" : "var(--red)" }}>{tbTotDr === tbTotCr ? "✓ BALANCED" : "⚠ OUT OF BALANCE"}</span>}
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
                    <td className="r mono" style={{ color: r.net >= 0 ? "var(--navy)" : "var(--red)", fontWeight: 600 }}>{fmt(Math.abs(r.net))}{r.net < 0 ? " Cr" : ""}</td>
                  </tr>
                ))}
                <tr className="tot"><td colSpan={3} style={{ fontFamily: "Playfair Display, serif" }}>Total</td><td className="r mono">{fmt(tbTotDr)}</td><td className="r mono">{fmt(tbTotCr)}</td><td className="r mono" style={{ color: tbTotDr === tbTotCr ? "var(--green)" : "var(--red)", fontWeight: 700 }}>{tbTotDr === tbTotCr ? "—" : fmt(Math.abs(tbTotDr - tbTotCr))}</td></tr>
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
              <div className="pnl-row pnl-sec"><span className="pnl-n">Revenue</span></div>
              {revRows.length === 0
                ? <div className="pnl-row" style={{ color: "var(--dim)", fontSize: 12 }}>No revenue entries (4xxx accounts)</div>
                : revRows.map((r, i) => <div key={i} className="pnl-row"><span className="pnl-n">{r.code} — {r.name}</span><span className="pnl-v">{fmt(r.amount)}</span></div>)}
              <div className="pnl-row pnl-tot"><span className="pnl-n">Total Revenue</span><span className="pnl-v" style={{ color: "var(--teal)", fontWeight: 700 }}>{fmt(totRev)}</span></div>
              <div className="pnl-row pnl-sec"><span className="pnl-n">Cost of Sales</span></div>
              {cosRows.length === 0
                ? <div className="pnl-row" style={{ color: "var(--dim)", fontSize: 12 }}>No cost of sales entries (5xxx accounts)</div>
                : cosRows.map((r, i) => <div key={i} className="pnl-row"><span className="pnl-n">{r.code} — {r.name}</span><span className="pnl-v">{fmt(r.amount)}</span></div>)}
              <div className="pnl-row pnl-tot"><span className="pnl-n">Gross Profit</span><span className="pnl-v" style={{ color: gp >= 0 ? "var(--green)" : "var(--red)", fontWeight: 700 }}>{fmt(gp)}</span></div>
              <div className="pnl-row pnl-sec"><span className="pnl-n">Operating Expenses</span></div>
              {opexRows.length === 0
                ? <div className="pnl-row" style={{ color: "var(--dim)", fontSize: 12 }}>No expense entries (6xxx accounts)</div>
                : opexRows.map((r, i) => <div key={i} className="pnl-row"><span className="pnl-n">{r.code} — {r.name}</span><span className="pnl-v">{fmt(r.amount)}</span></div>)}
              <div className="pnl-row pnl-tot" style={{ borderTop: "2px solid var(--navy)", background: "rgba(26,39,68,0.05)" }}>
                <span className="pnl-n" style={{ color: "var(--navy)", fontFamily: "Playfair Display, serif" }}>Net Profit</span>
                <span className="pnl-v" style={{ color: np >= 0 ? "var(--green)" : "var(--red)", fontWeight: 700 }}>{fmt(np)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "bs" && (
        <div className="card">
          <div className="card-header"><span className="card-title">Balance Sheet — {reportLabel}</span></div>
          <div style={{ padding: "40px 24px", textAlign: "center", color: "var(--dim)", fontSize: 13 }}>
            <div style={{ fontFamily: "Playfair Display, serif", fontSize: 15, color: "var(--navy)", marginBottom: 8 }}>Balance sheet coming soon</div>
            Balance sheet reporting will be available once your accounts are connected and transactions are categorised.
          </div>
        </div>
      )}

      {tab === "gl" && <GLExtract period={reportLabel} glLines={glLines} glAccounts={glAccounts} noJournals={noJournals} companyName={companyName} />}
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
    ["FinFlow — General Ledger Extract", companyName, period],
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
                    <td className="mono" style={{ color: "var(--navy)", fontSize: 10 }}>{line.ref}</td>
                    <td style={{ color: "var(--muted)" }}>{line.narrative}</td>
                    <td className="r mono dr">{line.debit > 0 ? fmt(line.debit) : "—"}</td>
                    <td className="r mono cr">{line.credit > 0 ? fmt(line.credit) : "—"}</td>
                    <td className={`r mono ${line.balance >= 0 ? "bal-pos" : "bal-neg"}`}>{line.balance < 0 ? `(${fmt(Math.abs(line.balance))})` : fmt(line.balance)}</td>
                  </tr>
                ))}
                <tr className="glex-totrow">
                  <td colSpan={3} style={{ fontFamily: "Playfair Display, serif", fontSize: 12 }}>Period Total</td>
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


function Journals({ period, companyName }) {
  const { user } = useUser();
  const now = new Date();
  const propYYYYMM = (() => {
    const idx = {January:0,February:1,March:2,April:3,May:4,June:5,July:6,August:7,September:8,October:9,November:10,December:11};
    const [m, y] = period.split(' ');
    const mi = idx[m] ?? now.getMonth() - 1;
    const yr = parseInt(y) || now.getFullYear();
    return `${yr}-${String(mi + 1).padStart(2, '0')}`;
  })();

  const [journals, setJournals]             = useState([]);
  const [companyId, setCompanyId]           = useState(null);
  const [loading, setLoading]               = useState(true);
  const [expanded, setExpanded]             = useState(null);
  const [showForm, setShowForm]             = useState(false);
  const [aiOpen, setAiOpen]                 = useState(false);
  const [aiLoading, setAiLoading]           = useState(false);
  const [aiText, setAiText]                 = useState("");
  const [selectedPeriod, setSelectedPeriod] = useState(propYYYYMM);
  const [periodLoading, setPeriodLoading]   = useState(false);

  const periodOptions = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return { val, label: d.toLocaleDateString("en-IE", { month: "long", year: "numeric" }) };
  });
  const periodLabel = periodOptions.find(o => o.val === selectedPeriod)?.label
    || new Date(selectedPeriod + '-01').toLocaleDateString("en-IE", { month: "long", year: "numeric" });

  const emptyForm = () => ({ date: new Date().toISOString().slice(0, 10), description: "", debit_account: "", credit_account: "", amount: "", reference: "" });
  const [form, setForm] = useState(emptyForm());

  const toDisplayJournal = (j) => ({
    ref: j.reference,
    date: j.date,
    description: j.description,
    preparedBy: "User",
    status: "posted",
    lines: [
      { account: j.debit_account, name: GL_ACCOUNTS.find(a => a.code === j.debit_account)?.name || j.debit_account, debit: j.amount, credit: 0 },
      { account: j.credit_account, name: GL_ACCOUNTS.find(a => a.code === j.credit_account)?.name || j.credit_account, debit: 0, credit: j.amount },
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

  // Resolve companyId once on mount
  useEffect(() => {
    if (!user) return;
    resolveCompanyId().then(setCompanyId).catch(err => console.error("[journals] resolveCompanyId:", err.message));
  }, [user]);

  // Fetch journals filtered to selected period
  useEffect(() => {
    if (!companyId) return;
    (async () => {
      setLoading(true);
      try {
        const db = getCompanyClient(companyId);
        const [y, m] = selectedPeriod.split('-').map(Number);
        const start = `${selectedPeriod}-01`;
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
      setPeriodLoading(false);
    })();
  }, [companyId, selectedPeriod]);

  const [postError, setPostError] = useState(null);

  const formValid = !!(form.description && form.debit_account && form.credit_account &&
    form.amount && parseFloat(form.amount) > 0 && form.debit_account !== form.credit_account);

  const post = async () => {
    if (!formValid) return;
    setPostError(null);

    let cid = companyId;
    if (!cid) {
      try {
        cid = await resolveCompanyId();
        setCompanyId(cid);
      } catch (err) {
        setPostError(err.message);
        return;
      }
    }

    const amount = parseFloat(form.amount);
    const ref = form.reference.trim() || `JNL-${String(jnlCounter++).padStart(3, "0")}`;
    const { error } = await getCompanyClient(cid).from("journals").insert({
      company_id: cid,
      date: form.date,
      description: form.description,
      debit_account: form.debit_account,
      credit_account: form.credit_account,
      amount,
      reference: ref,
    });
    if (error) {
      setPostError(`Save failed: ${error.message}`);
      return;
    }
    setJournals(prev => [toDisplayJournal({ reference: ref, date: form.date, description: form.description,
      debit_account: form.debit_account, credit_account: form.credit_account, amount }), ...prev]);
    setForm(emptyForm());
    setShowForm(false);
  };

  const suggest = async () => {
    setAiOpen(true); setAiLoading(true); setAiText("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 1000,
          system: `You are an expert Irish chartered accountant. For ${companyName} ${period} month end, suggest outstanding journal entries. Available accounts: ${GL_ACCOUNTS.map(a => `${a.code} ${a.name}`).join(", ")}. Already posted: Depreciation JNL-001, Accrual for legal fees JNL-002, Prepayment for insurance JNL-003. Suggest 2-3 journals with account codes, amounts and brief rationale. Be concise and professional.`,
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
          <div style={{ fontFamily: "Playfair Display, serif", fontSize: 17, fontWeight: 700, color: "var(--navy)", marginBottom: 2 }}>Journal Postings — {periodLabel}</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>{journals.length} journal{journals.length !== 1 ? "s" : ""} in {periodLabel}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value={selectedPeriod}
            onChange={e => { setPeriodLoading(true); setSelectedPeriod(e.target.value); }}
            style={{ fontSize: 12, fontFamily: "Source Code Pro, monospace", padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--navy)", cursor: "pointer" }}
          >
            {periodOptions.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
          </select>
          {periodLoading && <span style={{ fontSize: 11, color: "var(--dim)", fontFamily: "Source Code Pro, monospace" }}>…</span>}
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
                  {GL_ACCOUNTS.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                </select>
              </div>
              <div className="f-group">
                <label className="f-label">Credit Account</label>
                <select className="f-input" value={form.credit_account} onChange={e => setForm(p => ({ ...p, credit_account: e.target.value }))}>
                  <option value="">Select account…</option>
                  {GL_ACCOUNTS.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
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
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
  if (s) console.warn("[parseAIBDate] could not parse date:", JSON.stringify(s));
  return "";
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
    const revolut_id = aibHash(`${date}|${desc}|${amount}`);
    rows.push({ revolut_id, date, description: desc, amount, currency, balance, type });
  }
  console.log("[parseAIBCSV] parsed", rows.length, "rows. First row:", rows[0]);
  return rows;
}

function cleanPayee(description) {
  let s = (description || "").trim();
  // Strip common bank/card prefixes
  s = s.replace(/^(VDP-|VSP |SP |BP |DD |SO |ATM |POS |TFR |FEE |STO |CHG |SEPA CT |From |To |Money added from |Payment to |Payment from |Received from |Sent to )/i, "");
  // Strip card/ref numbers (4+ consecutive digits)
  s = s.replace(/\b\d{4,}\b/g, "");
  // Strip embedded dates (DD/MM/YY, DD-MM-YYYY, etc.)
  s = s.replace(/\b\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?\b/g, "");
  // Strip company suffixes
  s = s.replace(/\b(ltd|limited|plc|dac|uc|irl|ireland|ie)\b/gi, "");
  // Collapse and lowercase
  return s.replace(/\s+/g, " ").trim().toLowerCase();
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

async function categoriseWithAI(txns) {
  const BATCH = 5;
  const results = {};
  console.log("[categoriseWithAI] called with", txns.length, "transactions");

  for (let i = 0; i < txns.length; i += BATCH) {
    const batch = txns.slice(i, i + BATCH);
    console.log("[categoriseWithAI] fetching /api/categorise for batch", i / BATCH + 1, batch.map(t => t.description));
    try {
      const res = await fetch("/api/categorise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactions: batch.map(t => ({
            revolut_id: t.revolut_id,
            description: t.description,
            amount: t.amount,
            type: t.type,
          })),
        }),
      });
      console.log("[categoriseWithAI] /api/categorise status:", res.status);
      const data = await res.json();
      console.log("[categoriseWithAI] /api/categorise response:", data);
      if (data.results) {
        data.results.forEach(r => { results[r.revolut_id] = { code: r.code, confidence: r.confidence }; });
      } else {
        console.warn("[categoriseWithAI] no results array in response:", data);
        batch.forEach(t => { results[t.revolut_id] = { code: suggestNominalFallback(t.description, t.amount), confidence: "low" }; });
      }
    } catch (err) {
      console.error("[categoriseWithAI] fetch error:", err);
      batch.forEach(t => { results[t.revolut_id] = { code: suggestNominalFallback(t.description, t.amount), confidence: "low" }; });
    }
  }
  console.log("[categoriseWithAI] final results:", results);
  return results;
}

// ─── BANK IMPORT ──────────────────────────────────────────────────────────────
const CONF_COLOR = { high: "var(--green)", medium: "var(--gold)", low: "var(--red)" };

function BankImport({ companyId }) {
  const { user } = useUser();
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
  const [matching, setMatching] = useState(false);
  const [categorising, setCategorising] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [confirmReverse, setConfirmReverse] = useState(null);
  const [reversing, setReversing] = useState(false);
  const fileRef = useRef(null);
  const toastTimer = useRef(null);

  const getCid = async () => {
    if (companyId) return companyId;
    const { data } = await supabase.from("companies").select("id").eq("clerk_user_id", user.id).limit(1);
    if (data && data.length) return data[0].id;
    throw new Error("No company found");
  };

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const cid = await getCid();
      console.log("[loadHistory] companyId:", cid);
      const db = getCompanyClient(cid);

      // Step 1: probe which timestamp column exists — try created_at first (Supabase default)
      // then imported_at. Use select('*') on a single row to inspect the schema.
      const probe = await db.from("bank_transactions")
        .select("*").eq("company_id", cid).limit(1);
      console.log("[loadHistory] schema probe — error:", probe.error?.message, "| sample row keys:", probe.data?.[0] ? Object.keys(probe.data[0]).join(", ") : "none");

      const tsCol = probe.data?.[0]
        ? (("imported_at" in probe.data[0]) ? "imported_at" : ("created_at" in probe.data[0]) ? "created_at" : null)
        : "created_at"; // default assumption
      console.log("[loadHistory] timestamp column detected:", tsCol);

      if (!tsCol) {
        console.error("[loadHistory] no timestamp column found — cannot build history");
        setHistoryLoading(false);
        return;
      }

      // Step 2: fetch all bank_transactions for this company (no date filter)
      const selectCols = `import_batch_id, bank_format, amount, ${tsCol}`;
      const { data, error } = await db.from("bank_transactions")
        .select(selectCols)
        .eq("company_id", cid);

      console.log("[loadHistory] query cols:", selectCols);
      console.log("[loadHistory] query error:", error?.message || "none");
      console.log("[loadHistory] rows returned:", data?.length ?? 0);
      if (data?.length) {
        const sample = data[0];
        console.log("[loadHistory] first row sample:", JSON.stringify(sample));
        console.log("[loadHistory] first row ts value:", sample[tsCol]);
      }

      if (error) { setHistoryLoading(false); return; }
      if (!data || !data.length) {
        console.log("[loadHistory] no rows — history will be empty");
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

      console.log("[loadHistory] groups built:", groups.size, [...groups.keys()].slice(0, 5));

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

  // Fire when companyId resolves (prop) OR when user resolves (for user-lookup path)
  useEffect(() => { if (companyId) loadHistory(); }, [companyId]);

  const reverseImport = async (batch) => {
    setReversing(true);
    try {
      const cid = await getCid();
      const db = getCompanyClient(cid);
      if (batch.import_batch_id) {
        // New-style: exact match on import_batch_id
        await db.from("bank_transactions").delete().eq("company_id", cid).eq("import_batch_id", batch.import_batch_id);
        await db.from("journals").delete().eq("company_id", cid).eq("import_batch_id", batch.import_batch_id);
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

  const loadFile = async (file) => {
    console.log("[loadFile] file selected:", file?.name, "size:", file?.size);
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
      const cid = await getCid();
      const db = getCompanyClient(cid);
      const { data: existing, error } = await db.from("bank_transactions")
        .select("revolut_id, description, nominal_account")
        .eq("company_id", cid);
      if (error) console.error("[BankImport] Supabase error:", error.message);
      if (existing) existing.forEach(r => {
        importedIds.add(r.revolut_id);
        if (r.nominal_account) {
          if (!pastCats[r.description]) pastCats[r.description] = r.nominal_account;
          const cp = cleanPayee(r.description);
          if (cp && !learnedPayees[cp]) learnedPayees[cp] = r.nominal_account;
        }
      });
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

    // STEP 3b: Async batched fuzzy match — yields to browser between batches, 3s timeout
    const learnedEntries = Object.entries(learnedPayees);
    if (needFuzzy.length && learnedEntries.length) {
      setMatching(true);
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
          setNominals(prev => ({ ...prev, ...batchNom }));
          setConfidence(prev => ({ ...prev, ...batchConf }));
        }
        await new Promise(resolve => setTimeout(resolve, 0)); // yield to browser
      }
      setMatching(false);
      console.log("[BankImport] fuzzy matched:", fuzzyMatched.size - (newTxns.length - needFuzzy.length));
    }

    // STEP 4: AI categorise only those not resolved by exact or fuzzy match
    const toAI = newTxns.filter(r => !fuzzyMatched.has(r.revolut_id));
    console.log("[BankImport] toAI:", toAI.length);
    if (toAI.length) {
      setCategorising(true);
      try {
        const aiResults = await categoriseWithAI(toAI);
        setNominals(prev => { const u = { ...prev }; Object.entries(aiResults).forEach(([id, v]) => { u[id] = v.code; }); return u; });
        setConfidence(prev => { const u = { ...prev }; Object.entries(aiResults).forEach(([id, v]) => { u[id] = v.confidence; }); return u; });
      } catch (err) { console.error("[BankImport] categoriseWithAI threw:", err); }
      setCategorising(false);
    }
  };

  const handleNominalChange = (revolut_id, code) => {
    const changedPayee = cleanPayee(rows.find(r => r.revolut_id === revolut_id)?.description || "");
    // Unimported rows with ≥70% word overlap on cleaned payee name
    const siblings = rows.filter(r =>
      r.revolut_id !== revolut_id && !r.imported &&
      wordOverlap(cleanPayee(r.description), changedPayee) >= 0.7
    );
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
  };

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
      const cid = await getCid();
      const db = getCompanyClient(cid);
      const batchId = crypto.randomUUID();
      const journals = toPost.map(r => {
        const nominal = nominals[r.revolut_id] || "6600";
        const isIn = r.amount >= 0;
        return {
          company_id: cid, date: r.date, description: r.description, reference: r.revolut_id,
          debit_account: isIn ? "1000" : nominal,
          credit_account: isIn ? nominal : "1000",
          amount: Math.abs(r.amount),
          import_batch_id: batchId,
        };
      });
      const { error: jErr } = await db.from("journals").insert(journals);
      if (jErr) throw new Error(jErr.message);
      const btRows = toPost.map(r => ({
        company_id: cid, revolut_id: r.revolut_id, date: r.date,
        description: r.description, amount: r.amount, currency: r.currency,
        balance: r.balance, nominal_account: nominals[r.revolut_id] || "6600",
        bank_format: bankFormat, import_batch_id: batchId,
      }));
      const { error: btErr } = await db.from("bank_transactions").insert(btRows);
      if (btErr) throw new Error(btErr.message);
      setRows(prev => prev.map(r => selected.has(r.revolut_id) ? { ...r, imported: true } : r));
      setSelected(new Set());
      setAlert({ type: "ok", msg: `${toPost.length} transaction${toPost.length !== 1 ? "s" : ""} posted to the ledger.` });
      loadHistory();
    } catch (e) {
      setAlert({ type: "err", msg: e.message });
    }
    setPosting(false);
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
      {confirmReverse && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="card" style={{ maxWidth: 440, width: "90%", padding: "28px 28px 24px", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
            <div style={{ fontFamily: "Playfair Display, serif", fontSize: 17, fontWeight: 700, color: "var(--navy)", marginBottom: 10 }}>Reverse Import?</div>
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

      {!rows.length && (
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
          <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }} onChange={e => loadFile(e.target.files[0])} />
        </div>
      )}

      {alert && <div className={`bi-alert ${alert.type === "ok" ? "bi-alert-ok" : "bi-alert-err"}`}>{alert.msg}</div>}

      {/* ── Import History (shown when no file is loaded) ── */}
      {!rows.length && (
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
                  const canReverse = daysOld <= 30;
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
                      <td className="r mono">{batch.count}</td>
                      <td className="r mono" style={{ color: batch.total >= 0 ? "var(--green)" : "var(--red)", fontWeight: 600 }}>
                        {batch.total >= 0 ? "+" : ""}{fmtEUR(batch.total)}
                      </td>
                      <td className="r">
                        <button
                          className="btn btn-s btn-sm"
                          style={{ fontSize: 11, color: canReverse ? "var(--red)" : undefined, opacity: canReverse ? 1 : 0.45 }}
                          onClick={() => canReverse && setConfirmReverse(batch)}
                          disabled={!canReverse}
                          title={canReverse
                            ? batch.legacy
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
        </div>
      )}

      {rows.length > 0 && (
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
            {matching && (
              <span className="bi-categorising">
                <span className="dot" /><span className="dot" /><span className="dot" />
                &nbsp;Matching learned categorisations…
              </span>
            )}
            {categorising && (
              <span className="bi-categorising">
                <span className="dot" /><span className="dot" /><span className="dot" />
                &nbsp;AI categorising…
              </span>
            )}
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button className="btn btn-s btn-sm" onClick={() => downloadCSV(
                `bank-import-${fmtIE(new Date().toISOString().slice(0,10)).replace(/\//g,"-")}.csv`,
                [
                  ["FinFlow — Bank Import", `Exported ${fmtIE(new Date().toISOString().slice(0,10))}`],
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
              <button className="btn btn-s btn-sm" onClick={() => { setRows([]); setFileName(""); setAlert(null); setSelected(new Set()); setCategorising(false); setBankFormat(null); }}>
                Clear
              </button>
              <button className="btn btn-p btn-sm" onClick={post} disabled={posting || selected.size === 0 || categorising}>
                {posting ? "Posting…" : `Post ${selected.size > 0 ? selected.size + " " : ""}Selected to Ledger`}
              </button>
            </div>
          </div>
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
                        {r.amount >= 0 ? "+" : ""}{r.amount.toLocaleString("en-IE", { minimumFractionDigits: 2 })}
                      </span>
                    </td>
                    <td className="r">
                      <span className="bi-bal">{r.balance.toLocaleString("en-IE", { minimumFractionDigits: 2 })}</span>
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
                            {[
                              { label: "Income", types: ["Income"] },
                              { label: "Cost of Sales", codes: ["5000","5100","5200","5300"] },
                              { label: "Overheads", codes: ["6000","6100","6200","6300","6400","6500","6600","6700","6800","6900","6950"] },
                              { label: "Assets", types: ["Asset"] },
                              { label: "Liabilities", types: ["Liability"] },
                              { label: "Capital", types: ["Equity"] },
                            ].map(grp => (
                              <optgroup key={grp.label} label={grp.label}>
                                {GL_ACCOUNTS.filter(a =>
                                  grp.types ? grp.types.includes(a.type) : grp.codes.includes(a.code)
                                ).map(a => (
                                  <option key={a.code} value={a.code}>{a.code} · {a.name}</option>
                                ))}
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
    </div>
  );
}

const SUGGS = ["Will I have enough cash for payroll?", "What journals should I post at month end?", "What's net profit vs budget?", "Which invoices are most at risk?"];

function Chat({ page, companyName, period, companyId, company }) {
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
          const db = getCompanyClient(companyId);
          const today      = new Date().toISOString().slice(0, 10);
          const in30       = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
          const last30     = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
          const periodParts = period.split(' ');
          const pYear = parseInt(periodParts[1]);
          const pMonth = { January:0,February:1,March:2,April:3,May:4,June:5,July:6,August:7,September:8,October:9,November:10,December:11 }[periodParts[0]];
          const periodStart = `${pYear}-${String(pMonth+1).padStart(2,'0')}-01`;
          const periodEnd   = new Date(pYear, pMonth+1, 0).toISOString().slice(0, 10);

          const [btRecent, btAll, overdueInvs, upcomingInvs, jnlCount] = await Promise.all([
            db.from('bank_transactions').select('balance').eq('company_id', companyId).order('date', { ascending: false }).limit(1),
            db.from('bank_transactions').select('amount').eq('company_id', companyId).gte('date', last30),
            db.from('invoices').select('amount').eq('company_id', companyId).lt('due_date', today).neq('status', 'paid'),
            db.from('invoices').select('amount,due_date,client').eq('company_id', companyId).gte('due_date', today).lte('due_date', in30).in('status', ['pending','chased']),
            db.from('journals').select('id', { count: 'exact', head: true }).eq('company_id', companyId).gte('date', periodStart).lte('date', periodEnd),
          ]);

          const currentBal = btRecent.data?.[0] ? Number(btRecent.data[0].balance) : null;
          const txns30     = btAll.data || [];
          const inflows    = txns30.filter(t => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
          const outflows   = txns30.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
          const overdueAmt = (overdueInvs.data || []).reduce((s, i) => s + Number(i.amount), 0);
          const overdueN   = overdueInvs.data?.length || 0;
          const upcomingAmt= (upcomingInvs.data || []).reduce((s, i) => s + Number(i.amount), 0);
          const upcomingN  = upcomingInvs.data?.length || 0;
          const jnls       = jnlCount.count || 0;
          const yem        = company?.year_end_month ? MONTH_NAMES_LONG[company.year_end_month - 1] : "December";
          const vatPeriod  = company?.vat_period === 'monthly' ? 'Monthly' : 'Bi-monthly';

          const fmtE = n => `€${Math.abs(n).toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

          ctx = `
LIVE ACCOUNT DATA for ${companyName} (as of ${today}):
- Current bank balance: ${currentBal !== null ? fmtE(currentBal) : "No bank data imported yet"}
- Cash inflows last 30 days: ${fmtE(inflows)} (${txns30.filter(t=>Number(t.amount)>0).length} transactions)
- Cash outflows last 30 days: ${fmtE(outflows)} (${txns30.filter(t=>Number(t.amount)<0).length} transactions)
- Overdue invoices (AR): ${overdueN} invoice${overdueN !== 1 ? 's' : ''} totalling ${fmtE(overdueAmt)}
- Invoices due in next 30 days: ${upcomingN} invoice${upcomingN !== 1 ? 's' : ''} totalling ${fmtE(upcomingAmt)}
- Journals posted this period (${period}): ${jnls}
- Company: ${companyName} | VAT period: ${vatPeriod} | Accounting year end: ${yem}

Use these figures when answering questions. If the user asks about something not covered above, say what data you do have and suggest where to find the rest.`.trim();
        } else {
          ctx = "No company data available yet — the user has not imported any bank transactions.";
        }
      } catch (e) {
        ctx = "Live account data could not be loaded. Help with general Irish accounting questions only.";
      }

      const prompt = `You are Finflow AI — a concise Irish SME finance assistant built into Finflow. You are helping the team at ${companyName}.

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
      setMsgs([{ role: "assistant", text: `Good morning. I'm Finflow AI — your Irish finance assistant. I've loaded your live account data for ${period}. What do you need?` }]);
      setCtxLoading(false);
    })();
  }, [companyId]);

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
        <div>
          <div className="chat-ttl">Finflow AI</div>
          <div className="chat-st">{ctxLoading ? "● Loading data…" : "● Online · Live data"}</div>
        </div>
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
  const blank = () => ({
    name:           company?.name           || "",
    company_type:   company?.company_type   || "Limited Company",
    vat_registered: company?.vat_registered ?? false,
    vat_number:     company?.vat_number     || "",
    vat_period:     company?.vat_period     || "bimonthly",
    year_end_month: company?.year_end_month || 12,
    ard_month:      company?.ard_month      || "",
    ard_day:        company?.ard_day        || "",
    currency:       company?.currency       || "EUR",
  });
  const [form, setForm] = useState(blank());
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [error,  setError]  = useState(null);

  const valid = form.name.trim().length > 0 &&
    (!form.vat_registered || form.vat_number.trim().length > 0);

  const save = async () => {
    if (!valid || saving || !company?.id) return;
    setSaving(true); setSaved(false); setError(null);
    const { data, error: err } = await getCompanyClient(company.id)
      .from("companies")
      .update({
        name:           form.name.trim(),
        company_type:   form.company_type,
        vat_registered: form.vat_registered,
        vat_number:     form.vat_registered ? (form.vat_number.trim() || null) : null,
        vat_period:     form.vat_period,
        year_end_month: Number(form.year_end_month),
        ard_month:      form.ard_month ? Number(form.ard_month) : null,
        ard_day:        form.ard_day   ? Number(form.ard_day)   : null,
        currency:       form.currency,
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
        <div style={{ fontFamily: "Playfair Display, serif", fontSize: 17, fontWeight: 700, color: "var(--navy)", marginBottom: 2 }}>Company Settings</div>
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
              <label className="f-label">VAT Number</label>
              <input className="f-input" value={form.vat_number}
                onChange={e => setForm(p => ({ ...p, vat_number: e.target.value }))}
                placeholder="IE 1234567A"
                disabled={!form.vat_registered}
                style={{ opacity: form.vat_registered ? 1 : 0.45 }} />
            </div>
          </div>
        </div>
      </div>

      {/* ── CRO Annual Return ── */}
      <div className="card" style={{ marginBottom: 13 }}>
        <div className="card-header"><span className="card-title">CRO Annual Return</span></div>
        <div style={{ padding: "16px 15px" }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
            Your Annual Return Date (ARD) determines when your B1 return is due (56 days after ARD).
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
  const [loading,   setLoading]   = useState(false);
  const [generated, setGenerated] = useState(false);
  const [journals,  setJournals]  = useState([]);
  const [regNumber, setRegNumber] = useState("");
  const [dirRemun,  setDirRemun]  = useState("");

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
    const { data } = await getCompanyClient(company.id).from('journals')
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
          <div className="f-group" style={{ marginBottom: 22 }}>
            <label className="f-label">Directors' Remuneration (€) — for Note 3</label>
            <input className="f-input" type="number" min="0" value={dirRemun} onChange={e => setDirRemun(e.target.value)} placeholder="0" />
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

      {/* Print-only document header */}
      <div className="print-only" style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 24, fontWeight: 700, marginBottom: 4 }}>{companyName}</div>
        {regNumber && <div style={{ fontSize: 11, fontFamily: "monospace", color: "#555", marginBottom: 2 }}>Company Registration No. {regNumber}</div>}
        <div style={{ fontSize: 12, color: "#555", fontFamily: "monospace" }}>Financial Statements for the Year Ended {yeFmt}</div>
        <div style={{ fontSize: 11, color: "#888", fontFamily: "monospace", marginTop: 3 }}>Prepared under FRS 105 (Micro-entities Regime)</div>
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

const NAV = [
  { id: "overview",    icon: "◈", label: "Overview" },
  { id: "cashflow",    icon: "⟁", label: "Cash Flow" },
  { id: "invoices",    icon: "◻", label: "Invoices" },
  { id: "checklist",   icon: "☑", label: "Month End", badge: true },
  { id: "journals",    icon: "✎", label: "Journals" },
  { id: "gl",          icon: "⊞", label: "GL Reports" },
  { id: "bank-import", icon: "⇅", label: "Bank Import" },
  { id: "compliance",       icon: "⊙", label: "Compliance" },
  { id: "fin-statements",  icon: "§", label: "Financial Statements" },
  { id: "settings",        icon: "⚙", label: "Settings" },
];

export default function App() {
  const { user, isLoaded } = useUser();
  const [page, setPage] = useState("overview");
  const [company, setCompany] = useState(null);
  const [onboarding, setOnboarding] = useState(false);
  const [companyLoading, setCompanyLoading] = useState(true);

  // Derive the current accounting period (previous completed month)
  const period = (() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() - 1, 1)
      .toLocaleString("en-IE", { month: "long", year: "numeric" });
  })();

  const companyName = company?.name || "Your Company";

  useEffect(() => {
    if (!isLoaded) return;
    if (!user) { setCompanyLoading(false); return; }
    setCompanyLoading(true);
    supabase.from("companies").select("*").eq("clerk_user_id", user.id).limit(1)
      .then(({ data }) => {
        if (!data || data.length === 0) setOnboarding(true);
        else { setCompany(data[0]); setOnboarding(false); }
        setCompanyLoading(false);
      });
  }, [user, isLoaded]);

  // Signed-in user with no company yet → show onboarding
  if (isLoaded && user && onboarding) return (
    <>
      <style>{CSS}</style>
      <Onboarding user={user} onComplete={(c) => { setCompany(c); setOnboarding(false); }} />
    </>
  );

  // Signed-in user, company check still in flight → hold render to avoid flash
  if (isLoaded && user && companyLoading) return <style>{CSS}</style>;


  const titles = {
    overview:     ["Overview",         `${companyName} · ${period}`],
    cashflow:     ["Cash Flow",        "Forecasting · bank accounts · AP schedule"],
    invoices:     ["Invoices",         "AR ledger · aging · AI chase log"],
    checklist:    ["Month End Close",  `${period} · close checklist`],
    journals:     ["Journal Postings", `${period} · general ledger journals`],
    gl:           ["GL Reporting",     "Trial balance · P&L · Balance sheet · GL extract"],
    "bank-import":["Bank Import",      "Revolut Business · CSV import · journal posting"],
    compliance:        ["Compliance",            "ROS · CRO · Revenue deadlines"],
    "fin-statements":  ["Financial Statements",  "FRS 105 · Micro-entity accounts · CRO filing"],
    settings:          ["Settings",              "Company settings · tax · compliance"],
  };

  const [title, subtitle] = titles[page] || ["", ""];

  return (
    <AuthGate>
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
                  {item.badge && <span className="nav-badge">!</span>}
                </button>
              ))}
            </div>
            <div className="sidebar-footer">
              <div className="co-pill"><div className="co-dot" /><span className="co-name">{companyName}</span></div>
            </div>
          </div>
          <div className="main">
            <div className="topbar">
              <div><div className="pg-title">{title}</div><div className="pg-sub">{subtitle}</div></div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div className="feed-pill"><span className="feed-dot" />AIB · Live</div>
                <div className="period-badge">{period}</div>
                <UserChip />
              </div>
            </div>
            <div className="content">
              {page === "overview"     && <Overview period={period} companyId={company?.id} company={company} />}
              {page === "cashflow"     && <CashFlow onNavigate={setPage} companyId={company?.id} />}
              {page === "invoices"     && <Invoices companyName={companyName} />}
              {page === "checklist"    && <Checklist period={period} companyId={company?.id} />}
              {page === "journals"     && <Journals period={period} companyName={companyName} />}
              {page === "gl"           && <GLReport period={period} companyId={company?.id} companyName={companyName} company={company} />}
              {page === "bank-import"  && <BankImport companyId={company?.id} />}
              {page === "compliance"      && <Compliance company={company} />}
              {page === "fin-statements" && <FinancialStatements company={company} companyName={companyName} />}
              {page === "settings"       && <Settings company={company} onUpdate={c => setCompany(c)} />}
            </div>
          </div>
          <Chat page={title} companyName={companyName} period={period} companyId={company?.id} company={company} />
        </div>
      </>
    </AuthGate>
  );
}




