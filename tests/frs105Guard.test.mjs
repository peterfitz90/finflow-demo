// STA-01 interim guard: frs105Warnings flags (a) balances the balancing figure absorbs, (b) no
// opening position, (c) a negative bank nominal at the year end. Warnings only.
// Run: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFrs105, frs105Warnings } from '../src/shared/statements/frs105.js';

const J = (date, debit_account, credit_account, amount, reference = null) => ({ date, debit_account, credit_account, amount: String(amount), reference });
const run = (journals, yearEnd = '2025-12-31', opts) => {
  const upTo = journals.filter(j => j.date <= yearEnd);
  return frs105Warnings(upTo, computeFrs105(upTo, { yearEnd, yeMonth: 12 }), opts);
};
const ids = ws => ws.map(w => w.id);

test('a clean ledger with an opening journal raises nothing', () => {
  const js = [J('2024-12-31', '1000', '3000', 100, 'OPENING'), J('2025-03-01', '1000', '4000', 500), J('2025-04-01', '6100', '1000', 200)];
  assert.deepEqual(run(js), []);
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
  const a = run(js).find(w => w.id === 'absorbed');
  assert.deepEqual(a.items.map(x => [x.code, x.debitNet]), [['1600', 23], ['2500', 30850.15], ['3100', -1505], ['9999', 1]]);
  assert.equal(a.items.find(x => x.code === '2500').name, 'Bank Loan');
});

test('(b) no OPENING and the ledger starts after the period start', () => {
  assert.deepEqual(ids(run([J('2025-01-02', '6300', '1000', 10), J('2025-02-01', '1000', '4000', 50)])), ['no_opening']);
  assert.deepEqual(ids(run([J('2025-01-02', '6300', '1000', 60), J('2025-02-01', '1000', '4000', 50)])), ['no_opening', 'negative_bank']);
  const w = run([J('2025-01-02', '1000', '4000', 50)]).find(x => x.id === 'no_opening');
  assert.deepEqual(w, { id: 'no_opening', firstJournal: '2025-01-02', periodStart: '2025-01-01' });
  // first journal on or before the period start: no warning
  assert.deepEqual(run([J('2025-01-01', '1000', '4000', 50)]), []);
  assert.deepEqual(run([J('2024-06-01', '1000', '4000', 50)]), []);
  // an OPENING journal suppresses it even when dated inside the period
  assert.deepEqual(run([J('2025-10-09', '1000', '3000', 2, 'OPENING')]), []);
  // no journals at all up to the year end
  assert.deepEqual(run([J('2026-03-01', '1000', '4000', 50)]), [{ id: 'no_opening', firstJournal: null, periodStart: '2025-01-01' }]);
});

test('(c) any listed bank nominal below zero at the year end, using the same sum as nominal_balance_as_of', () => {
  const js = [J('2024-12-31', '1000', '3000', 100, 'OPENING'), J('2025-03-01', '6100', '1000', 150), J('2025-03-02', '1010', '4000', 40)];
  const c = run(js, '2025-12-31', { bankCodes: ['1000', '1010'] }).find(w => w.id === 'negative_bank');
  assert.deepEqual(c.items, [{ code: '1000', name: 'Bank — Current Account', balance: -50 }]);
  // after the year end the bank recovers, but the warning is about the year end only
  assert.equal(run([...js, J('2026-01-05', '1000', '4000', 500)], '2025-12-31').filter(w => w.id === 'negative_bank').length, 1);
  assert.equal(run(js, '2025-12-31', { bankCodes: ['1010'] }).some(w => w.id === 'negative_bank'), false);
});

test('the guard does not change any figure', () => {
  const js = [J('2025-02-01', '2500', '1000', 30850.15), J('2025-06-01', '1000', '4000', 50)];
  const before = computeFrs105(js, { yearEnd: '2025-12-31', yeMonth: 12 });
  frs105Warnings(js, before);
  assert.deepEqual(computeFrs105(js, { yearEnd: '2025-12-31', yeMonth: 12 }).retainedEarns, before.retainedEarns);
});
