// FRS 105 statements in the Companies Act 2014 Schedule 3B micro formats (STA-01 Stage 2):
// balance sheet Format 1 and the by-nature profit and loss account. Pure: no React, no Supabase.
//
// Every nominal maps to exactly one line through MAPPING below. There is no balancing figure:
// reserves are derived from the ledger (3100 + every P&L result to date − dividends), so the
// balance sheet balances on its own when every balance is mapped. Anything that cannot be placed
// (a code not in MAPPING, not in the company's own chart, or whose chart type disagrees) is
// returned in `unmapped`, and any resulting difference is returned as `imbalance`. Nothing is
// absorbed. Amounts are summed in integer cents.
//
// Lines and order: Sch 3B Part II Section B (as enacted by the Companies (Accounting) Act 2017).
// Subtotals F and G follow the Format 1 layout; whether J (accruals and deferred income) is
// deducted after G, as here, rather than inside net current assets, is for Peter to verify.

// Balance sheet Format 1.
export const BS_LINES = [
  { key: 'A', label: 'Called up share capital not paid' },
  { key: 'B', label: 'Fixed assets' },
  { key: 'C', label: 'Current assets' },
  { key: 'D', label: 'Prepayments and accrued income' },
  { key: 'E', label: 'Creditors: amounts falling due within one year' },
  { key: 'F', label: 'Net current assets (liabilities)', subtotal: true },
  { key: 'G', label: 'Total assets less current liabilities', subtotal: true },
  { key: 'H', label: 'Creditors: amounts falling due after more than one year' },
  { key: 'I', label: 'Provisions for liabilities' },
  { key: 'J', label: 'Accruals and deferred income' },
  { key: 'K', label: 'Capital and reserves', subtotal: true },
];
export const RESERVE_LINES = [
  { key: 'K1', label: 'Called up share capital' },
  { key: 'K2', label: 'Profit and loss account' },
];
// Profit and loss account, by nature.
export const PNL_LINES = [
  { key: '1', label: 'Turnover' },
  { key: '2', label: 'Other income' },
  { key: '3', label: 'Cost of raw materials and consumables' },
  { key: '4', label: 'Staff costs' },
  { key: '5', label: 'Value adjustments and other amounts written off assets' },
  { key: '6', label: 'Other expenses' },
  { key: '7', label: 'Tax' },
  { key: '8', label: 'Profit or loss' },
];

// code -> { line, type } where type is the chart account_type the code must have. 'K2' lines
// feed reserves; 'DLA' is the directors' loan account, placed by sign (debit C, credit E).
// The five codes marked "proposed" are STA-01 Stage 2 additions awaiting approval; no journal
// uses them yet.
export const MAPPING = {
  // Balance sheet
  1000: { line: 'C', type: 'asset' }, 1100: { line: 'C', type: 'asset' },
  1200: { line: 'D', type: 'asset' }, 1250: { line: 'D', type: 'asset' },
  1300: { line: 'C', type: 'asset' }, 1600: { line: 'C', type: 'asset' },
  1500: { line: 'B', type: 'asset' }, 1501: { line: 'B', type: 'asset' },
  1510: { line: 'B', type: 'asset' }, 1511: { line: 'B', type: 'asset' },
  1520: { line: 'B', type: 'asset' }, 1521: { line: 'B', type: 'asset' },
  1530: { line: 'B', type: 'asset' }, 1531: { line: 'B', type: 'asset' },
  1540: { line: 'B', type: 'asset' }, 1541: { line: 'B', type: 'asset' },
  2000: { line: 'E', type: 'liability' }, 2100: { line: 'E', type: 'liability' },
  2200: { line: 'E', type: 'liability' }, 2210: { line: 'E', type: 'liability' },   // 2210 proposed: Corporation Tax Payable
  2250: { line: 'E', type: 'liability' }, 2260: { line: 'E', type: 'liability' },
  2300: { line: 'J', type: 'liability' }, 2350: { line: 'E', type: 'liability' },
  2400: { line: 'DLA', type: 'liability' },
  2500: { line: 'H', type: 'liability' },
  3000: { line: 'K1', type: 'equity' }, 3100: { line: 'K2', type: 'equity' },
  3400: { line: 'K2', type: 'equity' },                                              // 3400 proposed: Dividends Paid
  // Profit and loss
  4000: { line: '1', type: 'income' }, 4100: { line: '1', type: 'income' },
  4200: { line: '2', type: 'income' }, 4250: { line: '2', type: 'income' },          // 4250 proposed: Profit on Disposal of Fixed Assets
  4300: { line: '2', type: 'income' },
  5000: { line: '3', type: 'expense' }, 5100: { line: '3', type: 'expense' },
  5200: { line: '6', type: 'expense' }, 5300: { line: '4', type: 'expense' },
  6000: { line: '4', type: 'expense' },
  6100: { line: '6', type: 'expense' }, 6200: { line: '6', type: 'expense' }, 6300: { line: '6', type: 'expense' },
  6400: { line: '6', type: 'expense' }, 6500: { line: '6', type: 'expense' }, 6550: { line: '6', type: 'expense' }, // 6550 proposed: Interest Payable
  6600: { line: '6', type: 'expense' }, 6700: { line: '6', type: 'expense' }, 6750: { line: '6', type: 'expense' },
  6800: { line: '6', type: 'expense' }, 6900: { line: '6', type: 'expense' },
  6910: { line: '5', type: 'expense' }, 6950: { line: '5', type: 'expense' },
  8000: { line: '7', type: 'expense' },                                              // 8000 proposed: Corporation Tax
};
const PNL_KEYS = new Set(PNL_LINES.map(l => l.key));
const cents = n => Math.round(Number(n) * 100);
const eur = c => c / 100;

// Where a code goes for this company, or why it can't be placed. chartByCode: the company's own
// chart_of_accounts rows keyed by code.
export function placeCode(code, chartByCode) {
  const m = MAPPING[code];
  if (!m) return { reason: 'no Schedule 3B line for this code' };
  const row = chartByCode.get(code);
  if (!row) return { reason: "not in the company's chart of accounts" };
  if (row.account_type !== m.type) return { reason: `chart type is ${row.account_type}, expected ${m.type}` };
  return { line: m.line };
}

// journals: every journal up to yearEnd. chart: the company's chart_of_accounts rows
// ({ code, name, account_type, category }). fyStart: first day of the financial year.
export function computeSchedule3b(journals, { fyStart, yearEnd, chart = [] }) {
  const chartByCode = new Map(chart.map(r => [r.code, r]));
  // Debit-minus-credit per code, in cents: to date, before the year, and within the year.
  const toDate = new Map(), before = new Map(), inYear = new Map();
  const add = (map, code, c) => map.set(code, (map.get(code) || 0) + c);
  for (const j of journals) {
    const c = cents(j.amount);
    for (const [code, signed] of [[j.debit_account, c], [j.credit_account, -c]]) {
      add(toDate, code, signed);
      if (fyStart && j.date >= fyStart) add(inYear, code, signed); else add(before, code, signed);
    }
  }
  const codes = [...toDate.keys()].sort();
  const name = code => chartByCode.get(code)?.name || null;

  const bs = Object.fromEntries([...BS_LINES, ...RESERVE_LINES].map(l => [l.key, { amount: 0, codes: [] }]));
  const pnl = Object.fromEntries(PNL_LINES.map(l => [l.key, { amount: 0, codes: [] }]));
  const unmapped = [];
  const mapping = [];
  const reserves = { retainedEarnings: 0, priorResults: 0, yearResult: 0, dividends: 0 };
  let unmappedNet = 0;

  for (const code of codes) {
    const dTo = toDate.get(code) || 0, dBefore = before.get(code) || 0, dYear = inYear.get(code) || 0;
    if (!dTo && !dYear && !dBefore) continue;
    const place = placeCode(code, chartByCode);
    if (!place.line) {
      unmapped.push({ code, name: name(code), reason: place.reason, debitNet: eur(dTo), yearMovement: eur(dYear) });
      unmappedNet += dTo;
      continue;
    }
    let line = place.line;
    if (PNL_KEYS.has(line)) {
      // Income lines are shown as credits, expense lines as debits.
      const sign = line === '1' || line === '2' ? -1 : 1;
      if (dYear) { pnl[line].amount += sign * dYear; pnl[line].codes.push({ code, amount: eur(sign * dYear) }); }
      reserves.priorResults += -dBefore;
      reserves.yearResult += -dYear;
      mapping.push({ code, name: name(code), line });
      continue;
    }
    if (line === 'DLA') line = dTo > 0 ? 'C' : 'E';
    if (line === 'K2') {
      if (code === '3400') reserves.dividends += dTo; else reserves.retainedEarnings += -dTo;
    }
    // Assets (A–D) are shown as debits; creditors, provisions, accruals and capital as credits.
    const sign = ['A', 'B', 'C', 'D'].includes(line) ? 1 : -1;
    if (line !== 'K2') { bs[line].amount += sign * dTo; bs[line].codes.push({ code, amount: eur(sign * dTo) }); }
    mapping.push({ code, name: name(code), line: place.line === 'DLA' ? `DLA→${line}` : line });
  }

  // P&L subtotal and reserves.
  const profit = pnl['1'].amount + pnl['2'].amount - pnl['3'].amount - pnl['4'].amount - pnl['5'].amount - pnl['6'].amount - pnl['7'].amount;
  pnl['8'].amount = profit;
  bs.K2.amount = reserves.retainedEarnings + reserves.priorResults + reserves.yearResult - reserves.dividends;
  bs.K2.codes = [{ code: '3100', amount: eur(reserves.retainedEarnings) }, { code: 'P&L before the year', amount: eur(reserves.priorResults) },
    { code: 'P&L for the year', amount: eur(reserves.yearResult) }, { code: '3400', amount: eur(-reserves.dividends) }];

  bs.F.amount = bs.C.amount + bs.D.amount - bs.E.amount;
  bs.G.amount = bs.A.amount + bs.B.amount + bs.F.amount;
  const netAssets = bs.G.amount - bs.H.amount - bs.I.amount - bs.J.amount;
  bs.K.amount = bs.K1.amount + bs.K2.amount;
  const imbalance = netAssets - bs.K.amount;

  const out = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { amount: eur(v.amount), codes: v.codes }]));
  return {
    bs: out(bs),
    pnl: out(pnl),
    netAssets: eur(netAssets),
    profit: eur(profit),
    reserves: Object.fromEntries(Object.entries(reserves).map(([k, v]) => [k, eur(v)])),
    unmapped,
    unmappedNet: eur(unmappedNet),
    imbalance: eur(imbalance),
    mapping,
  };
}
