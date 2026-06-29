import { useState, useEffect, useRef, useCallback } from 'react';
import { useUser, useAuth } from '@clerk/clerk-react';
import { SignIn } from '@clerk/clerk-react';
import { supabase } from './supabase.js';
import { approveApBill, confirmBankTxn } from './shared/approvals.js';
import { InboxZeroCelebration } from './shared/InboxZeroCelebration.jsx';
import { recScoreCandidate } from './shared/recScore.js';
import { computeDeadlines } from './shared/computeDeadlines.js';
import { useHealthy } from './shared/useHealthy.js';
import { AutomationHero, HealthPulseDot } from './shared/AutomationHero.jsx';
import {
  INV_VAT_LABELS, calcLineAmounts, calcInvTotals, vatCodeForRate,
  createInvoiceDraft, finaliseInvoice,
} from './shared/invoice.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const fmt  = n => `€${Math.abs(Number(n)||0).toLocaleString("en-IE",{minimumFractionDigits:0,maximumFractionDigits:0})}`;
const fmtD = d => d ? new Date(d).toLocaleDateString("en-IE",{day:"2-digit",month:"short"}) : "—";


// ─── CSS ──────────────────────────────────────────────────────────────────────
const M_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&family=Inter:wght@300;400;500;600&family=Source+Code+Pro:wght@400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --mb: #070d1a; --ms: #0d1526; --mc: #111d30; --mbd: #192338;
    --mt: var(--mb); --mtx: #e4eaf4; --mm: #6d7f9c; --md: #3d506a;
    --teal: #1d8a93; --teal2: #26a9b3; --gold: #d4a017; --red: #e05555;
    --green: #34d399; --r: 14px; --rsm: 10px;
  }
  html, body { background: var(--mb); min-height: 100%; -webkit-font-smoothing: antialiased; }
  .m-wrap { max-width: 430px; margin: 0 auto; min-height: 100svh; min-height: 100vh; background: var(--mb); display: flex; flex-direction: column; font-family: 'Inter', system-ui, sans-serif; color: var(--mtx); position: relative; }
  .m-content { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; padding-top: env(safe-area-inset-top, 0px); padding-bottom: calc(72px + env(safe-area-inset-bottom, 0px)); }
  .m-loading { display: flex; align-items: center; justify-content: center; min-height: 100svh; min-height: 100vh; background: var(--mb); color: var(--mm); font-family: 'Source Code Pro', monospace; font-size: 12px; letter-spacing: 0.1em; }

  /* Auth */
  .m-auth { min-height: 100svh; min-height: 100vh; background: var(--mb); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 32px 20px; gap: 28px; }
  .m-auth-logo { font-family: 'Playfair Display', serif; font-size: 32px; font-weight: 700; color: var(--mtx); letter-spacing: -0.02em; }
  .m-auth-logo span { color: var(--teal2); }
  .m-auth-sub { font-size: 11px; color: var(--mm); font-family: 'Source Code Pro', monospace; letter-spacing: 0.12em; text-transform: uppercase; margin-top: -16px; }
  .m-auth-hint { font-size: 13px; color: var(--mm); text-align: center; line-height: 1.6; }
  .m-auth-link { color: var(--teal2); text-decoration: none; font-weight: 600; }

  /* Bottom nav — 5 tabs, tighter padding */
  .m-nav { position: fixed; bottom: 0; left: 50%; transform: translateX(-50%); width: 100%; max-width: 430px; background: var(--ms); border-top: 1px solid var(--mbd); display: flex; padding-bottom: env(safe-area-inset-bottom, 0px); z-index: 100; box-shadow: 0 -4px 20px rgba(0,0,0,0.4); }
  .m-nav-btn { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 9px 2px; border: none; background: none; cursor: pointer; color: var(--md); transition: color 0.14s; min-height: 54px; }
  .m-nav-btn.active { color: var(--teal2); }
  .m-nav-btn.active .m-nav-icon { filter: drop-shadow(0 0 8px rgba(38,169,179,0.5)); }
  .m-nav-icon { font-size: 18px; line-height: 1; }
  .m-nav-label { font-size: 9px; font-family: 'Source Code Pro', monospace; letter-spacing: 0.04em; }

  /* Page header */
  .m-page-hdr { padding: 20px 18px 12px; }
  .m-company-name { font-family: 'Playfair Display', serif; font-size: 22px; font-weight: 700; color: var(--mtx); letter-spacing: -0.01em; }
  .m-date-str { font-size: 11px; color: var(--mm); font-family: 'Source Code Pro', monospace; margin-top: 3px; }

  /* Cards */
  .m-card { background: var(--mc); border: 1px solid var(--mbd); border-radius: var(--r); padding: 18px; margin: 0 16px 12px; }
  .m-card-hdr { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .m-card-title { font-size: 11px; font-family: 'Source Code Pro', monospace; text-transform: uppercase; letter-spacing: 0.1em; color: var(--mm); }

  /* Cash card */
  .m-cash-label { font-size: 11px; font-family: 'Source Code Pro', monospace; text-transform: uppercase; letter-spacing: 0.1em; color: var(--mm); margin-bottom: 8px; }
  .m-cash-val { font-family: 'Playfair Display', serif; font-size: 40px; font-weight: 700; line-height: 1; letter-spacing: -0.02em; }
  .m-cash-trend { font-size: 12px; font-family: 'Source Code Pro', monospace; margin-top: 6px; }

  /* Pill stats */
  .m-pills { display: flex; gap: 10px; padding: 0 16px 12px; }
  .m-pill { background: var(--mc); border: 1px solid var(--mbd); border-radius: var(--r); padding: 12px 14px; flex: 1; min-width: 0; }
  .m-pill-val { font-family: 'Playfair Display', serif; font-size: 24px; font-weight: 700; line-height: 1; }
  .m-pill-lbl { font-size: 9px; color: var(--mm); font-family: 'Source Code Pro', monospace; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 4px; line-height: 1.3; }

  /* Quick action row */
  .m-quick-row { display: flex; gap: 10px; padding: 0 16px 12px; }
  .m-quick-btn { flex: 1; background: var(--mc); border: 1px solid var(--mbd); border-radius: var(--r); padding: 14px 8px 12px; display: flex; flex-direction: column; align-items: center; gap: 6px; cursor: pointer; min-height: 76px; transition: background 0.14s; }
  .m-quick-btn:active { background: rgba(29,138,147,0.12); border-color: var(--teal); }
  .m-quick-btn-icon { font-size: 22px; line-height: 1; }
  .m-quick-btn-lbl { font-size: 11px; font-weight: 600; text-align: center; color: var(--mtx); font-family: 'Source Code Pro', monospace; letter-spacing: 0.03em; }

  /* Transaction rows */
  .m-txn { display: flex; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--mbd); gap: 10px; }
  .m-txn:last-child { border-bottom: none; }
  .m-txn-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .m-txn-info { flex: 1; min-width: 0; }
  .m-txn-desc { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .m-txn-date { font-size: 10px; color: var(--mm); font-family: 'Source Code Pro', monospace; margin-top: 2px; }
  .m-txn-amt { font-family: 'Source Code Pro', monospace; font-size: 13px; font-weight: 600; flex-shrink: 0; }

  /* Refresh */
  .m-ptr { text-align: center; padding: 10px; font-size: 11px; color: var(--teal2); font-family: 'Source Code Pro', monospace; letter-spacing: 0.08em; }

  /* Section title */
  .m-sec-title { font-family: 'Playfair Display', serif; font-size: 17px; font-weight: 600; padding: 4px 18px 10px; }
  .m-empty { padding: 24px 18px; font-size: 13px; color: var(--mm); text-align: center; }

  /* Deadline rows */
  .m-dl { display: flex; align-items: center; padding: 13px 0; border-bottom: 1px solid var(--mbd); gap: 10px; }
  .m-dl:last-child { border-bottom: none; }
  .m-dl-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
  .m-dl-type { font-size: 11px; font-family: 'Source Code Pro', monospace; font-weight: 700; color: var(--teal2); width: 44px; flex-shrink: 0; }
  .m-dl-body { flex: 1; min-width: 0; }
  .m-dl-desc { font-size: 13px; }
  .m-dl-date { font-size: 10px; color: var(--mm); font-family: 'Source Code Pro', monospace; margin-top: 2px; }
  .m-dl-days { font-family: 'Playfair Display', serif; font-size: 20px; font-weight: 700; flex-shrink: 0; }

  /* Receipt upload */
  .m-upload-zone { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; margin: 0 16px 14px; height: 150px; border: 2px dashed var(--teal); border-radius: var(--r); background: rgba(29,138,147,0.05); cursor: pointer; transition: background 0.15s; }
  .m-upload-zone:active { background: rgba(29,138,147,0.12); }
  .m-upload-icon { font-size: 40px; line-height: 1; }
  .m-upload-label { font-size: 15px; font-weight: 600; color: var(--teal2); }
  .m-upload-sub { font-size: 11px; color: var(--mm); }

  .m-receipt-row { display: flex; gap: 14px; margin: 0 16px 14px; }
  .m-receipt-img { width: 80px; height: 104px; object-fit: cover; border-radius: var(--rsm); border: 1px solid var(--mbd); flex-shrink: 0; background: var(--mc); }
  .m-receipt-fields { flex: 1; display: flex; flex-direction: column; gap: 8px; }
  .m-extracting { font-size: 11px; color: var(--teal2); font-family: 'Source Code Pro', monospace; text-align: center; padding: 8px; }

  /* Form */
  .m-form { padding: 0 16px 8px; }
  .m-fgroup { margin-bottom: 12px; }
  .m-flabel { display: block; font-size: 10px; font-family: 'Source Code Pro', monospace; text-transform: uppercase; letter-spacing: 0.08em; color: var(--mm); margin-bottom: 5px; }
  .m-finput { width: 100%; background: var(--ms); border: 1px solid var(--mbd); border-radius: var(--rsm); padding: 11px 13px; font-size: 14px; font-family: 'Inter', system-ui, sans-serif; color: var(--mtx); outline: none; -webkit-appearance: none; }
  .m-finput:focus { border-color: var(--teal); }
  .m-fselect { width: 100%; background: var(--ms); border: 1px solid var(--mbd); border-radius: var(--rsm); padding: 11px 13px; font-size: 14px; color: var(--mtx); outline: none; -webkit-appearance: none; }
  .m-frow { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }

  /* Buttons */
  .m-btn { width: 100%; padding: 15px; border-radius: var(--rsm); font-size: 15px; font-weight: 600; font-family: 'Inter', system-ui, sans-serif; border: none; cursor: pointer; transition: opacity 0.15s; min-height: 52px; }
  .m-btn-p { background: var(--teal); color: white; }
  .m-btn-p:disabled { opacity: 0.45; }
  .m-btn-s { background: var(--mc); color: var(--mm); border: 1px solid var(--mbd); margin-top: 10px; }
  .m-btn-sm { width: auto; padding: 8px 16px; font-size: 12px; min-height: 36px; border-radius: var(--rsm); border: none; cursor: pointer; font-family: 'Inter', system-ui, sans-serif; font-weight: 600; }

  /* Pill badge */
  .m-badge { display: inline-flex; align-items: center; padding: 3px 9px; border-radius: 20px; font-size: 10px; font-weight: 600; font-family: 'Source Code Pro', monospace; text-transform: uppercase; letter-spacing: 0.04em; }

  /* Receipt list row */
  .m-rcp { display: flex; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--mbd); gap: 10px; }
  .m-rcp:last-child { border-bottom: none; }
  .m-rcp-icon { width: 36px; height: 36px; border-radius: var(--rsm); background: var(--ms); display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; border: 1px solid var(--mbd); }
  .m-rcp-info { flex: 1; min-width: 0; }
  .m-rcp-supplier { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .m-rcp-meta { font-size: 10px; color: var(--mm); font-family: 'Source Code Pro', monospace; margin-top: 2px; }
  .m-rcp-amt { font-family: 'Source Code Pro', monospace; font-size: 13px; font-weight: 600; flex-shrink: 0; }

  /* Overdue invoice row */
  .m-inv { display: flex; align-items: center; padding: 11px 0; border-bottom: 1px solid var(--mbd); gap: 10px; }
  .m-inv:last-child { border-bottom: none; }
  .m-inv-info { flex: 1; min-width: 0; }
  .m-inv-client { font-size: 13px; font-weight: 500; }
  .m-inv-meta { font-size: 10px; color: var(--mm); font-family: 'Source Code Pro', monospace; margin-top: 2px; }

  /* Stub tabs */
  .m-stub { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 60px 28px; min-height: 55vh; text-align: center; }
  .m-stub-icon { font-size: 48px; line-height: 1; opacity: 0.7; }
  .m-stub-title { font-family: 'Playfair Display', serif; font-size: 22px; font-weight: 600; }
  .m-stub-sub { font-size: 13px; color: var(--mm); line-height: 1.65; max-width: 280px; }

  /* Colours */
  .c-red   { color: var(--red); }
  .c-gold  { color: var(--gold); }
  .c-green { color: var(--green); }
  .c-teal  { color: var(--teal2); }
  .c-dim   { color: var(--mm); }

  /* ── QuickInvoice tab ───────────────────────────────────────────── */
  .qi-line-card { margin: 0 16px 8px; background: var(--mc); border: 1px solid var(--mbd); border-radius: var(--r); padding: 12px 14px; }
  .qi-line-del { background: none; border: none; color: var(--md); font-size: 18px; cursor: pointer; padding: 2px 6px; line-height: 1; flex-shrink: 0; }
  .qi-line-del:active { color: var(--red); }
  .qi-line-gross { font-family: 'Source Code Pro', monospace; font-size: 13px; font-weight: 600; color: var(--teal2); white-space: nowrap; padding-left: 8px; flex-shrink: 0; }
  .qi-add-line { display: block; width: calc(100% - 32px); margin: 0 16px 10px; background: none; border: 1px dashed var(--mbd); border-radius: var(--r); padding: 12px; font-size: 13px; font-weight: 600; color: var(--mm); font-family: 'Inter', system-ui, sans-serif; cursor: pointer; text-align: center; }
  .qi-add-line:active { background: rgba(29,138,147,0.06); border-color: var(--teal); color: var(--teal2); }
  .qi-total-bar { margin: 0 16px 14px; padding: 14px 18px; background: rgba(29,138,147,0.07); border: 1px solid rgba(29,138,147,0.25); border-radius: var(--r); display: flex; justify-content: space-between; align-items: center; }
  .qi-total-lbl { font-size: 11px; font-family: 'Source Code Pro', monospace; text-transform: uppercase; letter-spacing: 0.08em; color: var(--mm); }
  .qi-total-sub { font-size: 10px; color: var(--mm); font-family: 'Source Code Pro', monospace; margin-top: 3px; }
  .qi-total-val { font-family: 'Playfair Display', serif; font-size: 30px; font-weight: 700; color: var(--teal2); letter-spacing: -0.01em; }
  .qi-done-card { margin: 0 16px 14px; padding: 24px 20px; background: rgba(52,211,153,0.06); border: 1px solid rgba(52,211,153,0.2); border-radius: var(--r); text-align: center; }
  .qi-done-num { font-family: 'Playfair Display', serif; font-size: 36px; font-weight: 700; color: var(--green); letter-spacing: -0.02em; }
  .qi-done-who { font-size: 14px; color: var(--mtx); font-weight: 500; margin-top: 6px; }
  .qi-done-sub { font-size: 11px; color: var(--mm); font-family: 'Source Code Pro', monospace; margin-top: 4px; letter-spacing: 0.03em; }
  .qi-cust-row { display: flex; gap: 8px; align-items: stretch; }
  .qi-cust-sel { flex: 1; background: var(--ms); border: 1px solid var(--mbd); border-radius: var(--rsm); padding: 11px 13px; font-size: 14px; color: var(--mtx); outline: none; -webkit-appearance: none; min-height: 46px; }
  .qi-cust-sel:focus { border-color: var(--teal); }
  .qi-new-btn { background: var(--mc); border: 1px solid var(--teal); border-radius: var(--rsm); padding: 11px 14px; font-size: 12px; font-weight: 700; color: var(--teal2); cursor: pointer; font-family: 'Inter', system-ui, sans-serif; white-space: nowrap; flex-shrink: 0; min-height: 46px; }
  .qi-err { margin: 0 16px 12px; padding: 12px 14px; background: rgba(224,85,85,0.08); border: 1px solid rgba(224,85,85,0.2); border-radius: 10px; font-size: 12px; color: var(--red); line-height: 1.5; }
  .qi-ok  { margin: 0 16px 10px; padding: 10px 14px; background: rgba(52,211,153,0.08); border: 1px solid rgba(52,211,153,0.2); border-radius: 10px; font-size: 12px; color: var(--green); }
`;

// ─── Auth screen ──────────────────────────────────────────────────────────────
function MobileAuth() {
  return (
    <div className="m-auth">
      <div className="m-auth-logo">Ledgr<span>ly</span></div>
      <div className="m-auth-sub">Mobile · Finance OS</div>
      <p className="m-auth-hint">Sign in to access your dashboard, deadlines, and expense capture on the go.</p>
      <SignIn routing="hash" appearance={{ variables: { colorBackground: '#0d1526', colorText: '#e4eaf4', colorInputBackground: '#111d30', colorInputText: '#e4eaf4' } }} />
      <a className="m-auth-link" href="/">← Back to full app</a>
    </div>
  );
}

// ─── Bottom nav ───────────────────────────────────────────────────────────────
function BottomNav({ tab, setTab }) {
  const TABS = [
    { id: 'home',       icon: '◈',  label: 'Home' },
    { id: 'approvals',  icon: '⊛',  label: 'Approvals' },
    { id: 'cash',       icon: '◎',  label: 'Cash' },
    { id: 'compliance', icon: '⊙',  label: 'Compliance' },
    { id: 'invoice',    icon: '◨',  label: 'Invoice' },
  ];
  return (
    <nav className="m-nav">
      {TABS.map(t => (
        <button key={t.id} className={`m-nav-btn${tab===t.id?' active':''}`} onClick={() => setTab(t.id)}>
          <span className="m-nav-icon">{t.icon}</span>
          <span className="m-nav-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

// ─── Home tab ─────────────────────────────────────────────────────────────────
function HomeTab({ companyId, company, setTab }) {
  const [overdue, setOverdue]       = useState(0);
  const [pending, setPending]       = useState(0);
  const [txns, setTxns]             = useState([]);
  const [overdueInvs, setOverdueInvs] = useState([]);
  const [loading, setLoading]       = useState(true);

  const load = useCallback(async () => {
    if (!companyId) return;
    const today = new Date().toISOString().slice(0,10);
    const [inv, exp, recent, overdueList] = await Promise.all([
      supabase.from('invoices').select('id').eq('company_id', companyId).lt('due_date', today).neq('status','paid'),
      supabase.from('expenses').select('id').eq('company_id', companyId).eq('status','submitted'),
      supabase.from('bank_transactions').select('date,description,amount').eq('company_id', companyId).order('date',{ascending:false}).limit(4),
      supabase.from('invoices').select('id,client,amount,due_date,invoice_ref').eq('company_id', companyId).lt('due_date', today).neq('status','paid').order('due_date').limit(3),
    ]);
    if (inv.data)         setOverdue(inv.data.length);
    if (exp.data)         setPending(exp.data.length);
    if (recent.data)      setTxns(recent.data);
    if (overdueList.data) setOverdueInvs(overdueList.data);
    setLoading(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const { healthy, loading: healthLoading } = useHealthy(companyId);

  const today = new Date();
  const dateStr = today.toLocaleDateString('en-IE', { weekday:'long', day:'numeric', month:'long' });
  const deadlines = computeDeadlines(company);
  const nextDl = deadlines.find(d => Math.floor((d.due - today) / 86400000) >= 0);
  const nextDlDays = nextDl ? Math.floor((nextDl.due - today) / 86400000) : null;

  return (
    <div>
      <div className="m-page-hdr">
        <div className="m-company-name">{company?.name || 'My Company'}</div>
        <div className="m-date-str">{dateStr}</div>
      </div>

      {/* Stat pills */}
      <div className="m-pills">
        <div className="m-pill">
          <div className={`m-pill-val ${overdue > 0 ? 'c-red' : 'c-green'}`}>{loading ? '…' : overdue}</div>
          <div className="m-pill-lbl">Overdue invoices</div>
        </div>
        <div className="m-pill">
          <div className={`m-pill-val ${nextDlDays !== null && nextDlDays <= 7 ? 'c-red' : nextDlDays !== null && nextDlDays <= 14 ? 'c-gold' : 'c-teal'}`}>
            {nextDlDays !== null ? `${nextDlDays}d` : '—'}
          </div>
          <div className="m-pill-lbl">Next deadline</div>
        </div>
        <div className="m-pill">
          <div className={`m-pill-val ${pending > 0 ? 'c-gold' : 'c-dim'}`}>{loading ? '…' : pending}</div>
          <div className="m-pill-lbl">Expenses pending</div>
        </div>
      </div>

      {/* Health indicator */}
      {!healthLoading && healthy !== null && (
        <div style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 0 4px', fontSize:11, fontFamily:'Source Code Pro,monospace', color:'var(--mm)', letterSpacing:'0.04em' }}>
          <HealthPulseDot healthy={healthy} size={8} />
          <span>{healthy ? 'Books healthy' : 'Needs attention'}</span>
        </div>
      )}

      {/* 30-day automation hero */}
      <AutomationHero companyId={companyId} theme="dark" />

      {/* Quick actions */}
      <div className="m-sec-title">Quick Actions</div>
      <div className="m-quick-row">
        <button className="m-quick-btn" onClick={() => setTab('approvals')}>
          <span className="m-quick-btn-icon">📷</span>
          <span className="m-quick-btn-lbl">Scan Receipt</span>
        </button>
        <button className="m-quick-btn" onClick={() => setTab('cash')}>
          <span className="m-quick-btn-icon">◎</span>
          <span className="m-quick-btn-lbl">Cash Position</span>
        </button>
        <button className="m-quick-btn" onClick={() => setTab('compliance')}>
          <span className="m-quick-btn-icon">⊙</span>
          <span className="m-quick-btn-lbl">Deadlines</span>
        </button>
      </div>

      {/* Overdue invoices */}
      {!loading && overdueInvs.length > 0 && (
        <>
          <div className="m-sec-title">Overdue Invoices</div>
          <div className="m-card">
            {overdueInvs.map((inv, i) => (
              <div key={i} className="m-inv">
                <div className="m-inv-info">
                  <div className="m-inv-client">{inv.client}</div>
                  <div className="m-inv-meta">{inv.invoice_ref} · Due {fmtD(inv.due_date)}</div>
                </div>
                <span style={{ fontFamily:'Source Code Pro,monospace', fontSize:13, fontWeight:600, color:'var(--red)' }}>{fmt(inv.amount)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Recent transactions */}
      <div className="m-sec-title">Recent Transactions</div>
      <div className="m-card">
        {loading ? <div className="m-empty">Loading…</div> :
         txns.length === 0 ? <div className="m-empty">No transactions yet</div> :
         txns.map((t, i) => {
           const pos = Number(t.amount) >= 0;
           return (
             <div key={i} className="m-txn">
               <div className="m-txn-dot" style={{ background: pos ? 'var(--green)' : 'var(--red)' }} />
               <div className="m-txn-info">
                 <div className="m-txn-desc">{t.description || '—'}</div>
                 <div className="m-txn-date">{fmtD(t.date)}</div>
               </div>
               <div className={`m-txn-amt ${pos ? 'c-green' : 'c-red'}`}>
                 {pos ? '+' : '-'}{fmt(Math.abs(Number(t.amount)))}
               </div>
             </div>
           );
         })}
      </div>
    </div>
  );
}

// ─── Cash tab ─────────────────────────────────────────────────────────────────
function CashTab({ companyId }) {
  const [cash, setCash]         = useState(null);
  const [cashLm, setCashLm]     = useState(null);
  const [txns, setTxns]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef(null);
  const touchY    = useRef(0);

  const load = useCallback(async () => {
    if (!companyId) return;
    const now    = new Date();
    const lmStart = new Date(now.getFullYear(), now.getMonth()-1, 1).toISOString().slice(0,10);
    const lmEnd   = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0,10);
    const [btAll, btLm, recent] = await Promise.all([
      supabase.from('bank_transactions').select('amount').eq('company_id', companyId),
      supabase.from('bank_transactions').select('amount').eq('company_id', companyId).gte('date', lmStart).lte('date', lmEnd),
      supabase.from('bank_transactions').select('date,description,amount').eq('company_id', companyId).order('date',{ascending:false}).limit(20),
    ]);
    if (btAll.data)  setCash(btAll.data.reduce((s,r) => s + Number(r.amount), 0));
    if (btLm.data)   setCashLm(btLm.data.reduce((s,r) => s + Number(r.amount), 0));
    if (recent.data) setTxns(recent.data);
    setLoading(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const handleTouchStart = e => { touchY.current = e.touches[0].clientY; };
  const handleTouchEnd   = async e => {
    const dy = e.changedTouches[0].clientY - touchY.current;
    if (dy > 65 && (scrollRef.current?.scrollTop || 0) === 0) {
      setRefreshing(true); await load(); setRefreshing(false);
    }
  };

  const cashColour = cash === null ? 'var(--mtx)' : cash >= 0 ? 'var(--green)' : 'var(--red)';
  const trendPct   = cashLm && cash !== null ? ((cash - cashLm) / Math.abs(cashLm) * 100).toFixed(0) : null;

  return (
    <div ref={scrollRef} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      {refreshing && <div className="m-ptr">↻ Refreshing…</div>}

      <div className="m-page-hdr">
        <div className="m-company-name">Cash</div>
        <div className="m-date-str">Bank position · pull to refresh</div>
      </div>

      <div className="m-card" style={{ borderTop: `3px solid ${cashColour}` }}>
        <div className="m-cash-label">Cash Position</div>
        {loading ? <div style={{ height:48, background:'var(--ms)', borderRadius:8, opacity:0.4 }} /> : (
          <>
            <div className="m-cash-val" style={{ color: cashColour }}>
              {cash === null ? '—' : fmt(Math.abs(cash))}
            </div>
            {trendPct !== null && (
              <div className={`m-cash-trend ${Number(trendPct) >= 0 ? 'c-green' : 'c-red'}`}>
                {Number(trendPct) >= 0 ? '▲' : '▼'} {Math.abs(trendPct)}% vs last month
              </div>
            )}
          </>
        )}
      </div>

      <div className="m-sec-title">Transactions</div>
      <div className="m-card">
        {loading ? <div className="m-empty">Loading…</div> :
         txns.length === 0 ? <div className="m-empty">No transactions yet</div> :
         txns.map((t, i) => {
           const pos = Number(t.amount) >= 0;
           return (
             <div key={i} className="m-txn">
               <div className="m-txn-dot" style={{ background: pos ? 'var(--green)' : 'var(--red)' }} />
               <div className="m-txn-info">
                 <div className="m-txn-desc">{t.description || '—'}</div>
                 <div className="m-txn-date">{fmtD(t.date)}</div>
               </div>
               <div className={`m-txn-amt ${pos ? 'c-green' : 'c-red'}`}>
                 {pos ? '+' : '-'}{fmt(Math.abs(Number(t.amount)))}
               </div>
             </div>
           );
         })}
      </div>
    </div>
  );
}

// ─── Receipt capture (reusable sub-component) ─────────────────────────────────
function ReceiptCapture({ companyId, user }) {
  const [extracting, setExtracting] = useState(false);
  const [receiptUrl, setReceiptUrl] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted]   = useState(false);
  const [form, setForm] = useState({ supplier:'', receipt_date: new Date().toISOString().slice(0,10), amount:'', vat_amount:'0', nominal_account:'6600', payment_method:'company_card', notes:'' });
  const fileRef = useRef(null);
  const ff = f => e => setForm(p => ({ ...p, [f]: e.target.value }));

  const handleFile = async file => {
    if (!file) return;
    setReceiptUrl(URL.createObjectURL(file));
    setSubmitted(false);
    if (!file.type.startsWith('image/')) return;
    setExtracting(true);
    try {
      const b64 = await new Promise((res, rej) => {
        const rd = new FileReader();
        rd.onload = e => res(e.target.result.split(',')[1]);
        rd.onerror = rej;
        rd.readAsDataURL(file);
      });
      const resp = await fetch('/api/extract-receipt', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ base64: b64, mediaType: file.type }),
      });
      const d = await resp.json();
      setForm(p => ({
        ...p,
        supplier:     d.supplier     || p.supplier,
        receipt_date: d.date         || p.receipt_date,
        amount:       d.total_amount ? String(d.total_amount) : p.amount,
        vat_amount:   d.vat_amount   ? String(d.vat_amount)   : p.vat_amount,
      }));
    } catch (e) { console.error('[mobile receipts]', e); }
    setExtracting(false);
  };

  const submit = async () => {
    if (!form.supplier || !form.amount || !companyId) return;
    setSubmitting(true);
    const byName = user?.firstName ? `${user.firstName} ${user.lastName??''}`.trim() : user?.emailAddresses?.[0]?.emailAddress || 'Unknown';
    await supabase.from('expenses').insert({
      company_id: companyId, submitted_by_clerk_id: user?.id || '',
      submitted_by_name: byName, receipt_date: form.receipt_date,
      supplier: form.supplier, amount: parseFloat(form.amount)||0,
      vat_amount: parseFloat(form.vat_amount)||0,
      net_amount: (parseFloat(form.amount)||0) - (parseFloat(form.vat_amount)||0),
      nominal_account: form.nominal_account, nominal_name: 'Sundry Expenses',
      payment_method: form.payment_method, status: 'submitted', notes: form.notes,
    });
    setReceiptUrl(null);
    setForm({ supplier:'', receipt_date: new Date().toISOString().slice(0,10), amount:'', vat_amount:'0', nominal_account:'6600', payment_method:'company_card', notes:'' });
    setSubmitted(true); setSubmitting(false);
  };

  if (submitted) {
    return (
      <div style={{ margin:'0 16px 12px', padding:'12px 16px', background:'rgba(52,211,153,0.1)', border:'1px solid rgba(52,211,153,0.25)', borderRadius:'var(--r)', fontSize:13, color:'var(--green)' }}>
        ✓ Expense submitted for approval
        <button style={{ marginLeft:12, background:'none', border:'none', color:'var(--teal2)', fontSize:12, cursor:'pointer', fontWeight:600 }}
          onClick={() => setSubmitted(false)}>Scan another →</button>
      </div>
    );
  }

  if (!receiptUrl) {
    return (
      <>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" capture="environment" style={{ display:'none' }}
          onChange={e => { if (e.target.files[0]) handleFile(e.target.files[0]); }} />
        <div className="m-upload-zone" onClick={() => fileRef.current?.click()}>
          <div className="m-upload-icon">📷</div>
          <div className="m-upload-label">Scan Receipt</div>
          <div className="m-upload-sub">Take a photo or choose from library</div>
        </div>
      </>
    );
  }

  return (
    <>
      {extracting && <div className="m-extracting">AI extracting receipt data…</div>}
      <div className="m-receipt-row">
        <img className="m-receipt-img" src={receiptUrl} alt="Receipt" onError={e => { e.target.style.display='none'; }} />
        <div className="m-receipt-fields">
          <div className="m-fgroup">
            <label className="m-flabel">Supplier</label>
            <input className="m-finput" value={form.supplier} onChange={ff('supplier')} placeholder="Supplier name" />
          </div>
          <div className="m-fgroup">
            <label className="m-flabel">Date</label>
            <input className="m-finput" type="date" value={form.receipt_date} onChange={ff('receipt_date')} />
          </div>
        </div>
      </div>
      <div className="m-form">
        <div className="m-frow">
          <div className="m-fgroup">
            <label className="m-flabel">Total (€)</label>
            <input className="m-finput" type="number" step="0.01" value={form.amount} onChange={ff('amount')} placeholder="0.00" />
          </div>
          <div className="m-fgroup">
            <label className="m-flabel">VAT (€)</label>
            <input className="m-finput" type="number" step="0.01" value={form.vat_amount} onChange={ff('vat_amount')} placeholder="0.00" />
          </div>
        </div>
        <div className="m-fgroup">
          <label className="m-flabel">Payment Method</label>
          <select className="m-fselect" value={form.payment_method} onChange={ff('payment_method')}>
            <option value="company_card">Company Card</option>
            <option value="personal_card">Personal Card</option>
            <option value="cash">Cash</option>
            <option value="bank_transfer">Bank Transfer</option>
          </select>
        </div>
        <div className="m-fgroup">
          <label className="m-flabel">Notes</label>
          <input className="m-finput" value={form.notes} onChange={ff('notes')} placeholder="Optional notes…" />
        </div>
        <button className="m-btn m-btn-p" onClick={submit} disabled={!form.supplier || !form.amount || submitting}>
          {submitting ? 'Submitting…' : 'Submit for Approval'}
        </button>
        <button className="m-btn m-btn-s" onClick={() => setReceiptUrl(null)}>Cancel</button>
      </div>
    </>
  );
}

// ─── Approval card ─────────────────────────────────────────────────────────────
function ApprovalCard({ item, approving, onApprove, onReview }) {
  const isBill = item._type === 'ap_bill';
  const isIn   = Number(item.amount) >= 0;
  const busy   = approving === item.id;

  return (
    <div style={{ margin:'0 16px 10px', background:'var(--mc)', border:'1px solid var(--mbd)', borderRadius:'var(--r)', padding:'14px 16px' }}>
      {/* Header row */}
      <div style={{ display:'flex', alignItems:'flex-start', gap:10, marginBottom:10 }}>
        <div style={{ width:34, height:34, borderRadius:8, background: isBill ? 'rgba(29,138,147,0.1)' : 'rgba(52,211,153,0.07)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>
          {isBill ? '🧾' : '🏦'}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:13, fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
            {item.description}
          </div>
          <div style={{ fontSize:10, color:'var(--mm)', fontFamily:'Source Code Pro,monospace', marginTop:2 }}>
            {item.subtitle}
          </div>
        </div>
        <div style={{ fontSize:14, fontWeight:700, fontFamily:'Source Code Pro,monospace', color: !isBill && !isIn ? 'var(--red)' : 'var(--mtx)', flexShrink:0 }}>
          {!isBill && !isIn ? '-' : ''}{fmt(Math.abs(Number(item.amount)))}
        </div>
      </div>

      {/* AI suggestion pill */}
      <div style={{ background:'var(--ms)', borderRadius:8, padding:'7px 10px', marginBottom:12, display:'flex', flexWrap:'wrap', gap:'4px 8px', fontSize:11, alignItems:'center' }}>
        <span style={{ color:'var(--mm)', fontFamily:'Source Code Pro,monospace' }}>Category</span>
        <span style={{ color:'var(--teal2)', fontWeight:600, fontFamily:'Source Code Pro,monospace' }}>{item.suggestedNominal}</span>
        {item.nominalName && <span style={{ color:'var(--mm)' }}>{item.nominalName}</span>}
        {item.vatCode && item.vatCode !== 'NONE' && (
          <span style={{ color:'var(--mm)', fontFamily:'Source Code Pro,monospace' }}>· {item.vatCode}</span>
        )}
        {item.confidence != null && (
          <span style={{ marginLeft:'auto', fontFamily:'Source Code Pro,monospace', color: item.confidence >= 80 ? 'var(--green)' : 'var(--gold)', fontWeight:600 }}>
            {item.confidence}%
          </span>
        )}
      </div>

      {/* Actions */}
      <div style={{ display:'flex', gap:10 }}>
        <button onClick={onReview} disabled={!!approving}
          style={{ flex:1, padding:'10px', background:'var(--ms)', border:'1px solid var(--mbd)', borderRadius:'var(--rsm)', fontSize:13, fontWeight:600, color:'var(--mm)', cursor:'pointer', fontFamily:'Inter,system-ui,sans-serif', opacity: approving ? 0.5 : 1 }}>
          Review on web
        </button>
        <button onClick={onApprove} disabled={!!approving}
          style={{ flex:2, padding:'10px', background: busy ? 'rgba(29,138,147,0.5)' : 'var(--teal)', border:'none', borderRadius:'var(--rsm)', fontSize:13, fontWeight:600, color:'white', cursor: busy ? 'default' : 'pointer', fontFamily:'Inter,system-ui,sans-serif' }}>
          {busy ? '…' : '✓ Approve'}
        </button>
      </div>
    </div>
  );
}

// ─── Approvals tab ────────────────────────────────────────────────────────────
function ApprovalsTab({ companyId, user }) {
  const [items, setItems]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [loadErr, setLoadErr]       = useState(null);
  const [approving, setApproving]   = useState(null); // id of item being approved
  const [justCleared, setJustCleared] = useState(false);

  useEffect(() => { if (items.length > 0) setJustCleared(false); }, [items.length]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setLoadErr(null);
    try {
      // ── 1. AP bills needing review ──────────────────────────────────────────
      const { data: bills, error: bErr } = await supabase
        .from('ap_invoices')
        .select('id, company_id, supplier, invoice_ref, invoice_date, due_date, amount, gross_amount, net_amount, vat_amount, suggested_nominal, nominal_code, vat_code, status')
        .eq('company_id', companyId)
        .eq('status', 'needs_review')
        .order('invoice_date', { ascending: false })
        .limit(30);
      if (bErr) throw bErr;

      // ── 2. Bank transactions needing category confirmation ─────────────────
      // Start from the bank_matches side so we only fetch txns that are already
      // in the categorise queue (matched_type='journal', status='suggested').
      const { data: journalMatches } = await supabase
        .from('bank_matches')
        .select('id, bank_transaction_id, confidence, matched_id')
        .eq('company_id', companyId)
        .eq('status', 'suggested')
        .eq('matched_type', 'journal')
        .order('confidence', { ascending: false })
        .limit(40);

      let txnItems = [];
      if (journalMatches?.length) {
        // Best match per transaction (highest confidence)
        const bestMatch = {};
        for (const m of journalMatches) {
          if (!bestMatch[m.bank_transaction_id] || m.confidence > bestMatch[m.bank_transaction_id].confidence)
            bestMatch[m.bank_transaction_id] = m;
        }
        const btIds = Object.keys(bestMatch);

        // Fetch the bank rows + open AP/AR invoices in parallel
        const [{ data: bts }, { data: openAP }, { data: openAR }] = await Promise.all([
          supabase.from('bank_transactions')
            .select('id, date, description, amount')
            .in('id', btIds)
            .eq('company_id', companyId)
            .eq('reconciled', false), // safety guard: never show already-reconciled

          // Open AP bills: potential settlement candidates for outgoing txns
          supabase.from('ap_invoices')
            .select('id, invoice_ref, supplier, amount, gross_amount, amount_paid, invoice_date')
            .eq('company_id', companyId)
            .in('status', ['pending', 'approved', 'part_paid']),

          // Open AR invoices: potential settlement candidates for incoming txns
          supabase.from('invoices')
            .select('id, invoice_number, invoice_ref, client, total, amount, amount_paid, issue_date, invoice_date')
            .eq('company_id', companyId)
            .in('status', ['sent', 'part_paid']),
        ]);

        // Shape open invoices the same way the matching engine does
        const mapAP = x => { const tot = Number(x.gross_amount||x.amount||0); const outs = Math.max(0, tot - Number(x.amount_paid||0)); return { ...x, _type:'ap_invoice', _date:x.invoice_date, amount:tot, outstanding:outs }; };
        const mapAR = x => { const tot = Number(x.total||x.amount||0); const outs = Math.max(0, tot - Number(x.amount_paid||0)); return { ...x, _type:'invoice', _date:x.issue_date||x.invoice_date, amount:tot, outstanding:outs }; };
        const apCands = (openAP||[]).map(mapAP).filter(x => x.outstanding > 0.005);
        const arCands = (openAR||[]).map(mapAR).filter(x => x.outstanding > 0.005);

        // Fetch journal nominals for the suggestion chips
        const jIds = Object.values(bestMatch).map(m => m.matched_id).filter(Boolean);
        const { data: journals } = jIds.length
          ? await supabase.from('journals').select('id, debit_account, credit_account, vat_code').in('id', jIds)
          : { data: [] };
        const jMap = Object.fromEntries((journals || []).map(j => [j.id, j]));

        txnItems = (bts || [])
          .filter(bt => {
            // needsCategorisation: exclude any txn that strongly matches an open invoice
            // (settlement candidate → belongs in web settlement flow, not mobile categorise)
            const isIn  = Number(bt.amount) > 0;
            const isOut = Number(bt.amount) < 0;
            const cands = [...(isIn ? arCands : []), ...(isOut ? apCands : [])];
            return !cands.some(c => recScoreCandidate(bt, c) >= 60);
          })
          .map(bt => {
            const match = bestMatch[bt.id];
            const j     = jMap[match.matched_id];
            const isIn  = Number(bt.amount) >= 0;
            return {
              _type:           'bank_txn',
              id:              bt.id,
              matchId:         match.id,
              company_id:      companyId,
              description:     bt.description,
              subtitle:        fmtD(bt.date),
              amount:          bt.amount,
              suggestedNominal:(isIn ? j?.credit_account : j?.debit_account) ?? '6600',
              vatCode:         j?.vat_code ?? null,
              confidence:      match.confidence,
              nominalName:     '',
              _raw:            bt,
            };
          });
      }

      // ── 3. Fetch COA names for all suggested nominals ───────────────────────
      const apItems = (bills || []).map(b => ({
        _type:    'ap_bill',
        id:       b.id,
        company_id: b.company_id,
        description:      b.supplier,
        subtitle:         [b.invoice_ref, fmtD(b.invoice_date)].filter(Boolean).join(' · '),
        amount:           b.gross_amount ?? b.amount ?? 0,
        suggestedNominal: b.suggested_nominal ?? b.nominal_code ?? '6600',
        vatCode:          b.vat_code ?? 'STD23',
        confidence:       null,
        nominalName:      '',
        _raw:             b,
      }));

      const allCodes = [...new Set([...apItems, ...txnItems].map(i => i.suggestedNominal).filter(Boolean))];
      if (allCodes.length) {
        const { data: coa } = await supabase
          .from('chart_of_accounts')
          .select('code, name')
          .eq('company_id', companyId)
          .in('code', allCodes);
        const nameMap = Object.fromEntries((coa || []).map(a => [a.code, a.name]));
        apItems.forEach(i => { i.nominalName = nameMap[i.suggestedNominal] ?? ''; });
        txnItems.forEach(i => { i.nominalName = nameMap[i.suggestedNominal] ?? ''; });
      }

      setItems([...apItems, ...txnItems]);
    } catch (e) {
      setLoadErr(e.message ?? 'Load failed');
    }
    setLoading(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const handleApprove = async (item) => {
    setApproving(item.id);
    try {
      if (item._type === 'ap_bill') {
        await approveApBill(item._raw);
      } else {
        await confirmBankTxn(item.matchId, item.id);
      }
      setItems(prev => {
        const next = prev.filter(i => i.id !== item.id);
        if (next.length === 0 && prev.length > 0) setJustCleared(true);
        return next;
      });
    } catch (e) {
      console.error('[approvals] approve failed:', e.message);
    }
    setApproving(null);
  };

  // Defer to web — remove from local mobile view, no DB change
  const handleReview = (item) => {
    setItems(prev => prev.filter(i => i.id !== item.id));
  };

  const dateStr = new Date().toLocaleDateString('en-IE', { weekday:'long', day:'numeric', month:'short' });

  return (
    <div>
      <div className="m-page-hdr">
        <div className="m-company-name">Approvals</div>
        <div className="m-date-str">
          {loading ? 'Loading…' : items.length === 0 ? dateStr : `${items.length} item${items.length !== 1 ? 's' : ''} need your review`}
        </div>
      </div>

      {loadErr && (
        <div style={{ margin:'0 16px 12px', padding:'12px', background:'rgba(224,85,85,0.08)', border:'1px solid rgba(224,85,85,0.2)', borderRadius:10, fontSize:12, color:'var(--red)' }}>
          {loadErr}
        </div>
      )}

      {loading ? (
        <div className="m-empty">Loading queue…</div>
      ) : items.length === 0 ? (
        <>
          {/* Celebration / calm empty state */}
          <InboxZeroCelebration companyId={companyId} justCleared={justCleared} theme="dark" />
          {/* Receipt capture always accessible */}
          <div className="m-sec-title">Capture a Receipt</div>
          <ReceiptCapture companyId={companyId} user={user} />
        </>
      ) : (
        <>
          {items.map(item => (
            <ApprovalCard key={item.id} item={item} approving={approving}
              onApprove={() => handleApprove(item)} onReview={() => handleReview(item)} />
          ))}

          {/* Receipt capture below queue */}
          <div className="m-sec-title" style={{ marginTop:12 }}>Capture a Receipt</div>
          <ReceiptCapture companyId={companyId} user={user} />
        </>
      )}
    </div>
  );
}

// ─── Compliance tab ───────────────────────────────────────────────────────────
function ComplianceTab({ company }) {
  const [expanded, setExpanded] = useState(null);
  const today = new Date(); today.setHours(0,0,0,0);
  const deadlines = computeDeadlines(company);
  const diff   = d => Math.floor((d - today) / 86400000);
  const colour = d => { const n = diff(d); return n < 0 ? 'var(--red)' : n <= 7 ? 'var(--red)' : n <= 14 ? 'var(--gold)' : 'var(--teal2)'; };

  return (
    <div>
      <div className="m-page-hdr">
        <div className="m-company-name">Compliance</div>
        <div className="m-date-str">Tax · CRO · Revenue deadlines</div>
      </div>
      <div className="m-card">
        {deadlines.length === 0
          ? <div className="m-empty">No upcoming deadlines</div>
          : deadlines.slice(0, 12).map((dl, i) => {
            const d = diff(dl.due);
            const c = colour(dl.due);
            const isExp = expanded === i;
            return (
              <div key={i}>
                <div className="m-dl" style={{ cursor: 'pointer' }} onClick={() => setExpanded(isExp ? null : i)}>
                  <div className="m-dl-dot" style={{ background: c }} />
                  <div className="m-dl-type">{dl.type}</div>
                  <div className="m-dl-body">
                    <div className="m-dl-desc">{dl.desc}</div>
                    {isExp && <div className="m-dl-date" style={{ marginTop: 4 }}>Due: {dl.due.toLocaleDateString('en-IE',{day:'numeric',month:'long',year:'numeric'})}</div>}
                  </div>
                  <div className="m-dl-days" style={{ color: c }}>
                    {d < 0 ? `${Math.abs(d)}d` : d === 0 ? 'Today' : `${d}d`}
                  </div>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}

// ─── QuickInvoice tab ─────────────────────────────────────────────────────────
function QuickInvoiceTab({ companyId, company }) {
  const defaultVc = vatCodeForRate(company?.sales_vat_rate) || 'STD23';

  function mkBlank(vc) {
    return { _id: Math.random().toString(36).slice(2), description: '', quantity: 1, unit_price: '', vat_code: vc || 'STD23', line_total: 0, vat_amount: 0, gross_total: 0 };
  }

  // ── Data ──────────────────────────────────────────────────────────────────
  const [customers,   setCustomers]   = useState([]);
  const [invSettings, setInvSettings] = useState(null);
  const [loadingData, setLoadingData] = useState(true);

  // ── Form ──────────────────────────────────────────────────────────────────
  const [selectedCustId, setSelectedCustId] = useState('');
  const [addingCust,     setAddingCust]     = useState(false);
  const [newName,        setNewName]        = useState('');
  const [newEmail,       setNewEmail]       = useState('');
  const [custSaving,     setCustSaving]     = useState(false);
  const [lines,          setLines]          = useState([mkBlank('STD23')]);

  // ── Submission ────────────────────────────────────────────────────────────
  const [saving,       setSaving]       = useState(false);
  const [err,          setErr]          = useState(null);
  const [result,       setResult]       = useState(null); // { id, numStr } after finalise
  const [sending,      setSending]      = useState(false);
  const [sentTo,       setSentTo]       = useState(null);
  const [downloading,  setDownloading]  = useState(false);

  useEffect(() => {
    if (!companyId) return;
    Promise.all([
      supabase.from('customers').select('id,name,email').eq('company_id', companyId).eq('is_active', true).order('name'),
      supabase.from('invoice_settings').select('*').eq('company_id', companyId).maybeSingle(),
    ]).then(([custRes, setRes]) => {
      if (custRes.data) setCustomers(custRes.data);
      if (setRes.data)  setInvSettings(setRes.data);
      setLoadingData(false);
    });
  }, [companyId]);

  // ── Line helpers ──────────────────────────────────────────────────────────
  const updateLine = (idx, field, val) => setLines(prev => {
    const next = [...prev];
    next[idx] = calcLineAmounts({ ...next[idx], [field]: val });
    return next;
  });

  const computedLines = lines.map(l => calcLineAmounts(l));
  const totals = calcInvTotals(computedLines);
  const fmtE   = v => `€${Number(v || 0).toFixed(2)}`;

  // ── Add customer inline ───────────────────────────────────────────────────
  const addCustomer = async () => {
    if (!newName.trim()) return;
    setCustSaving(true);
    const { data, error } = await supabase.from('customers')
      .insert({ company_id: companyId, name: newName.trim(), email: newEmail.trim() || null, is_active: true })
      .select('id,name,email').single();
    if (!error && data) {
      setCustomers(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedCustId(data.id);
      setAddingCust(false); setNewName(''); setNewEmail('');
    }
    setCustSaving(false);
  };

  // ── Finalise ──────────────────────────────────────────────────────────────
  const canFinalise = !!selectedCustId && computedLines.some(l => l.description.trim()) && !saving;

  const handleFinalise = async () => {
    if (!canFinalise || !companyId) return;
    setSaving(true); setErr(null);
    try {
      const todayStr = new Date().toISOString().slice(0, 10);
      const currency = company?.base_currency || 'EUR';
      const inv = {
        type: 'invoice',
        customer_id: selectedCustId,
        issue_date: todayStr,
        payment_terms: Number(invSettings?.payment_terms ?? 30),
        credit_note_for: null,
        reference: null,
        notes: null,
      };
      // Step 1: create draft (finaliseInvoice requires inv.id)
      const draftId = await createInvoiceDraft(supabase, companyId, inv, computedLines, customers, invSettings, currency);
      // Step 2: claim number → upsert lines → post journals → stamp sent
      const { numStr } = await finaliseInvoice(supabase, companyId, { ...inv, id: draftId }, computedLines, customers, invSettings);
      setResult({ id: draftId, numStr });
    } catch (e) {
      setErr(e.message);
    }
    setSaving(false);
  };

  // ── Send / PDF ────────────────────────────────────────────────────────────
  const handleSend = async () => {
    if (!result) return;
    setSending(true); setErr(null);
    try {
      const r = await fetch('/api/send-invoice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_id: result.id, company_id: companyId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Send failed');
      setSentTo(d.to);
    } catch (e) { setErr(e.message); }
    setSending(false);
  };

  const handleDownload = async () => {
    if (!result) return;
    setDownloading(true); setErr(null);
    try {
      const r = await fetch('/api/invoice-pdf', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_id: result.id, company_id: companyId }),
      });
      if (!r.ok) throw new Error('PDF generation failed');
      const blob = await r.blob();
      const url  = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: `${result.numStr}.pdf` });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { setErr(e.message); }
    setDownloading(false);
  };

  const reset = () => {
    setResult(null); setSelectedCustId(''); setLines([mkBlank(defaultVc)]);
    setErr(null); setSentTo(null); setAddingCust(false); setNewName(''); setNewEmail('');
  };

  // ── Success screen ────────────────────────────────────────────────────────
  if (result) {
    const cust = customers.find(c => c.id === selectedCustId);
    return (
      <div>
        <div className="m-page-hdr">
          <div className="m-company-name">Invoice</div>
          <div className="m-date-str">Finalised · Journal posted</div>
        </div>

        <div className="qi-done-card">
          <div className="qi-done-num">{result.numStr}</div>
          <div className="qi-done-who">{cust?.name}</div>
          <div className="qi-done-sub">{fmtE(totals.total)} · DR 1100 / CR 4000</div>
        </div>

        {err    && <div className="qi-err">{err} <span style={{float:'right',cursor:'pointer'}} onClick={() => setErr(null)}>✕</span></div>}
        {sentTo && <div className="qi-ok">✓ Sent to {sentTo}</div>}

        <div className="m-form">
          {cust?.email && !sentTo ? (
            <button className="m-btn m-btn-p" onClick={handleSend} disabled={sending}>
              {sending ? 'Sending…' : `Email to ${cust.email}`}
            </button>
          ) : !cust?.email ? (
            <div style={{ padding:'10px 0', fontSize:13, color:'var(--mm)', textAlign:'center' }}>
              No email on file — add one in the web app to send
            </div>
          ) : null}
          <button className="m-btn m-btn-s" onClick={handleDownload} disabled={downloading}>
            {downloading ? 'Generating PDF…' : '↓  Download PDF'}
          </button>
          <button className="m-btn m-btn-s" style={{ marginTop: 8 }} onClick={reset}>
            + New Invoice
          </button>
        </div>
      </div>
    );
  }

  // ── Form ──────────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="m-page-hdr">
        <div className="m-company-name">Quick Invoice</div>
        <div className="m-date-str">{new Date().toLocaleDateString('en-IE', { day:'numeric', month:'long', year:'numeric' })}</div>
      </div>

      {err && <div className="qi-err" onClick={() => setErr(null)}>{err} ✕</div>}

      {/* Customer */}
      <div className="m-form">
        <div className="m-fgroup">
          <label className="m-flabel">Customer</label>
          {!addingCust ? (
            <div className="qi-cust-row">
              <select className="qi-cust-sel" value={selectedCustId}
                onChange={e => setSelectedCustId(e.target.value)} disabled={loadingData}>
                <option value="">{loadingData ? 'Loading…' : '— select customer —'}</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button className="qi-new-btn" onClick={() => setAddingCust(true)}>+ New</button>
            </div>
          ) : (
            <div className="m-card" style={{ margin: 0, marginBottom: 8 }}>
              <div className="m-fgroup">
                <label className="m-flabel">Name</label>
                <input className="m-finput" value={newName} onChange={e => setNewName(e.target.value)}
                  placeholder="Customer name" autoFocus />
              </div>
              <div className="m-fgroup" style={{ marginBottom: 12 }}>
                <label className="m-flabel">Email</label>
                <input className="m-finput" type="email" inputMode="email" value={newEmail}
                  onChange={e => setNewEmail(e.target.value)} placeholder="email@example.com" />
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button className="m-btn m-btn-p" style={{ flex:2, padding:'12px', fontSize:14, minHeight:46 }}
                  onClick={addCustomer} disabled={!newName.trim() || custSaving}>
                  {custSaving ? 'Saving…' : 'Add Customer'}
                </button>
                <button style={{ flex:1, padding:'12px', background:'var(--ms)', border:'1px solid var(--mbd)', borderRadius:'var(--rsm)', fontSize:13, color:'var(--mm)', cursor:'pointer', fontFamily:'Inter,system-ui,sans-serif', minHeight:46 }}
                  onClick={() => { setAddingCust(false); setNewName(''); setNewEmail(''); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Line items */}
      {lines.map((line, idx) => (
        <div key={line._id} className="qi-line-card">
          <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:9 }}>
            <input className="m-finput" style={{ flex:1 }} value={line.description}
              onChange={e => updateLine(idx, 'description', e.target.value)}
              placeholder={`Line ${idx + 1} description`} />
            {lines.length > 1 && (
              <button className="qi-line-del" onClick={() => setLines(prev => prev.filter((_, i) => i !== idx))}>✕</button>
            )}
          </div>
          <div className="m-frow" style={{ marginBottom: 9 }}>
            <div>
              <label className="m-flabel">Qty</label>
              <input className="m-finput" type="number" inputMode="decimal" min="0" step="any"
                value={line.quantity} onChange={e => updateLine(idx, 'quantity', e.target.value)} />
            </div>
            <div>
              <label className="m-flabel">Unit Price (€)</label>
              <input className="m-finput" type="number" inputMode="decimal" min="0" step="0.01"
                value={line.unit_price} onChange={e => updateLine(idx, 'unit_price', e.target.value)}
                placeholder="0.00" />
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <select className="m-fselect" style={{ flex:1 }} value={line.vat_code}
              onChange={e => updateLine(idx, 'vat_code', e.target.value)}>
              {Object.entries(INV_VAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <span className="qi-line-gross">{fmtE(line.gross_total)}</span>
          </div>
        </div>
      ))}

      <button className="qi-add-line" onClick={() => setLines(prev => [...prev, mkBlank(defaultVc)])}>
        + Add Line
      </button>

      {/* Running total */}
      <div className="qi-total-bar">
        <div>
          <div className="qi-total-lbl">Gross Total</div>
          {totals.vat_total > 0 && (
            <div className="qi-total-sub">incl. {fmtE(totals.vat_total)} VAT</div>
          )}
        </div>
        <div className="qi-total-val">{fmtE(totals.total)}</div>
      </div>

      <div className="m-form">
        <button className="m-btn m-btn-p" onClick={handleFinalise} disabled={!canFinalise}>
          {saving ? 'Finalising…' : 'Finalise Invoice'}
        </button>
        {!selectedCustId && (
          <div style={{ textAlign:'center', fontSize:12, color:'var(--mm)', marginTop:8 }}>Select a customer to continue</div>
        )}
      </div>
    </div>
  );
}

// ─── Ask AI tab ───────────────────────────────────────────────────────────────
function AskAiTab() {
  return (
    <div>
      <div className="m-page-hdr">
        <div className="m-company-name">Ask AI</div>
        <div className="m-date-str">Your finance assistant</div>
      </div>
      <div className="m-stub">
        <div className="m-stub-icon">✦</div>
        <div className="m-stub-title">Coming Next</div>
        <div className="m-stub-sub">Ask questions about your accounts, get VAT guidance, explain transactions, forecast cash flow, and more — your AI finance assistant is on the way.</div>
      </div>
    </div>
  );
}

// ─── Main Mobile component ────────────────────────────────────────────────────
export default function Mobile() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user }                 = useUser();
  const [tab, setTab]            = useState('home');
  const [companyId, setCompanyId] = useState(null);
  const [company, setCompany]    = useState(null);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(e => console.warn('[SW]', e));
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    supabase.from('companies').select('*').eq('clerk_user_id', user.id).limit(1)
      .then(({ data }) => { if (data?.[0]) { setCompanyId(data[0].id); setCompany(data[0]); } });
  }, [user]);

  if (!isLoaded) return (
    <>
      <style>{M_CSS}</style>
      <div className="m-loading">LOADING…</div>
    </>
  );

  if (!isSignedIn) return (
    <>
      <style>{M_CSS}</style>
      <MobileAuth />
    </>
  );

  return (
    <>
      <style>{M_CSS}</style>
      <div className="m-wrap">
        <div className="m-content">
          {tab === 'home'       && <HomeTab          companyId={companyId} company={company} setTab={setTab} />}
          {tab === 'approvals'  && <ApprovalsTab     companyId={companyId} user={user} />}
          {tab === 'cash'       && <CashTab          companyId={companyId} />}
          {tab === 'compliance' && <ComplianceTab    company={company} />}
          {tab === 'invoice'    && <QuickInvoiceTab  companyId={companyId} company={company} />}
        </div>
        <BottomNav tab={tab} setTab={setTab} />
      </div>
    </>
  );
}
