// Loads everything the FRS 105 statements need for one company and year end, and assembles it with
// src/shared/statements/assemble.js (the function the statements page uses). `db` is a supabase-js
// client: in api/statements-pdf.js it carries the caller's own token, so RLS applies exactly as on
// screen (accountant-only tables included); scripts may pass a service-role client for local review.
import { fetchJournalsToDate, fetchChartForStatements } from '../src/shared/statements/frs105.js';
import { assembleStatements, resolvePeriod } from '../src/shared/statements/assemble.js';
import { fetchAllRows } from '../src/shared/fetchAllRows.js';
import { addDaysStr } from '../src/shared/dates.js';

const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };

// preloaded (local review only): { periods, profile, directors, yearInputs, disclosures, comparatives }
// for the accountant-only tables, which the service role cannot read.
export async function loadStatements(db, companyId, yearEnd, today, preloaded = null) {
  const company = must(await db.from('companies').select('*').eq('id', companyId).maybeSingle(), 'company');
  if (!company) throw Object.assign(new Error('Company not found'), { status: 404 });
  const periods = preloaded ? (preloaded.periods || []) : (must(await db.from('financial_periods').select('period_start, period_end, kind, reason').eq('company_id', companyId), 'periods') || []);
  const { fyStart } = resolvePeriod({ company, periods, yearEnd, today });
  const priorYE = fyStart ? addDaysStr(fyStart, -1) : null;

  const [journals, chart, banks, opening, profile, directors, yearInputs, disclosures, comparatives] = await Promise.all([
    fetchJournalsToDate(db, companyId, yearEnd).then(r => must(r, 'journals')),
    fetchChartForStatements(db, companyId).then(r => must(r, 'chart')),
    db.from('bank_accounts').select('nominal_code').eq('company_id', companyId).eq('is_active', true).then(r => must(r, 'bank accounts')),
    fetchAllRows(() => db.from('journals').select('id, date, reference').eq('company_id', companyId).eq('reference', 'OPENING').order('date').order('id')).then(r => must(r, 'opening')),
    preloaded ? preloaded.profile : db.from('company_statutory_profile').select('*').eq('company_id', companyId).maybeSingle().then(r => must(r, 'profile')),
    preloaded ? preloaded.directors : db.from('company_directors').select('*').eq('company_id', companyId).order('appointed_on', { nullsFirst: true }).order('full_name').then(r => must(r, 'directors')),
    preloaded ? preloaded.yearInputs : db.from('fs_year_inputs').select('*').eq('company_id', companyId).eq('year_end_date', yearEnd).eq('regime', 'FRS105').maybeSingle().then(r => must(r, 'year inputs')),
    preloaded ? preloaded.disclosures : db.from('fs_disclosures').select('*').eq('company_id', companyId).eq('year_end_date', yearEnd).eq('regime', 'FRS105').then(r => must(r, 'disclosures')),
    preloaded ? preloaded.comparatives : priorYE ? db.from('fs_comparatives').select('*').eq('company_id', companyId).eq('prior_year_end', priorYE).eq('regime', 'FRS105').neq('status', 'superseded').then(r => must(r, 'comparatives')) : Promise.resolve([]),
  ]);
  const bankCodes = [...new Set((banks || []).map(b => b.nominal_code).filter(Boolean))];
  const assembled = assembleStatements({
    generated: true, company, companyName: company.name, journals: journals || [], chart: chart || [],
    bankCodes: bankCodes.length ? bankCodes : ['1000'], periods, openingJournals: opening || [],
    inputs: { profile, directors: directors || [], yearInputs, disclosures: disclosures || [], comparatives: comparatives || [] },
    yearEnd, today,
  });
  return { company, assembled, journalCount: (journals || []).length };
}
