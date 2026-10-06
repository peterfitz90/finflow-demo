// STA-01 Stage 1: the shared FRS 105 engine must reproduce the pre-extraction code exactly.
// The baseline is read from git (tests/statements/baseline.mjs), not copied. Synthetic journals
// only; scripts/frs105-regression.mjs runs the same comparison over every real company.
// Run: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadBaseline, diffResults, FIGURES } from './statements/baseline.mjs';
import { computeFrs105, frs105FiscalYear } from '../src/shared/statements/frs105.js';
import { GL_ACCOUNTS } from '../src/shared/glAccounts.js';
import { LEGACY_GL_ACCOUNTS } from '../src/shared/statements/legacyGlAccounts.js';
import { localDateStr } from '../src/shared/dates.js';

const base = loadBaseline();
const engineSrc = readFileSync(new URL('../src/shared/statements/frs105.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const legacyGlSrc = readFileSync(new URL('../src/shared/statements/legacyGlAccounts.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the moved blocks are byte-identical to the baseline', () => {
  assert.ok(engineSrc.includes(base.blocks.fiscalYear), 'fiscal-year block changed');
  assert.ok(engineSrc.includes(base.blocks.figures), 'figures block changed');
  // The legacy engine types accounts from a frozen copy of the baseline GL_ACCOUNTS.
  assert.ok(engineSrc.includes("import { LEGACY_GL_ACCOUNTS as GL_ACCOUNTS } from './legacyGlAccounts.js';"), 'legacy engine not on the frozen list');
  assert.ok(legacyGlSrc.includes(base.blocks.glAccounts.replace('export const GL_ACCOUNTS = [', 'export const LEGACY_GL_ACCOUNTS = [')), 'frozen legacy GL list changed');
  assert.deepEqual(LEGACY_GL_ACCOUNTS, base.GL_ACCOUNTS);
  // GL_ACCOUNTS may only grow: every baseline entry is still there, unchanged.
  for (const a of base.GL_ACCOUNTS) assert.deepEqual(GL_ACCOUNTS.find(g => g.code === a.code), a);
  // The query moved into fetchJournalsToDate with only the client and id renamed.
  const norm = s => s.replace(/\s+/g, '').replace('supabase.from', 'db.from').replace('company.id', 'companyId');
  const q = engineSrc.slice(engineSrc.indexOf('fetchAllRows(() => db.from'), engineSrc.indexOf(".order('id'));") + 14);
  assert.equal(norm(q), norm(base.blocks.query.slice(base.blocks.query.indexOf('fetchAllRows'))));
});

// Every range the statements use, codes outside them (absorbed by the balancing figure), several
// fiscal years, reversals, non-GL codes, fractional cents and string amounts as PostgREST returns.
const J = (date, debit_account, credit_account, amount) => ({ date, debit_account, credit_account, amount: String(amount) });
const journals = [
  J('2023-03-01', '1000', '3000', 100), J('2023-04-15', '1000', '4000', 1234.56), J('2023-06-30', '6100', '1000', 300.1),
  J('2024-01-10', '1500', '1000', 4000), J('2024-02-01', '6950', '1501', 66.67), J('2024-05-05', '1100', '4100', 999.99),
  J('2024-07-01', '1000', '2500', 30000), J('2024-08-01', '2400', '1000', 250.5), J('2024-09-09', '1600', '2100', 23),
  J('2024-12-31', '7100', '1000', 12.34), J('2025-01-01', '1000', '7000', 5.01), J('2025-02-02', '5000', '2000', 777.77),
  J('2025-03-03', '1300', '4200', 0.005), J('2025-04-04', '1000', '3100', 1505), J('2025-05-05', '6600', '1000', 0.1),
  J('2025-05-05', '1000', '6600', 0.1), J('2025-06-06', '9999', '1000', 42), J('2025-07-07', '1000', 'ABC', 7.77),
  J('2025-10-31', '6000', '2200', 1500.25), J('2025-11-01', '2300', '1000', 89.9), J('2025-12-31', '1000', '4300', 0.33),
  J('2026-01-01', '1000', '1100', 999.99), J('2026-04-30', '6950', '1500', 150),
];

for (const yeMonth of [12, 4, 10, 1, 6]) {
  test(`engine equals baseline for every figure (year-end month ${yeMonth})`, () => {
    for (const yearEnd of [...base.yearEnds(yeMonth, localDateStr), '2024-12-31', '2025-10-31']) {
      const upTo = journals.filter(j => j.date <= yearEnd);
      const { diffs, compared } = diffResults(base.compute(upTo, yearEnd, yeMonth), computeFrs105(upTo, { yearEnd, yeMonth }));
      assert.deepEqual(diffs, [], `year end ${yearEnd}`);
      assert.ok(compared > FIGURES.length);
    }
  });
}

test('empty ledger and no year end behave as before', () => {
  for (const [js, ye] of [[[], '2025-12-31'], [journals, '']]) {
    assert.deepEqual(diffResults(base.compute(js, ye, 12), computeFrs105(js, { yearEnd: ye, yeMonth: 12 })).diffs, []);
  }
  assert.equal(frs105FiscalYear('', 12).fyStart, null);
});

test('the comparison detects a one-cent difference (harness self-check)', () => {
  const ye = '2025-12-31';
  const tweaked = journals.map((j, i) => (i === 1 ? { ...j, amount: '1234.57' } : j)).filter(j => j.date <= ye);
  const { diffs } = diffResults(base.compute(journals.filter(j => j.date <= ye), ye, 12), computeFrs105(tweaked, { yearEnd: ye, yeMonth: 12 }));
  assert.ok(diffs.some(d => d.startsWith('retainedEarns')), 'balancing figure difference not detected');
});

test('only legacy mode exists', () => {
  assert.throws(() => computeFrs105([], { yearEnd: '2025-12-31', yeMonth: 12, mode: 'mapped' }), /Unknown FRS 105 mode/);
});
