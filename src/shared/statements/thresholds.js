// Size thresholds for the Irish micro companies regime (STA-01 Stage 3e). Each value carries its
// source and verification status from the STA-01 investigation (primary text read for that
// report); none is written from memory. Change a value only with a cited source.

export const MICRO = {
  turnover: 900000,
  balanceSheetTotal: 450000,
  employees: 10,
  criteriaToMeet: 2,
  source: 'Companies Act 2014 s.280D as amended by S.I. 301/2024 reg 6; FRS 105 para A4.4',
  status: 'verified',
};

// A micro company must also qualify as small.
export const SMALL = {
  turnover: 15000000,
  balanceSheetTotal: 7500000,
  employees: 50,
  criteriaToMeet: 2,
  source: 'Companies Act 2014 s.280A as amended by S.I. 301/2024',
  status: 'verified',
};

export const THRESHOLDS_APPLY_FROM = {
  rule: 'Financial years beginning on or after 1 January 2024; by election from 1 January 2023',
  source: 'Companies Act 2014 s.280I',
  status: 'verified',
};

// Definitions not confirmed in primary text: the check uses these working definitions and says so.
export const DEFINITIONS = {
  balanceSheetTotal: { working: 'gross assets: Schedule 3B lines A + B + C + D, before deducting liabilities', status: 'unverified' },
  averageEmployees: { working: 'the average number of employees for the year, as entered by the accountant', status: 'unverified' },
};

// Legal forms the micro regime is taken to apply to. Peter's answer (6 Oct 2026), not verified
// against the Act: other forms are warned about, never blocked.
export const MICRO_LEGAL_FORMS = { forms: ['LTD', 'DAC'], source: "Peter's answer (6 Oct 2026)", status: 'unverified' };
