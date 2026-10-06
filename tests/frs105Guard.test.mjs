// STA-01 interim guard: frs105Warnings flags (a) balances the balancing figure absorbs, (b) no
// opening position, (c) a negative bank nominal at the year end, (d) a negative bank nominal at
// any month end in the year, and (e, information only) liability accounts in debit at the year
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
    ['no_opening', 'warn'], ['negative_bank', 'warn'], ['negative_bank_month_end', 'warn'], ['liability_debit', 'info'],
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
  assert.deepEqual(ids(run([J('2025-01-02', '6300', '1000', 10), J('2025-01-20', '1000', '4000', 50)])), ['no_opening']);
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

test('(d) below zero at a month end inside the year is caught even when the year end is positive', () => {
  const js = [
    J('2024-12-31', '1000', '3000', 100, 'OPENING'),
    J('2025-03-10', '6100', '1000', 400),   // 31 Mar: -300
    J('2025-04-15', '6100', '1000', 100),   // 30 Apr: -400 (lowest)
    J('2025-05-02', '1000', '4000', 1000),  // 31 May onwards: +600
  ];
  const ws = run(js);
  assert.equal(get(ws, 'negative_bank'), undefined);
  assert.deepEqual(get(ws, 'negative_bank_month_end').items, [{
    code: '1000', name: 'Bank — Current Account', monthEndsBelowZero: 2, monthEnds: 12,
    lowest: { date: '2025-04-30', balance: -400 },
    below: [{ date: '2025-03-31', balance: -300 }, { date: '2025-04-30', balance: -400 }],
  }]);
});

test('(d) a dip that recovers before the month end is not caught (month-end granularity)', () => {
  const js = [J('2024-12-31', '1000', '3000', 100, 'OPENING'), J('2025-01-11', '6000', '1000', 5000), J('2025-01-20', '1000', '4000', 6000)];
  assert.equal(get(run(js), 'negative_bank_month_end'), undefined);
});

test('(d) follows a non-December year and counts every month end in it', () => {
  const js = [J('2025-04-30', '1000', '3000', 100, 'OPENING'), J('2025-11-03', '6100', '1000', 150), J('2025-12-01', '1000', '4000', 100)];
  const d = get(run(js, '2026-04-30', {}, 4), 'negative_bank_month_end').items[0];
  assert.deepEqual([d.monthEnds, d.monthEndsBelowZero, d.lowest], [12, 1, { date: '2025-11-30', balance: -50 }]);
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
