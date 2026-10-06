// STA-01 Stage 3d: statement wording. No default claims; placeholders where inputs are missing.
// Run: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHOICE, VARIANTS, disclosureSentence, balanceSheetStatements, statementNotes, PLACEHOLDER } from '../src/shared/statements/wording.js';

const row = (key, has_items, extra = {}) => ({ disclosure_key: key, has_items, ...extra });

test('the guard never prints a negative statement without a recorded attestation', () => {
  for (const key of ['directors_advances', 'commitments', 'dividends', 'own_shares', 'not_in_liquidation']) {
    assert.equal(disclosureSentence(undefined, key), null, key);
    assert.equal(disclosureSentence(null, key), null, key);
    assert.equal(disclosureSentence(row('dividends', false), key === 'dividends' ? 'x' : key), null, 'a row for another key never counts');
    assert.ok(disclosureSentence(row(key, false), key, { yearEnd: '31 December 2025' }), key);
  }
  assert.equal(disclosureSentence(row('commitments', true, { narrative: '  Lease of premises.  ' }), 'commitments'), 'Lease of premises.');
  assert.equal(disclosureSentence(row('commitments', true, { narrative: '' }), 'commitments'), null);
});

test('notes with nothing recorded show placeholders, never claims', () => {
  const notes = statementNotes({ companyName: 'X Ltd', yearEndFmt: '31 December 2025', reserves: { atStart: 0, result: 10, dividendsInYear: 0, atEnd: 10 } });
  const text = notes.flatMap(n => n.paragraphs).join(' ');
  assert.doesNotMatch(text, /No advances|no financial commitments|No dividends|did not hold|not being wound up/);
  for (const label of ['legal form', 'registered number', 'registered office', 'advances, credits and guarantees to directors', 'commitments, guarantees and contingencies', 'dividends paid or proposed', 'own shares held or acquired', 'whether the company is being wound up']) {
    assert.ok(text.includes(PLACEHOLDER(label)), label);
  }
  assert.deepEqual(notes.map(n => n.title), ['Company information', 'Statement of compliance', 'Accounting policies', 'Advances, credits and guarantees to directors', 'Financial commitments, guarantees and contingencies', 'Reserves and dividends', 'Own shares']);
  // exempt content is never produced
  assert.doesNotMatch(text, /remuneration|going concern|directors' report/i);
});

test('complete inputs give the sheet wording', () => {
  const ds = ['not_in_liquidation', 'directors_advances', 'commitments', 'dividends', 'own_shares'].map(k => row(k, false));
  const notes = statementNotes({ companyName: 'X Ltd', legalForm: 'LTD', country: 'Ireland', croNumber: '123456', registeredOffice: '1 Main St, Dublin', disclosures: ds,
    yearEndFmt: '31 December 2025', assetClasses: ['1510'], depreciationRates: { 1510: '20% straight line' }, taxUsed: true, reserves: { atStart: 100, result: 50, dividendsInYear: 20, atEnd: 130 } });
  assert.equal(notes[0].paragraphs[0], 'X Ltd is a private company limited by shares incorporated and registered in Ireland (registered number 123456). Its registered office is 1 Main St, Dublin.');
  assert.equal(notes[0].paragraphs[1], 'The company is not being wound up.');
  assert.match(notes[2].paragraphs.join(' '), /following rates: 1510: 20% straight line\./);
  assert.match(notes[2].paragraphs.join(' '), /Current tax is recognised/);
  assert.deepEqual(notes[5].table, [['Profit and loss account at the start of the year', 100], ['Profit or loss for the year', 50], ['Dividends paid', -20], ['Profit and loss account at the end of the year', 130]]);
  assert.equal(notes[4].paragraphs[0], 'The company had no financial commitments, guarantees or contingencies not included in the balance sheet at 31 December 2025.');
});

test('audit exemption prints only when claimed, with a section and the s.334 attestation', () => {
  const base = { companyName: 'X Ltd', approvalDate: '30 June 2026' };
  assert.deepEqual(balanceSheetStatements({ ...base }).auditExemption, [PLACEHOLDER('audit exemption claimed or not')]);
  assert.equal(balanceSheetStatements({ ...base, disclosures: [row('audit_exemption', false)] }).auditExemption, null);
  assert.deepEqual(balanceSheetStatements({ ...base, disclosures: [row('audit_exemption', true, { details: {} })] }).auditExemption, [PLACEHOLDER('audit exemption section (358 or 359)')]);
  assert.match(balanceSheetStatements({ ...base, disclosures: [row('audit_exemption', true, { details: { section: '358' } })] }).auditExemption[0], /no notice under s\.334/);
  const ok = balanceSheetStatements({ ...base, disclosures: [row('audit_exemption', true, { details: { section: '358' } }), row('no_s334_notice', false)] });
  assert.equal(ok.auditExemption.length, 5);
  assert.match(ok.auditExemption[1], /availing itself of the exemption provided for by Chapter 15 of Part 6 of the Companies Act 2014/);
  assert.match(ok.auditExemption[2], /section 358 of the Companies Act 2014 is complied with/);
  assert.equal(ok.microRegime, VARIANTS.microRegime.sheet);
  assert.equal(ok.approval, 'Approved by the board of directors and authorised for issue on 30 June 2026 and signed on its behalf by:');
  assert.equal(balanceSheetStatements({ companyName: 'X' }).approval, `Approved by the board of directors and authorised for issue on ${PLACEHOLDER('approval date')} and signed on its behalf by:`);
});

test('the per-item choice switches to the S&P wording', () => {
  const saved = { ...CHOICE };
  try {
    CHOICE.microRegime = 'sp'; CHOICE.auditExemption = 'sp';
    const ok = balanceSheetStatements({ companyName: 'S&P Ltd', disclosures: [row('audit_exemption', true, { details: { section: '359' } }), row('no_s334_notice', false)] });
    assert.equal(ok.microRegime, VARIANTS.microRegime.sp);
    assert.equal(ok.auditExemption[0], 'We as Directors of S&P Ltd, state that:');
    assert.match(ok.auditExemption[2], /conditions specified in section 359 are satisfied/);
  } finally { Object.assign(CHOICE, saved); }
});
