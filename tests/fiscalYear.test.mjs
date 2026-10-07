// The shared fiscal-year helper (src/shared/fiscalYear.js). Run: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fiscalConfig, fiscalYearContaining, ytdStartForMonth, ct1DueDate, ct1Deadlines, periodEndsInYears, yearEndLabel } from '../src/shared/fiscalYear.js';

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// The formula every screen used before (Overview, Cash Flow, GL Report, Full GL Report).
const oldYtdStart = (yyyymm, yem) => {
  const [py, pm] = yyyymm.split('-').map(Number);
  const ysm = (yem % 12) + 1;
  return `${pm >= ysm ? py : py - 1}-${String(ysm).padStart(2, '0')}-01`;
};

test('month-end companies: year-to-date start is unchanged for every year-end month and selected month', () => {
  for (let yem = 1; yem <= 12; yem++) for (const y of [2023, 2024, 2025, 2026]) for (let m = 1; m <= 12; m++) {
    const sel = `${y}-${String(m).padStart(2, '0')}`;
    assert.equal(ytdStartForMonth(sel, fiscalConfig({ year_end_month: yem })), oldYtdStart(sel, yem), `${yem} ${sel}`);
    for (const today of [`${sel}-01`, `${sel}-15`]) assert.equal(ytdStartForMonth(sel, fiscalConfig({ year_end_month: yem }), today), oldYtdStart(sel, yem), `${yem} ${sel} today ${today}`);
  }
});

test('month-end companies: CT1 due dates are unchanged', () => {
  for (let yem = 1; yem <= 12; yem++) {
    const old = [2025, 2026, 2027].map(y => ymd(new Date(y, yem - 1 + 9, 23)));
    assert.deepEqual(ct1Deadlines(2025, 2027, fiscalConfig({ year_end_month: yem })).map(d => ymd(d.due)), old, `month ${yem}`);
  }
});

test('S&P (8 October): year-to-date and CT1', () => {
  const sp = fiscalConfig({ year_end_month: 10, fy_end_day: 8 });
  assert.deepEqual(fiscalYearContaining('2026-09-30', sp), { start: '2025-10-09', end: '2026-10-08', recorded: false });
  assert.equal(ytdStartForMonth('2026-09', sp), '2025-10-09');   // was 2025-11-01
  assert.equal(ytdStartForMonth('2026-10', sp), '2026-10-09');   // October's end is in the next year
  assert.equal(ytdStartForMonth('2026-01', sp), '2025-10-09');
  // the current October, before the year end has passed, stays in the year still running
  assert.equal(ytdStartForMonth('2026-10', sp, '2026-10-07'), '2025-10-09');
  assert.equal(ytdStartForMonth('2026-10', sp, '2026-10-20'), '2026-10-09');
  assert.equal(ymd(ct1DueDate('2025-10-08')), '2026-07-23');
  assert.deepEqual(periodEndsInYears(2025, 2026, sp), ['2025-10-08', '2026-10-08']);
  assert.equal(yearEndLabel(sp), '8 October');
  assert.equal(yearEndLabel(fiscalConfig({ year_end_month: 12 })), 'December');
});

test('recorded periods: CT1 follows the recorded end, and a regular year never reaches into one', () => {
  const cfg = fiscalConfig({ year_end_month: 12 }, [{ period_start: '2024-06-01', period_end: '2025-06-30' }]);
  assert.deepEqual(periodEndsInYears(2024, 2026, cfg), ['2025-06-30', '2025-12-31', '2026-12-31']);
  assert.deepEqual(fiscalYearContaining('2025-03-01', cfg), { start: '2024-06-01', end: '2025-06-30', recorded: true });
  assert.deepEqual(fiscalYearContaining('2025-09-01', cfg), { start: '2025-07-01', end: '2025-12-31', recorded: false });
});

// computeDeadlines() itself is not loaded here: it imports vat3.js, which imports the browser
// Supabase client. Its CT1 loop is ct1Deadlines() above with the same window filter.
