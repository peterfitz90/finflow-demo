// Same-account guard (src/shared/transferHold.js). Run: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRANSFER, categoryFromAI, isTransferHold, sameAccount, assertDistinctAccounts } from '../src/shared/transferHold.js';

test('the AI never yields a bank nominal: 1000-1099 and TRANSFER become TRANSFER', () => {
  for (const c of ['1000', '1001', '1099', 'TRANSFER', 'transfer', ' 1000 ']) assert.equal(categoryFromAI(c), TRANSFER, c);
  for (const c of ['1100', '6000', '4100', '2400', '10000']) assert.equal(categoryFromAI(c), c, c);
});

test('a line is held when its category is a transfer or its own bank nominal; another bank nominal posts', () => {
  assert.equal(isTransferHold(TRANSFER, '1000'), true);
  assert.equal(isTransferHold('1000', '1000'), true, 'Moyvencap case: coded to its own bank');
  assert.equal(isTransferHold('1001', '1001'), true);
  assert.equal(isTransferHold('1001', '1000'), false, 'transfer to another bank nominal still posts');
  assert.equal(isTransferHold('6600', '1000'), false);
  assert.equal(isTransferHold(null, '1000'), false);
});

test('assertDistinctAccounts refuses Dr x / Cr x and passes everything else', () => {
  assert.equal(sameAccount({ debit_account: '1000', credit_account: '1000' }), true);
  assert.throws(() => assertDistinctAccounts([{ debit_account: '6600', credit_account: '1000' }, { debit_account: '1000', credit_account: '1000' }]), /same account \(1000\)/);
  assert.doesNotThrow(() => assertDistinctAccounts([{ debit_account: '1001', credit_account: '1000' }]));
  assert.doesNotThrow(() => assertDistinctAccounts([]));
  assert.throws(() => assertDistinctAccounts({ debit_account: '2400', credit_account: '2400' }));
});
