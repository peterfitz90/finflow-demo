// The FRS 105 calculation exactly as committed before STA-01 Stage 1 extracted it, loaded straight
// from git (BASELINE) by the same markers the extraction used, so regression tests always compare
// the shared engine against the real pre-extraction code, never a hand-kept copy.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const BASELINE = '352c9f6';
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

export const gitShow = (path, rev = BASELINE) =>
  execFileSync('git', ['show', `${rev}:${path}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .replace(/\r\n/g, '\n');

// Whole lines from the line holding startMarker through the line where endMarker ends.
export function cut(text, startMarker, endMarker, label, from = 0) {
  const s = text.indexOf(startMarker, from);
  if (s < 0) throw new Error(`${label}: start marker missing`);
  if (from === 0 && text.indexOf(startMarker, s + 1) >= 0) throw new Error(`${label}: start marker not unique`);
  const e = text.indexOf(endMarker, s);
  if (e < 0) throw new Error(`${label}: end marker missing`);
  const lineStart = text.lastIndexOf('\n', s) + 1;
  const lineEnd = text.indexOf('\n', e + endMarker.length - 1) + 1;
  return text.slice(lineStart, lineEnd);
}

// Every figure the statements render, plus the fiscal-year start the P&L is bound to.
export const FIGURES = [
  'fixedAssets', 'debtors', 'cashAtBank', 'currAssets', 'creditors', 'netCurrAssets', 'totAssetsLCL',
  'shareCapital', 'retainedEarns', 'turnover', 'cos', 'grossProfit', 'adminExp', 'opProfit',
  'interest', 'pbt', 'pfYear',
];

export function loadBaseline() {
  const app = gitShow('src/App.jsx');
  const coa = gitShow('src/shared/chartOfAccounts.js');
  const fsStart = app.indexOf('function FinancialStatements(');
  if (fsStart < 0) throw new Error('FinancialStatements not found at baseline');

  const blocks = {
    fiscalYear: cut(app, "// Fiscal year start for the SELECTED yearEnd — same yearStartMonth logic GLReport's ytdStart", 'const fyStart = fyStartYear != null', 'fiscal year'),
    figures: cut(app, '// Balance sheet accounts are cumulative from inception — unchanged, correct as before.', 'const pfYear  = pbt;', 'figures'),
    query: cut(app, "const { data } = await fetchAllRows(() => supabase.from('journals')\n      .select('*').eq('company_id', company.id).lte('date', yearEnd)", ".order('date').order('id'));", 'journal query'),
    yearEndOptions: cut(app, 'const yearEndOptions = (() => {', '})();', 'year-end options', fsStart),
    glAccounts: cut(coa, 'export const GL_ACCOUNTS = [', '\n];', 'GL_ACCOUNTS'),
  };

  // eslint-disable-next-line no-new-func
  const GL_ACCOUNTS = new Function(`${blocks.glAccounts.replace('export const', 'const')}\nreturn GL_ACCOUNTS;`)();
  // eslint-disable-next-line no-new-func
  const legacy = new Function('journals', 'yearEnd', 'yeMonth', 'GL_ACCOUNTS',
    `${blocks.fiscalYear}${blocks.figures}return { fyStart, allCodes, acctBal, ${FIGURES.join(', ')} };`);
  // eslint-disable-next-line no-new-func
  const yearEnds = new Function('yeMonth', 'localDateStr', `${blocks.yearEndOptions}return yearEndOptions.map(o => o.val);`);

  return {
    blocks,
    GL_ACCOUNTS,
    compute: (journals, yearEnd, yeMonth) => legacy(journals, yearEnd, yeMonth, GL_ACCOUNTS),
    yearEnds,
  };
}

// Compare the baseline and engine results. Zero tolerance: raw floats must be identical
// (Object.is), which is stricter than "to the cent". Also compares every account's balance.
export function diffResults(base, eng) {
  const diffs = [];
  if (base.fyStart !== eng.fyStart) diffs.push(`fyStart ${base.fyStart} vs ${eng.fyStart}`);
  for (const k of FIGURES) if (!Object.is(base[k], eng[k])) diffs.push(`${k} ${base[k]} vs ${eng[k]}`);
  const codes = [...new Set([...base.allCodes, ...eng.allCodes])].sort();
  if (codes.length !== base.allCodes.length || codes.length !== eng.allCodes.length) diffs.push('account code sets differ');
  for (const c of codes) if (!Object.is(base.acctBal(c), eng.acctBal(c))) diffs.push(`balance ${c} ${base.acctBal(c)} vs ${eng.acctBal(c)}`);
  return { diffs, compared: 1 + FIGURES.length + codes.length };
}
