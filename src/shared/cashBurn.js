// Cash burn and runway — Overview's "Burn rate" / "runway" figures and the "under 3 months"
// insight. Pure functions over journal rows; no queries.
//
// Net burn = (expenses − income) per month, averaged over the last 3 COMPLETE calendar months:
//   income   = credits to 4000–4999 minus debits to them (credit notes / reversals reduce it)
//   expenses = debits to 5000–6999 minus credits to them (refunds / reversals reduce it)
// It's the P&L run-rate: VAT/PAYE settlements, loan repayments, capital spend and owner
// drawings aren't in it. Previously this was the gross 5000–6999 debits of the single selected
// month — income never netted, no averaging — so a net-positive month could show "0.2mo runway".

const ym = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const pad = n => String(n).padStart(2, '0');
const monthEndStr = (y, m) => `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}`; // m 1-based

// The window: 3 complete calendar months. Viewing the current (still open) month → the 3 months
// before it; viewing a past month → the 3 months ending with it. selPeriod = 'YYYY-MM'.
export function burnWindow(selPeriod, today = new Date()) {
  const [y, m] = selPeriod.split('-').map(Number);
  const endOffset = selPeriod >= ym(today) ? -1 : 0; // current/future month isn't complete
  const months = [];
  for (let i = 2; i >= 0; i--) {
    const d = new Date(y, m - 1 + endOffset - i, 1);
    months.push(ym(d));
  }
  const [sy, sm] = months[0].split('-').map(Number);
  const [ey, em] = months[2].split('-').map(Number);
  return { months, start: `${months[0]}-01`, end: monthEndStr(ey, em), startYear: sy, startMonth: sm };
}

const inRange = (code, lo, hi) => code >= lo && code < hi;

// Per-month income / expenses / journal count for the window, and the averages.
// complete = the company's books cover the whole window: its first journal is on or before the
// window's first day (a feed that starts mid-window — e.g. Moyvencap from 16 Jun — would make
// the first month partial) AND every month has at least one journal (a month with none, e.g. a
// bank-import gap, would drag the average toward zero). Otherwise no figure is shown.
export function netBurn(journals, months, { firstJournalDate = null } = {}) {
  const by = Object.fromEntries(months.map(k => [k, { month: k, income: 0, expenses: 0, journals: 0 }]));
  for (const j of journals || []) {
    const b = by[String(j.date).slice(0, 7)];
    if (!b) continue;
    const amt = Math.abs(Number(j.amount) || 0);
    b.journals++;
    if (inRange(j.credit_account, '4000', '5000')) b.income += amt;
    if (inRange(j.debit_account, '4000', '5000')) b.income -= amt;
    if (inRange(j.debit_account, '5000', '7000')) b.expenses += amt;
    if (inRange(j.credit_account, '5000', '7000')) b.expenses -= amt;
  }
  const rows = months.map(k => by[k]);
  const n = rows.length || 1;
  const r2 = x => Math.round(x * 100) / 100;
  const avgIncome = r2(rows.reduce((s, r) => s + r.income, 0) / n);
  const avgExpenses = r2(rows.reduce((s, r) => s + r.expenses, 0) / n);
  return {
    months: rows.map(r => ({ ...r, income: r2(r.income), expenses: r2(r.expenses) })),
    avgIncome, avgExpenses,
    avgNetBurn: r2(avgExpenses - avgIncome),
    complete: !!firstJournalDate && firstJournalDate <= `${months[0]}-01` && rows.every(r => r.journals > 0),
  };
}

// What Overview shows. kind: 'insufficient' (no figure, no warning) | 'generative' (net inflow —
// no runway figure, no warning) | 'burning' (runway = balance ÷ net burn; warn under 3 months).
export function runwayState(balance, burn) {
  if (balance === null || balance === undefined || !burn || !burn.complete) {
    return { kind: 'insufficient', label: 'Runway: not enough history', ok: null, warn: false, months: null };
  }
  if (burn.avgNetBurn <= 0) {
    return { kind: 'generative', label: 'Cash-generative', ok: true, warn: false, months: null };
  }
  const months = Math.max(0, balance) / burn.avgNetBurn;
  return { kind: 'burning', label: `${months.toFixed(1)}mo runway`, ok: months >= 3, warn: months < 3, months };
}
