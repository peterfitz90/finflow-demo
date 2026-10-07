// Before/after for the shared fiscal-year helper (src/shared/fiscalYear.js).
//
//   node --env-file=.env --env-file=.env.service.local scripts/fiscal-year-diff.mjs
//
// For every limited company (Kota IE - 1, Sean's test company, excluded): the year-to-date start
// for each of the last 24 months and the CT1 due dates, old formula against the helper. A
// company with fy_end_day null and no recorded periods must come out identical. For any company
// that differs, the year-to-date window and its figures (income 4xxx, expenses 5xxx–6xxx, money
// in and out of its bank nominals) old against new, as Overview, Cash Flow and GL Report show
// them. Read-only. Needs SUPABASE_SERVICE_ROLE_KEY in .env.service.local.
import { createClient } from '@supabase/supabase-js';
import { fetchJournalsToDate } from '../src/shared/statements/frs105.js';
import { fiscalConfig, ytdStartForMonth, ct1Deadlines } from '../src/shared/fiscalYear.js';
import { monthEnd, todayStr } from '../src/shared/dates.js';

const EXCLUDED = new Set(['04cfb3d6-cc38-4d1f-91a0-6e735416bca2']);
const url = process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see header).'); process.exit(2); }
const db = createClient(url, key, { auth: { persistSession: false } });

const oldYtdStart = (yyyymm, yem) => {
  const [py, pm] = yyyymm.split('-').map(Number);
  const ysm = (yem % 12) + 1;
  return `${pm >= ysm ? py : py - 1}-${String(ysm).padStart(2, '0')}-01`;
};
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = todayStr();
const [ty, tm] = today.split('-').map(Number);
const months = Array.from({ length: 24 }, (_, i) => { const d = new Date(ty, tm - 1 - i, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });
const r2 = n => Math.round(n * 100) / 100;

const { data: companies, error } = await db.from('companies').select('id, name, year_end_month, fy_end_day').eq('company_type', 'Limited Company').order('name');
if (error) { console.error(error.message); process.exit(2); }
const { data: allPeriods } = await db.from('financial_periods').select('company_id, period_start, period_end');

const summary = [], changed = [];
for (const co of companies.filter(c => !EXCLUDED.has(c.id))) {
  const yem = co.year_end_month || 12;
  const cfg = fiscalConfig(co, (allPeriods || []).filter(p => p.company_id === co.id));
  const ytdDiffs = months.filter(m => oldYtdStart(m, yem) !== ytdStartForMonth(m, cfg, today));
  const oldCt1 = [ty - 1, ty, ty + 1].map(y => ymd(new Date(y, yem - 1 + 9, 23)));
  const newCt1 = ct1Deadlines(ty - 1, ty + 1, cfg).map(d => ymd(d.due));
  const ct1Same = JSON.stringify(oldCt1) === JSON.stringify(newCt1);
  summary.push({ company: co.name, month: yem, day: co.fy_end_day ?? 'month end', 'YTD starts (24 months)': ytdDiffs.length ? `${ytdDiffs.length} differ` : 'same', CT1: ct1Same ? 'same' : `${oldCt1.join(' ')} → ${newCt1.join(' ')}` });
  if (ytdDiffs.length || !ct1Same) changed.push({ co, cfg, yem, ytdDiffs });
}
console.table(summary);
const unchanged = summary.filter(s => s['YTD starts (24 months)'] === 'same' && s.CT1 === 'same').length;
console.log(`${unchanged} of ${summary.length} companies unchanged (year-to-date start for 24 months and CT1 due dates).`);

for (const { co, cfg, yem, ytdDiffs } of changed) {
  const { data: journals } = await fetchJournalsToDate(db, co.id, monthEnd(ty, tm));
  const { data: bank } = await db.from('bank_accounts').select('nominal_code, is_active').eq('company_id', co.id);
  const bankCodes = new Set((bank || []).filter(b => b.is_active !== false).map(b => b.nominal_code).filter(Boolean));
  if (!bankCodes.size) bankCodes.add('1000');
  const figures = (start, end) => {
    let income = 0, expenses = 0, bankIn = 0, bankOut = 0, n = 0;
    for (const j of journals) {
      if (j.date < start || j.date > end) continue;
      n++;
      const a = Number(j.amount);
      if (j.credit_account >= '4000' && j.credit_account <= '4999') income += a;
      if (j.debit_account >= '4000' && j.debit_account <= '4999') income -= a;
      if (j.debit_account >= '5000' && j.debit_account <= '6999') expenses += a;
      if (j.credit_account >= '5000' && j.credit_account <= '6999') expenses -= a;
      if (bankCodes.has(j.debit_account) && !bankCodes.has(j.credit_account)) bankIn += a;
      if (bankCodes.has(j.credit_account) && !bankCodes.has(j.debit_account)) bankOut += a;
    }
    return { journals: n, income: r2(income), expenses: r2(expenses), profit: r2(income - expenses), bankIn: r2(bankIn), bankOut: r2(bankOut) };
  };
  console.log(`\n${co.name}: year end ${cfg.fyEndDay ?? 'last day of'} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][yem - 1]}. Year-to-date for the selected month, before → after:`);
  const rows = {};
  for (const m of ytdDiffs.slice(0, 13)) {
    const [y, mm] = m.split('-').map(Number);
    const end = monthEnd(y, mm);
    const before = figures(oldYtdStart(m, yem), end), after = figures(ytdStartForMonth(m, cfg, today), end);
    rows[m] = { before: `${oldYtdStart(m, yem)}→${end}`, after: `${ytdStartForMonth(m, cfg, today)}→${end}`,
      'income b/a': `${before.income} / ${after.income}`, 'expenses b/a': `${before.expenses} / ${after.expenses}`,
      'bank in b/a': `${before.bankIn} / ${after.bankIn}`, 'bank out b/a': `${before.bankOut} / ${after.bankOut}` };
  }
  console.table(rows);
}
