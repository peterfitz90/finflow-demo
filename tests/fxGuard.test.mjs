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

// Reconciliation lives inside App.jsx, so its two guarded actions are checked in the source:
// Settle and Categorise each refuse a non-EUR line when opened and when saved, and each button
// is disabled for one, all with the same message.
test('Reconciliation blocks Settle and Categorise on a non-EUR line, with the same message', async () => {
  const { readFileSync } = await import('node:fs');
  const { SETTLE_FX_MESSAGE } = await import('../src/shared/fxGuard.js');
  const src = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const body = name => { const i = src.indexOf(`const ${name} = `); assert.ok(i > 0, name); return src.slice(i, i + 400); };
  for (const fn of ['openSettleModal', 'openCreateJnl', 'saveJnl']) assert.match(body(fn), /isForeignLine\((bt|createJnlFor)\)\) \{ showToast\(SETTLE_FX_MESSAGE\); return; \}/, fn);
  assert.match(body('confirmSettlement'), /if \(isForeignLine\(bt\)\) throw new Error\(SETTLE_FX_MESSAGE\)/);
  const buttons = src.split('\n').filter(l => /Settle…<\/button>|[oO]penCreateJnl\(/.test(l) && /<button/.test(l));
  assert.equal(buttons.length, 6, 'four Settle and two Categorise buttons');
  for (const b of buttons) assert.match(b, /disabled=\{isForeignLine\((row\.bt|item\.bt|bt)\)\} title=\{isForeignLine\(\1\) \? SETTLE_FX_MESSAGE : undefined\}/, b.trim().slice(0, 80));
  assert.match(SETTLE_FX_MESSAGE, /^Foreign-currency lines can't be settled/);
});

// A bank line, statement balance or import batch can be in GBP/USD: none may be formatted as
// euro. The rule, checked over the whole app source: no fmtEUR or literal € on a bank line's
// amount or balance; and the euro aggregates built from bank lines leave non-EUR lines out.
test('no hard-coded € on a bank line, and euro sums of bank lines leave non-EUR lines out', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const mobile = readFileSync(new URL('../src/Mobile.jsx', import.meta.url), 'utf8');
  const lines = (src, file) => src.split('\n').map((l, i) => ({ l, at: `${file}:${i + 1}` }));
  const all = [...lines(app, 'App.jsx'), ...lines(mobile, 'Mobile.jsx')];
  const btAmount = /\b(bt|row\.bt|item\.bt|settleFor|createJnlFor|transferFor)\.(amount|balance)\b/;
  const bad = all.filter(({ l }) =>
    /fmtEUR\(\s*(Math\.abs\()?\s*(Number\()?\s*(bt|row\.bt|item\.bt|settleFor|createJnlFor|transferFor)\.(amount|balance)/.test(l)
    || (/€\{/.test(l) && btAmount.test(l)));
  assert.deepEqual(bad.map(b => b.at), [], 'bank-line amount formatted as euro');

  // each place fixed in this change, by its own wording
  for (const [what, re] of [
    ['Worksheet amount', /fmtCurrencyFull\(row\.bt\.amount, row\.bt\.currency \|\| 'EUR'\)/],
    ['Worksheet running balance hidden when mixed', /runningBalance: mixed \? null : running/],
    ['re-categorise related line', /fmtCurrencyFull\(Math\.abs\(Number\(bt\.amount\)\), bt\.currency \|\| 'EUR'\)/],
    ['sibling prompt', /fmtCurrencyFull\(r\.amount, r\.currency \|\| 'EUR'\)/],
    ['preview CSV export', /"Currency", "Amount", "Balance"/],
    ['global search', /tertiary=\{fmtCurrencyFull\(r\.amount, r\.currency\)\}/],
    ['Overview unreconciled sum', /unrecTxns\s+\|\| \[\]\)\.filter\(t => !isForeignLine\(t\)\)/],
    ['Overview sparkline', /btRecent\.data\]\.filter\(r => !isForeignLine\(r\)\)/],
    ['cash position chart', /\[\.\.\.data\]\.filter\(r => !isForeignLine\(r\)\)/],
    ['Cash Flow', /setTxns\(txRes\.data\.filter\(t => !isForeignLine\(t\)\)\)/],
    ['matching engine', /const txns = \(allTxns \|\| \[\]\)\.filter\(t => !isForeignLine\(t\)\)/],
  ]) assert.match(app, re, what);
  assert.equal((mobile.match(/fmtLine\(Math\.abs\(Number\(t\.amount\)\), t\.currency\)/g) || []).length, 2, 'mobile recent lines');
  assert.match(mobile, /fmtLine\(Math\.abs\(Number\(item\.amount\)\), item\.currency\)/, 'mobile approval card');
  // every mobile bank-line select that feeds a displayed amount fetches currency
  for (const m of mobile.matchAll(/from\('bank_transactions'\)\s*\.select\('([^']*)'\)/g)) assert.match(m[1], /currency/, m[1]);
});

test('Choose account on a held non-EUR transfer is blocked, with the Settle message', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const i = src.indexOf('const saveTransfer = ');
  assert.match(src.slice(i, i + 300), /if \(isForeignLine\(bt\)\) \{ showToast\(SETTLE_FX_MESSAGE\); return; \}/);
  const btn = src.split('\n').find(l => /setTransferFor\(transferFor\?\.id === bt\.id \? null : bt\)/.test(l));
  assert.match(btn, /disabled=\{isForeignLine\(bt\)\} title=\{isForeignLine\(bt\) \? SETTLE_FX_MESSAGE : undefined\}/);
});
