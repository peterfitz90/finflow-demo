// STA-01 Stage 4a: financial periods and the OPENING-date guard. Run: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yearEndIn, regularPeriod, periodMonths, listPeriods, isYearEnd } from '../src/shared/statements/periods.js';
import { computeFrs105, frs105FiscalYear, frs105Warnings } from '../src/shared/statements/frs105.js';

test('year ends: month end by default, any day when set, clamped to the month', () => {
  assert.equal(yearEndIn(2025, 12), '2025-12-31');
  assert.equal(yearEndIn(2025, 10, 8), '2025-10-08');
  assert.equal(yearEndIn(2025, 2), '2025-02-28');
  assert.equal(yearEndIn(2024, 2, 29), '2024-02-29');
  assert.equal(yearEndIn(2025, 2, 29), '2025-02-28');
});

test('a regular month-end year starts where the old formula started, for every month', () => {
  for (let m = 1; m <= 12; m++) for (const y of [2023, 2024, 2025]) {
    const end = yearEndIn(y, m);
    assert.equal(regularPeriod(end, m).start, frs105FiscalYear(end, m).fyStart, `${y}-${m}`);
  }
});

test('S&P: the year to 8 October 2025 runs from 9 October 2024', () => {
  assert.deepEqual(regularPeriod('2025-10-08', 10, 8), { start: '2024-10-09', end: '2025-10-08' });
  assert.equal(periodMonths('2024-10-09', '2025-10-08'), 12);
});

test('period length in months', () => {
  assert.equal(periodMonths('2025-01-01', '2025-12-31'), 12);
  assert.equal(periodMonths('2024-06-01', '2025-12-31'), 19);
  assert.equal(periodMonths('2025-01-01', '2025-06-30'), 6);
  assert.equal(periodMonths('2024-06-16', '2024-12-31'), Math.round(199 * 12 / 365 * 100) / 100);
});

test('with no recorded periods and no day, the list is the old one', () => {
  const old = (yeMonth, now) => {
    const thisYE = new Date(now.getFullYear(), yeMonth, 0);
    const startYear = thisYE <= now ? now.getFullYear() : now.getFullYear() - 1;
    return [0, 1, 2].map(i => { const d = new Date(startYear - i, yeMonth, 0); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  };
  for (let m = 1; m <= 12; m++) for (const today of ['2026-10-06', '2026-12-31', '2026-01-01', '2024-02-29']) {
    const now = new Date(today + 'T12:00:00');
    assert.deepEqual(listPeriods({ yeMonth: m, today }).map(p => p.val), old(m, now), `${m} ${today}`);
  }
});

test('recorded periods come first and replace the regular years they overlap', () => {
  const periods = [{ period_start: '2024-06-01', period_end: '2025-12-31', kind: 'first', reason: 'incorporated 1 June 2024' }];
  const list = listPeriods({ yeMonth: 12, periods, today: '2026-10-06' });
  assert.deepEqual(list.map(p => [p.start, p.end, p.source]), [
    ['2024-06-01', '2025-12-31', 'table'],
  ], 'no regular years before a first period');
  const changed = [{ period_start: '2025-01-01', period_end: '2025-06-30', kind: 'changed', reason: 'year end moved to June' }];
  assert.deepEqual(listPeriods({ yeMonth: 6, periods: changed, today: '2026-10-06' }).map(p => [p.start, p.end, p.source, p.months]), [
    ['2025-01-01', '2025-06-30', 'table', 6],
    ['2025-07-01', '2026-06-30', 'regular', 12],
  ], 'a changed year end: the short period, then regular years after it only');
  assert.equal(list[0].months, 19);
  assert.match(list[0].label, /first period/);
});

test('isYearEnd: regular year ends and recorded period ends', () => {
  assert.equal(isYearEnd('2025-10-08', { yeMonth: 10, fyEndDay: 8 }), true);
  assert.equal(isYearEnd('2025-10-31', { yeMonth: 10, fyEndDay: 8 }), false);
  assert.equal(isYearEnd('2025-10-31', { yeMonth: 10 }), true);
  assert.equal(isYearEnd('2025-06-30', { yeMonth: 12, periods: [{ period_end: '2025-06-30' }] }), true);
});

const J = (date, debit_account, credit_account, amount, reference = null) => ({ date, debit_account, credit_account, amount, reference });

test('the engine takes a period start; legacy ignores it', () => {
  const journals = [J('2024-10-20', '1000', '4000', 100), J('2025-10-05', '1000', '4000', 50), J('2025-10-20', '1000', '4000', 7)];
  const chart = [{ code: '1000', name: 'Bank', account_type: 'asset' }, { code: '4000', name: 'Sales', account_type: 'income' }];
  const s = computeFrs105(journals.filter(j => j.date <= '2025-10-08'), { yearEnd: '2025-10-08', yeMonth: 10, periodStart: '2024-10-09', mode: 'schedule3b', chart });
  const sOld = computeFrs105(journals.filter(j => j.date <= '2025-10-08'), { yearEnd: '2025-10-08', yeMonth: 10, mode: 'schedule3b', chart });
  assert.equal(sOld.pnl['1'].amount, 50, 'without the period start the year would begin on 1 November 2024');
  assert.equal(s.fyStart, '2024-10-09');
  assert.equal(s.pnl['1'].amount, 150);
  const legacyA = computeFrs105(journals, { yearEnd: '2025-10-31', yeMonth: 10 });
  const legacyB = computeFrs105(journals, { yearEnd: '2025-10-31', yeMonth: 10, periodStart: '2024-10-09' });
  assert.equal(legacyA.fyStart, legacyB.fyStart);
  assert.equal(legacyA.turnover, legacyB.turnover);
  const noStart = computeFrs105(journals, { yearEnd: '2025-10-31', yeMonth: 10, mode: 'schedule3b', chart: [] });
  assert.equal(noStart.fyStart, '2024-11-01');
});

test('guard: an OPENING journal dated the day after a year end warns; mid-year starts do not', () => {
  const opening = [J('2025-10-09', '1000', '3100', 10, 'OPENING'), J('2025-10-09', '3000', '1000', 2, 'OPENING')];
  const result = computeFrs105([], { yearEnd: '2025-10-08', yeMonth: 10, periodStart: '2024-10-09', mode: 'schedule3b', chart: [] });
  const sp = d => isYearEnd(d, { yeMonth: 10, fyEndDay: 8 });
  const w = frs105Warnings([], result, { yearEnd: '2025-10-08', isYearEnd: sp, openingJournals: opening }).find(x => x.id === 'opening_after_year_end');
  assert.deepEqual(w.items, [{ date: '2025-10-09', yearEnd: '2025-10-08', count: 2 }]);
  assert.equal(w.severity, 'warn');
  // dated on the year end: no warning
  const onYE = opening.map(j => ({ ...j, date: '2025-10-08' }));
  assert.equal(frs105Warnings([], result, { isYearEnd: sp, openingJournals: onYE }).find(x => x.id === 'opening_after_year_end'), undefined);
  // a mid-year start (the day before the first journal) is legitimate
  const mid = [J('2026-06-16', '1000', '3000', 1, 'OPENING')];
  assert.equal(frs105Warnings([], result, { isYearEnd: d => isYearEnd(d, { yeMonth: 12 }), openingJournals: mid }).find(x => x.id === 'opening_after_year_end'), undefined);
  // the same journal before S&P's day is set (month end 31 Oct): not the day after a year end
  assert.equal(frs105Warnings([], result, { isYearEnd: d => isYearEnd(d, { yeMonth: 10 }), openingJournals: opening }).find(x => x.id === 'opening_after_year_end'), undefined);
  // without isYearEnd the rule is not checked
  assert.equal(frs105Warnings([], result, { openingJournals: opening }).find(x => x.id === 'opening_after_year_end'), undefined);
});
