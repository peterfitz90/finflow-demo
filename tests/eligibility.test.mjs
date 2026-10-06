// STA-01 Stage 3e: micro eligibility, warn only. Run: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { microEligibility } from '../src/shared/statements/eligibility.js';
import { MICRO, SMALL, MICRO_LEGAL_FORMS } from '../src/shared/statements/thresholds.js';

const attested = ['not_group_parent', 'not_consolidated_subsidiary', 'not_investment_or_financial_holding', 'not_ineligible_entity']
  .map(k => ({ disclosure_key: k, has_items: false }));
const base = { turnover: 100000, grossAssets: 50000, employees: 3, legalForm: 'LTD', disclosures: attested };

test('thresholds carry their source and status', () => {
  assert.deepEqual([MICRO.turnover, MICRO.balanceSheetTotal, MICRO.employees, MICRO.criteriaToMeet], [900000, 450000, 10, 2]);
  assert.deepEqual([SMALL.turnover, SMALL.balanceSheetTotal, SMALL.employees], [15000000, 7500000, 50]);
  for (const t of [MICRO, SMALL]) { assert.match(t.source, /280/); assert.equal(t.status, 'verified'); }
  assert.deepEqual(MICRO_LEGAL_FORMS.forms, ['LTD', 'DAC']);
  assert.equal(MICRO_LEGAL_FORMS.status, 'unverified');
});

test('a clean micro LTD has no warnings apart from the unchecked two-year rule', () => {
  const r = microEligibility(base);
  assert.equal(r.sizeResult, 'meets');
  assert.deepEqual(r.warnings, []);
  assert.ok(r.notes.some(n => /Two-year rule/.test(n)));
});

test('each threshold is inclusive at the limit and fails just above it', () => {
  assert.equal(microEligibility({ ...base, turnover: 900000 }).tests.turnover.ok, true);
  assert.equal(microEligibility({ ...base, turnover: 900000.01 }).tests.turnover.ok, false);
  assert.equal(microEligibility({ ...base, grossAssets: 450000 }).tests.balanceSheetTotal.ok, true);
  assert.equal(microEligibility({ ...base, grossAssets: 450000.01 }).tests.balanceSheetTotal.ok, false);
  assert.equal(microEligibility({ ...base, employees: 10 }).tests.employees.ok, true);
  assert.equal(microEligibility({ ...base, employees: 11 }).tests.employees.ok, false);
});

test('two of three: one failure still meets; two failures fail; missing employees can leave it undetermined', () => {
  assert.equal(microEligibility({ ...base, turnover: 950000 }).sizeResult, 'meets');
  assert.equal(microEligibility({ ...base, turnover: 950000, employees: 12 }).sizeResult, 'fails');
  const und = microEligibility({ ...base, turnover: 950000, employees: null });
  assert.equal(und.sizeResult, 'undetermined');
  assert.ok(und.warnings.some(w => /record the average number of employees/.test(w)));
  // turnover and assets both pass: employees not needed
  assert.equal(microEligibility({ ...base, employees: null }).sizeResult, 'meets');
});

test('legal forms other than LTD and DAC warn; a missing form warns', () => {
  assert.deepEqual(microEligibility({ ...base, legalForm: 'DAC' }).warnings, []);
  for (const f of ['CLG', 'UC', 'ULC']) assert.ok(microEligibility({ ...base, legalForm: f }).warnings.some(w => w.includes(`Legal form ${f}`) && /unverified/.test(w)));
  assert.ok(microEligibility({ ...base, legalForm: null }).warnings.includes('Legal form not recorded.'));
});

test('attestations: missing ones are asked for, a "yes" excludes', () => {
  const none = microEligibility({ ...base, disclosures: [] });
  assert.equal(none.warnings.filter(w => /^Not yet attested/.test(w)).length, 4);
  const parent = microEligibility({ ...base, disclosures: attested.map(d => (d.disclosure_key === 'not_group_parent' ? { ...d, has_items: true } : d)) });
  assert.ok(parent.warnings.some(w => /^Excluded from the micro regime: the company is a holding company/.test(w)));
});

test('turnover is pro-rated for a period that is not 12 months', () => {
  const r = microEligibility({ ...base, turnover: 500000, periodMonths: 6 });
  assert.equal(r.tests.turnover.value, 1000000);
  assert.equal(r.tests.turnover.ok, false);
  assert.ok(r.warnings.some(w => /pro-rated to 12 months for a 6-month period/.test(w)));
});

test('two-year rule: a failing prior year warns', () => {
  const r = microEligibility({ ...base, prior: { turnover: 2000000, grossAssets: 900000, employees: 20 } });
  assert.equal(r.twoYearRule, 'checked');
  assert.ok(r.warnings.some(w => /Prior year did not meet/.test(w)));
});
