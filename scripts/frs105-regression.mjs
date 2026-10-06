// STA-01 regression: for every limited company and each of its last three year ends (the same
// three the statements page offers) plus the current in-progress year end, run the
// pre-extraction FRS 105 code (read from git at the baseline commit) and the shared engine over
// the same journals and compare every figure,
// including the balancing figure and every account balance. Zero tolerance: raw floats must be
// identical. Read-only. Prints no secrets and no ledger amounts, only pass/fail per company/year.
//
//   node --env-file=.env --env-file=.env.service.local scripts/frs105-regression.mjs
//
// Needs VITE_SUPABASE_URL (.env) and SUPABASE_SERVICE_ROLE_KEY (.env.service.local, gitignored):
// statements cover every company, so RLS-scoped access would see only one user's companies.
import { createClient } from '@supabase/supabase-js';
import { loadBaseline, diffResults } from '../tests/statements/baseline.mjs';
import { computeFrs105, fetchJournalsToDate } from '../src/shared/statements/frs105.js';
import { localDateStr } from '../src/shared/dates.js';

const url = process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see header).'); process.exit(2); }
const db = createClient(url, key, { auth: { persistSession: false } });
const base = loadBaseline();

const { data: companies, error } = await db.from('companies')
  .select('id, name, year_end_month').eq('company_type', 'Limited Company').order('name');
if (error) { console.error(error.message); process.exit(2); }

let failures = 0, runs = 0, figures = 0;
const rows = [];
for (const co of companies) {
  const yeMonth = co.year_end_month || 12;
  // The three year ends the page offers, plus the current (in-progress) year end, so journals
  // posted after the last completed year end are exercised too.
  const offered = base.yearEnds(yeMonth, localDateStr);
  const [y, m] = offered[0].split('-').map(Number);
  const current = localDateStr(new Date(y + 1, m, 0));
  for (const yearEnd of [current, ...offered]) {
    const { data: journals, error: jErr } = await fetchJournalsToDate(db, co.id, yearEnd);
    if (jErr) { console.error(`${co.name} ${yearEnd}: ${jErr.message}`); process.exit(2); }
    const { diffs, compared } = diffResults(base.compute(journals, yearEnd, yeMonth), computeFrs105(journals, { yearEnd, yeMonth }));
    runs++; figures += compared;
    if (diffs.length) failures++;
    rows.push({ company: co.name, yearEnd: yearEnd === current ? `${yearEnd} (current)` : yearEnd, journals: journals.length, compared, result: diffs.length ? `DIFF: ${diffs.slice(0, 3).join('; ')}` : 'identical' });
  }
}
console.table(rows);
console.log(`${failures ? 'FAILED' : 'OK'}: ${companies.length} limited companies, ${runs} company/year-end runs, ${figures} values compared, ${failures} with differences (baseline ${(await import('../tests/statements/baseline.mjs')).BASELINE})`);
process.exit(failures ? 1 : 0);
