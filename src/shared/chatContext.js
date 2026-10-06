// Ledgrly AI chat — the live account-data context, system prompt, greeting and request, shared by
// the full app's chat panel and /mobile's Ask AI so both send the model the same prompt. Moved
// verbatim from App.jsx's Chat (only its props became parameters).
import { supabase } from '../supabase.js';
import { todayStr as localToday, monthEnd, localDateStr } from './dates.js';
import { fetchActiveBankNominals, fetchNominalBalanceAsOf, BANK_NOMINAL_CODE } from './bankBalance.js';
import { fetchAllRows } from './fetchAllRows.js';
import { MONTH_NAMES_LONG, getVATPeriods, defaultVatPeriod, fetchVat3PeriodData, computeVat3, isPeriodLocked } from './vat3.js';
import { applicableDeadlines, isCurrentDeadline, daysFromToday } from './computeDeadlines.js';
import { fetchInvoiceDocs, overdueInvoices, dueSoonInvoices } from './invoice.js';
import { GL_ACCOUNTS } from './chartOfAccounts.js';
import { fmtCurrencyFull } from './currency.js';

export const CHAT_SUGGESTIONS = ["Will I have enough cash for payroll?", "What journals should I post at month end?", "What's net profit vs budget?", "Which invoices are most at risk?"];

// The LIVE ACCOUNT DATA block for the selected period (selPeriod = 'YYYY-MM', period = its label).
export async function buildChatContext({ companyId, company, companyName, period, selPeriod }) {
  let ctx = "";
  try {
    if (companyId) {
      const db = supabase;
      const today  = localToday();

      // Derive period bounds from YYYY-MM selPeriod
      const sp = selPeriod || (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`; })();
      const [pYear, pMonth] = sp.split('-').map(Number);
      const periodStart = `${sp}-01`;
      const periodEnd   = monthEnd(pYear, pMonth);

      // Trailing 12 months range for monthly summary
      const trail12Start = (() => {
        const d = new Date(pYear, pMonth - 13, 1);
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
      })();

      const [btLatest, invoiceDocs, periodJournals, trail12Journals, lockedRes] = await Promise.all([
        // Bank balance = ledger balance of the active bank nominals at period end (the same source
        // as Overview / Practice Dashboard). Was bank_transactions.balance of the latest row, which
        // the live feed never populates — so the AI was told €0.00.
        fetchActiveBankNominals(companyId).then(codes => fetchNominalBalanceAsOf(companyId, codes.length ? codes : [BANK_NOMINAL_CODE], periodEnd)).catch(() => null),
        // Invoices — status from the Invoices page's rule (src/shared/invoice.js), as Home and the
        // Invoices tab use. Was every non-'paid' row past due_date (drafts, voids and credited
        // counted; the legacy `amount`; due_date_calc ignored) and only pending/chased as upcoming.
        fetchInvoiceDocs(db, companyId).catch(() => null),
        db.from('journals').select('debit_account,credit_account,amount,date,description,reference').eq('company_id', companyId).gte('date', periodStart).lte('date', periodEnd).order('date'),
        fetchAllRows(() => db.from('journals').select('debit_account,credit_account,amount,date').eq('company_id', companyId).gte('date', trail12Start).lte('date', periodEnd).order('date').order('id')),
        // Filed VAT periods — get_locked_periods, readable by every role (vat_returns isn't).
        db.rpc('get_locked_periods', { p_company_id: companyId }),
      ]);

      const currentBal = btLatest ?? null;
      const overdueList  = invoiceDocs ? overdueInvoices(invoiceDocs) : [];
      const dueSoonList  = invoiceDocs ? dueSoonInvoices(invoiceDocs, new Date(), 30) : [];
      const overdueAmt = overdueList.reduce((s, i) => s + i.owed, 0);
      const overdueN   = overdueList.length;
      const upcomingAmt= dueSoonList.reduce((s, i) => s + i.owed, 0);
      const upcomingN  = dueSoonList.length;
      const locked     = lockedRes.error ? null : (lockedRes.data || []);
      const yem        = company?.year_end_month ? MONTH_NAMES_LONG[company.year_end_month - 1] : "December";
      const vatPeriod  = company?.vat_period === 'monthly' ? 'Monthly' : 'Bi-monthly';
      // baseCurrency was never declared in Chat (lost in 61a88b8, 2026-06-27): every fmtE call threw,
      // the catch below swallowed it, and the AI silently got "live account data could not be loaded"
      // instead of the company figures on every chat since then.
      const baseCurrency = company?.base_currency || company?.currency || "EUR";
      const fmtE = n => fmtCurrencyFull(n, baseCurrency);

      // Build trailing-12-month monthly summary from journals
      const monthMap = {};
      for (const j of (trail12Journals.data || [])) {
        const mo = j.date.slice(0, 7); // YYYY-MM
        if (!monthMap[mo]) monthMap[mo] = { income: 0, expenses: 0, byAcct: {} };
        const amt = Math.abs(Number(j.amount));
        if (j.credit_account >= '4000' && j.credit_account < '5000') monthMap[mo].income += amt;
        if (j.debit_account  >= '5000' && j.debit_account  < '7000') {
          monthMap[mo].expenses += amt;
          monthMap[mo].byAcct[j.debit_account] = (monthMap[mo].byAcct[j.debit_account] || 0) + amt;
        }
      }
      const months12 = Object.entries(monthMap).sort(([a], [b]) => a.localeCompare(b));
      const chatAcctName = code => GL_ACCOUNTS.find(a => a.code === code)?.name || code;
      const monthly12Table = months12.length > 0
        ? months12.map(([mo, v]) => {
            const top5 = Object.entries(v.byAcct).sort(([,x],[,y]) => y - x).slice(0, 5)
              .map(([acct, total]) => `    ${acct} ${chatAcctName(acct)}: ${fmtE(total)}`).join('\n');
            return `  ${mo}: income ${fmtE(v.income)}, expenses ${fmtE(v.expenses)}, profit before tax ${fmtE(v.income - v.expenses)}${top5 ? '\n  top expense accounts:\n' + top5 : ''}`;
          }).join('\n')
        : "  No journal data in trailing 12 months";

      // Period journal detail
      const pJnls = periodJournals.data || [];
      const pIncome   = pJnls.filter(j => j.credit_account >= '4000' && j.credit_account < '5000').reduce((s, j) => s + Math.abs(Number(j.amount)), 0);
      const pExpenses = pJnls.filter(j => j.debit_account  >= '5000' && j.debit_account  < '7000').reduce((s, j) => s + Math.abs(Number(j.amount)), 0);
      const pJnlDetail = pJnls.length > 0
        ? pJnls.slice(0, 30).map(j => `  ${j.date} | DR:${j.debit_account} CR:${j.credit_account} | ${fmtE(j.amount)} | ${j.description || j.reference || ''}`).join('\n')
        : "  No journals posted for this period";

      // Deadlines that apply (ROS-aware, filed VAT periods excluded) — the Compliance tab's list.
      const ymd = d => localDateStr(d);
      const inDays = n => (n < 0 ? `${-n} day${n === -1 ? '' : 's'} overdue — return not filed` : n === 0 ? 'due today' : `in ${n} day${n === 1 ? '' : 's'}`);
      const deadlineLines = !locked ? '  Deadline data unavailable'
        : (applicableDeadlines(company, locked).filter(isCurrentDeadline).slice(0, 8)
            .map(dl => `  - ${dl.desc.startsWith(dl.type) ? dl.desc : `${dl.type} ${dl.desc}`}: due ${ymd(dl.due)} — ${inDays(daysFromToday(dl.due))}`)
            .join('\n') || '  None in the coming months');
      const rosNote = company?.ros_efiler ? 'yes — VAT3 and P30 are due the 23rd' : 'no — VAT3 is due the 19th, P30 the 14th';

      // The VAT return due now — the mobile VAT card's period and figures (src/shared/vat3.js).
      let vatBlock = '';
      if (!company?.vat_registered) {
        vatBlock = 'VAT: not VAT-registered — no VAT3 returns.';
      } else if (locked) {
        const vp = defaultVatPeriod(getVATPeriods(company.vat_period || 'bimonthly', company.ros_efiler || false), locked, today);
        const [vd, reqRes] = vp ? await Promise.all([
          fetchVat3PeriodData(companyId, vp).catch(() => null),
          db.from('vat_filing_requests').select('status, requested_at').eq('company_id', companyId).eq('period_val', vp.val)
            .order('requested_at', { ascending: false }).limit(1),
        ]) : [null, null];
        if (vp && vd) {
          const v = computeVat3(vd.journals, { paCustomsValue: '0', paVatAmount: '0', adjT1: '', adjT2: '' });
          const req = reqRes?.data?.[0];
          const state = isPeriodLocked(vp, locked) ? 'filed'
            : `not filed${req?.status === 'pending' ? `; filing requested by the client on ${String(req.requested_at).slice(0, 10)}, awaiting the accountant` : ''}`;
          const blockers = vd.pendingBills.length + vd.unreconciledBt.length;
          vatBlock = `VAT RETURN — ${vp.label} (${vp.start} → ${vp.end}, due ${vp.due}, ${state}):
  T1 VAT on sales ${fmtE(v.t1Final)} | T2 VAT on purchases ${fmtE(v.t2Final)} | T3 payable ${fmtE(v.t3Final)} | T4 repayable ${fmtE(v.t4Final)}
  ${v.t1DrillRows.length} sales / ${v.t2DrillRows.length} purchase journals with a VAT code; ${v.codeExceptions.length} journals on VAT nominals with no VAT code (may affect T1/T2); ${v.rcExceptions.length} reverse-charge items (declared separately on ROS)
  ${blockers ? `Blocking filing: ${vd.pendingBills.length} bills awaiting review, ${vd.unreconciledBt.length} unreconciled bank lines` : 'Nothing blocking filing'}`;
        } else {
          vatBlock = 'VAT return data unavailable.';
        }
      }

      ctx = `
LIVE ACCOUNT DATA for ${companyName} (as of ${today}):

SELECTED PERIOD: ${period} (${periodStart} → ${periodEnd})
- Bank balance at period end: ${currentBal !== null ? fmtE(currentBal) : "No bank data imported yet"}
- Period income (4xxx credit journals): ${fmtE(pIncome)}
- Period expenses (5xxx-6xxx debit journals): ${fmtE(pExpenses)}
- Period profit before tax (income less 5xxx-6xxx expenses; corporation tax on 8000 is not included): ${fmtE(pIncome - pExpenses)}
- Overdue invoices (AR): ${overdueN} invoice${overdueN !== 1 ? 's' : ''} totalling ${fmtE(overdueAmt)}
- Invoices due in next 30 days: ${upcomingN} invoice${upcomingN !== 1 ? 's' : ''} totalling ${fmtE(upcomingAmt)}
- Company: ${companyName} | VAT period: ${vatPeriod} | Accounting year end: ${yem}

DEADLINES (ROS e-filer: ${rosNote}):
${deadlineLines}

${vatBlock}

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
  return ctx;
}

export function buildChatSystemPrompt({ companyName, ctx, page }) {
  return `You are Ledgrly AI — a concise Irish SME finance assistant built into Ledgrly. You are helping the team at ${companyName}.

${ctx}

You can also help with:
- Irish accounting questions (double-entry, nominal accounts, chart of accounts)
- VAT — VAT3 returns, VAT rates, ROS filing, thresholds
- Payroll compliance — P30, PAYE/PRSI/USC, Revenue Commissioners
- CRO filings — annual returns, B1
- Corporation Tax — CT1, preliminary tax, deadlines
- Journal entries — accruals, prepayments, depreciation

RULES: Max 2–3 sentences per reply unless the user asks for detail. Be direct and practical. Use Irish accounting terminology (ROS, CRO, CT1, P30, VAT3, Revenue). Current page: ${page}.`;
}

export const chatGreeting = period => `Good morning. I'm Ledgrly AI — your Irish finance assistant. I've loaded your account data for ${period}. What do you need?`;

// Sends the conversation to /api/chat (the model is fixed server-side). Returns the assistant's
// reply text — or an "Error: …" / "Connection error: …" line, as the panel has always shown.
// history = [{ role: 'user'|'assistant', text }].
export async function sendChatMessage({ companyId, systemPrompt, history, msg }) {
  try {
    const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json", 'Authorization': `Bearer ${await window.Clerk?.session?.getToken()}` },
      body: JSON.stringify({ company_id: companyId, max_tokens: 1000, // model is fixed server-side
        system: systemPrompt,
        messages: [...history.map(m => ({ role: m.role, content: m.text })), { role: "user", content: msg }] }) });
    const data = await res.json();
    if (!res.ok) return `Error: ${data.error || "Unable to reach AI. Please try again."}`;
    // The first text block, not content[0] — a reply can lead with a thinking block (api/_anthropic.js).
    return data.content?.find?.(b => b?.type === 'text')?.text || "No response received.";
  } catch (e) { return `Connection error: ${e.message}`; }
}

// 'YYYY-MM' → 'September 2026' — the period label the full app passes its chat panel.
export const chatPeriodLabel = selPeriod => {
  const [y, m] = selPeriod.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IE", { month: "long", year: "numeric" });
};
