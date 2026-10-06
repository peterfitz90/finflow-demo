// FRS 105 statement figures — the calculation moved verbatim out of App.jsx's
// FinancialStatements (STA-01 Stage 1), copied by marker, not retyped. Pure: no React and no
// Supabase import, so the on-screen statements, server code and node scripts share one engine.
//
// Mode 'legacy' reproduces the committed behaviour exactly, including the balance sheet's
// balancing figure: "Profit and loss account" = total assets less current liabilities minus
// share capital, which absorbs any balance outside the mapped code ranges. It must never change.
// Mode 'schedule3b' (STA-01 Stage 2) maps every nominal to a Schedule 3B line with no balancing
// figure (see schedule3b.js); it needs the company's chart of accounts.
// scripts/frs105-regression.mjs proves this file matches the pre-extraction code to the cent.
import { GL_ACCOUNTS } from '../glAccounts.js';
import { fetchAllRows } from '../fetchAllRows.js';
import { monthEnd } from '../dates.js';
import { computeSchedule3b } from './schedule3b.js';

export const FRS105_MODES = ['legacy', 'schedule3b'];

// Every journal up to and including yearEnd (inception-to-date), paged past PostgREST's
// 1,000-row cap with id as the unique tiebreaker. `db` is a supabase-js client.
export function fetchJournalsToDate(db, companyId, yearEnd) {
  return fetchAllRows(() => db.from('journals')
      .select('*').eq('company_id', companyId).lte('date', yearEnd).order('date').order('id'));
}

// The company's own chart of accounts, which the schedule3b mode maps from.
export function fetchChartForStatements(db, companyId) {
  return db.from('chart_of_accounts').select('code, name, account_type, category').eq('company_id', companyId);
}

// Fiscal year bounds for the selected year end (yearEnd is always the last day of yeMonth).
export function frs105FiscalYear(yearEnd, yeMonth) {
  // Fiscal year start for the SELECTED yearEnd — same yearStartMonth logic GLReport's ytdStart
  // uses, just anchored to the chosen year-end's own month instead of "today"'s selected period.
  // yearEnd is always the last day of yeMonth (by construction in yearEndOptions above), so this
  // never hits a day-overflow edge case the way subtracting a literal year from the date would.
  const [yeSelYear] = yearEnd ? yearEnd.split('-').map(Number) : [null];
  const yearStartMonth = (yeMonth % 12) + 1;
  const fyStartYear = yeSelYear != null ? (yeMonth >= yearStartMonth ? yeSelYear : yeSelYear - 1) : null;
  const fyStart = fyStartYear != null ? `${fyStartYear}-${String(yearStartMonth).padStart(2, '0')}-01` : null;
  return { yeSelYear, yearStartMonth, fyStartYear, fyStart };
}

export function computeFrs105(journals, { yearEnd, yeMonth, mode = 'legacy', chart = [] }) {
  if (!FRS105_MODES.includes(mode)) throw new Error(`Unknown FRS 105 mode: ${mode}`);
  if (mode === 'schedule3b') {
    // The legacy result supplies the per-code totals the guard uses; its figures are not shown.
    const legacy = computeFrs105(journals, { yearEnd, yeMonth, mode: 'legacy' });
    return {
      mode, fyStart: legacy.fyStart, rawD: legacy.rawD, rawC: legacy.rawC, allCodes: legacy.allCodes, legacy,
      ...computeSchedule3b(journals, { fyStart: legacy.fyStart, yearEnd, chart }),
    };
  }
  const { fyStart } = frs105FiscalYear(yearEnd, yeMonth);

  // Balance sheet accounts are cumulative from inception — unchanged, correct as before.
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

  // P&L accounts must be bound to the fiscal year, not cumulative — this app never posts
  // automatic year-end closing journals, so income/expense balances otherwise accumulate
  // indefinitely across every year a company has traded. Filtering the already-fetched
  // cumulative set (rather than a second query) since it's already a superset.
  const pnlJournals = fyStart ? journals.filter(j => j.date >= fyStart) : [];
  const pnlRawD = {}, pnlRawC = {};
  pnlJournals.forEach(j => {
    const a = Number(j.amount);
    pnlRawD[j.debit_account]  = (pnlRawD[j.debit_account]  || 0) + a;
    pnlRawC[j.credit_account] = (pnlRawC[j.credit_account] || 0) + a;
  });
  const pnlCodes = [...new Set([...Object.keys(pnlRawD), ...Object.keys(pnlRawC)])];
  const pnlAcctBal = code => {
    const d = pnlRawD[code] || 0, c = pnlRawC[code] || 0;
    const t = GL_ACCOUNTS.find(a => a.code === code)?.type || '';
    return (t === 'Liability' || t === 'Equity' || t === 'Income') ? c - d : d - c;
  };
  const pnlSumRng = (f, t) => pnlCodes.filter(c => c >= f && c <= t).reduce((s, c) => s + pnlAcctBal(c), 0);

  // P&L figures
  const turnover    = pnlSumRng("4000", "4999");
  const cos         = pnlSumRng("5000", "5999");
  const grossProfit = turnover - cos;
  const adminExp    = pnlSumRng("6000", "6999");
  const opProfit    = grossProfit - adminExp;
  const interest    = pnlCodes.filter(c => c >= "7000" && c <= "7999")
    .reduce((s, c) => s + ((pnlRawC[c] || 0) - (pnlRawD[c] || 0)), 0);
  const pbt     = opProfit + interest;
  const pfYear  = pbt;

  return {
    fyStart,
    rawD, rawC, allCodes, acctBal, sumRng, fixedAssets, debtors, cashAtBank, currAssets, creditors, netCurrAssets, totAssetsLCL, shareCapital, retainedEarns, pnlJournals, pnlRawD, pnlRawC, pnlCodes, pnlAcctBal, pnlSumRng, turnover, cos, grossProfit, adminExp, opProfit, interest, pbt, pfYear,
  };
}

// ── Interim guard (STA-01): warnings only, never blocks generation ─────────────────────────
// The legacy statements put these code ranges on balance sheet lines and 4000–7999 on the P&L.
// Any other balance is silently included in "Profit and loss account" (the balancing figure).
// Same string comparison as the engine's sumRng, so "mapped" here means exactly what the
// engine maps.
export const FRS105_LEGACY_BS_RANGES = [['1000', '1099'], ['1100', '1299'], ['1500', '1599'], ['2000', '2399'], ['3000', '3099']];
export const FRS105_LEGACY_PNL_RANGES = [['4000', '4999'], ['5000', '5999'], ['6000', '6999'], ['7000', '7999']];
const inAnyRange = (code, ranges) => ranges.some(([f, t]) => code >= f && code <= t);
const round2 = n => Math.round(n * 100) / 100;
const glName = code => GL_ACCOUNTS.find(a => a.code === code)?.name || null;

// journals: every journal up to the year end (fetchJournalsToDate). result: computeFrs105's
// output for the same journals. bankCodes: the company's active bank nominals (fallback 1000).
// yearEnd: the statements' year end. Balances are debit minus credit, the same sum nominal_balance_as_of returns. Every rule works
// on this one paginated journal set: no further queries, none per month.
// Each warning has severity 'warn', except 'liability_debit', which is 'info'.
export function frs105Warnings(journals, result, { bankCodes = ['1000'], yearEnd = null, ledgerCompleteFrom = null } = {}) {
  const warnings = [];
  const debitNet = code => round2((result.rawD[code] || 0) - (result.rawC[code] || 0));

  // (a) schedule3b: balances that could not be placed on a line, and any imbalance they cause
  if (result.mode === 'schedule3b') {
    if (result.unmapped.length) warnings.push({ id: 'unmapped', items: result.unmapped });
    if (Math.abs(result.imbalance) >= 0.005) warnings.push({ id: 'imbalance', amount: result.imbalance });
  }

  // (a) legacy: balances the balancing figure absorbs
  const absorbed = result.mode === 'schedule3b' ? [] : result.allCodes
    .filter(c => !inAnyRange(c, FRS105_LEGACY_BS_RANGES) && !inAnyRange(c, FRS105_LEGACY_PNL_RANGES))
    .map(c => ({ code: c, name: glName(c), debitNet: debitNet(c) }))
    .filter(x => Math.abs(x.debitNet) >= 0.005)
    .sort((x, y) => (x.code < y.code ? -1 : 1));
  if (absorbed.length) warnings.push({ id: 'absorbed', items: absorbed });

  // (b) no opening position: no OPENING journal, and the ledger starts after the period start.
  // Satisfied when the company's ledger_complete_from is on or before the period start.
  if (result.fyStart && !(ledgerCompleteFrom && ledgerCompleteFrom <= result.fyStart)) {
    const hasOpening = journals.some(j => j.reference === 'OPENING');
    const firstJournal = journals.reduce((min, j) => (min === null || j.date < min ? j.date : min), null);
    if (!hasOpening && (firstJournal === null || firstJournal > result.fyStart)) {
      warnings.push({ id: 'no_opening', firstJournal, periodStart: result.fyStart });
    }
  }

  // (c) a bank nominal below zero at the year end
  const negative = [...new Set(bankCodes)]
    .map(c => ({ code: c, name: glName(c), balance: debitNet(c) }))
    .filter(x => x.balance < -0.005);
  if (negative.length) warnings.push({ id: 'negative_bank', items: negative });

  // (d) a bank nominal below zero at the end of any day in the period (the year end included).
  // The balance only changes on days with movements, so it is checked after each such day and
  // for the balance carried into the period; the days between keep the same balance.
  if (result.fyStart) {
    // The period runs to the year end; without one, 12 months from the period start (as the
    // legacy engine assumes).
    const [fy, fm] = result.fyStart.split('-').map(Number);
    const periodEnd = yearEnd || monthEnd(fm === 1 ? fy : fy + 1, fm === 1 ? 12 : fm - 1);
    const dayNo = d => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000;
    const daysInPeriod = dayNo(periodEnd) - dayNo(result.fyStart) + 1;
    const items = [];
    for (const code of [...new Set(bankCodes)]) {
      const byDay = new Map();
      let carried = 0;
      for (const j of journals) {
        if (j.debit_account !== code && j.credit_account !== code) continue;
        const mv = (j.debit_account === code ? Number(j.amount) : 0) - (j.credit_account === code ? Number(j.amount) : 0);
        if (j.date < result.fyStart) carried += mv;
        else if (j.date <= periodEnd) byDay.set(j.date, (byDay.get(j.date) || 0) + mv);
      }
      // [date the balance takes effect, end-of-day balance], from the period start
      const points = [];
      let bal = carried;
      const days = [...byDay.keys()].sort();
      if (!days.length || days[0] > result.fyStart) points.push([result.fyStart, round2(bal)]);
      for (const d of days) { bal += byDay.get(d); points.push([d, round2(bal)]); }
      let daysBelowZero = 0, firstBelow = null, lowest = null;
      points.forEach(([d, b], k) => {
        if (b >= -0.005) return;
        const until = k + 1 < points.length ? dayNo(points[k + 1][0]) : dayNo(periodEnd) + 1;
        daysBelowZero += until - dayNo(d);
        if (!firstBelow) firstBelow = d;
        if (!lowest || b < lowest.balance) lowest = { date: d, balance: b };
      });
      if (daysBelowZero) items.push({ code, name: glName(code), daysBelowZero, daysInPeriod, firstBelow, lowest });
    }
    if (items.length) warnings.push({ id: 'negative_bank_in_period', items });
  }

  // (e) information: a liability account (2000–2599) in debit at the year end
  const liabDebit = result.allCodes
    .filter(c => c >= '2000' && c <= '2599')
    .map(c => ({ code: c, name: glName(c), debit: debitNet(c) }))
    .filter(x => x.debit > 0.005)
    .sort((x, y) => (x.code < y.code ? -1 : 1));
  if (liabDebit.length) warnings.push({ id: 'liability_debit', severity: 'info', items: liabDebit });

  return warnings.map(w => ({ severity: 'warn', ...w }));
}
