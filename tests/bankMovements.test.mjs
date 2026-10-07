// Cash Flow from the ledger (src/shared/bankMovements.js). Run: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bankMovements, withRunningBalance, netMovement } from '../src/shared/bankMovements.js';

const J = (id, date, debit_account, credit_account, amount, description = '') => ({ id, date, debit_account, credit_account, amount, description });

test('movements: into and out of the bank, transfers between bank nominals left out', () => {
  const m = bankMovements([
    J('b', '2026-01-02', '6000', '1000', 500, 'wages'),
    J('a', '2026-01-02', '1000', '4000', 1200.5, 'sale'),
    J('c', '2026-01-03', '1001', '1000', 300, 'to savings'),
    J('d', '2026-01-04', '1000', '1000', 50, 'same account'),
    J('e', '2026-01-05', '6600', '2000', 10, 'not bank'),
  ], ['1000', '1001']);
  assert.deepEqual(m.map(x => [x.id, x.amount, x.nominal_account]), [['a', 1200.5, '4000'], ['b', -500, '6000']]);
  assert.equal(netMovement(m), 700.5);
});

test('running balance ends at opening + net, in cents', () => {
  const m = bankMovements([J('1', '2026-01-01', '1000', '4000', 0.1), J('2', '2026-01-01', '1000', '4000', 0.2), J('3', '2026-01-02', '6000', '1000', 0.3)], ['1000']);
  const rb = withRunningBalance(m, 100);
  assert.deepEqual(rb.map(x => x.runningBalance), [100.1, 100.3, 100]);
});

test('Heros-like: ledger opening + ledger movement = ledger closing', () => {
  // opening 6981.40, movement -4170.40 => 2811.00 (the ledger balance), whatever the statement lines say
  const m = bankMovements([J('x', '2026-03-01', '2500', '1000', 4170.4, 'loan repayment')], ['1000']);
  assert.equal(Math.round((6981.4 + netMovement(m)) * 100) / 100, 2811);
});
