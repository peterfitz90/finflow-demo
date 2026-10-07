// Everything the FRS 105 statements show, assembled from loaded data (STA-01 Stage 5a). Pure: no
// React, no Supabase. The statements page (App.jsx FinancialStatements) and the server-side PDF
// (api/statements-pdf.js) both call this, so the PDF shows exactly what the screen shows.
//
// Moved verbatim from FinancialStatements' derived-values block; `generated` gates the same values
// it gated there (the page computes before "Generate" is pressed, with no journals).
import { computeFrs105, frs105FiscalYear, frs105Warnings } from './frs105.js';
import { listPeriods, isYearEnd } from './periods.js';
import { fiscalConfig, fiscalYearContaining } from '../fiscalYear.js';
import { ledgerEvidence, fixedAssetClasses, informationRequired, directorsInOffice } from './statementInputs.js';
import { balanceSheetStatements, statementNotes } from './wording.js';
import { microEligibility } from './eligibility.js';
import { ledgerLines, priorColumn, ledgerDifferences } from './comparatives.js';
import { addDaysStr } from '../dates.js';

const longFmt = d => new Date(d + 'T00:00:00').toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric' });

// The period the statements cover for a year end: from the company's period list (recorded
// periods, then regular years) or, if not in the list, the month-based start.
export function resolvePeriod({ company, periods = [], yearEnd, today }) {
  const yeMonth = company?.year_end_month || 12;
  const fyEndDay = company?.fy_end_day ?? null;
  const options = listPeriods({ yeMonth, fyEndDay, periods, today });
  const selectedPeriod = options.find(o => o.val === yearEnd) || null;
  const fyStart = selectedPeriod?.start || (yearEnd ? frs105FiscalYear(yearEnd, yeMonth).fyStart : null);
  return { yeMonth, fyEndDay, options, selectedPeriod, fyStart };
}

// inputs: { profile, directors, yearInputs, disclosures, comparatives } (the accountant-only
// statement tables). journals: every journal up to the year end. openingJournals: every OPENING
// journal of the company, whatever its date.
export function assembleStatements({ generated = true, company, companyName, journals = [], chart = [], bankCodes = ['1000'],
  periods = [], openingJournals = [], inputs, yearEnd, today }) {
  const fsInputs = { profile: null, directors: [], yearInputs: null, disclosures: [], comparatives: [], ...(inputs || {}) };
  const { yeMonth, fyEndDay, selectedPeriod, fyStart } = resolvePeriod({ company, periods, yearEnd, today });
  const isCompanyYearEnd = d => isYearEnd(d, { yeMonth, fyEndDay, periods });

  const frs105 = computeFrs105(journals, { yearEnd, yeMonth, periodStart: fyStart, mode: 'schedule3b', chart });
  const { bs: s3bs, pnl: s3pnl, profit: pfYear, imbalance: s3Imbalance, unmapped: s3Unmapped } = frs105;
  // Interim guard (STA-01): warnings only. Shown on screen, never printed.
  const guardWarnings = generated ? frs105Warnings(journals, frs105, { bankCodes, yearEnd, ledgerCompleteFrom: company?.ledger_complete_from || null, isYearEnd: isCompanyYearEnd, openingJournals }) : [];
  // Stage 3c: what the accountant still has to record, and the ledger evidence for suggestions.
  const inputsEvidence = generated && fyStart ? ledgerEvidence(journals, { fyStart, yearEnd }) : null;
  const assetClasses = generated && fyStart ? fixedAssetClasses(journals, { fyStart }) : [];
  const hasShareCapital = generated && (['LTD', 'DAC'].includes(fsInputs.profile?.legal_form) || s3bs.K1.amount !== 0);
  // Stage 4a comparatives: precedence approved snapshot (Stage 5), then confirmed lines, then the
  // ledger as a check only.
  const priorYE = fyStart ? addDaysStr(fyStart, -1) : null;
  const priorStart = priorYE ? fiscalYearContaining(priorYE, fiscalConfig(company, periods)).start : null;
  const priorLedger = generated && priorYE
    ? ledgerLines(computeFrs105(journals.filter(j => j.date <= priorYE), { yearEnd: priorYE, yeMonth, periodStart: priorStart, mode: 'schedule3b', chart }))
    : {};
  const prior = priorColumn(fsInputs.comparatives);
  const showPrior = !!(prior.bs || prior.pnl);
  const compDiffs = ledgerDifferences(prior, priorLedger);
  const hadPriorYear = generated && !!fyStart && selectedPeriod?.kind !== 'first' && journals.some(j => j.date < fyStart);
  const comparativesNeeded = { bs: hadPriorYear && !prior.bs, pnl: hadPriorYear && !prior.pnl };
  const infoRequired = generated ? informationRequired({ company: company || {}, ...fsInputs, assetClasses, yearEnd, shareCapitalNeeded: hasShareCapital, comparativesNeeded }) : [];
  // Stage 3d: statutory wording (wording.js) from the inputs and figures.
  const approvalISO = fsInputs.yearInputs?.approval_date || null;
  const inOfficeAtApproval = approvalISO ? directorsInOffice(fsInputs.directors, approvalISO) : [];
  const nameOf = id => fsInputs.directors.find(d => d.id === id)?.full_name;
  const bsStatements = balanceSheetStatements({
    disclosures: fsInputs.disclosures, companyName,
    approvalDate: approvalISO ? longFmt(approvalISO) : null,
    signatories: (fsInputs.yearInputs?.signatory_ids || []).map(nameOf).filter(Boolean),
    soleDirector: inOfficeAtApproval.length === 1,
  });
  const dividendsInYear = generated && fyStart ? Math.round(journals.filter(j => j.date >= fyStart)
    .reduce((t, j) => t + (j.debit_account === '3400' ? Number(j.amount) : 0) - (j.credit_account === '3400' ? Number(j.amount) : 0), 0) * 100) / 100 : 0;
  const notes = generated ? statementNotes({
    companyName, legalForm: fsInputs.profile?.legal_form, country: fsInputs.profile?.country, croNumber: company?.cro_number,
    registeredOffice: fsInputs.profile?.registered_office, disclosures: fsInputs.disclosures,
    yearEndFmt: yearEnd ? longFmt(yearEnd) : '',
    depreciationRates: fsInputs.yearInputs?.policy_inputs?.depreciation || {}, assetClasses,
    taxUsed: s3pnl['7'].amount !== 0 || [...s3bs.E.codes, ...s3bs.C.codes].some(c => c.code === '2210'),
    reserves: { atStart: Math.round((s3bs.K2.amount - pfYear + dividendsInYear) * 100) / 100, result: pfYear, dividendsInYear, atEnd: s3bs.K2.amount },
    shareCapital: hasShareCapital ? { amount: s3bs.K1.amount, number: fsInputs.yearInputs?.policy_inputs?.share_capital?.number, shareClass: fsInputs.yearInputs?.policy_inputs?.share_capital?.class } : null,
  }) : [];
  // Stage 3e: micro eligibility, warn only.
  const eligibility = generated ? microEligibility({
    turnover: s3pnl['1'].amount,
    periodMonths: selectedPeriod?.months ?? 12,
    grossAssets: Math.round((s3bs.A.amount + s3bs.B.amount + s3bs.C.amount + s3bs.D.amount) * 100) / 100,
    employees: fsInputs.yearInputs?.average_employees ?? null,
    legalForm: fsInputs.profile?.legal_form || null,
    disclosures: fsInputs.disclosures,
  }) : null;
  // Ledger-side DRAFT conditions (missing inputs excluded): these put a caution on suggestions.
  const ledgerDraftConditions = generated ? [
    guardWarnings.some(w => w.id === 'no_opening') ? 'no opening balances' : null,
    s3Unmapped.length > 0 ? 'unmapped balances' : null,
    Math.abs(s3Imbalance) >= 0.005 ? 'an imbalance' : null,
  ].filter(Boolean) : [];
  // DRAFT: unmapped balances, an imbalance, no opening position, or a required input missing.
  const isDraft = generated && (s3Unmapped.length > 0 || Math.abs(s3Imbalance) >= 0.005 || guardWarnings.some(w => w.id === 'no_opening') || infoRequired.length > 0);

  const yeFmt = yearEnd ? longFmt(yearEnd) : '';
  const notAYear = !!selectedPeriod && selectedPeriod.months !== 12;
  const periodPhrase = notAYear ? `period from ${longFmt(selectedPeriod.start)} to ${yeFmt}` : `year ended ${yeFmt}`;

  return {
    yeMonth, fyEndDay, selectedPeriod, fyStart, isCompanyYearEnd, frs105, s3bs, s3pnl, pfYear, s3Imbalance, s3Unmapped,
    guardWarnings, inputsEvidence, assetClasses, hasShareCapital, priorYE, priorStart, priorLedger, prior, showPrior, compDiffs,
    hadPriorYear, comparativesNeeded, infoRequired, bsStatements, notes, eligibility, ledgerDraftConditions, isDraft,
    yeFmt, notAYear, periodPhrase, approvalISO,
  };
}
