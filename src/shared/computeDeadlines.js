const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export function computeDeadlines(company) {
  const today = new Date(); today.setHours(0,0,0,0);
  const diff  = d => Math.floor((d - today) / 86400000);
  const deadlines = [];
  const vatPeriod = company?.vat_period || 'bimonthly';
  const yem       = Number(company?.year_end_month || 12);
  const ardMonth  = company?.ard_month ? Number(company.ard_month) : null;
  const ardDay    = company?.ard_day   ? Number(company.ard_day)   : null;

  for (let i = -1; i <= 2; i++) {
    const due = new Date(today.getFullYear(), today.getMonth() + i + 1, 14);
    const m   = new Date(today.getFullYear(), today.getMonth() + i, 1);
    if (diff(due) >= -30)
      deadlines.push({ type:"P30", desc:`PAYE/PRSI — ${MONTH_SHORT[m.getMonth()]} ${m.getFullYear()}`, due });
  }
  if (vatPeriod === 'bimonthly') {
    const pairs = [{m:[0,1],dm:2},{m:[2,3],dm:4},{m:[4,5],dm:6},{m:[6,7],dm:8},{m:[8,9],dm:10},{m:[10,11],dm:0,ny:true}];
    for (let y = today.getFullYear()-1; y <= today.getFullYear()+1; y++) {
      pairs.forEach(p => {
        const due = new Date(p.ny ? y+1 : y, p.dm, 19);
        const d = diff(due);
        if (d >= -30 && d <= 120)
          deadlines.push({ type:"VAT3", desc:`VAT3 — ${MONTH_SHORT[p.m[0]]}/${MONTH_SHORT[p.m[1]]} ${y}`, due });
      });
    }
  } else {
    for (let i = -1; i <= 3; i++) {
      const m   = new Date(today.getFullYear(), today.getMonth()+i, 1);
      const due = new Date(today.getFullYear(), today.getMonth()+i+1, 19);
      const d = diff(due);
      if (d >= -30 && d <= 120)
        deadlines.push({ type:"VAT3", desc:`VAT3 — ${MONTH_SHORT[m.getMonth()]} ${m.getFullYear()}`, due });
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
