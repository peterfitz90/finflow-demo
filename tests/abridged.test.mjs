// CRO abridged copy (wording sheet agreed by Peter, 7 October 2026). Run: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ABRIDGED, WORDING_STATUS, abridgedStatements, certificationPage, statementNotes, PLACEHOLDER } from '../src/shared/statements/wording.js';
import { informationRequired } from '../src/shared/statements/statementInputs.js';
import { assembleStatements } from '../src/shared/statements/assemble.js';
import { renderStatementsPdf } from '../api/_statements-pdf-doc.js';

const row = (k, has_items, extra = {}) => ({ disclosure_key: k, has_items, ...extra });
const claimed = [row('audit_exemption', true, { details: { section: '359' } }), row('no_s334_notice', false)];

test('every abridged item is recorded as agreed by Peter on 7 October 2026', () => {
  const keys = Object.keys(WORDING_STATUS).filter(k => k.startsWith('abridged.'));
  assert.deepEqual(keys, ['abridged.A1', 'abridged.A2', 'abridged.A3', 'abridged.A4', 'abridged.A5', 'abridged.A6', 'abridged.A7', 'abridged.A8', 'abridged.notes']);
  for (const k of keys) assert.deepEqual([WORDING_STATUS[k].status, WORDING_STATUS[k].by, WORDING_STATUS[k].on], ['verified', 'Peter', '2026-10-07'], k);
});

test('A6 + A7: (a)-(d) as the full set, (c) loses "and", (d) gains it, then (e) micro wording', () => {
  const a = abridgedStatements({ companyName: 'X Ltd', disclosures: claimed, approvalDate: '7 January 2027', signatories: ['A', 'B'] });
  const st = a.auditExemption;
  assert.match(st.find(l => l.startsWith('(c)')), /;$/);
  assert.match(st.find(l => l.startsWith('(d)')), /; and$/);
  assert.equal(st[st.length - 1], ABRIDGED.statementE);
  assert.match(ABRIDGED.statementE, /section 352 .* as a micro company, .* section 353/);
  assert.doesNotMatch(ABRIDGED.statementE, /small company/);
  // no audit exemption recorded: the placeholder, then (e)
  const none = abridgedStatements({ companyName: 'X Ltd', disclosures: [] });
  assert.deepEqual(none.auditExemption, [PLACEHOLDER('audit exemption claimed or not'), ABRIDGED.statementE]);
});

test('A1 certification: section 347, two directors by default, or a director and the secretary', () => {
  const two = certificationPage({ periodPhrase: 'year ended 8 October 2026', directorNames: ['Sean Moylan', 'Peter Fitzsimons'], date: '1 December 2026' });
  assert.match(two.text, /for the financial year ended 8 October 2026, which are required by section 347 of the Companies Act 2014/);
  assert.doesNotMatch(two.text, /1303|EEA/);
  assert.deepEqual(two.signatories, [{ name: 'Sean Moylan', role: 'Director' }, { name: 'Peter Fitzsimons', role: 'Director' }]);
  const sec = certificationPage({ periodPhrase: 'year ended 8 October 2026', directorNames: ['Sean Moylan'], secretaryName: 'Jane Doe' });
  assert.deepEqual(sec.signatories.map(s => s.role), ['Director', 'Secretary']);
  assert.equal(sec.date, PLACEHOLDER('certification date'));
});

test('abridged notes: the full set without the reserves movement note', () => {
  const args = { companyName: 'X Ltd', reserves: { atStart: 1, result: 2, dividendsInYear: 0, atEnd: 3 }, shareCapital: { amount: 2, number: 2, shareClass: 'Ordinary' }, disclosures: [row('post_bs_events', false)] };
  const full = statementNotes(args).map(n => n.title);
  const ab = statementNotes({ ...args, abridged: true }).map(n => n.title);
  assert.ok(full.includes('Reserves and dividends'));
  assert.deepEqual(ab, full.filter(t => t !== 'Reserves and dividends'));
  for (const t of ['Called up share capital', 'Events after the balance sheet date', 'Advances, credits and guarantees to directors', 'Financial commitments, guarantees and contingencies', 'Own shares']) assert.ok(ab.includes(t), t);
});

test('information required: certification signatories and date only when abridged filing is elected', () => {
  const base = { company: { cro_number: '1', incorporation_date: '2020-01-01' }, yearEnd: '2026-10-08' };
  const keys = a => informationRequired({ ...base, abridged: a }).map(x => x.key).filter(k => k.startsWith('certification'));
  assert.deepEqual(keys({}), []);
  assert.deepEqual(keys({ elected: true }), ['certification_signatories', 'certification_date']);
  assert.deepEqual(keys({ elected: true, certification: { director_ids: ['d1'], secretary_name: 'Jane', date: '2026-12-01' } }), []);
  assert.deepEqual(keys({ elected: true, certification: { director_ids: ['d1'], date: '2026-12-01' } }), ['certification_signatories']);
});

test('the abridged PDF: certification, cover, contents, balance sheet, notes; no P&L; DRAFT', async () => {
  const J = (date, d, c, a, ref = null) => ({ id: date + d + c + a, date, debit_account: d, credit_account: c, amount: a, reference: ref });
  const chart = [{ code: '1000', name: 'Bank', account_type: 'asset' }, { code: '4000', name: 'Sales', account_type: 'income' }, { code: '3000', name: 'Share capital', account_type: 'equity' }];
  const A = assembleStatements({ company: { id: 'c', name: 'X Ltd', year_end_month: 12 }, companyName: 'X Ltd', journals: [J('2026-01-02', '1000', '4000', 100), J('2026-01-01', '1000', '3000', 2)],
    chart, bankCodes: ['1000'], yearEnd: '2026-12-31', today: '2026-12-31',
    inputs: { directors: [{ id: 'd1', full_name: 'Sean Moylan' }, { id: 'd2', full_name: 'Peter Fitzsimons' }], disclosures: claimed,
      yearInputs: { policy_inputs: { abridged: { elected: true, certification: { director_ids: ['d1', 'd2'], date: '2027-01-07' } } } } } });
  assert.equal(A.abridgedElected, true);
  assert.deepEqual(A.certification.signatories.map(s => s.name), ['Sean Moylan', 'Peter Fitzsimons']);
  const pdf = Buffer.from(await renderStatementsPdf({ companyName: 'X Ltd', croNumber: '1', assembled: A, yearEnd: '2026-12-31', approved: false, variant: 'abridged' }));
  assert.match(pdf.toString('latin1'), /\/Count 5/, 'five pages');
  const full = Buffer.from(await renderStatementsPdf({ companyName: 'X Ltd', croNumber: '1', assembled: A, yearEnd: '2026-12-31', approved: false }));
  assert.match(full.toString('latin1'), /\/Count 4/, 'the full set is unchanged');
});
