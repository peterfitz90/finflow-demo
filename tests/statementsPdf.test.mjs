// STA-01 Stage 5a: the shared statements assembly and the draft PDF. Run: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assembleStatements, resolvePeriod } from '../src/shared/statements/assemble.js';
import { renderStatementsPdf, fa } from '../api/_statements-pdf-doc.js';

const J = (date, debit_account, credit_account, amount, reference = null) => ({ id: `${date}-${debit_account}-${credit_account}-${amount}`, date, debit_account, credit_account, amount, reference });
const chart = [
  { code: '1000', name: 'Bank', account_type: 'asset' }, { code: '2300', name: 'Accruals', account_type: 'liability' },
  { code: '3000', name: 'Share capital', account_type: 'equity' }, { code: '3100', name: 'Retained earnings', account_type: 'equity' },
  { code: '4000', name: 'Sales', account_type: 'income' }, { code: '6600', name: 'Sundry', account_type: 'expense' },
];
const company = { id: 'c', name: 'Test Co Limited', year_end_month: 10, fy_end_day: 8, cro_number: '123456' };
const journals = [
  J('2025-10-08', '1000', '2300', 2161, 'OPENING'), J('2025-10-08', '1000', '3000', 2, 'OPENING'), J('2025-10-08', '1000', '3100', 1505, 'OPENING'),
  J('2026-01-15', '1000', '4000', 1000), J('2026-02-10', '6600', '1000', 300),
];
const base = { company, companyName: company.name, journals, chart, bankCodes: ['1000'], openingJournals: journals.filter(j => j.reference === 'OPENING'), yearEnd: '2026-10-08', today: '2026-10-08' };

test('resolvePeriod: S&P-style year end on the 8th', () => {
  const r = resolvePeriod({ company, yearEnd: '2026-10-08', today: '2026-10-08' });
  assert.equal(r.fyStart, '2025-10-09');
  assert.equal(r.selectedPeriod.months, 12);
});

test('assembleStatements: figures, DRAFT while inputs are missing, notes and wording', () => {
  const A = assembleStatements({ ...base, inputs: {} });
  assert.equal(A.pfYear, 700);
  assert.equal(A.frs105.netAssets, 2207);
  assert.equal(A.s3bs.K2.amount, 2205);
  assert.equal(A.isDraft, true, 'inputs missing');
  assert.ok(A.infoRequired.some(x => x.key === 'comparatives_bs'), 'a prior year exists, so comparatives are required');
  assert.deepEqual(A.notes.map(n => n.title).slice(0, 3), ['Company information', 'Statement of compliance', 'Accounting policies']);
  assert.equal(A.periodPhrase, 'year ended 8 October 2026');
  const notGenerated = assembleStatements({ ...base, generated: false, inputs: {} });
  assert.equal(notGenerated.isDraft, false);
  assert.deepEqual(notGenerated.notes, []);
});

test('confirmed comparatives make the prior-year column; drafts do not', () => {
  const rows = [['bs.A', 0], ['bs.B', 0], ['bs.C', 3668], ['bs.D', 0], ['bs.E', 2161], ['bs.H', 0], ['bs.I', 0], ['bs.K1', 2], ['bs.K2', 1505]];
  const draft = assembleStatements({ ...base, inputs: { comparatives: rows.map(([line_key, a]) => ({ line_key, amount: a, status: 'draft' })) } });
  assert.equal(draft.showPrior, false);
  const confirmed = assembleStatements({ ...base, inputs: { comparatives: rows.map(([line_key, a]) => ({ line_key, amount: a, confirmed_amount: a, status: 'confirmed' })) } });
  assert.equal(confirmed.showPrior, true);
  assert.equal(confirmed.prior.bs.netAssets, 1507);
  assert.deepEqual(confirmed.compDiffs, [], 'the confirmed lines agree with the ledger at the prior year end');
});

test('the draft PDF renders (cover, P&L, balance sheet, notes) with the embedded font', async () => {
  const A = assembleStatements({ ...base, inputs: {} });
  const pdf = await renderStatementsPdf({ companyName: company.name, croNumber: company.cro_number, assembled: A, yearEnd: '2026-10-08', approved: false });
  const head = Buffer.from(pdf).subarray(0, 5).toString();
  assert.equal(head, '%PDF-');
  const text = Buffer.from(pdf).toString('latin1');
  assert.match(text, /\/Count 4/, 'four pages');
  assert.match(text, /LedgrlySans/, 'Ledgrly Sans embedded');
  assert.equal(fa(-2161), '(€2,161)');
  assert.equal(fa(0.4), '—');
});

test('the endpoint is accountant-only and reads with the caller\'s token, never the service role', () => {
  const src = readFileSync(new URL('../api/statements-pdf.js', import.meta.url), 'utf8');
  assert.match(src, /await requireAccountant\(req, company_id\)/);
  assert.match(src, /accessToken: async \(\) => token/);
  assert.doesNotMatch(src, /SERVICE_ROLE/);
});

test('the embedded font has no ligatures (PDF text extracts and searches as written) and has the euro sign', async () => {
  const { createRequire } = await import('node:module');
  const fontkit = createRequire(import.meta.url)('fontkit');
  for (const w of ['400', '700']) {
    const f = fontkit.openSync(new URL(`../api/_fonts/ledgrly-sans-${w}.woff`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
    assert.equal(f.familyName, 'Ledgrly Sans', 'renamed: "Source" is a Reserved Font Name');
    for (const tag of ['liga', 'clig', 'dlig', 'rlig']) assert.ok(!f.availableFeatures.includes(tag), `${w}: no ${tag}`);
    assert.ok(f.glyphForCodePoint(0x20AC).id > 0, 'has the euro sign');
    const run = f.layout('Staff office profit difference affiliated');
    assert.equal(run.glyphs.length, 'Staff office profit difference affiliated'.length, 'one glyph per character: nothing joined');
  }
});
