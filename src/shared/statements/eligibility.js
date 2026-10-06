// Micro companies regime eligibility (STA-01 Stage 3e). Warn only: it never blocks and never
// changes the regime. Pure: inputs from the engine (Schedule 3B figures), the year inputs and the
// attestations. Thresholds and their sources live in thresholds.js.
import { MICRO, MICRO_LEGAL_FORMS, DEFINITIONS } from './thresholds.js';

const ATTESTATIONS = [
  ['not_group_parent', 'a holding company preparing group financial statements'],
  ['not_consolidated_subsidiary', "included in a higher undertaking's consolidated financial statements"],
  ['not_investment_or_financial_holding', 'an investment undertaking or a financial holding undertaking'],
  ['not_ineligible_entity', 'an ineligible company (listed securities, credit institution, insurer, Schedule 5 entity)'],
];

// turnover: P&L line 1 for the period. periodMonths: length of the financial period in months
// (turnover is pro-rated to 12 months when it is not a year, s.280D(5)). grossAssets: A+B+C+D.
// employees: average employees input (null when not recorded). legalForm: profile legal form.
// disclosures: fs_disclosures rows for the year. prior: { turnover, grossAssets, employees } or
// null when no prior-year figures are confirmed (the two-year rule then cannot be applied).
export function microEligibility({ turnover, periodMonths = 12, grossAssets, employees = null, legalForm = null, disclosures = [], prior = null }) {
  const annualTurnover = periodMonths && periodMonths !== 12 ? Math.round((turnover * 12 / periodMonths) * 100) / 100 : turnover;
  const tests = {
    turnover: { value: annualTurnover, limit: MICRO.turnover, ok: annualTurnover <= MICRO.turnover, prorated: periodMonths !== 12 },
    balanceSheetTotal: { value: grossAssets, limit: MICRO.balanceSheetTotal, ok: grossAssets <= MICRO.balanceSheetTotal },
    employees: { value: employees, limit: MICRO.employees, ok: employees == null ? null : employees <= MICRO.employees },
  };
  const met = Object.values(tests).filter(t => t.ok === true).length;
  const failed = Object.values(tests).filter(t => t.ok === false).length;
  const warnings = [];
  let sizeResult;
  if (met >= MICRO.criteriaToMeet) sizeResult = 'meets';
  else if (failed > Object.keys(tests).length - MICRO.criteriaToMeet) sizeResult = 'fails';
  else sizeResult = 'undetermined';
  if (sizeResult === 'fails') warnings.push(`Fails the micro size test: meets ${met} of 3 criteria, needs ${MICRO.criteriaToMeet}.`);
  if (sizeResult === 'undetermined') warnings.push('Micro size test undetermined: record the average number of employees.');
  if (tests.turnover.prorated) warnings.push(`Turnover pro-rated to 12 months for a ${periodMonths}-month period (s.280D(5)).`);

  if (!legalForm) warnings.push('Legal form not recorded.');
  else if (!MICRO_LEGAL_FORMS.forms.includes(legalForm)) warnings.push(`Legal form ${legalForm}: the micro regime is taken to apply to ${MICRO_LEGAL_FORMS.forms.join(' and ')} only (unverified).`);

  const byKey = Object.fromEntries(disclosures.map(d => [d.disclosure_key, d]));
  for (const [key, label] of ATTESTATIONS) {
    const row = byKey[key];
    if (!row) warnings.push(`Not yet attested: whether the company is ${label}.`);
    else if (row.has_items) warnings.push(`Excluded from the micro regime: the company is ${label}.`);
  }

  const twoYearRule = prior ? 'checked' : 'not checked';
  const notes = [];
  if (!prior) notes.push('Two-year rule (s.280D(2)) not checked: prior-year figures are needed.');
  notes.push(`Balance sheet total uses a working definition (${DEFINITIONS.balanceSheetTotal.working}); unverified.`);
  if (prior) {
    const pm = [prior.turnover <= MICRO.turnover, prior.grossAssets <= MICRO.balanceSheetTotal, prior.employees == null ? null : prior.employees <= MICRO.employees].filter(x => x === true).length;
    if (pm < MICRO.criteriaToMeet) warnings.push('Prior year did not meet the micro size test: under the two-year rule the regime may not apply; check s.280D(2).');
  }
  return { tests, met, sizeResult, warnings, notes, twoYearRule, source: MICRO.source };
}
