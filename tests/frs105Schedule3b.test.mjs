// STA-01 Stage 2: the schedule3b mode. Every code maps to exactly one line or is reported; a
// balanced ledger always balances with zero imbalance; nothing is absorbed.
// Run: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeFrs105, frs105Warnings } from '../src/shared/statements/frs105.js';
import { MAPPING, BS_LINES, PNL_LINES, RESERVE_LINES, placeCode } from '../src/shared/statements/schedule3b.js';
import { GL_ACCOUNTS } from '../src/shared/glAccounts.js';

// The seed charts, read from source (chartOfAccounts.js imports React and the browser client).
const coaSrc = readFileSync(new URL('../src/shared/chartOfAccounts.js', import.meta.url), 'utf8');
const seed = name => {
  const i = coaSrc.indexOf(`export const ${name} = [`), j = coaSrc.indexOf('\n];', i);
  return [...coaSrc.slice(i, j).matchAll(/code: "(\w+)", name: "([^"]+)",\s*account_type: "(\w+)",\s*category: "([^"]+)"/g)]
    .map(m => ({ code: m[1], name: m[2], account_type: m[3], category: m[4] }));
};
const LTD = seed('COA_SEED'), SOLE = seed('COA_SEED_SOLE_TRADER');
// The Stage 2 proposed nominals (not in the seed until approved).
const PROPOSED = [
  { code: '2210', name: 'Corporation Tax Payable', account_type: 'liability', category: 'Current Liabilities' },
  { code: '3400', name: 'Dividends Paid', account_type: 'equity', category: 'Equity' },
  { code: '4250', name: 'Profit on Disposal of Fixed Assets', account_type: 'income', category: 'Income' },
  { code: '6550', name: 'Interest Payable', account_type: 'expense', category: 'Overheads' },
  { code: '8000', name: 'Corporation Tax', account_type: 'expense', category: 'Taxation' },
];
const LTD_NEW = [...LTD, ...PROPOSED];
const chartMap = rows => new Map(rows.map(r => [r.code, r]));
const LINE_KEYS = new Set([...BS_LINES, ...RESERVE_LINES, ...PNL_LINES].map(l => l.key).concat('DLA'));

test('every limited-company seed code and proposed code maps to exactly one line with a matching type', () => {
  assert.ok(LTD.length >= 48);
  for (const r of LTD_NEW) {
    const p = placeCode(r.code, chartMap(LTD_NEW));
    assert.ok(p.line, `${r.code} ${r.name}: ${p.reason}`);
    assert.ok(LINE_KEYS.has(p.line));
  }
});

test('every GL_ACCOUNTS code is in the mapping, with the same type', () => {
  for (const a of GL_ACCOUNTS) {
    assert.ok(MAPPING[a.code], `${a.code} ${a.name} has no line`);
    assert.equal(MAPPING[a.code].type, a.type.toLowerCase(), `${a.code} type`);
  }
});

test('sole-trader-only codes are reported, not placed', () => {
  for (const code of ['3200', '3300']) assert.equal(placeCode(code, chartMap(SOLE)).reason, 'no Schedule 3B line for this code');
});

test('the mapping covers exactly the limited seed plus the proposed codes', () => {
  assert.deepEqual(Object.keys(MAPPING).sort(), LTD_NEW.map(r => r.code).sort());
});

test('every mapped code appears exactly once and every line key is real', () => {
  for (const [code, m] of Object.entries(MAPPING)) {
    assert.match(code, /^\d{4}$/);
    assert.ok(LINE_KEYS.has(m.line), `${code} -> ${m.line}`);
  }
});

// Random balanced ledgers over every mapped code: the balance sheet must balance exactly.
const CHART = Object.entries(MAPPING).map(([code, m]) => ({ code, name: `n${code}`, account_type: m.type }));
const rng = seedN => () => ((seedN = (seedN * 1103515245 + 12345) % 2147483648) / 2147483648);
const codes = Object.keys(MAPPING);
test('300 random balanced ledgers balance with zero imbalance and nothing unmapped', () => {
  for (let s = 1; s <= 300; s++) {
    const r = rng(s);
    const js = Array.from({ length: 5 + Math.floor(r() * 200) }, () => {
      const y = 2023 + Math.floor(r() * 3), m = 1 + Math.floor(r() * 12), d = 1 + Math.floor(r() * 28);
      return { date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        debit_account: codes[Math.floor(r() * codes.length)], credit_account: codes[Math.floor(r() * codes.length)],
        amount: (Math.floor(r() * 10000000) / 100).toFixed(2) };
    });
    for (const [yearEnd, yeMonth] of [['2025-12-31', 12], ['2025-04-30', 4]]) {
      const upTo = js.filter(j => j.date <= yearEnd);
      const res = computeFrs105(upTo, { yearEnd, yeMonth, mode: 'schedule3b', chart: CHART });
      assert.deepEqual(res.unmapped, [], `seed ${s}`);
      assert.equal(res.imbalance, 0, `seed ${s} ${yearEnd}`);
      assert.equal(res.netAssets, res.bs.K.amount);
      assert.equal(res.profit, res.reserves.yearResult);
    }
  }
});

const J = (date, debit_account, credit_account, amount, reference = null) => ({ date, debit_account, credit_account, amount: String(amount), reference });
const s3b = (js, yearEnd = '2025-12-31', chart = LTD_NEW, yeMonth = 12) =>
  computeFrs105(js.filter(j => j.date <= yearEnd), { yearEnd, yeMonth, mode: 'schedule3b', chart });

test('an unmapped code is reported and its balance shows as the imbalance, never absorbed', () => {
  const res = s3b([J('2025-01-01', '1000', '3000', 100), J('2025-02-01', '9999', '1000', 30), J('2025-03-01', '1000', '4000', 50)]);
  assert.deepEqual(res.unmapped, [{ code: '9999', name: null, reason: 'no Schedule 3B line for this code', debitNet: 30, yearMovement: 30 }]);
  assert.equal(res.imbalance, -30);
  assert.equal(res.bs.C.amount, 120);
  assert.equal(res.bs.K.amount, 150);       // 100 capital + 50 profit; the 30 is not hidden in reserves
  const ws = frs105Warnings([], res);
  assert.deepEqual(ws.filter(w => w.id === 'unmapped' || w.id === 'imbalance').map(w => w.id), ['unmapped', 'imbalance']);
  assert.equal(ws.some(w => w.id === 'absorbed'), false);
});

test("a code missing from the company's chart, or with the wrong type, is reported", () => {
  const chart = LTD_NEW.filter(r => r.code !== '6600').map(r => (r.code === '6300' ? { ...r, account_type: 'asset' } : r));
  const res = s3b([J('2025-01-01', '1000', '3000', 100), J('2025-02-01', '6600', '1000', 10), J('2025-02-02', '6300', '1000', 5)], '2025-12-31', chart);
  assert.deepEqual(res.unmapped.map(u => [u.code, u.reason]), [['6300', 'chart type is asset, expected expense'], ['6600', "not in the company's chart of accounts"]]);
  assert.equal(res.imbalance, -15);           // unmapped debits leave net assets below capital and reserves
});

test('lines, signs and the directors loan placed by sign', () => {
  const res = s3b([
    J('2025-01-01', '1000', '3000', 2), J('2025-01-02', '1000', '2500', 30000), J('2025-01-03', '1200', '1000', 120),
    J('2025-01-04', '6100', '2300', 300), J('2025-01-05', '1000', '4000', 5000), J('2025-01-06', '1000', '4300', 7),
    J('2025-01-07', '6000', '1000', 1000), J('2025-01-08', '5100', '1000', 400), J('2025-01-09', '6950', '1501', 150),
    J('2025-01-10', '1500', '1000', 1500), J('2025-01-11', '2400', '1000', 250), J('2025-01-12', '8000', '2210', 90),
    J('2025-01-13', '3400', '1000', 500),
  ]);
  const amt = k => res.bs[k].amount, p = k => res.pnl[k].amount;
  assert.deepEqual([p('1'), p('2'), p('3'), p('4'), p('5'), p('6'), p('7'), p('8')], [5000, 7, 400, 1000, 150, 300, 90, 3067]);
  assert.equal(amt('B'), 1350);                     // 1500 cost - 150 depreciation
  assert.equal(amt('D'), 120);
  assert.equal(amt('J'), 300);
  assert.equal(amt('H'), 30000);
  assert.equal(amt('E'), 90);                       // corporation tax payable
  assert.ok(res.bs.C.codes.some(c => c.code === '2400' && c.amount === 250));   // DLA in debit is a debtor
  assert.equal(res.reserves.dividends, 500);
  assert.equal(amt('K2'), 3067 - 500);
  assert.equal(res.imbalance, 0);
  const credit = s3b([J('2025-01-01', '1000', '2400', 75)]);
  assert.ok(credit.bs.E.codes.some(c => c.code === '2400' && c.amount === 75)); // in credit, a creditor
});

test('reserves = 3100 + results before the year + the year result - dividends', () => {
  const res = s3b([
    J('2023-06-01', '1000', '3100', 1505), J('2024-03-01', '1000', '4000', 800), J('2024-04-01', '6100', '1000', 300),
    J('2025-02-01', '1000', '4000', 1000), J('2025-03-01', '3400', '1000', 200),
  ]);
  assert.deepEqual(res.reserves, { retainedEarnings: 1505, priorResults: 500, yearResult: 1000, dividends: 200 });
  assert.equal(res.bs.K2.amount, 2805);
  assert.equal(res.imbalance, 0);
});

test('legacy mode is unaffected by the chart option', () => {
  const js = [J('2025-01-01', '1000', '3000', 100), J('2025-02-01', '2500', '1000', 30)];
  const a = computeFrs105(js, { yearEnd: '2025-12-31', yeMonth: 12 });
  const b = computeFrs105(js, { yearEnd: '2025-12-31', yeMonth: 12, chart: LTD });
  assert.equal(a.retainedEarns, b.retainedEarns);
  assert.equal(a.mode, undefined);
});

test('ledger_complete_from on or before the period start satisfies condition (b)', () => {
  const js = [J('2025-03-01', '1000', '4000', 50)];
  const res = s3b(js);
  assert.ok(frs105Warnings(js, res, { yearEnd: '2025-12-31' }).some(w => w.id === 'no_opening'));
  assert.ok(!frs105Warnings(js, res, { yearEnd: '2025-12-31', ledgerCompleteFrom: '2025-01-01' }).some(w => w.id === 'no_opening'));
  assert.ok(frs105Warnings(js, res, { yearEnd: '2025-12-31', ledgerCompleteFrom: '2025-03-01' }).some(w => w.id === 'no_opening'));
});
