// STA-01 interim guard: frs105Warnings flags (a) balances the balancing figure absorbs, (b) no
// opening position, (c) a negative bank nominal at the year end, (d) a negative bank nominal at
// the end of any day in the year, and (e, information only) liability accounts in debit at the year
// end. Warnings only. Run: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFrs105, frs105Warnings } from '../src/shared/statements/frs105.js';

const J = (date, debit_account, credit_account, amount, reference = null) => ({ date, debit_account, credit_account, amount: String(amount), reference });
const run = (journals, yearEnd = '2025-12-31', opts = {}, yeMonth = 12) => {
  const upTo = journals.filter(j => j.date <= yearEnd);
  return frs105Warnings(upTo, computeFrs105(upTo, { yearEnd, yeMonth }), { yearEnd, ...opts });
};
const ids = ws => ws.map(w => w.id);
const get = (ws, id) => ws.find(w => w.id === id);

test('a clean ledger with an opening journal raises nothing', () => {
  const js = [J('2024-12-31', '1000', '3000', 100, 'OPENING'), J('2025-03-01', '1000', '4000', 500), J('2025-04-01', '6100', '1000', 200)];
  assert.deepEqual(run(js), []);
});

test('every warning carries a severity; only liability_debit is informational', () => {
  const ws = run([J('2025-01-02', '2100', '1000', 50)]);
  assert.deepEqual(ws.map(w => [w.id, w.severity]), [
    ['no_opening', 'warn'], ['negative_bank', 'warn'], ['negative_bank_in_period', 'warn'], ['liability_debit', 'info'],
  ]);
});

test('(a) lists every absorbed balance with its sign, and ignores P&L codes and zero balances', () => {
  const js = [
    J('2024-12-31', '1000', '3000', 100, 'OPENING'),
    J('2025-01-05', '1000', '2500', 30000), J('2025-01-06', '2500', '1000', 30000),   // nets to zero: not listed
    J('2025-02-01', '2500', '1000', 30850.15),                                       // debit balance on a loan
    J('2025-03-01', '1000', '3100', 1505),                                            // retained earnings, credit
    J('2025-04-01', '1600', '2100', 23), J('2025-05-01', '9999', '1000', 1),
    J('2025-06-01', '1000', '4000', 50000), J('2025-06-02', '7100', '1000', 10),      // P&L codes: not absorbed
  ];
  const a = get(run(js), 'absorbed');
  assert.deepEqual(a.items.map(x => [x.code, x.debitNet]), [['1600', 23], ['2500', 30850.15], ['3100', -1505], ['9999', 1]]);
  assert.equal(a.items.find(x => x.code === '2500').name, 'Bank Loan');
});

test('(b) no OPENING and the ledger starts after the period start', () => {
  assert.deepEqual(ids(run([J('2025-01-02', '1000', '4000', 50), J('2025-01-20', '6300', '1000', 10)])), ['no_opening']);
  // a short dip after a late start is also caught by the end-of-day rule
  assert.deepEqual(ids(run([J('2025-01-02', '6300', '1000', 10), J('2025-01-20', '1000', '4000', 50)])), ['no_opening', 'negative_bank_in_period']);
  assert.deepEqual(get(run([J('2025-01-02', '1000', '4000', 50)]), 'no_opening'),
    { severity: 'warn', id: 'no_opening', firstJournal: '2025-01-02', periodStart: '2025-01-01' });
  // first journal on or before the period start: no warning
  assert.deepEqual(run([J('2025-01-01', '1000', '4000', 50)]), []);
  assert.deepEqual(run([J('2024-06-01', '1000', '4000', 50)]), []);
  // an OPENING journal suppresses it even when dated inside the period
  assert.deepEqual(run([J('2025-10-09', '1000', '3000', 2, 'OPENING')]), []);
  // no journals at all up to the year end
  assert.deepEqual(run([J('2026-03-01', '1000', '4000', 50)]), [{ severity: 'warn', id: 'no_opening', firstJournal: null, periodStart: '2025-01-01' }]);
});

test('(c) any listed bank nominal below zero at the year end, using the same sum as nominal_balance_as_of', () => {
  const js = [J('2024-12-31', '1000', '3000', 100, 'OPENING'), J('2025-03-01', '6100', '1000', 150), J('2025-03-02', '1010', '4000', 40)];
  assert.deepEqual(get(run(js, '2025-12-31', { bankCodes: ['1000', '1010'] }), 'negative_bank').items,
    [{ code: '1000', name: 'Bank — Current Account', balance: -50 }]);
  assert.equal(get(run(js, '2025-12-31', { bankCodes: ['1010'] }), 'negative_bank'), undefined);
});

test('(d) below zero at the end of a day inside the year is caught even when the year end is positive', () => {
  const js = [
    J('2024-12-31', '1000', '3000', 100, 'OPENING'),
    J('2025-03-10', '6100', '1000', 400),   // 10 Mar: -300
    J('2025-04-15', '6100', '1000', 100),   // 15 Apr: -400 (lowest)
    J('2025-05-02', '1000', '4000', 1000),  // 2 May: +600
  ];
  const ws = run(js);
  assert.equal(get(ws, 'negative_bank'), undefined);
  assert.deepEqual(get(ws, 'negative_bank_in_period').items, [{
    code: '1000', name: 'Bank — Current Account', daysBelowZero: 53, daysInPeriod: 365,
    firstBelow: '2025-03-10', lowest: { date: '2025-04-15', balance: -400 },
  }]);
});

test('(d) a dip that recovers within the month is caught (end of day, not month end)', () => {
  // Kota-shaped: down on the 11th, back up on the 20th
  const js = [J('2024-12-31', '1000', '3000', 100, 'OPENING'), J('2025-01-11', '6000', '1000', 5000), J('2025-01-20', '1000', '4000', 6000)];
  assert.deepEqual(get(run(js), 'negative_bank_in_period').items[0],
    { code: '1000', name: 'Bank — Current Account', daysBelowZero: 9, daysInPeriod: 365, firstBelow: '2025-01-11', lowest: { date: '2025-01-11', balance: -4900 } });
});

test('(d) movements within one day are netted before the end-of-day check', () => {
  const js = [J('2024-12-31', '1000', '3000', 100, 'OPENING'), J('2025-02-01', '6000', '1000', 500), J('2025-02-01', '1000', '4000', 600)];
  assert.equal(get(run(js), 'negative_bank_in_period'), undefined);
});

test('(d) a negative balance carried into the year counts from the first day', () => {
  const js = [J('2024-06-01', '6000', '1000', 50), J('2025-01-15', '1000', '4000', 100)];
  assert.deepEqual(get(run(js), 'negative_bank_in_period').items[0],
    { code: '1000', name: 'Bank — Current Account', daysBelowZero: 14, daysInPeriod: 365, firstBelow: '2025-01-01', lowest: { date: '2025-01-01', balance: -50 } });
});

test('(d) follows a non-December year', () => {
  const js = [J('2025-04-30', '1000', '3000', 100, 'OPENING'), J('2025-11-03', '6100', '1000', 150), J('2025-12-01', '1000', '4000', 100)];
  const d = get(run(js, '2026-04-30', {}, 4), 'negative_bank_in_period').items[0];
  assert.deepEqual([d.daysInPeriod, d.daysBelowZero, d.firstBelow, d.lowest], [365, 28, '2025-11-03', { date: '2025-11-03', balance: -50 }]);
});

test('(e) liability accounts 2000–2599 in debit at the year end, information only', () => {
  const js = [
    J('2024-12-31', '1000', '3000', 100, 'OPENING'),
    J('2025-02-01', '2100', '1000', 19.5), J('2025-02-02', '2000', '1000', 10), J('2025-02-03', '1000', '2000', 10),
    J('2025-03-01', '2500', '1000', 30), J('2025-04-01', '1000', '2300', 5), J('2025-05-01', '2600', '1000', 1),
  ];
  const e = get(run(js), 'liability_debit');
  assert.equal(e.severity, 'info');
  assert.deepEqual(e.items, [{ code: '2100', name: 'VAT Control', debit: 19.5 }, { code: '2500', name: 'Bank Loan', debit: 30 }]);
});

test('the guard does not change any figure', () => {
  const js = [J('2025-02-01', '2500', '1000', 30850.15), J('2025-06-01', '1000', '4000', 50)];
  const before = computeFrs105(js, { yearEnd: '2025-12-31', yeMonth: 12 });
  frs105Warnings(js, before, { yearEnd: '2025-12-31' });
  assert.deepEqual(computeFrs105(js, { yearEnd: '2025-12-31', yeMonth: 12 }).retainedEarns, before.retainedEarns);
});
