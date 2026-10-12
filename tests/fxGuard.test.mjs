// GEO-02 foreign-currency block (src/shared/fxGuard.js), the shared posting step
// (importDedup.js postImportBatch) and the PDF reader's printed euro amount.
// Run: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FX_BLOCK_MESSAGE, fxPlan, toLedgerLine, isForeignLine } from '../src/shared/fxGuard.js';
import { postImportBatch } from '../src/shared/importDedup.js';
import { verifyStatement } from '../src/shared/statementPdfVerify.js';

const line = (id, amount, currency, eur_amount) => ({ revolut_id: id, date: '2026-09-01', description: id, amount, currency, balance: 100, ...(eur_amount !== undefined ? { eur_amount } : {}) });

// A fake db that records every insert: postImportBatch must not reach it for a foreign line.
function fakeDb() {
  const calls = [];
  return { calls, from: table => ({
    insert: rows => ({ select: async () => { calls.push({ table, rows }); return { data: rows.map((r, i) => ({ id: `${table}-${i}`, revolut_id: r.revolut_id, reference: r.reference })), error: null }; } }),
    delete: () => ({ in: async () => ({ error: null }) }),
  }) };
}

test('a GBP section with no euro amounts is reference only: every line blocked, nothing posts', async () => {
  const rows = [line('g1', -12.5, 'GBP'), line('g2', 40, 'GBP')];
  const plan = fxPlan(rows);
  assert.deepEqual(plan.sections, [{ currency: 'GBP', lines: 2, missing: 2, mode: 'blocked' }]);
  assert.deepEqual([...plan.blockedIds].sort(), ['g1', 'g2']);
  assert.equal(plan.euroIds.size, 0);
  assert.throws(() => toLedgerLine(rows[0], plan), { message: FX_BLOCK_MESSAGE });

  // the shared posting step refuses it outright, before any insert
  const db = fakeDb();
  const res = await postImportBatch(db, 'c1', rows.map(bt => ({ bt, journal: { reference: bt.revolut_id, amount: Math.abs(bt.amount) } })));
  assert.equal(res.error.code, 'FOREIGN_CURRENCY');
  assert.match(res.error.message, /can't be posted yet; multi-currency posting is planned\. 2 lines in GBP/);
  assert.equal(db.calls.length, 0);
});

test('a mixed section (some lines print euro, one does not) stays blocked as a whole', () => {
  const rows = [line('m1', -10, 'GBP', -11.6), line('m2', -20, 'GBP'), line('m3', 5, 'GBP', 5.8)];
  const plan = fxPlan(rows);
  assert.deepEqual(plan.sections, [{ currency: 'GBP', lines: 3, missing: 1, mode: 'blocked' }]);
  assert.deepEqual([...plan.blockedIds].sort(), ['m1', 'm2', 'm3']);
  for (const r of rows) assert.throws(() => toLedgerLine(r, plan), { message: FX_BLOCK_MESSAGE });
  // a euro amount of zero or in the wrong direction counts as missing
  assert.equal(fxPlan([line('z', -10, 'GBP', 0)]).sections[0].mode, 'blocked');
  assert.equal(fxPlan([line('w', -10, 'GBP', 11.6)]).sections[0].mode, 'blocked');
});

test('an all-euro-printed section posts the euro column, recording the original currency and printed euro', async () => {
  const rows = [line('e1', -10, 'GBP', -11.6), line('e2', 25, 'gbp', 29.05)];
  const plan = fxPlan(rows);
  assert.deepEqual(plan.sections, [{ currency: 'GBP', lines: 2, missing: 0, mode: 'euro-printed' }]);
  assert.equal(plan.blockedIds.size, 0);
  const posted = rows.map(r => toLedgerLine(r, plan));
  assert.deepEqual(posted.map(p => [p.amount, p.currency, p.balance, p.original_currency, p.original_amount, p.printed_eur_amount]), [
    [-11.6, 'EUR', null, 'GBP', -10, -11.6],
    [29.05, 'EUR', null, 'GBP', 25, 29.05],
  ]);
  // converted lines pass the shared posting step
  const db = fakeDb();
  const res = await postImportBatch(db, 'c1', posted.map(bt => ({ bt, journal: { reference: bt.revolut_id, amount: Math.abs(bt.amount) } })));
  assert.equal(res.error, null);
  assert.deepEqual(db.calls.map(c => c.table), ['bank_transactions', 'journals']);
  assert.deepEqual(db.calls[1].rows.map(j => j.amount), [11.6, 29.05]);
});

test('EUR lines are untouched, and in a CSV with two currencies each currency is its own section', () => {
  const rows = [line('a', -5, 'EUR'), line('b', -5, null), line('c', -7, 'USD'), line('d', -3, 'GBP', -3.5)];
  const plan = fxPlan(rows);
  assert.equal(isForeignLine(rows[0]), false);
  assert.equal(isForeignLine(rows[1]), false);
  assert.equal(toLedgerLine(rows[0], plan), rows[0]);
  assert.deepEqual(plan.sections.map(s => [s.currency, s.mode]), [['USD', 'blocked'], ['GBP', 'euro-printed']]);
  assert.deepEqual([...plan.blockedIds], ['c']);
  assert.deepEqual([...plan.euroIds], ['d']);
});

test('the PDF reader keeps a printed euro amount only for a non-EUR section, signed like the line', () => {
  const page = '01 Sep 2026 Coffee 3.50 4.06 96.50 02 Sep 2026 Refund 10.00 11.60 106.50 opening 100.00';
  const chunk = (cur, eur1, eur2) => ({ firstPage: 1, result: { statement: { period_start_text: null, period_end_text: null }, sections: [{
    key: `${cur} main`, account_label: 'Main', currency: cur, opening_balance_text: '100.00',
    rows: [
      { page: 1, date_text: '01 Sep 2026', description: 'Coffee', money_out_text: '3.50', balance_text: '96.50', eur_amount_text: eur1 },
      { page: 1, date_text: '02 Sep 2026', description: 'Refund', money_in_text: '10.00', balance_text: '106.50', eur_amount_text: eur2 },
    ] }] } });
  const gbp = verifyStatement({ chunks: [chunk('GBP', '4.06', '11.60')], pageTexts: [page] }).sections[0];
  assert.deepEqual(gbp.rows.map(r => [r.amount, r.eur_amount]), [[-3.5, -4.06], [10, 11.6]]);
  assert.equal(fxPlan(gbp.rows).sections[0].mode, 'euro-printed');
  const partial = verifyStatement({ chunks: [chunk('GBP', '4.06', null)], pageTexts: [page] }).sections[0];
  assert.equal(fxPlan(partial.rows).sections[0].mode, 'blocked');
  const eur = verifyStatement({ chunks: [chunk('EUR', null, null)], pageTexts: [page] }).sections[0];
  assert.ok(eur.rows.every(r => r.eur_amount === undefined));
  assert.equal(fxPlan(eur.rows).sections.length, 0);
});
