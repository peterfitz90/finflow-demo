// STA-01 Stage 0 worklist: which limited companies and year ends trigger the FRS 105 interim
// guard warnings (a) balances absorbed by the balancing figure, (b) no opening position,
// (c) a bank nominal below zero at the year end. Same engine and guard code as the app.
// Read-only (paginated journal reads). Run for the last three year ends plus the current one:
//
//   node --env-file=.env --env-file=.env.service.local scripts/frs105-guard-report.mjs
//
// Needs VITE_SUPABASE_URL (.env) and SUPABASE_SERVICE_ROLE_KEY (.env.service.local, gitignored).
import { createClient } from '@supabase/supabase-js';
import { computeFrs105, fetchJournalsToDate, frs105Warnings } from '../src/shared/statements/frs105.js';
import { localDateStr } from '../src/shared/dates.js';

const url = process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see header).'); process.exit(2); }
const db = createClient(url, key, { auth: { persistSession: false } });

// The three year ends the statements page offers (same rule as FinancialStatements), plus the
// current in-progress one.
function yearEnds(yeMonth, now = new Date()) {
  const thisYE = new Date(now.getFullYear(), yeMonth, 0);
  const startYear = thisYE <= now ? now.getFullYear() : now.getFullYear() - 1;
  return [startYear + 1, startYear, startYear - 1, startYear - 2].map(y => localDateStr(new Date(y, yeMonth, 0)));
}

const { data: companies, error } = await db.from('companies')
  .select('id, name, year_end_month').eq('company_type', 'Limited Company').order('name');
if (error) { console.error(error.message); process.exit(2); }

const fmt = n => n.toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rows = [];
for (const co of companies) {
  const yeMonth = co.year_end_month || 12;
  const { data: banks } = await db.from('bank_accounts').select('nominal_code').eq('company_id', co.id).eq('is_active', true);
  const bankCodes = (banks || []).map(b => b.nominal_code).filter(Boolean);
  for (const [i, yearEnd] of yearEnds(yeMonth).entries()) {
    const { data: journals, error: jErr } = await fetchJournalsToDate(db, co.id, yearEnd);
    if (jErr) { console.error(`${co.name} ${yearEnd}: ${jErr.message}`); process.exit(2); }
    const ws = frs105Warnings(journals, computeFrs105(journals, { yearEnd, yeMonth }), { bankCodes: bankCodes.length ? bankCodes : ['1000'] });
    const get = id => ws.find(w => w.id === id);
    rows.push({
      company: co.name,
      yearEnd: i === 0 ? `${yearEnd} (current)` : yearEnd,
      journals: journals.length,
      '(a) absorbed': get('absorbed')?.items.map(x => `${x.code} ${fmt(Math.abs(x.debitNet))} ${x.debitNet >= 0 ? 'Dr' : 'Cr'}`).join(', ') || '',
      '(b) no opening': get('no_opening') ? `first ${get('no_opening').firstJournal ?? 'none'} > start ${get('no_opening').periodStart}` : '',
      '(c) negative bank': get('negative_bank')?.items.map(x => `${x.code} ${fmt(x.balance)}`).join(', ') || '',
    });
  }
}
console.table(rows);
