// Practice Dashboard — cross-client aggregation (RPT-02: A = portfolio totals strip,
// B = cross-client deadline list) and the accountant-only scoping of the client list.
// Pure functions over data the dashboard already has in memory: no queries of their own.

// A company belongs in an accountant's portfolio only if the user IS its accountant — the
// owner (companies.clerk_user_id) or role='accountant' in user_company_access. RLS
// (user_company_ids()) returns companies for EITHER role, so without this a user who is an
// accountant for some clients and a business_owner of another company would see that company
// in their practice view and totals. Same rule as the SQL helper user_is_accountant().
export function isAccountantFor(company, userId, roleByCompanyId) {
  if (!company || !userId) return false;
  return company.clerk_user_id === userId || roleByCompanyId?.[company.id] === 'accountant';
}

// A — portfolio totals. `data` is the dashboard's per-company map { balance, arTotal,
// arOverdue, ... }; statusOf(company, d) → { level: red|amber|green|loading };
// deadlineRows = crossClientDeadlines(...) output — the VAT tile counts clients from the SAME
// VAT3 rows the deadline list shows (not filed, due passed / within 7 days), so the strip and
// the list can never disagree on the same page.
export function portfolioTotals(companies, data, statusOf, deadlineRows = []) {
  const t = {
    clients: companies.length, loaded: 0,
    cash: 0, cashKnown: 0,
    arTotal: 0, arOverdue: 0,
    red: 0, amber: 0, green: 0,
    vatOverdue: 0, vatDueSoon: 0,
  };
  for (const c of companies) {
    const d = data[c.id];
    if (!d) continue;                       // still loading — counted in clients, not in sums
    t.loaded++;
    if (d.balance != null && Number.isFinite(Number(d.balance))) { t.cash += Number(d.balance); t.cashKnown++; }
    t.arTotal   += Number(d.arTotal   || 0);
    t.arOverdue += Number(d.arOverdue || 0);
    const level = statusOf(c, d)?.level;
    if (level === 'red' || level === 'amber' || level === 'green') t[level]++;
  }
  // Clients (not returns) with a VAT3 overdue / due within 7 days; overdue takes precedence.
  const inBook = new Set(companies.map(c => c.id));
  const vatRows = deadlineRows.filter(r => r.type === 'VAT3' && inBook.has(r.companyId));
  const overdue = new Set(vatRows.filter(r => r.daysUntil < 0).map(r => r.companyId));
  const soon = new Set(vatRows.filter(r => r.daysUntil >= 0 && r.daysUntil <= 7 && !overdue.has(r.companyId)).map(r => r.companyId));
  t.vatOverdue = overdue.size;
  t.vatDueSoon = soon.size;
  t.cash = Math.round(t.cash * 100) / 100;
  t.arTotal = Math.round(t.arTotal * 100) / 100;
  t.arOverdue = Math.round(t.arOverdue * 100) / 100;
  return t;
}

// Which computeDeadlines() entries actually apply to this company. computeDeadlines lists every
// type for everyone; the dashboard already has the flags to tell. Also used by /mobile's Home and
// Compliance tabs. vatFiled = Set of filed vat_returns.period_val.
export function deadlineApplies(company, dl, vatFiled) {
  switch (dl.type) {
    case 'VAT3': return !!company.vat_registered && !(dl.period_val && vatFiled?.has(dl.period_val));
    case 'P30':
    case 'P35':  return !!company.paye_registered;
    case 'CT1':  return company.company_type !== 'Sole Trader';
    default:     return true;                // CRO only appears when an ARD is set
  }
}

// B — one date-sorted list of every client's upcoming (and recently missed) deadlines.
// Window: from `pastDays` ago (overdue, still actionable) to `aheadDays` ahead.
export function crossClientDeadlines(companies, data, computeDeadlines, { today = new Date(), pastDays = 30, aheadDays = 60 } = {}) {
  const t0 = new Date(today); t0.setHours(0, 0, 0, 0);
  const out = [];
  for (const c of companies) {
    const vatFiled = data[c.id]?.vatFiled;
    for (const dl of computeDeadlines(c)) {
      const daysUntil = Math.floor((dl.due - t0) / 86400000);
      if (daysUntil < -pastDays || daysUntil > aheadDays) continue;
      if (!deadlineApplies(c, dl, vatFiled)) continue;
      out.push({ companyId: c.id, companyName: c.name, type: dl.type, desc: dl.desc, due: dl.due, daysUntil });
    }
  }
  return out.sort((a, b) => a.due - b.due || a.companyName.localeCompare(b.companyName));
}
