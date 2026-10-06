// STA-01 Stage 3 regression: Stage 3 changes wording and inputs, never a figure. This records
// every Schedule 3B figure for every limited company (current year end and the last three) in a
// local golden file, then compares against it with zero tolerance. The golden file holds client
// figures, so it is gitignored (tests/statements/*.local.json).
//
//   node --env-file=.env --env-file=.env.service.local scripts/frs105-s3b-golden.mjs --write   (once, before Stage 3 changes)
//   node --env-file=.env --env-file=.env.service.local scripts/frs105-s3b-golden.mjs           (after each sub-stage)
//
// Read-only against the database. Needs SUPABASE_SERVICE_ROLE_KEY in .env.service.local.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { computeFrs105, fetchJournalsToDate } from '../src/shared/statements/frs105.js';
import { localDateStr } from '../src/shared/dates.js';

const FILE = new URL('../tests/statements/s3b-golden.local.json', import.meta.url);
const url = process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see header).'); process.exit(2); }
const db = createClient(url, key, { auth: { persistSession: false } });

function yearEnds(yeMonth, now = new Date()) {
  const thisYE = new Date(now.getFullYear(), yeMonth, 0);
  const startYear = thisYE <= now ? now.getFullYear() : now.getFullYear() - 1;
  return [startYear + 1, startYear, startYear - 1, startYear - 2].map(y => localDateStr(new Date(y, yeMonth, 0)));
}

const { data: companies, error } = await db.from('companies').select('id, name, year_end_month').eq('company_type', 'Limited Company').order('name');
if (error) { console.error(error.message); process.exit(2); }
const current = {};
for (const co of companies) {
  const yeMonth = co.year_end_month || 12;
  const { data: chart } = await db.from('chart_of_accounts').select('code, name, account_type, category').eq('company_id', co.id);
  for (const yearEnd of yearEnds(yeMonth)) {
    const { data: journals, error: jErr } = await fetchJournalsToDate(db, co.id, yearEnd);
    if (jErr) { console.error(jErr.message); process.exit(2); }
    const S = computeFrs105(journals, { yearEnd, yeMonth, mode: 'schedule3b', chart: chart || [] });
    const lines = {};
    for (const [k, v] of Object.entries(S.bs)) lines[`bs.${k}`] = v.amount;
    for (const [k, v] of Object.entries(S.pnl)) lines[`pnl.${k}`] = v.amount;
    Object.assign(lines, { netAssets: S.netAssets, profit: S.profit, imbalance: S.imbalance, unmapped: S.unmapped.map(u => u.code).join(' ') },
      Object.fromEntries(Object.entries(S.reserves).map(([k, v]) => [`reserves.${k}`, v])));
    current[`${co.id}|${yearEnd}`] = { company: co.name, yearEnd, lines };
  }
}

if (process.argv.includes('--write')) {
  writeFileSync(FILE, JSON.stringify(current, null, 1));
  console.log(`Golden written: ${Object.keys(current).length} company/year-end runs.`);
  process.exit(0);
}
if (!existsSync(FILE)) { console.error('No golden file: run with --write first (before Stage 3 changes).'); process.exit(2); }
const golden = JSON.parse(readFileSync(FILE, 'utf8'));
let diffs = 0, values = 0;
for (const k of new Set([...Object.keys(golden), ...Object.keys(current)])) {
  const a = golden[k]?.lines, b = current[k]?.lines;
  if (!a || !b) { diffs++; console.log(`MISSING ${k}`); continue; }
  for (const f of new Set([...Object.keys(a), ...Object.keys(b)])) {
    values++;
    if (!Object.is(a[f], b[f])) { diffs++; console.log(`DIFF ${golden[k].company} ${golden[k].yearEnd} ${f}: ${a[f]} → ${b[f]}`); }
  }
}
console.log(`${diffs ? 'FAILED' : 'OK'}: ${Object.keys(current).length} runs, ${values} values compared with the golden file, ${diffs} differences.`);
process.exit(diffs ? 1 : 0);
