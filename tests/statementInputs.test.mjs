// STA-01 Stage 3c: the inputs evaluator and the ledger-evidenced suggestions.
// Run: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DISCLOSURES, LEGAL_FORMS, informationRequired, ledgerEvidence, suggestion, fixedAssetClasses, directorsInOffice } from '../src/shared/statements/statementInputs.js';

const J = (date, debit_account, credit_account, amount) => ({ date, debit_account, credit_account, amount: String(amount) });
const period = { fyStart: '2025-01-01', yearEnd: '2025-12-31' };
const D1 = { id: 'd1', full_name: 'Ann', appointed_on: '2020-01-01', resigned_on: null };
const D2 = { id: 'd2', full_name: 'Bob', appointed_on: '2021-01-01', resigned_on: null };
const allAttested = DISCLOSURES.map(d => ({ disclosure_key: d.key, has_items: false, details: {} }));
const complete = {
  company: { cro_number: '123456', incorporation_date: '2020-01-01' },
  profile: { legal_form: 'LTD', registered_office: '1 Main St', country: 'Ireland' },
  directors: [D1, D2],
  yearInputs: { approval_date: '2026-06-30', signatory_ids: ['d1', 'd2'], average_employees: 3, policy_inputs: {} },
  disclosures: allAttested, assetClasses: [], yearEnd: '2025-12-31',
};

test('nothing recorded: everything is required, and nothing is assumed', () => {
  const m = informationRequired({ yearEnd: '2025-12-31' });
  const keys = m.map(x => x.key);
  for (const k of ['legal_form', 'registered_office', 'country', 'cro_number', 'incorporation_date', 'directors', 'approval_date', 'signatories', 'average_employees']) assert.ok(keys.includes(k), k);
  for (const d of DISCLOSURES) assert.ok(keys.includes(d.key), d.key);
  assert.ok(m.every(x => x.field && x.label && x.section));
});

test('a complete set of inputs leaves nothing required', () => {
  assert.deepEqual(informationRequired(complete), []);
});

test('two signatories, or one when there is a sole director in office at approval', () => {
  const one = { ...complete, yearInputs: { ...complete.yearInputs, signatory_ids: ['d1'] } };
  assert.deepEqual(informationRequired(one).map(x => x.key), ['signatories']);
  const sole = { ...one, directors: [D1, { ...D2, resigned_on: '2026-01-31' }] };
  assert.deepEqual(informationRequired(sole), []);
  // a signatory not in office at the approval date does not count
  const stale = { ...complete, directors: [D1, { ...D2, resigned_on: '2026-01-31' }, { id: 'd3', full_name: 'Cy', appointed_on: '2026-05-01' }], yearInputs: { ...complete.yearInputs, signatory_ids: ['d1', 'd2'] } };
  assert.deepEqual(informationRequired(stale).map(x => x.key), ['signatories']);
});

test('a "yes" disclosure needs details; audit exemption needs its section', () => {
  const withYes = { ...complete, disclosures: allAttested.map(d => (d.disclosure_key === 'commitments' ? { ...d, has_items: true } : d.disclosure_key === 'audit_exemption' ? { ...d, has_items: true } : d)) };
  assert.deepEqual(informationRequired(withYes).map(x => x.key).sort(), ['audit_exemption_section', 'commitments_details']);
  const filled = { ...complete, disclosures: allAttested.map(d => (d.disclosure_key === 'commitments' ? { ...d, has_items: true, narrative: 'Lease of premises: €12,000 a year to 2028.' } : d.disclosure_key === 'audit_exemption' ? { ...d, has_items: true, details: { section: '358' } } : d)) };
  assert.deepEqual(informationRequired(filled), []);
});

test('each fixed-asset class with a balance or movement needs a depreciation rate', () => {
  const js = [J('2025-03-01', '1510', '1000', 400), J('2025-06-28', '6950', '1500', 600), J('2024-01-01', '1530', '1000', 100), J('2024-02-01', '1000', '1530', 100)];
  assert.deepEqual(fixedAssetClasses(js, period), ['1500', '1510']);
  const m = informationRequired({ ...complete, assetClasses: ['1500', '1510'], yearInputs: { ...complete.yearInputs, policy_inputs: { depreciation: { 1510: '20% straight line' } } } });
  assert.deepEqual(m.map(x => x.key), ['depreciation_1500']);
});

test('suggestions only where the ledger shows nothing, never for commitments or post-balance-sheet events', () => {
  const quiet = ledgerEvidence([J('2025-02-01', '1000', '4000', 50)], period);
  assert.ok(suggestion('directors_loan', quiet));
  assert.ok(suggestion('dividends', quiet));
  assert.ok(suggestion('share_capital', quiet));
  for (const key of ['commitments', 'post_bs_events']) assert.equal(DISCLOSURES.find(d => d.key === key).suggest, null);
  // 2400 moved in the year but nets to nil: no suggestion
  const moved = ledgerEvidence([J('2025-02-01', '2400', '1000', 50), J('2025-03-01', '1000', '2400', 50)], period);
  assert.equal(suggestion('directors_loan', moved), null);
  // 2400 balance carried from before the year with no movements: no suggestion
  const carried = ledgerEvidence([J('2024-05-01', '2400', '1000', 50)], period);
  assert.equal(suggestion('directors_loan', carried), null);
  // a dividend paid: no suggestion; share capital issued in the year: no suggestion
  assert.equal(suggestion('dividends', ledgerEvidence([J('2025-06-01', '3400', '1000', 500)], period)), null);
  assert.equal(suggestion('share_capital', ledgerEvidence([J('2025-01-15', '1000', '3000', 100)], period)), null);
  // share capital issued before the year: still suggested (no postings in the year)
  assert.ok(suggestion('share_capital', ledgerEvidence([J('2020-01-15', '1000', '3000', 100)], period)));
});

test('directors in office and the legal-form list', () => {
  assert.deepEqual(directorsInOffice([D1, { ...D2, appointed_on: '2026-07-01' }], '2026-06-30').map(d => d.id), ['d1']);
  assert.deepEqual(LEGAL_FORMS.map(f => f.value), ['LTD', 'DAC', 'CLG', 'UC', 'ULC']);
});
