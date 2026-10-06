// STA-01 Stage 4a expected-difference report: the statements page's period list and figures before
// and after year ends on any day (src/shared/statements/periods.js).
//
//   node --env-file=.env --env-file=.env.service.local scripts/frs105-periods-diff.mjs
//
// For every limited company (Kota IE - 1, Sean's test company, excluded): the old list (last day
// of year_end_month, three most recent years ended) against the new one from the company's own
// fy_end_day and financial_periods rows, and every Schedule 3B figure and guard warning for each
// period, old path (month-based start) against new path (period start from the list). A company
// with fy_end_day null and no recorded periods must come out identical.
//
// --simulate-sp also shows S&P as it will be after the approved data changes (fy_end_day 8 and
// the OPENING journal moved from 9 to 8 October 2025), computed in memory: nothing is written.
// Read-only. Needs SUPABASE_SERVICE_ROLE_KEY in .env.service.local.
import { createClient } from '@supabase/supabase-js';
import { computeFrs105, fetchJournalsToDate, frs105Warnings } from '../src/shared/statements/frs105.js';
import { listPeriods, isYearEnd } from '../src/shared/statements/periods.js';
import { localDateStr, todayStr } from '../src/shared/dates.js';

const EXCLUDED = new Set(['04cfb3d6-cc38-4d1f-91a0-6e735416bca2']); // Kota IE - 1 (test company)
const SP = '1d4bf5bd-3f2f-4919-b972-b00b2b9cac99';
const url = process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see header).'); process.exit(2); }
const db = createClient(url, key, { auth: { persistSession: false } });
const today = todayStr();

// The page's old list, verbatim logic.
function oldYearEnds(yeMonth, now = new Date()) {
  const thisYE = new Date(now.getFullYear(), yeMonth, 0);
  const startYear = thisYE <= now ? now.getFullYear() : now.getFullYear() - 1;
  return [0, 1, 2].map(i => localDateStr(new Date(startYear - i, yeMonth, 0)));
}
const flat = S => {
  const lines = {};
  for (const [k, v] of Object.entries(S.bs)) lines[`bs.${k}`] = v.amount;
  for (const [k, v] of Object.entries(S.pnl)) lines[`pnl.${k}`] = v.amount;
  Object.assign(lines, { fyStart: S.fyStart, netAssets: S.netAssets, profit: S.profit, imbalance: S.imbalance, unmapped: S.unmapped.map(u => u.code).join(' ') },
    Object.fromEntries(Object.entries(S.reserves).map(([k, v]) => [`reserves.${k}`, v])));
  return lines;
};
const warnIds = ws => ws.map(w => w.id).sort().join(',');

async function load(co) {
  const [{ data: chart }, { data: periods }, { data: bank }] = await Promise.all([
    db.from('chart_of_accounts').select('code, name, account_type, category').eq('company_id', co.id),
    db.from('financial_periods').select('period_start, period_end, kind, reason').eq('company_id', co.id),
    db.from('bank_accounts').select('nominal_code, is_active').eq('company_id', co.id),
  ]);
  const { data: all, error } = await fetchJournalsToDate(db, co.id, '9999-12-31');
  if (error) throw new Error(error.message);
  const bankCodes = [...new Set((bank || []).filter(b => b.is_active !== false).map(b => b.nominal_code).filter(Boolean))];
  return { chart: chart || [], periods: periods || [], journals: all, bankCodes: bankCodes.length ? bankCodes : ['1000'] };
}

function run(co, d, { fyEndDay, journals }) {
  const yeMonth = co.year_end_month || 12;
  const opening = journals.filter(j => j.reference === 'OPENING');
  const isYE = dd => isYearEnd(dd, { yeMonth, fyEndDay, periods: d.periods });
  const list = listPeriods({ yeMonth, fyEndDay, periods: d.periods, today });
  return list.map(p => {
    const js = journals.filter(j => j.date <= p.end);
    const S = computeFrs105(js, { yearEnd: p.end, yeMonth, periodStart: p.start, mode: 'schedule3b', chart: d.chart });
    const ws = frs105Warnings(js, S, { bankCodes: d.bankCodes, yearEnd: p.end, ledgerCompleteFrom: co.ledger_complete_from, isYearEnd: isYE, openingJournals: opening });
    return { period: p, lines: flat(S), warnings: ws };
  });
}

const { data: companies, error } = await db.from('companies').select('id, name, year_end_month, fy_end_day, ledger_complete_from').eq('company_type', 'Limited Company').order('name');
if (error) { console.error(error.message); process.exit(2); }

let values = 0, diffs = 0;
const rows = [];
const cache = {};
for (const co of companies.filter(c => !EXCLUDED.has(c.id))) {
  const d = cache[co.id] = await load(co);
  const yeMonth = co.year_end_month || 12;
  const oldList = oldYearEnds(yeMonth);
  const newRuns = run(co, d, { fyEndDay: co.fy_end_day ?? null, journals: d.journals });
  const sameList = JSON.stringify(oldList) === JSON.stringify(newRuns.map(r => r.period.end));
  let coDiffs = sameList ? 0 : 1;
  for (const r of newRuns) {
    const js = d.journals.filter(j => j.date <= r.period.end);
    const O = computeFrs105(js, { yearEnd: r.period.end, yeMonth, mode: 'schedule3b', chart: d.chart });
    const oldLines = flat(O);
    const oldW = frs105Warnings(js, O, { bankCodes: d.bankCodes, yearEnd: r.period.end, ledgerCompleteFrom: co.ledger_complete_from });
    for (const f of new Set([...Object.keys(oldLines), ...Object.keys(r.lines)])) {
      values++;
      if (!Object.is(oldLines[f], r.lines[f])) { coDiffs++; console.log(`DIFF ${co.name} ${r.period.end} ${f}: ${oldLines[f]} → ${r.lines[f]}`); }
    }
    values++;
    if (warnIds(oldW) !== warnIds(r.warnings)) { coDiffs++; console.log(`WARN ${co.name} ${r.period.end}: [${warnIds(oldW)}] → [${warnIds(r.warnings)}]`); }
  }
  diffs += coDiffs;
  rows.push([co.name, yeMonth, co.fy_end_day ?? 'month end', d.periods.length, sameList ? 'same' : `${oldList.join(' ')} → ${newRuns.map(r => r.period.end).join(' ')}`, coDiffs ? `${coDiffs} differences` : 'unchanged']);
}
console.table(rows.map(([company, month, day, recorded, list, result]) => ({ company, month, day, recorded, list, result })));
console.log(`${diffs ? 'DIFFERENCES' : 'OK'}: ${rows.length} companies, ${values} values and warning sets compared (old path against new), ${diffs} differences.`);

if (process.argv.includes('--simulate-sp')) {
  const co = companies.find(c => c.id === SP);
  const d = cache[SP];
  const show = ['bs.C', 'bs.D', 'bs.E', 'bs.F', 'bs.G', 'bs.K1', 'bs.K2', 'netAssets', 'pnl.1', 'profit', 'imbalance'];
  const table = (label, runs) => {
    console.log(`\n${label}`);
    console.table(Object.fromEntries(runs.map(r => [`${r.period.start} to ${r.period.end}`, { ...Object.fromEntries(show.map(f => [f, r.lines[f]])), warnings: warnIds(r.warnings.filter(w => w.severity === 'warn')) }])));
  };
  table('S&P now (month end, 31 October)', run(co, d, { fyEndDay: null, journals: d.journals }));
  table('S&P with fy_end_day 8, OPENING still dated 9 October 2025', run(co, d, { fyEndDay: 8, journals: d.journals }));
  const moved = d.journals.map(j => (j.reference === 'OPENING' && j.date === '2025-10-09' ? { ...j, date: '2025-10-08' } : j));
  table('S&P with fy_end_day 8 and OPENING moved to 8 October 2025 (after the data changes)', run(co, d, { fyEndDay: 8, journals: moved }));
  console.log(`OPENING journals dated 9 October 2025: ${d.journals.filter(j => j.reference === 'OPENING' && j.date === '2025-10-09').length}; other OPENING journals: ${d.journals.filter(j => j.reference === 'OPENING' && j.date !== '2025-10-09').length}`);
}
process.exit(0);
