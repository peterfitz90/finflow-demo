// STA-01 Stage 3c: what a micro company's statements need from the accountant, what is missing,
// and which "nothing to disclose" attestations the ledger can suggest. Pure: no React, no
// Supabase, so the inputs panel, the statements and tests share it.
//
// No default claims (Peter, Stage 3a): a negative statement exists only as a recorded
// fs_disclosures row. A suggestion is shown beside its ledger evidence and becomes an attestation
// only when the accountant confirms it; items with no ledger evidence (commitments, guarantees,
// contingencies, post-balance-sheet events) are never suggested. Last year's attestation text is
// offered as a suggestion only, never copied in.
//
// Approval rule, recorded for Stage 5 (Peter): the full financial year is signed off, the
// "information required" list is empty, and there are zero write_after_signoff events since that
// sign-off, or the accountant explicitly acknowledges the count.

export const LEGAL_FORMS = [
  { value: 'LTD', label: 'LTD — private company limited by shares' },
  { value: 'DAC', label: 'DAC — designated activity company' },
  { value: 'CLG', label: 'CLG — company limited by guarantee' },
  { value: 'UC', label: 'UC — unlimited company' },
  { value: 'ULC', label: 'ULC — public unlimited company' },
];
export const LEGAL_FORM_NOTE = 'Which legal forms may use the micro companies regime is unverified.';

// Disclosure keys the FRS 105 micro statements need, in the order the panel shows them.
// yes/no: the label for has_items = true / false. suggest: the ledger rule that may propose
// "nothing to disclose" (null = never suggested).
export const DISCLOSURES = [
  { key: 'directors_advances', group: 'Notes', title: 'Advances, credits and guarantees to directors',
    no: 'No advances or credits were granted to, and no guarantees were entered into on behalf of, the directors during the year.',
    yes: 'There were advances, credits or guarantees (enter details).', suggest: 'directors_loan' },
  { key: 'commitments', group: 'Notes', title: 'Financial commitments, guarantees, contingencies and charges',
    no: 'No financial commitments, guarantees, contingencies, charges or secured debts not included in the balance sheet.',
    yes: 'There are commitments, guarantees, contingencies or charges (enter details).', suggest: null },
  { key: 'dividends', group: 'Notes', title: 'Dividends',
    no: 'No dividends were paid during the year or proposed after the year end.',
    yes: 'Dividends were paid or proposed (enter details).', suggest: 'dividends' },
  { key: 'own_shares', group: 'Notes', title: 'Own shares (s.320 and s.328)',
    no: 'The company did not hold or acquire any of its own shares during the year.',
    yes: 'The company held or acquired its own shares (enter details).', suggest: 'share_capital' },
  { key: 'post_bs_events', group: 'Notes', title: 'Events after the balance sheet date',
    no: 'No significant events have occurred since the year end.',
    yes: 'There are events to disclose (enter details).', suggest: null },
  { key: 'audit_exemption', group: 'Audit exemption', title: 'Audit exemption claimed',
    no: 'The company is not claiming audit exemption.',
    yes: 'The company is availing itself of the audit exemption (choose s.358 or s.359).', suggest: null },
  { key: 'no_s334_notice', group: 'Audit exemption', title: 'Members\' notice requiring an audit (s.334)',
    no: 'No notice under section 334(1) has been served on the company.',
    yes: 'A notice under section 334(1) has been served (an audit is required).', suggest: null },
  { key: 'not_group_parent', group: 'Eligibility', title: 'Holding company preparing group statements',
    no: 'The company is not a holding company preparing group financial statements.',
    yes: 'The company is a holding company preparing group financial statements.', suggest: null },
  { key: 'not_consolidated_subsidiary', group: 'Eligibility', title: 'Subsidiary in a higher undertaking\'s consolidated statements',
    no: 'The company is not included in the consolidated financial statements of a higher undertaking.',
    yes: 'The company is included in a higher undertaking\'s consolidated financial statements.', suggest: null },
  { key: 'not_investment_or_financial_holding', group: 'Eligibility', title: 'Investment or financial holding undertaking',
    no: 'The company is not an investment undertaking or a financial holding undertaking.',
    yes: 'The company is an investment undertaking or a financial holding undertaking.', suggest: null },
  { key: 'not_ineligible_entity', group: 'Eligibility', title: 'Ineligible company (s.275)',
    no: 'The company is not an ineligible company (listed securities, credit institution, insurer, Schedule 5 entity).',
    yes: 'The company is an ineligible company.', suggest: null },
  { key: 'not_in_liquidation', group: 'Company', title: 'Being wound up',
    no: 'The company is not being wound up.',
    yes: 'The company is being wound up (enter details).', suggest: null },
  { key: 'no_going_concern_uncertainty', group: 'Internal (not printed)', title: 'Going concern',
    no: 'There is no material uncertainty about the company\'s ability to continue as a going concern.',
    yes: 'There is a material uncertainty (enter details).', suggest: null },
];
export const DISCLOSURE_BY_KEY = Object.fromEntries(DISCLOSURES.map(d => [d.key, d]));

const round2 = n => Math.round(n * 100) / 100;

// Ledger evidence for the suggestion rules. journals: every journal up to the year end;
// fyStart / yearEnd bound the year.
export function ledgerEvidence(journals, { fyStart, yearEnd }) {
  const inYear = journals.filter(j => j.date >= fyStart && j.date <= yearEnd);
  const touch = code => inYear.filter(j => j.debit_account === code || j.credit_account === code);
  const bal = code => round2(journals.reduce((s, j) => s + (j.debit_account === code ? Number(j.amount) : 0) - (j.credit_account === code ? Number(j.amount) : 0), 0));
  return {
    directors_loan: { code: '2400', movementsInYear: touch('2400').length, balanceAtYearEnd: bal('2400') },
    dividends: { code: '3400', movementsInYear: touch('3400').length, balanceAtYearEnd: bal('3400') },
    share_capital: { code: '3000', movementsInYear: touch('3000').length,
      balanceAtStart: round2(journals.filter(j => j.date < fyStart).reduce((s, j) => s + (j.debit_account === '3000' ? Number(j.amount) : 0) - (j.credit_account === '3000' ? Number(j.amount) : 0), 0)),
      balanceAtYearEnd: bal('3000') },
  };
}

// A suggestion is offered only when the ledger shows nothing: 2400 nil with no movements in the
// year; 3400 nil with no movements; share capital (3000) recorded, non-nil at the start and the
// end of the year, with no postings in between. Where 3000 is nil there is no evidence either way,
// so nothing is suggested (see ledgerNote).
export function suggestion(rule, ev) {
  if (rule === 'directors_loan') {
    const e = ev.directors_loan;
    return e.movementsInYear === 0 && e.balanceAtYearEnd === 0 ? { evidence: e, text: 'Directors Loan Account (2400): nil at the year end and no movements in the year.' } : null;
  }
  if (rule === 'dividends') {
    const e = ev.dividends;
    return e.movementsInYear === 0 && e.balanceAtYearEnd === 0 ? { evidence: e, text: 'Dividends Paid (3400): nil, no postings in the year.' } : null;
  }
  if (rule === 'share_capital') {
    const e = ev.share_capital;
    return e.balanceAtStart !== 0 && e.balanceAtYearEnd !== 0 && e.movementsInYear === 0
      ? { evidence: e, text: 'Share Capital (3000): recorded at the start and end of the year, with no postings in the year.' } : null;
  }
  return null;
}

// A note shown instead of a suggestion where the ledger cannot support one.
export function ledgerNote(rule, ev) {
  if (rule === 'share_capital' && ev.share_capital.balanceAtYearEnd === 0 && ev.share_capital.balanceAtStart === 0) {
    return 'Share capital not in ledger (3000 is nil), so nothing is suggested.';
  }
  return null;
}

// When the statements carry a ledger DRAFT condition, every suggestion carries this caution and
// suggestions must be confirmed one at a time (no "Confirm all suggested").
export function suggestionCaution(draftConditions = []) {
  if (!draftConditions.length) return null;
  return `Caution: these statements are DRAFT because of ${draftConditions.join(', ')}, so the ledger evidence may be incomplete. Check this item before confirming it.`;
}

// Fixed-asset classes (15x0 + 15x1) with a balance at the year end or movements in the year:
// each needs a depreciation rate or life in the accounting policy.
export function fixedAssetClasses(journals, { fyStart }) {
  const classes = new Map();
  for (const j of journals) {
    for (const [code, signed] of [[j.debit_account, Number(j.amount)], [j.credit_account, -Number(j.amount)]]) {
      if (!(code >= '1500' && code <= '1599')) continue;
      const cls = code.slice(0, 3) + '0';
      const c = classes.get(cls) || { cls, balance: 0, moved: false };
      c.balance += signed;
      if (j.date >= fyStart) c.moved = true;
      classes.set(cls, c);
    }
  }
  return [...classes.values()].filter(c => Math.abs(c.balance) >= 0.005 || c.moved).map(c => c.cls).sort();
}

// Directors in office on a date (appointed on or before it, not resigned before it).
export const directorsInOffice = (directors, date) =>
  (directors || []).filter(d => (!d.appointed_on || d.appointed_on <= date) && (!d.resigned_on || d.resigned_on >= date));

// Everything still needed, as [{ key, label, section, field }]. field is the panel element id.
export function informationRequired({ company = {}, profile = null, directors = [], yearInputs = null, disclosures = [], assetClasses = [], yearEnd }) {
  const missing = [];
  const need = (key, label, section, field) => missing.push({ key, label, section, field });
  // Company
  if (!profile?.legal_form) need('legal_form', 'Legal form', 'Company', 'fsi-legal-form');
  if (!profile?.registered_office?.trim()) need('registered_office', 'Registered office', 'Company', 'fsi-registered-office');
  if (!profile?.country?.trim()) need('country', 'Country of incorporation', 'Company', 'fsi-country');
  if (!company.cro_number) need('cro_number', 'Registered number (set in Settings)', 'Company', 'fsi-cro');
  if (!company.incorporation_date) need('incorporation_date', 'Incorporation date (set in Settings)', 'Company', 'fsi-incorporation');
  if (!directors.length) need('directors', 'Directors', 'Company', 'fsi-directors');
  // Year
  const approval = yearInputs?.approval_date || null;
  if (!approval) need('approval_date', 'Approval date', 'This year', 'fsi-approval-date');
  const inOffice = approval ? directorsInOffice(directors, approval) : [];
  const signers = (yearInputs?.signatory_ids || []).filter(id => inOffice.some(d => d.id === id));
  const needed = inOffice.length === 1 ? 1 : 2;
  if (!approval || signers.length < needed) need('signatories', needed === 1 ? 'Signatory (sole director)' : 'Two signatories', 'This year', 'fsi-signatories');
  if (yearInputs?.average_employees == null) need('average_employees', 'Average number of employees', 'This year', 'fsi-employees');
  for (const cls of assetClasses) {
    if (!yearInputs?.policy_inputs?.depreciation?.[cls]) need(`depreciation_${cls}`, `Depreciation rate or life for class ${cls}`, 'This year', `fsi-dep-${cls}`);
  }
  // Disclosures and attestations
  const have = new Set(disclosures.map(d => d.disclosure_key));
  for (const d of DISCLOSURES) if (!have.has(d.key)) need(d.key, d.title, d.group, `fsi-d-${d.key}`);
  // A "yes" that needs details but has none
  for (const r of disclosures) {
    const def = DISCLOSURE_BY_KEY[r.disclosure_key];
    if (!def) continue;
    if (r.disclosure_key === 'audit_exemption' && r.has_items && !['358', '359'].includes(r.details?.section)) need('audit_exemption_section', 'Audit exemption: choose s.358 or s.359', def.group, `fsi-d-${r.disclosure_key}`);
    else if (r.has_items && r.disclosure_key !== 'audit_exemption' && !r.narrative?.trim() && !(r.details && Object.keys(r.details).length)) need(`${r.disclosure_key}_details`, `${def.title}: details`, def.group, `fsi-d-${r.disclosure_key}`);
  }
  return missing;
}
