// STA-01 Stage 2 expected-difference report: for every limited company at the current year end
// and its last three year ends, the legacy FRS 105 figures beside the Schedule 3B figures, with
// the reason for every difference, plus the mapping table and each company's chart coverage.
// Read-only. Writes Markdown to stdout (it contains client figures: keep it out of the repo).
//
//   node --env-file=.env --env-file=.env.service.local scripts/frs105-expected-diff.mjs > report.md
//
// Needs VITE_SUPABASE_URL (.env) and SUPABASE_SERVICE_ROLE_KEY (.env.service.local, gitignored).
import { createClient } from '@supabase/supabase-js';
import { computeFrs105, fetchJournalsToDate, frs105Warnings } from '../src/shared/statements/frs105.js';
import { MAPPING, BS_LINES, RESERVE_LINES, PNL_LINES, placeCode } from '../src/shared/statements/schedule3b.js';
import { localDateStr } from '../src/shared/dates.js';

const url = process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see header).'); process.exit(2); }
const db = createClient(url, key, { auth: { persistSession: false } });

const STAGE2 = { 2210: 'Corporation Tax Payable', 3400: 'Dividends Paid', 4250: 'Profit on Disposal of Fixed Assets', 6550: 'Interest Payable', 8000: 'Corporation Tax' };
const LINE_LABEL = Object.fromEntries([...BS_LINES, ...RESERVE_LINES, ...PNL_LINES.map(l => ({ ...l, key: l.key, label: `P&L ${l.key} ${l.label}` }))].map(l => [l.key, l.label]));
const PNL_KEYS = new Set(PNL_LINES.map(l => l.key));

const fmt = n => (Math.abs(n) < 0.005 ? '–' : n.toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const r2 = n => Math.round(n * 100) / 100;
const out = [];
const w = (...l) => out.push(...l);

function yearEnds(yeMonth, now = new Date()) {
  const thisYE = new Date(now.getFullYear(), yeMonth, 0);
  const startYear = thisYE <= now ? now.getFullYear() : now.getFullYear() - 1;
  return [startYear + 1, startYear, startYear - 1, startYear - 2].map(y => localDateStr(new Date(y, yeMonth, 0)));
}
// Where the legacy statements put a code: a balance sheet range, a P&L range, or the plug.
function legacyPlace(code) {
  const inR = (f, t) => code >= f && code <= t;
  if (inR('1000', '1099')) return 'cash';
  if (inR('1100', '1299')) return 'debtors';
  if (inR('1500', '1599')) return 'fixed assets';
  if (inR('2000', '2399')) return 'creditors';
  if (inR('3000', '3099')) return 'share capital';
  if (inR('4000', '4999')) return 'turnover';
  if (inR('5000', '5999')) return 'cost of sales';
  if (inR('6000', '6999')) return 'administrative expenses';
  if (inR('7000', '7999')) return 'interest';
  return 'absorbed in P&L reserve';
}
const LEGACY_BS = new Set(['cash', 'debtors', 'fixed assets', 'creditors', 'share capital']);

// ── Mapping table ─────────────────────────────────────────────────────────────────────────
w('# FRS 105 Schedule 3B: expected differences', '', `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC, read-only.`, '');
w('## Mapping table', '', '| Code | Type | Schedule 3B line | Legacy placement | Status |', '|---|---|---|---|---|');
for (const [code, m] of Object.entries(MAPPING).sort()) {
  w(`| ${code}${STAGE2[code] ? ` ${STAGE2[code]}` : ''} | ${m.type} | ${m.line} ${LINE_LABEL[m.line] || ''}${m.type === 'liability' ? '; C (other debtors) when in debit' : (m.line === 'C' || m.line === 'D') ? '; E (creditor) when in credit' : ''} | ${legacyPlace(code)} | ${STAGE2[code] ? 'added in Stage 2' : 'existing'} |`);
}
w('', 'Any code not in this table, missing from the company\'s own chart, or whose chart type differs is reported as unmapped. Every liability account in debit at the year end is shown as other debtors within C, and every current-asset account (C or D) in credit as a creditor within E, account by account, with no netting. Fixed-asset accounts stay in B whatever their sign. Accruals (2300) are within E; there is no separate J line.', '');

const { data: companies, error } = await db.from('companies').select('id, name, year_end_month').eq('company_type', 'Limited Company').order('name');
if (error) { console.error(error.message); process.exit(2); }

// ── Chart coverage ────────────────────────────────────────────────────────────────────────
w('## Chart coverage (every real limited company)', '', '| Company | Chart rows | Placed | Not placed |', '|---|---|---|---|');
const charts = {};
for (const co of companies) {
  const { data: chart } = await db.from('chart_of_accounts').select('code, name, account_type, category').eq('company_id', co.id);
  charts[co.id] = chart || [];
  const byCode = new Map(charts[co.id].map(r => [r.code, r]));
  const notPlaced = charts[co.id].filter(r => !placeCode(r.code, byCode).line).map(r => `${r.code} (${placeCode(r.code, byCode).reason})`);
  w(`| ${co.name} | ${charts[co.id].length} | ${charts[co.id].length - notPlaced.length} | ${notPlaced.join('; ') || 'none'} |`);
}
w('');

// ── Per company and year end ──────────────────────────────────────────────────────────────
const summary = [];
for (const co of companies) {
  const yeMonth = co.year_end_month || 12;
  w(`## ${co.name}`, '');
  for (const [i, yearEnd] of yearEnds(yeMonth).entries()) {
    const { data: journals, error: jErr } = await fetchJournalsToDate(db, co.id, yearEnd);
    if (jErr) { console.error(jErr.message); process.exit(2); }
    const label = `${yearEnd}${i === 0 ? ' (current, in progress)' : ''}`;
    if (!journals.length) { w(`### ${label}: no journals, every figure is nil in both`, ''); summary.push({ co: co.name, yearEnd, journals: 0 }); continue; }
    const L = computeFrs105(journals, { yearEnd, yeMonth, mode: 'legacy' });
    const S = computeFrs105(journals, { yearEnd, yeMonth, mode: 'schedule3b', chart: charts[co.id] });
    const b = k => S.bs[k].amount, p = k => S.pnl[k].amount;
    w(`### ${label} (${journals.length} journals; year from ${L.fyStart})`, '');

    w('**Profit and loss account**', '', '| Legacy (by function) | € | Schedule 3B (by nature) | € |', '|---|---:|---|---:|');
    const oldP = [['Turnover', L.turnover], ['Cost of sales', -L.cos], ['Gross profit', L.grossProfit], ['Administrative expenses', -L.adminExp], ['Operating profit', L.opProfit], ['Interest', L.interest], ['Profit before tax', L.pbt], ['Tax', 0], ['Profit for the financial year', L.pfYear]];
    const newP = [['1 Turnover', p('1')], ['2 Other income', p('2')], ['3 Raw materials and consumables', -p('3')], ['4 Staff costs', -p('4')], ['5 Value adjustments', -p('5')], ['6 Other expenses', -p('6')], ['7 Tax', -p('7')], ['8 Profit or loss', S.profit], ['', null]];
    for (let k = 0; k < Math.max(oldP.length, newP.length); k++) {
      const o = oldP[k] || ['', null], n = newP[k] || ['', null];
      w(`| ${o[0]} | ${o[1] == null ? '' : fmt(o[1])} | ${n[0]} | ${n[1] == null ? '' : fmt(n[1])} |`);
    }
    w('');

    w('**Balance sheet**', '', '| Legacy | € | Schedule 3B Format 1 | € |', '|---|---:|---|---:|');
    const oldB = [['Tangible assets', L.fixedAssets], ['Debtors', L.debtors], ['Cash at bank and in hand', L.cashAtBank], ['Creditors < 1 year', -L.creditors], ['Net current assets', L.netCurrAssets], ['Total assets less current liabilities', L.totAssetsLCL], ['', null], ['', null], ['', null], ['Called up share capital', L.shareCapital], ['Profit and loss account (balancing figure)', L.retainedEarns], ['Capital and reserves', L.totAssetsLCL], ['', null]];
    const newB = [['B Fixed assets', b('B')], ['C Current assets', b('C')], ['D Prepayments and accrued income', b('D')], ['E Creditors < 1 year', -b('E')], ['F Net current assets', b('F')], ['G Total assets less current liabilities', b('G')], ['H Creditors > 1 year', -b('H')], ['', null], ['Net assets', S.netAssets], ['K Called up share capital', b('K1')], ['K Profit and loss account (derived)', b('K2')], ['K Capital and reserves', b('K')], ['Imbalance (unmapped balances)', S.imbalance]];
    for (let k = 0; k < Math.max(oldB.length, newB.length); k++) {
      const o = oldB[k] || ['', null], n = newB[k] || ['', null];
      w(`| ${o[0]} | ${o[1] == null ? '' : fmt(o[1])} | ${n[0]} | ${n[1] == null ? '' : fmt(n[1])} |`);
    }
    w('', `Reserves derived: 3100 ${fmt(S.reserves.retainedEarnings)} + results before the year ${fmt(S.reserves.priorResults)} + result for the year ${fmt(S.reserves.yearResult)} − dividends ${fmt(S.reserves.dividends)} = ${fmt(b('K2'))}.`, '');

    // Reasons: every code whose placement differs, with its amount.
    const reasons = [];
    const chartByCode = new Map(charts[co.id].map(r => [r.code, r]));
    let plugDiff = 0, profitDiff = 0;
    for (const code of [...L.allCodes].sort()) {
      const dn = r2((L.rawD[code] || 0) - (L.rawC[code] || 0));
      const yr = r2((L.pnlRawD[code] || 0) - (L.pnlRawC[code] || 0));
      const old = legacyPlace(code);
      const np = placeCode(code, chartByCode);
      const debitLiab = !!np.line && MAPPING[code].type === 'liability' && dn > 0;
      const creditAsset = !!np.line && MAPPING[code].type === 'asset' && (np.line === 'C' || np.line === 'D') && dn < 0;
      const newLine = debitLiab ? 'C' : creditAsset ? 'E' : np.line;
      const isPnlNew = newLine && PNL_KEYS.has(newLine);
      const isPnlOld = ['turnover', 'cost of sales', 'administrative expenses', 'interest'].includes(old);
      // Effect on the P&L reserve: legacy puts every non-BS-range balance in the plug; new puts P&L and K2 codes there.
      const oldInReserve = !LEGACY_BS.has(old), newInReserve = isPnlNew || newLine === 'K2';
      const reserveEffect = r2((oldInReserve ? -dn : 0) - (newInReserve ? -dn : 0));
      const profitEffect = r2((isPnlOld ? -yr : 0) - (isPnlNew ? -yr : 0));
      plugDiff += reserveEffect; profitDiff += profitEffect;
      const shown = isPnlNew || isPnlOld ? yr : dn;
      if (!dn && !yr) continue;
      let reason = null;
      if (!np.line) reason = `unmapped balance now visible (${np.reason})`;
      else if (creditAsset) reason = `current-asset account in credit, shown as a creditor in E (previously netted within ${old})`;
      else if (debitLiab) reason = `liability account in debit, shown as other debtors in C${old === 'absorbed in P&L reserve' ? ' (previously absorbed in the P&L reserve)' : ' (previously netted within creditors)'}`;
      else if (old === 'absorbed in P&L reserve' && !newInReserve) reason = 'previously absorbed in the P&L reserve, now shown on its own line';
      else if (code === '3100' || newLine === 'K2') reason = 'reserve now derived from the ledger';
      else {
        const sameLine = { cash: 'C', debtors: 'C', 'fixed assets': 'B', creditors: 'E', 'share capital': 'K1' }[old];
        if (sameLine && sameLine !== newLine) reason = `reclassification: ${old} → ${newLine} ${LINE_LABEL[newLine] || ''}`;
        if (isPnlOld && isPnlNew && !(old === 'turnover' && newLine === '1')) reason = `reclassification by nature: ${old} → ${LINE_LABEL[newLine]}`;
      }
      if (reason) reasons.push(`| ${code} ${chartByCode.get(code)?.name || ''} | ${fmt(Math.abs(shown))} ${shown >= 0 ? 'Dr' : 'Cr'} | ${old} | ${newLine ? `${newLine} ${LINE_LABEL[newLine] || ''}` : 'unmapped'} | ${reason} |`);
    }
    if (reasons.length) w('**Reasons for differences**', '', '| Code | Amount | Legacy | Schedule 3B | Reason |', '|---|---:|---|---|---|', ...reasons, '');
    const reserveGap = r2(L.retainedEarns - b('K2'));
    w(`Profit: legacy ${fmt(L.pfYear)}, Schedule 3B ${fmt(S.profit)}, difference ${fmt(r2(L.pfYear - S.profit))} (explained by codes above: ${fmt(r2(profitDiff))}).`,
      `P&L reserve: legacy balancing figure ${fmt(L.retainedEarns)}, derived ${fmt(b('K2'))}, difference ${fmt(reserveGap)} (explained by codes above: ${fmt(r2(plugDiff))}).`, '');
    if (Math.abs(r2(reserveGap - plugDiff)) >= 0.01 || Math.abs(r2(L.pfYear - S.profit - profitDiff)) >= 0.01) w('**UNEXPLAINED DIFFERENCE: investigate.**', '');
    const guard = frs105Warnings(journals, S, { yearEnd });
    const noOpening = guard.some(x => x.id === 'no_opening');
    const assetCredit = guard.find(x => x.id === 'asset_credit');
    if (assetCredit) w(`Asset accounts in credit (information): ${assetCredit.items.map(x => `${x.code} ${x.name || ''}${x.kind === 'fixed-asset class' ? ' (fixed-asset class, stays in B)' : ''} ${fmt(x.credit)} Cr`).join('; ')}.`, '');
    const draft = [S.unmapped.length ? 'unmapped' : '', Math.abs(S.imbalance) >= 0.005 ? 'imbalance' : '', noOpening ? 'no opening balances' : ''].filter(Boolean).join(', ');
    w(`DRAFT watermark: ${draft || 'no'}.`, '');
    summary.push({ draft, co: co.name, yearEnd, journals: journals.length, profitOld: L.pfYear, profitNew: S.profit, reserveOld: L.retainedEarns, reserveNew: b('K2'), imbalance: S.imbalance, unmapped: S.unmapped.map(u => u.code).join(' '), draftReasons: [S.unmapped.length ? 'unmapped' : '', Math.abs(S.imbalance) >= 0.005 ? 'imbalance' : ''].filter(Boolean).join(', ') });
  }
}

w('## Summary', '', '| Company | Year end | Journals | Profit legacy | Profit 3B | Reserve legacy (plug) | Reserve 3B (derived) | Imbalance | Unmapped | DRAFT |', '|---|---|---:|---:|---:|---:|---:|---:|---|---|');
for (const s of summary) {
  if (!s.journals) { w(`| ${s.co} | ${s.yearEnd} | 0 | – | – | – | – | – | | no opening balances |`); continue; }
  w(`| ${s.co} | ${s.yearEnd} | ${s.journals} | ${fmt(s.profitOld)} | ${fmt(s.profitNew)} | ${fmt(s.reserveOld)} | ${fmt(s.reserveNew)} | ${fmt(s.imbalance)} | ${s.unmapped} | ${s.draft || 'no'} |`);
}
console.log(out.join('\n'));
