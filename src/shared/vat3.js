// VAT3 return — the period list, the figures (T1–T4, adjustments, drill-down and exception
// rows), the filing blockers and the filing snapshot. Moved verbatim from App.jsx's VATReturns
// (only closure state became parameters) so the full app and /mobile compute a return the same
// way. Shared by VATReturns (desktop) and mobile's Request Filing.
import { supabase } from '../supabase.js';
import { monthStart, monthEnd } from './dates.js';
import { fetchAllRows } from './fetchAllRows.js';

export const MONTH_NAMES_LONG  = ["January","February","March","April","May","June","July","August","September","October","November","December"];
export const MONTH_NAMES_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Irish VAT rates used in back-calculation (amounts are VAT-inclusive from bank imports)
export const VAT_RATES = { STD23: 23, RED13: 13.5, RED9: 9 };
// Returns { vat, net } from a gross VAT-inclusive amount
export function calcJournalVAT(amount, vatCode) {
  const rate = VAT_RATES[vatCode];
  if (!rate) return { vat: 0, net: Math.abs(Number(amount)) };
  const abs = Math.abs(Number(amount));
  const vat = abs * rate / (100 + rate);
  return { vat, net: abs - vat };
}

// Revenue due days — the one rule every deadline list and VAT screen uses (companies.ros_efiler).
// Filing and paying through ROS extends both the VAT3 and the P30 deadline to the 23rd of the
// month after the period; otherwise VAT3 is due the 19th and P30 the 14th.
export const vatDueDay = rosEfiler => (rosEfiler ? 23 : 19);
export const p30DueDay = rosEfiler => (rosEfiler ? 23 : 14);

export function getVATPeriods(vatPeriodType, rosEfiler = false) {
  const dueDay = vatDueDay(rosEfiler);
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
        start: monthStart(y, m + 1),
        end:   monthEnd(y, m + 1),
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
        start: monthStart(y, sm + 1),
        end:   monthEnd(y, em + 1),
        due:   new Date(dy, dm % 12, dueDay).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" }),
      });
    }
  }
  return periods;
}

// Loads everything a VAT3 period needs: its journals (every page), the hard blockers (bills
// awaiting review, unreconciled bank lines), the warnings (submitted expenses, draft sales
// invoices) and the invoice-level VAT detail (one row per sales invoice × rate, one per bill).
export async function fetchVat3PeriodData(companyId, vatPeriod, db = supabase) {
  const out = {};
  const [jRes, apRes, btRes, expRes, arRes, arInvRes, apInvRes] = await Promise.all([
    // Every page, not just the first 1,000 rows (PostgREST's silent cap): a period with more
    // journals than that would otherwise under-report T1/T2. id breaks date ties so pages
    // never overlap or skip.
    fetchAllRows(() => db.from('journals')
      .select('id, date, description, reference, debit_account, credit_account, amount, vat_code')
      .eq('company_id', companyId)
      .gte('date', vatPeriod.start)
      .lte('date', vatPeriod.end)
      .order('date').order('id')),
    // Hard block: not yet journalled, so not yet counted in T1-T4. 'pending' is excluded —
    // those bills are already approved/journalled and correctly counted; only needs_review
    // means the figures above don't yet reflect this bill.
    db.from('ap_invoices')
      .select('id, supplier, invoice_ref, invoice_date, amount, status')
      .eq('company_id', companyId)
      .eq('status', 'needs_review')
      .gte('invoice_date', vatPeriod.start)
      .lte('invoice_date', vatPeriod.end),
    db.from('bank_transactions')
      .select('id, date, description, amount, settlement_type')
      .eq('company_id', companyId)
      .eq('reconciled', false)
      .gte('date', vatPeriod.start)
      .lte('date', vatPeriod.end),
    // Warning only, not a hard block — filing can proceed; these just won't be reflected
    // in this return's figures until approved (which posts the journal).
    db.from('expenses')
      .select('id, supplier, description, receipt_date, amount, status')
      .eq('company_id', companyId)
      .eq('status', 'submitted')
      .gte('receipt_date', vatPeriod.start)
      .lte('receipt_date', vatPeriod.end),
    db.from('invoices')
      .select('id, invoice_number, client, issue_date')
      .eq('company_id', companyId)
      .eq('status', 'draft')
      .gte('issue_date', vatPeriod.start)
      .lte('issue_date', vatPeriod.end),
    // Full sales invoice list for the invoice-level VAT detail report — issued docs
    // only (drafts/void excluded); credit notes included (shown/summed as negative).
    db.from('invoices')
      .select('id, invoice_number, invoice_ref, client, type, issue_date')
      .eq('company_id', companyId)
      .neq('status', 'draft').neq('status', 'void')
      .gte('issue_date', vatPeriod.start)
      .lte('issue_date', vatPeriod.end)
      .order('issue_date'),
    // Purchase invoice list for the same report — excludes needs_review/rejected,
    // which aren't confirmed bills yet (mirrors the aged-creditors/supplier-spend filter).
    db.from('ap_invoices')
      .select('id, invoice_ref, supplier, invoice_date, vat_code, net_amount, vat_amount, gross_amount, amount')
      .eq('company_id', companyId)
      .neq('status', 'needs_review').neq('status', 'rejected')
      .gte('invoice_date', vatPeriod.start)
      .lte('invoice_date', vatPeriod.end)
      .order('invoice_date'),
  ]);
  out.journals = jRes.data || [];
  out.pendingBills = apRes.data || [];
  out.unreconciledBt = btRes.data || [];
  out.pendingExpenses = expRes.data || [];
  out.draftArInvoices = arRes.data || [];

  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

  // AR: group invoice_lines by (invoice, vat_code) so a multi-rate invoice shows one
  // row per rate — the same breakdown Revenue expects on a VAT return backup schedule.
  const arInvoices = arInvRes.data || [];
  let lineRows = [];
  if (arInvoices.length) {
    const { data: lines } = await db.from('invoice_lines')
      .select('invoice_id, vat_code, line_total, vat_amount, gross_total')
      .in('invoice_id', arInvoices.map(i => i.id));
    lineRows = lines || [];
  }
  const arGroups = {};
  lineRows.forEach(l => {
    const key = `${l.invoice_id}::${l.vat_code || 'NONE'}`;
    if (!arGroups[key]) arGroups[key] = { invoice: arInvoices.find(i => i.id === l.invoice_id), vat_code: l.vat_code, net: 0, vat: 0, gross: 0 };
    arGroups[key].net   += Number(l.line_total)  || 0;
    arGroups[key].vat   += Number(l.vat_amount)  || 0;
    arGroups[key].gross += Number(l.gross_total) || 0;
  });
  const arRows = Object.values(arGroups)
    .filter(g => g.invoice)
    .map(g => {
      const isCN = g.invoice.type === 'credit_note';
      const sign = isCN ? -1 : 1;
      return {
        id: `${g.invoice.id}-${g.vat_code || 'NONE'}`,
        date: g.invoice.issue_date,
        ref: g.invoice.invoice_number || g.invoice.invoice_ref || '—',
        party: g.invoice.client || '—',
        isCN,
        vat_code: g.vat_code || 'NONE',
        net: sign * r2(g.net), vat: sign * r2(g.vat), gross: sign * r2(g.gross),
      };
    })
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  out.arDetail = arRows;

  // AP: each bill carries a single vat_code (see APInvoices form) — one row per invoice.
  const apRows = (apInvRes.data || []).map(inv => {
    const gross = Number(inv.gross_amount ?? inv.amount ?? 0);
    const vat   = Number(inv.vat_amount ?? 0);
    const net   = inv.net_amount != null ? Number(inv.net_amount) : (gross - vat);
    return {
      id: inv.id, date: inv.invoice_date,
      ref: inv.invoice_ref || '—', party: inv.supplier || '—',
      vat_code: inv.vat_code || 'NONE',
      net: r2(net), vat: r2(vat), gross: r2(gross),
    };
  }).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  out.apDetail = apRows;
  return out;
}

// T1–T4 from the period's journals (VAT-inclusive amounts, back-calculated by rate), plus
// Postponed Accounting and review-stage T1/T2 adjustments; drill-down and exception rows.
export function computeVat3(journals, { paCustomsValue, paVatAmount, adjT1, adjT2 }) {
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

  // Postponed Accounting — manually entered, not journal/vat_code-derived (see EU fields above
  // for the same reasoning: there's no cash leg to tag a code onto, since the whole point of the
  // scheme is that no VAT is paid to Revenue at the point of import). paCustomsValue populates
  // PA1 directly. paVatAmount is added to BOTH t1 and t2 here, before t3/t4 are derived — the
  // real self-accounting mechanic (declared as due and reclaimed in the same period), which
  // nets to zero effect on t3/t4 for a fully-taxable trader and only shows up in t3/t4 if input
  // VAT recovery is restricted.
  const pa1 = parseFloat(paCustomsValue) || 0;
  const paVat = parseFloat(paVatAmount) || 0;
  t1 += paVat;
  t2 += paVat;

  const t3 = Math.max(0, t1 - t2);
  const t4 = Math.max(0, t2 - t1);

  // Review-stage adjustment values
  const adjT1Num = parseFloat(adjT1) || 0;
  const adjT2Num = parseFloat(adjT2) || 0;
  const t1Final  = Math.round((t1 + adjT1Num) * 100) / 100;
  const t2Final  = Math.round((t2 + adjT2Num) * 100) / 100;
  const t3Final  = Math.max(0, t1Final - t2Final);
  const t4Final  = Math.max(0, t2Final - t1Final);
  const hasAdjT1 = adjT1Num !== 0;
  const hasAdjT2 = adjT2Num !== 0;

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
  return {
    salesJournals, purchaseJournals, t1, t2, pa1, paVat, t3, t4,
    adjT1Num, adjT2Num, t1Final, t2Final, t3Final, t4Final, hasAdjT1, hasAdjT2,
    t1DrillRows, t2DrillRows, rcExceptions, codeExceptions,
  };
}

// Filing blockers: bills awaiting review and unreconciled bank lines block filing and a
// business_owner's filing request (request_vat_filing checks the same two server-side).
export function vat3Blockers({ pendingBills, unreconciledBt, isLocked, isBizLocked, existingRequest }) {
  const hardBlockCount = pendingBills.length + unreconciledBt.length;
  const canFile = !isLocked && hardBlockCount === 0;
  const hasPendingRequest = existingRequest?.status === 'pending';
  const canRequest = !isBizLocked && hardBlockCount === 0 && !hasPendingRequest;
  return { hardBlockCount, canFile, hasPendingRequest, canRequest };
}

// The figures snapshot stored by Mark as Filed (vat_returns.figures) and Request Filing
// (vat_filing_requests.figures) — computed, adjustments with their comments, final, E1–ES2, PA.
export function buildFilingFigures({ t1, t2, t3, t4, pa1, paVat, adjT1Num, adjT2Num, hasAdjT1, hasAdjT2,
  t1Final, t2Final, t3Final, t4Final, adjT1Comment, adjT2Comment, e1, e2, es1, es2 }) {
  const round2 = n => Math.round(n * 100) / 100;
  const adjustments = [];
  if (hasAdjT1) adjustments.push({ box: 'T1', computed: round2(t1), delta: round2(adjT1Num), final: t1Final, comment: adjT1Comment.trim(), ts: new Date().toISOString() });
  if (hasAdjT2) adjustments.push({ box: 'T2', computed: round2(t2), delta: round2(adjT2Num), final: t2Final, comment: adjT2Comment.trim(), ts: new Date().toISOString() });
  const figures = {
    computed: { t1: round2(t1), t2: round2(t2), t3: round2(t3), t4: round2(t4), pa1: round2(pa1) },
    adjustments,
    final: { t1: t1Final, t2: t2Final, t3: t3Final, t4: t4Final },
    e1: Number(e1)||0, e2: Number(e2)||0, es1: Number(es1)||0, es2: Number(es2)||0,
    paVat: round2(paVat),
  };
  return figures;
}

// Is this VAT period filed? `lockedPeriods` are get_locked_periods rows ({ period_start,
// period_end }) — the RPC a business_owner must use, since vat_returns SELECT is
// accountant-only. Same test as desktop VATReturns' isDateLocked(vatPeriod.start, …).
export function isPeriodLocked(vatPeriod, lockedPeriods) {
  return !!vatPeriod && (lockedPeriods || []).some(p => vatPeriod.start >= p.period_start && vatPeriod.start <= p.period_end);
}

// The period a return is due for: the latest that has ended and isn't filed, else the current
// one (the desktop screen's default). periods = getVATPeriods(…) (newest first), today = 'YYYY-MM-DD'.
export function defaultVatPeriod(periods, lockedPeriods, today) {
  return periods.find(p => p.end < today && !isPeriodLocked(p, lockedPeriods)) || periods[0] || null;
}
