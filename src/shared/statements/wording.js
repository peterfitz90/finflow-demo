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
export const CHOICE = {
  microRegime: 'sheet',
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

// Sentences for attested disclosures (sheet items 8 and 11–14). "none" prints only from a
// recorded has_items = false row; "items" prints the accountant's own narrative.
const NONE_TEXT = {
  not_in_liquidation: 'The company is not being wound up.',
  directors_advances: 'No advances or credits were granted to, and no guarantees were entered into on behalf of, the directors during the year.',
  commitments: 'The company had no financial commitments, guarantees or contingencies not included in the balance sheet at [yearEnd].',
  dividends: 'No dividends were paid during the year or proposed after the year end.',
  own_shares: 'The company did not hold or acquire any of its own shares during the year.',
};

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

// Notes 1–9 as [{ title, paragraphs: string[], table?: [label, amount][] }], numbered by the caller.
export function statementNotes({ companyName, legalForm, country, croNumber, registeredOffice, disclosures = [], yearEndFmt,
  depreciationRates = {}, assetClasses = [], taxUsed = false, reserves = null }) {
  const by = Object.fromEntries(disclosures.map(d => [d.disclosure_key, d]));
  const notes = [];
  const ph = PLACEHOLDER;

  // 1 Company information (s.291(3A))
  const info = fill(VARIANTS.companyInfo[CHOICE.companyInfo], {
    name: companyName, form: legalFormText(legalForm) || ph('legal form'), country: country || ph('country'),
    number: croNumber || ph('registered number'), office: registeredOffice || ph('registered office'),
  });
  const liq = disclosureSentence(by.not_in_liquidation, 'not_in_liquidation');
  notes.push({ title: 'Company information', paragraphs: [info, liq || ph('whether the company is being wound up')] });

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
  if (reserves) {
    notes.push({
      title: 'Reserves and dividends',
      table: [['Profit and loss account at the start of the year', reserves.atStart], ['Profit or loss for the year', reserves.result],
        ...(reserves.dividendsInYear ? [['Dividends paid', -reserves.dividendsInYear]] : []), ['Profit and loss account at the end of the year', reserves.atEnd]],
      paragraphs: [disclosureSentence(by.dividends, 'dividends') || ph('dividends paid or proposed')],
    });
  }
  // 7 Own shares (s.320) and the s.328 information otherwise in a directors' report (s.325(1A)(b))
  notes.push({ title: 'Own shares', paragraphs: [disclosureSentence(by.own_shares, 'own_shares') || ph('own shares held or acquired')] });
  // 8–9 conditional: only when recorded with details
  for (const [key, title] of [['format_change', 'Change of format'], ['comparatives_adjusted', 'Comparative amounts']]) {
    const r = by[key];
    if (r?.has_items && (r.narrative || '').trim()) notes.push({ title, paragraphs: [r.narrative.trim()] });
  }
  return notes;
}

export const LEGAL_FORM_LABELS = Object.fromEntries(LEGAL_FORMS.map(f => [f.value, f.label]));
export { DISCLOSURE_BY_KEY };
