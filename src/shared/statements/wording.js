// FRS 105 micro statements: every printed sentence of the statutory content (STA-01 Stage 3d),
// from the Stage 3a wording sheet as approved by Peter. Pure: no React, no Supabase.
//
// Each compared item keeps the sheet text and S&P's signed-accounts text side by side in CHOICE /
// VARIANTS, so Peter's per-item choice is a one-line change to CHOICE. Nothing here prints a
// negative statement ("no advances…", "not being wound up") unless the accountant recorded that
// attestation: disclosureSentence() returns null for a missing row, and the caller prints an
// "information required" placeholder instead. Exempt content (directors' report, directors'
// remuneration, the going-concern paragraph) is not produced.

import { DISCLOSURE_BY_KEY, LEGAL_FORMS } from './statementInputs.js';

// Peter chooses per item: 'sheet' (Stage 3a wording sheet) or 'sp' (as printed in S&P's signed
// accounts for the year ended 8 October 2025). Default: the approved sheet.
// Peter's choices (review of 6 Oct 2026): item 3 S&P's wording, printed once; items 4, 5, 8, 9
// and 10 the sheet (item 8 plus the currency sentence, CURRENCY below).
export const CHOICE = {
  microRegime: 'sp',
  auditExemption: 'sheet',
  approval: 'sheet',
  companyInfo: 'sheet',
  compliance: 'sheet',
  policies: 'sheet',
};

const fill = (s, v) => s.replace(/\[(\w+)\]/g, (m, k) => (v[k] != null && v[k] !== '' ? v[k] : m));

export const VARIANTS = {
  microRegime: {
    sheet: 'These financial statements have been prepared in accordance with the micro companies regime as permitted by section 280D of the Companies Act 2014.',
    sp: 'The financial statements have been prepared in accordance with the micro-companies\' regime and FRS 105 "The Financial Reporting Standard applicable to the Micro-Entities Regime".',
  },
  auditExemption: {
    sheet: [
      'The directors state that:',
      '(a) the company is availing itself of the exemption provided for by Chapter 15 of Part 6 of the Companies Act 2014;',
      '(b) the company is availing itself of the exemption on the grounds that section [section] of the Companies Act 2014 is complied with;',
      '(c) no notice under section 334(1) of the Companies Act 2014 has, in accordance with section 334(2), been served on the company; and',
      '(d) the directors acknowledge the obligations of the company under the Companies Act 2014 to (i) keep adequate accounting records and prepare financial statements which give a true and fair view of the assets, liabilities and financial position of the company at the end of its financial year and of its profit or loss for such a year, and (ii) otherwise comply with the provisions of that Act relating to financial statements so far as they are applicable to the company.',
    ],
    sp: [
      'We as Directors of [name], state that:',
      '(a) the company is availing itself of the exemption provided for by Chapter 15 of Part 6 of the Companies Act 2014,',
      '(b) the company is availing itself of the exemption on the grounds that the conditions specified in section [section] are satisfied,',
      '(c) the shareholders of the company have not served a notice on the company under section 334(1) in accordance with section 334(2),',
      "(d) we acknowledge the company's obligations under the Companies Act 2014, to keep adequate accounting records and prepare financial statements which give a true and fair view of the assets, liabilities and financial position of the company at the end of its financial year and of its profit or loss for such a financial year and to otherwise comply with the provisions of the Companies Act 2014 relating to financial statements so far as they are applicable to the company,",
    ],
  },
  approval: {
    sheet: 'Approved by the board of directors and authorised for issue on [date] and signed on its behalf by:',
    sp: 'Approved by the Directors and authorised for issue on [date] and signed on its behalf by:',
  },
  companyInfo: {
    sheet: '[name] is a [form] incorporated and registered in [country] (registered number [number]). Its registered office is [office].',
    sp: '[name] is a [form] incorporated in [country]. [office] is the registered office, which is also the principal place of business of the company. The financial statements have been presented in Euro (€) which is also the functional currency of the company.',
  },
  compliance: {
    sheet: "These financial statements have been prepared in accordance with FRS 105 'The Financial Reporting Standard applicable to the Micro-entities Regime' issued by the Financial Reporting Council and the Companies Act 2014.",
    sp: 'The financial reporting framework that has been applied in their preparation is the Companies Act 2014 and FRS 105 "The Financial Reporting Standard applicable to the Micro-Entities Regime" issued by the Financial Reporting Council. The company qualifies as a micro company as defined by section 280D of the Companies Act 2014 in respect of the financial year, and has applied the rules of the \'Micro Companies Regime\' in accordance with section 280E of the Companies Act 2014 and FRS 105.',
  },
  policies: {
    sheet: {
      basis: 'The financial statements are prepared under the historical cost convention.',
      turnover: 'Turnover comprises the value of goods and services supplied in the ordinary course of business, net of value added tax and trade discounts.',
      fixedAssets: 'Tangible fixed assets are stated at cost less accumulated depreciation. Depreciation is charged so as to write off the cost of each asset over its expected useful life at the following rates: [rates].',
      taxation: 'Current tax is recognised for the amount of corporation tax payable in respect of the taxable profit for the year.',
    },
    sp: {
      basis: 'The financial statements have been prepared on the going concern basis and in accordance with the historical cost convention.',
      turnover: 'Turnover comprises the invoice value of goods supplied by the company, exclusive of trade discounts and value added tax.',
      fixedAssets: 'Tangible fixed assets are stated at cost less accumulated depreciation. Depreciation is charged so as to write off the cost of each asset over its expected useful life at the following rates: [rates].',
      taxation: 'Current tax represents the amount expected to be paid or recovered in respect of taxable profits for the financial year and is calculated using the tax rates and laws that have been enacted or substantially enacted at the Statement of Financial Position date.',
    },
  },
};

// Item 8 addition (Peter): the presentation-currency sentence, as S&P prints it.
export const CURRENCY = 'The financial statements have been presented in Euro (€) which is also the functional currency of the company.';

// Sentences for attested disclosures (sheet items 8 and 11–14). "none" prints only from a
// recorded has_items = false row; "items" prints the accountant's own narrative.
const NONE_TEXT = {
  not_in_liquidation: 'The company is not being wound up.',
  directors_advances: 'No advances or credits were granted to, and no guarantees were entered into on behalf of, the directors during the year.',
  commitments: 'The company had no financial commitments, guarantees or contingencies not included in the balance sheet at [yearEnd].',
  dividends: 'No dividends were paid during the year or proposed after the year end.',
  own_shares: 'The company did not hold or acquire any of its own shares during the year.',
  post_bs_events: 'There have been no significant events affecting the company since the financial year-end.',
};

// The dividends sentence, shared by the full set's reserves note and the abridged copy's dividends
// note. paid: Dividends Paid (3400) moved in the year. An attestation of "none" that the ledger
// contradicts is not printed.
function dividendsSentence(row, paid) {
  if (paid && row?.disclosure_key === 'dividends' && row.has_items === false)
    return PLACEHOLDER('dividends: the attestation says none were paid, but Dividends Paid (3400) has postings in the year');
  return disclosureSentence(row, 'dividends') || PLACEHOLDER('dividends paid or proposed');
}

// The guard: null when there is no attestation (never a default claim).
export function disclosureSentence(row, key, vars = {}) {
  if (!row || row.disclosure_key !== key) return null;
  if (row.has_items === false) return NONE_TEXT[key] ? fill(NONE_TEXT[key], vars) : null;
  return (row.narrative || '').trim() || null;
}

const legalFormText = form => ({
  LTD: 'private company limited by shares', DAC: 'designated activity company', CLG: 'company limited by guarantee',
  UC: 'private unlimited company', ULC: 'public unlimited company',
}[form] || null);

export const PLACEHOLDER = label => `[Information required: ${label}]`;

// Balance sheet page, items 3–5. names: the signatories' names in order; soleDirector when one
// director was in office at approval.
export function balanceSheetStatements({ disclosures = [], companyName, approvalDate, signatories = [], soleDirector = false }) {
  const by = Object.fromEntries(disclosures.map(d => [d.disclosure_key, d]));
  const out = { microRegime: VARIANTS.microRegime[CHOICE.microRegime], auditExemption: null, approval: null, signatories, soleDirector };
  const ae = by.audit_exemption, s334 = by.no_s334_notice;
  if (!ae) out.auditExemption = [PLACEHOLDER('audit exemption claimed or not')];
  else if (ae.has_items) {
    const section = ['358', '359'].includes(ae.details?.section) ? ae.details.section : null;
    if (!section) out.auditExemption = [PLACEHOLDER('audit exemption section (358 or 359)')];
    else if (!s334 || s334.has_items) out.auditExemption = [PLACEHOLDER(!s334 ? 'no notice under s.334 (attestation)' : 'a notice under s.334(1) was served: the audit exemption cannot be claimed')];
    else out.auditExemption = VARIANTS.auditExemption[CHOICE.auditExemption].map(l => fill(l, { section, name: companyName }));
  }
  out.approval = fill(VARIANTS.approval[CHOICE.approval], { date: approvalDate || PLACEHOLDER('approval date') });
  return out;
}

// Notes as [{ title, paragraphs: string[], table?: [label, amount][] }], numbered by the caller.
// abridged: the CRO abridged copy's notes (agreed by Peter, 7 October 2026): the full set's notes
// without the reserves movement note (no creditors analysis note exists to leave out). The dividend
// sentence stays, in a stand-alone dividends note where the reserves note would be.
export function statementNotes({ companyName, legalForm, country, croNumber, registeredOffice, disclosures = [], yearEndFmt,
  depreciationRates = {}, assetClasses = [], taxUsed = false, reserves = null, shareCapital = null, abridged = false }) {
  const by = Object.fromEntries(disclosures.map(d => [d.disclosure_key, d]));
  const notes = [];
  const ph = PLACEHOLDER;

  // 1 Company information (s.291(3A))
  const info = fill(VARIANTS.companyInfo[CHOICE.companyInfo], {
    name: companyName, form: legalFormText(legalForm) || ph('legal form'), country: country || ph('country'),
    number: croNumber || ph('registered number'), office: registeredOffice || ph('registered office'),
  });
  const liq = disclosureSentence(by.not_in_liquidation, 'not_in_liquidation');
  notes.push({ title: 'Company information', paragraphs: [info, ...(CHOICE.companyInfo === 'sheet' ? [CURRENCY] : []), liq || ph('whether the company is being wound up')] });

  // 2 Statement of compliance (s.291(7) via FRS 105 6B.2)
  notes.push({ title: 'Statement of compliance', paragraphs: [VARIANTS.compliance[CHOICE.compliance]] });

  // 3 Accounting policies (s.321)
  const P = VARIANTS.policies[CHOICE.policies];
  const policies = [P.basis, P.turnover];
  if (assetClasses.length) {
    const rates = assetClasses.map(c => (depreciationRates[c] ? `${c}: ${depreciationRates[c]}` : ph(`depreciation rate for class ${c}`))).join('; ');
    policies.push(fill(P.fixedAssets, { rates }));
  }
  if (taxUsed) policies.push(P.taxation);
  notes.push({ title: 'Accounting policies', paragraphs: policies });

  // 4 Advances, credits and guarantees to directors (s.307)
  notes.push({ title: 'Advances, credits and guarantees to directors', paragraphs: [disclosureSentence(by.directors_advances, 'directors_advances') || ph('advances, credits and guarantees to directors')] });
  // 5 Financial commitments, guarantees and contingencies (Sch 3B paras 34–35)
  notes.push({ title: 'Financial commitments, guarantees and contingencies', paragraphs: [disclosureSentence(by.commitments, 'commitments', { yearEnd: yearEndFmt }) || ph('commitments, guarantees and contingencies')] });
  // 6 Reserves and dividends (Sch 3B para 33): movement from the ledger, dividends from the attestation
  if (reserves && !abridged) {
    notes.push({
      title: 'Reserves and dividends',
      table: [['Profit and loss account at the start of the year', reserves.atStart], ['Profit or loss for the year', reserves.result],
        ...(reserves.dividendsInYear ? [['Dividends paid', -reserves.dividendsInYear]] : []), ['Profit and loss account at the end of the year', reserves.atEnd]],
      paragraphs: [dividendsSentence(by.dividends, !!reserves.dividendsInYear)],
    });
  }
  // Abridged copy: dividends without the reserves movement (which would show the profit). The
  // amount prints when 3400 moved in the year; the sentence follows the full set's rule, so with
  // no dividends it is the attested "none" sentence or the placeholder, never a default claim.
  if (reserves && abridged) {
    const paid = reserves.dividendsInYear || 0;
    notes.push({
      title: 'Dividends',
      ...(paid ? { table: [['Dividends paid in the year', paid]] } : {}),
      paragraphs: [dividendsSentence(by.dividends, !!paid)],
    });
  }
  // Called-up share capital (Peter): the amount from 3000, the number and class from the year inputs.
  if (shareCapital) {
    const { amount = 0, number, shareClass } = shareCapital;
    const desc = number && shareClass ? `${Number(number).toLocaleString('en-IE')} ${shareClass} shares` : ph('number and class of shares');
    notes.push({
      title: 'Called up share capital',
      table: [[`Allotted, called up and fully paid: ${desc}`, amount]],
      paragraphs: amount === 0 ? [ph('share capital not in the ledger (3000 is nil)')] : [],
    });
  }
  // 7 Own shares (s.320) and the s.328 information otherwise in a directors' report (s.325(1A)(b))
  notes.push({ title: 'Own shares', paragraphs: [disclosureSentence(by.own_shares, 'own_shares') || ph('own shares held or acquired')] });
  // Events after the balance sheet date (Peter): printed only when attested.
  const pbse = disclosureSentence(by.post_bs_events, 'post_bs_events');
  if (pbse) notes.push({ title: 'Events after the balance sheet date', paragraphs: [pbse] });
  // 8–9 conditional: only when recorded with details
  for (const [key, title] of [['format_change', 'Change of format'], ['comparatives_adjusted', 'Comparative amounts']]) {
    const r = by[key];
    if (r?.has_items && (r.narrative || '').trim()) notes.push({ title, paragraphs: [r.narrative.trim()] });
  }
  return notes;
}

// ── CRO abridged copy (STA-01 Stage 5) ──────────────────────────────────────────────────────
// From the abridged wording sheet, based on S&P's filed abridged accounts and agreed by Peter on
// 7 October 2026 item by item (A1–A8 and the notes). No member notification or consent condition
// applies to abridged filing under ss.352–353 (Peter, 7 October 2026), so there is no attestation.
export const ABRIDGED = {
  // A1: certification page. Section 347 (S&P's filed copy cited s.1303, which concerns EEA companies).
  certification: 'We hereby certify that the accounting documents of the Company for the [period], which are required by section 347 of the Companies Act 2014 to be delivered to the Registrar, are true copies of the originals.',
  // A2 cover and A3 contents
  coverTitle: 'Abridged Unaudited Financial Statements',
  contentsBalanceSheet: 'Balance Sheet',
  contentsNotes: 'Notes to the abridged financial statements',
  notesTitle: 'Notes to the Abridged Financial Statements',
  // A7: statement (e), the sheet's micro wording
  statementE: '(e) the company has relied on the exemption in section 352 of the Companies Act 2014 on the grounds that it is entitled to that exemption as a micro company, and these abridged financial statements have been properly prepared in accordance with section 353 of the Companies Act 2014.',
};

// Wording verification record (Stage 5b's gate reads it): every printed item, its status, who and
// when. The abridged items were agreed by Peter on the sheet on 7 October 2026.
const AGREED = { status: 'verified', by: 'Peter', on: '2026-10-07', source: 'Abridged wording sheet' };
// Full-set items: Peter reviewed the Stage 3a wording sheet, including its unverified items, with
// his per-item choices of 6 October 2026, and confirmed it. Recorded as verified on the day the
// record was made (7 October 2026, system clock).
const CONFIRMED = { status: 'verified', by: 'Peter', on: '2026-10-07', source: 'Stage 3a wording sheet, reviewed and confirmed (choices of 6 October 2026)' };
export const WORDING_STATUS = {
  'full.3': { ...CONFIRMED, item: 'Item 3: micro-regime statement (S&P wording)' },
  'full.4': { ...CONFIRMED, item: "Item 4: directors' statements (a)-(d), audit exemption" },
  'full.5': { ...CONFIRMED, item: 'Item 5: approval line and signatories' },
  'full.8': { ...CONFIRMED, item: 'Item 8: company information, with the currency sentence' },
  'full.9': { ...CONFIRMED, item: 'Item 9: statement of compliance' },
  'full.10': { ...CONFIRMED, item: 'Item 10: accounting policies' },
  'full.notes': { ...CONFIRMED, item: 'Notes: attested sentences (items 11-14), reserves and dividends' },
  'full.notes.share_capital': { ...CONFIRMED, item: 'Called up share capital note' },
  'full.notes.post_bs_events': { ...CONFIRMED, item: 'Events after the balance sheet date note (printed only when attested)' },
  'abridged.A1': { ...AGREED, item: 'Certification page: section 347; two directors by default, or a director and the company secretary; named and dated' },
  'abridged.A2': { ...AGREED, item: 'Cover: "Abridged Unaudited Financial Statements"' },
  'abridged.A3': { ...AGREED, item: 'Contents page' },
  'abridged.A4': { ...AGREED, item: 'Statement of financial position: Schedule 3B with comparatives, no profit and loss account, same title as the full set' },
  'abridged.A5': { ...AGREED, item: 'Micro-regime statement, as the full set' },
  'abridged.A6': { ...AGREED, item: "Directors' statements (a)–(d), as the full set" },
  'abridged.A7': { ...AGREED, item: 'Statement (e): micro wording, ss.352–353' },
  'abridged.A8': { ...AGREED, item: 'Approval line and signatories with typed names, as the full set' },
  'abridged.notes': { ...AGREED, item: "Notes as the full set, without the creditors analysis and the reserves movement notes" },
  // Proposed 7 October 2026; approved by Peter on 9 October 2026.
  'abridged.dividends': { status: 'verified', by: 'Peter', on: '2026-10-09', source: 'Dividends proposal, 7 October 2026', item: 'Dividends note: stand-alone, where the reserves note would be; the amount when 3400 moved in the year, and the dividends attestation sentence as the full set' },
};

// The balance sheet statements for the abridged copy: the full set's items 3–5 with (e) added at
// the end of the directors' statements ((c) loses its "and", (d) gains it).
export function abridgedStatements(args) {
  const out = balanceSheetStatements(args);
  const ae = out.auditExemption ? [...out.auditExemption] : [];
  const iC = ae.findIndex(l => /^\(c\)/.test(l)), iD = ae.findIndex(l => /^\(d\)/.test(l));
  if (iC >= 0) ae[iC] = ae[iC].replace(/;?\s*and$/, ';').replace(/,$/, ',');
  if (iD >= 0) ae[iD] = ae[iD].replace(/\.$/, '; and').replace(/,$/, ', and');
  out.auditExemption = [...ae, ABRIDGED.statementE];
  return out;
}

// A1: the certification text and its signatories: two directors by default, or a director and the
// company secretary when a secretary is named. Missing names and the date show as placeholders.
export function certificationPage({ periodPhrase, directorNames = [], secretaryName = null, date = null }) {
  const people = secretaryName
    ? [{ name: directorNames[0] || null, role: 'Director' }, { name: secretaryName, role: 'Secretary' }]
    : [{ name: directorNames[0] || null, role: 'Director' }, { name: directorNames[1] || null, role: 'Director' }];
  return {
    text: fill(ABRIDGED.certification, { period: `financial ${periodPhrase}` }),
    signatories: people.map(p => ({ ...p, name: p.name || PLACEHOLDER(`certification signatory (${p.role.toLowerCase()})`) })),
    date: date || PLACEHOLDER('certification date'),
  };
}

export const LEGAL_FORM_LABELS = Object.fromEntries(LEGAL_FORMS.map(f => [f.value, f.label]));
export { DISCLOSURE_BY_KEY };

// The wording items that print in a copy, for the approval gate (STA-01 Stage 5b): the full set
// always; the abridged copy's items when abridged filing is elected. An item that does not print
// (the audit exemption statements when none is claimed; the abridged dividends note when the copy
// has none) is not listed, so it cannot block.
export function printedWordingKeys(A, { abridged = false } = {}) {
  const has = title => (A.notes || []).some(n => n.title === title);
  const keys = ['full.3', ...(A.bsStatements?.auditExemption ? ['full.4'] : []), 'full.5', 'full.8', 'full.9', 'full.10', 'full.notes',
    ...(has('Called up share capital') ? ['full.notes.share_capital'] : []), ...(has('Events after the balance sheet date') ? ['full.notes.post_bs_events'] : [])];
  if (abridged) {
    keys.push('abridged.A1', 'abridged.A2', 'abridged.A3', 'abridged.A4', 'abridged.A5', 'abridged.A6', 'abridged.A7', 'abridged.A8', 'abridged.notes');
    if ((A.abridgedNotes || []).some(n => n.title === 'Dividends')) keys.push('abridged.dividends');
  }
  return keys;
}

// The gate: every printed item verified. Unknown keys count as unverified.
export function wordingGate(keys, status = WORDING_STATUS) {
  const items = keys.map(k => ({ key: k, ...(status[k] || { status: 'unverified', item: k }) }));
  return { items, blocking: items.filter(i => i.status !== 'verified') };
}
