// Comparatives (prior-year figures) for the FRS 105 statements (STA-01 Stage 4a). Pure: no React,
// no Supabase. Rows live in fs_comparatives (supabase/add_fs_comparatives.sql): entered by hand
// now, extracted in Stage 4b, confirmed only through fs_confirm_comparatives, which re-runs the
// checks. Precedence on the statements: approved snapshot (Stage 5), then confirmed lines here,
// then the ledger, shown as a check with its differences.
//
// Amounts are held as the engine holds them (schedule3b.js): creditors (E, H), provisions (I),
// costs (pnl.3–7) and dividends positive. Subtotals (F, G, K, pnl.8) are optional; when absent
// they are computed.

export const COMPARATIVE_LINES = [
  { key: 'bs.A', group: 'bs', label: 'Called up share capital not paid', required: true },
  { key: 'bs.B', group: 'bs', label: 'Fixed assets', required: true },
  { key: 'bs.C', group: 'bs', label: 'Current assets', required: true },
  { key: 'bs.D', group: 'bs', label: 'Prepayments and accrued income', required: true },
  { key: 'bs.E', group: 'bs', label: 'Creditors: amounts falling due within one year', required: true },
  { key: 'bs.F', group: 'bs', label: 'Net current assets (liabilities)', subtotal: true },
  { key: 'bs.G', group: 'bs', label: 'Total assets less current liabilities', subtotal: true },
  { key: 'bs.H', group: 'bs', label: 'Creditors: amounts falling due after more than one year', required: true },
  { key: 'bs.I', group: 'bs', label: 'Provisions for liabilities', required: true },
  { key: 'bs.K1', group: 'bs', label: 'Called up share capital', required: true },
  { key: 'bs.K2', group: 'bs', label: 'Profit and loss account', required: true },
  { key: 'bs.K', group: 'bs', label: 'Capital and reserves', subtotal: true },
  { key: 'res.bf', group: 'bs', label: 'Profit and loss account at the start of the year (reserves note)' },
  { key: 'res.div', group: 'bs', label: 'Dividends paid (reserves note)' },
  { key: 'pnl.1', group: 'pnl', label: 'Turnover', required: true },
  { key: 'pnl.2', group: 'pnl', label: 'Other income', required: true },
  { key: 'pnl.3', group: 'pnl', label: 'Cost of raw materials and consumables', required: true },
  { key: 'pnl.4', group: 'pnl', label: 'Staff costs', required: true },
  { key: 'pnl.5', group: 'pnl', label: 'Value adjustments and other amounts written off assets', required: true },
  { key: 'pnl.6', group: 'pnl', label: 'Other expenses', required: true },
  { key: 'pnl.7', group: 'pnl', label: 'Tax', required: true },
  { key: 'pnl.8', group: 'pnl', label: 'Profit or loss', subtotal: true },
];
// fs_comparatives rows carry line_group 'bs' for the res.* lines (they confirm with the balance sheet).
export const groupOf = key => (key.startsWith('pnl.') ? 'pnl' : 'bs');

const r2 = n => Math.round(n * 100) / 100;

// Every line from a schedule3b engine result for the comparative year (computeFrs105 at the prior
// year end with that year's start): the ledger's own figures, for pre-fill and as the check.
export function ledgerLines(S) {
  if (!S?.bs || !S?.pnl) return {};
  const out = {};
  for (const k of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'K', 'K1', 'K2']) out[`bs.${k}`] = r2(S.bs[k].amount);
  for (const k of ['1', '2', '3', '4', '5', '6', '7', '8']) out[`pnl.${k}`] = r2(S.pnl[k].amount);
  const div = r2(S.reserves?.dividends || 0);
  out['res.div'] = div;
  out['res.bf'] = r2(S.bs.K2.amount - S.pnl['8'].amount + div);
  return out;
}

// Fill computed subtotals for a set of { key: amount } values.
export function withSubtotals(v) {
  const x = { ...v };
  const n = k => Number(x[k] || 0);
  if (['bs.C', 'bs.D', 'bs.E'].every(k => k in x) && !('bs.F' in x)) x['bs.F'] = r2(n('bs.C') + n('bs.D') - n('bs.E'));
  if (['bs.A', 'bs.B'].every(k => k in x) && 'bs.F' in x && !('bs.G' in x)) x['bs.G'] = r2(n('bs.A') + n('bs.B') + n('bs.F'));
  if (['bs.K1', 'bs.K2'].every(k => k in x) && !('bs.K' in x)) x['bs.K'] = r2(n('bs.K1') + n('bs.K2'));
  if (['pnl.1', 'pnl.2', 'pnl.3', 'pnl.4', 'pnl.5', 'pnl.6', 'pnl.7'].every(k => k in x) && !('pnl.8' in x))
    x['pnl.8'] = r2(n('pnl.1') + n('pnl.2') - n('pnl.3') - n('pnl.4') - n('pnl.5') - n('pnl.6') - n('pnl.7'));
  if ('bs.G' in x && ['bs.H', 'bs.I'].every(k => k in x)) x.netAssets = r2(n('bs.G') - n('bs.H') - n('bs.I'));
  return x;
}

// The prior-year column from fs_comparatives rows: confirmed lines only, per group. A group with
// no confirmed lines is null (nothing is shown for it).
export function priorColumn(rows = []) {
  const live = rows.filter(r => r.status === 'confirmed');
  const pick = g => {
    const rs = live.filter(r => groupOf(r.line_key) === g);
    if (!rs.length) return null;
    return withSubtotals(Object.fromEntries(rs.map(r => [r.line_key, Number(r.confirmed_amount)])));
  };
  return { bs: pick('bs'), pnl: pick('pnl') };
}

// Confirmed figures against the ledger, line by line (the ledger as a check): every line with a
// difference of a cent or more.
export function ledgerDifferences(prior, ledger) {
  const out = [];
  for (const g of ['bs', 'pnl']) {
    if (!prior[g]) continue;
    for (const l of COMPARATIVE_LINES.filter(x => x.group === g)) {
      if (!(l.key in prior[g]) || !(l.key in ledger)) continue;
      const d = r2(prior[g][l.key] - ledger[l.key]);
      if (Math.abs(d) >= 0.01) out.push({ key: l.key, label: l.label, confirmed: prior[g][l.key], ledger: ledger[l.key], difference: d });
    }
  }
  return out;
}
