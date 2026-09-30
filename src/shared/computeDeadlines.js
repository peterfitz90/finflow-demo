import { vatDueDay, p30DueDay } from './vat3.js';

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export function computeDeadlines(company) {
  const today = new Date(); today.setHours(0,0,0,0);
  const diff  = d => Math.floor((d - today) / 86400000);
  const deadlines = [];
  const vatPeriod = company?.vat_period || 'bimonthly';
  const yem       = Number(company?.year_end_month || 12);
  const ardMonth  = company?.ard_month ? Number(company.ard_month) : null;
  const ardDay    = company?.ard_day   ? Number(company.ard_day)   : null;
  // ROS e-filers get the 23rd for VAT3 and P30 (vatDueDay / p30DueDay — the VAT screens' rule).
  const vatDay    = vatDueDay(company?.ros_efiler);
  const p30Day    = p30DueDay(company?.ros_efiler);

  for (let i = -1; i <= 2; i++) {
    const due = new Date(today.getFullYear(), today.getMonth() + i + 1, p30Day);
    const m   = new Date(today.getFullYear(), today.getMonth() + i, 1);
    if (diff(due) >= -30)
      deadlines.push({ type:"P30", desc:`PAYE/PRSI — ${MONTH_SHORT[m.getMonth()]} ${m.getFullYear()}`, due });
  }
  if (vatPeriod === 'bimonthly') {
    const pairs = [{m:[0,1],dm:2},{m:[2,3],dm:4},{m:[4,5],dm:6},{m:[6,7],dm:8},{m:[8,9],dm:10},{m:[10,11],dm:0,ny:true}];
    for (let y = today.getFullYear()-1; y <= today.getFullYear()+1; y++) {
      pairs.forEach((p, pairIdx) => {
        const due = new Date(p.ny ? y+1 : y, p.dm, vatDay);
        const d = diff(due);
        // period_val matches vat_returns.period_val / getVATPeriods ('b-<year>-<pair 0-5>'),
        // so callers can tell a filed period apart from an outstanding one.
        if (d >= -30 && d <= 120)
          deadlines.push({ type:"VAT3", desc:`VAT3 — ${MONTH_SHORT[p.m[0]]}/${MONTH_SHORT[p.m[1]]} ${y}`, due, period_val: `b-${y}-${pairIdx}` });
      });
    }
  } else {
    for (let i = -1; i <= 3; i++) {
      const m   = new Date(today.getFullYear(), today.getMonth()+i, 1);
      const due = new Date(today.getFullYear(), today.getMonth()+i+1, vatDay);
      const d = diff(due);
      if (d >= -30 && d <= 120)
        deadlines.push({ type:"VAT3", desc:`VAT3 — ${MONTH_SHORT[m.getMonth()]} ${m.getFullYear()}`, due, period_val: `m-${m.getFullYear()}-${m.getMonth()}` });
    }
  }
  for (let y = today.getFullYear()-1; y <= today.getFullYear()+1; y++) {
    const due = new Date(y, yem - 1 + 9, 23);
    const d = diff(due);
    if (d >= -30 && d <= 400)
      deadlines.push({ type:"CT1", desc:`Corp Tax — FY${y}`, due });
  }
  for (let y = today.getFullYear()-1; y <= today.getFullYear(); y++) {
    const due = new Date(y+1, 1, 15);
    const d = diff(due);
    if (d >= -30 && d <= 365)
      deadlines.push({ type:"P35", desc:`Annual Return — ${y}`, due });
  }
  if (ardMonth && ardDay) {
    for (let y = today.getFullYear()-1; y <= today.getFullYear()+1; y++) {
      const due = new Date(y, ardMonth-1, ardDay+56);
      const d = diff(due);
      if (d >= -30 && d <= 400)
        deadlines.push({ type:"CRO", desc:`B1 Annual Return — ${y}`, due });
    }
  }
  return deadlines.sort((a,b) => a.due - b.due);
}

// First day ('YYYY-MM-DD') of the VAT period a VAT3 deadline's period_val names —
// 'b-<year>-<pair 0-5>' (bi-monthly) or 'm-<year>-<month 0-11>' (monthly). Lets callers match
// a deadline against filed periods given as date ranges (get_locked_periods — the RPC a
// business_owner must use, since vat_returns SELECT is accountant-only).
export function vatPeriodStartOf(periodVal) {
  const [kind, y, n] = String(periodVal || '').split('-');
  if (!y || n === undefined) return null;
  const month = kind === 'b' ? Number(n) * 2 + 1 : Number(n) + 1;
  return `${y}-${String(month).padStart(2, '0')}-01`;
}

// The period_vals of the VAT3 deadlines in `deadlines` whose period is filed. lockedPeriods are
// get_locked_periods rows ({ period_start, period_end }) — the RPC every role can read (a
// business_owner can't read vat_returns). Feeds deadlineApplies(company, dl, vatFiled).
export function filedVatPeriodVals(deadlines, lockedPeriods) {
  return new Set((deadlines || [])
    .filter(dl => dl.type === 'VAT3' && dl.period_val)
    .filter(dl => { const st = vatPeriodStartOf(dl.period_val); return (lockedPeriods || []).some(p => st >= p.period_start && st <= p.period_end); })
    .map(dl => dl.period_val));
}
