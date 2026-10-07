// STA-01 Stage 4a: comparatives (src/shared/statements/comparatives.js). Run: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPARATIVE_LINES, groupOf, ledgerLines, withSubtotals, priorColumn, ledgerDifferences } from '../src/shared/statements/comparatives.js';
import { computeFrs105 } from '../src/shared/statements/frs105.js';

const J = (date, debit_account, credit_account, amount, reference = null) => ({ date, debit_account, credit_account, amount, reference });
const chart = [
  { code: '1000', name: 'Bank', account_type: 'asset' }, { code: '2300', name: 'Accruals', account_type: 'liability' },
  { code: '3000', name: 'Share capital', account_type: 'equity' }, { code: '3100', name: 'Retained earnings', account_type: 'equity' },
];
// S&P's OPENING journal at 8 October 2025 (the signed balance sheet).
const opening = [J('2025-10-08', '1000', '2300', 2161, 'OPENING'), J('2025-10-08', '1000', '3000', 2, 'OPENING'), J('2025-10-08', '1000', '3100', 1505, 'OPENING')];

test('every Schedule 3B line has a comparative key, and res.* confirm with the balance sheet', () => {
  assert.equal(COMPARATIVE_LINES.length, 22);
  assert.equal(groupOf('res.bf'), 'bs');
  assert.equal(groupOf('pnl.8'), 'pnl');
  assert.deepEqual(COMPARATIVE_LINES.filter(l => l.subtotal).map(l => l.key), ['bs.F', 'bs.G', 'bs.K', 'pnl.8']);
});

test('ledgerLines: S&P at 8 October 2025 gives the signed balance sheet', () => {
  const S = computeFrs105(opening, { yearEnd: '2025-10-08', yeMonth: 10, periodStart: '2024-10-09', mode: 'schedule3b', chart });
  const L = ledgerLines(S);
  assert.deepEqual([L['bs.C'], L['bs.E'], L['bs.F'], L['bs.G'], L['bs.K1'], L['bs.K2'], L['bs.K']], [3668, 2161, 1507, 1507, 2, 1505, 1507]);
  assert.equal(L['pnl.8'], 0);
  assert.equal(L['res.bf'], 1505);
});

test('priorColumn uses confirmed lines only, per group, with subtotals computed', () => {
  const rows = [
    ...[['bs.A', 0], ['bs.B', 0], ['bs.C', 2873], ['bs.D', 0], ['bs.E', 2115], ['bs.F', 759], ['bs.H', 0], ['bs.I', 0], ['bs.K1', 2], ['bs.K2', 757]]
      .map(([line_key, a]) => ({ line_key, status: 'confirmed', confirmed_amount: a, amount: a })),
    { line_key: 'pnl.8', status: 'draft', amount: 424 },
  ];
  const p = priorColumn(rows);
  assert.equal(p.pnl, null, 'a draft P&L is not shown');
  assert.equal(p.bs['bs.F'], 759, 'the printed subtotal is kept');
  assert.equal(p.bs['bs.G'], 759);
  assert.equal(p.bs['bs.K'], 759);
  assert.equal(p.bs.netAssets, 759);
  assert.deepEqual(priorColumn([]), { bs: null, pnl: null });
});

test('withSubtotals computes F, G, K, P&L and net assets when absent', () => {
  const x = withSubtotals({ 'bs.A': 0, 'bs.B': 100, 'bs.C': 50, 'bs.D': 0, 'bs.E': 30, 'bs.H': 10, 'bs.I': 0, 'bs.K1': 2, 'bs.K2': 108,
    'pnl.1': 1000, 'pnl.2': 0, 'pnl.3': 100, 'pnl.4': 200, 'pnl.5': 0, 'pnl.6': 300, 'pnl.7': 50 });
  assert.deepEqual([x['bs.F'], x['bs.G'], x.netAssets, x['bs.K'], x['pnl.8']], [20, 120, 110, 110, 350]);
});

test('ledgerDifferences lists only lines that differ', () => {
  const prior = { bs: withSubtotals({ 'bs.A': 0, 'bs.B': 0, 'bs.C': 3668, 'bs.D': 0, 'bs.E': 2161, 'bs.H': 0, 'bs.I': 0, 'bs.K1': 2, 'bs.K2': 1505 }), pnl: null };
  const S = computeFrs105(opening, { yearEnd: '2025-10-08', yeMonth: 10, periodStart: '2024-10-09', mode: 'schedule3b', chart });
  assert.deepEqual(ledgerDifferences(prior, ledgerLines(S)), []);
  const off = { bs: { ...prior.bs, 'bs.C': 3669 }, pnl: null };
  assert.deepEqual(ledgerDifferences(off, ledgerLines(S)).map(d => [d.key, d.difference]), [['bs.C', 1]]);
});
