// BNK-14: a per-company daily cap on model reads of statements (Peter, 10 Oct 2026). Defaults: 40
// reads or US$5 a day, whichever comes first; a company can have its own limits in
// company_read_limits (server-only, set by Peter). "A day" is the Irish calendar day. Only reads
// that called the model count (a scanned PDF refused before any call costs nothing).
export const DEFAULT_READ_LIMITS = { max_reads_per_day: 40, max_usd_per_day: 5 };

// Midnight in Ireland, as an ISO instant, for the day containing `now`.
export function irishDayStart(now = new Date()) {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  // Irish offset at that date: 0 (GMT) or +1 (IST)
  const probe = new Date(`${ymd}T12:00:00Z`);
  const hourThere = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Dublin', hour: '2-digit', hour12: false }).format(probe));
  const offsetH = hourThere - 12;
  return new Date(Date.parse(`${ymd}T00:00:00Z`) - offsetH * 3600 * 1000).toISOString();
}

const counts = r => r.status === 'read' || r.status === 'failed' || (r.tokens_in || 0) > 0;

// reads: today's statement_reads rows ({ status, tokens_in, cost_usd }); limits: an override row or null.
export function readCapStatus(reads, limits = null) {
  const lim = { ...DEFAULT_READ_LIMITS, ...(limits ? Object.fromEntries(Object.entries(limits).filter(([, v]) => v != null)) : {}) };
  const used = reads.filter(counts);
  const n = used.length, usd = Math.round(used.reduce((t, r) => t + Number(r.cost_usd || 0), 0) * 10000) / 10000;
  const reached = n >= lim.max_reads_per_day || usd >= Number(lim.max_usd_per_day);
  return { reached, reads_today: n, usd_today: usd, max_reads_per_day: lim.max_reads_per_day, max_usd_per_day: Number(lim.max_usd_per_day),
    message: reached ? `Today's limit for reading PDF statements for this company has been reached (${lim.max_reads_per_day} reads or US$${Number(lim.max_usd_per_day).toFixed(2)} a day; used: ${n} reads, US$${usd.toFixed(2)}). It resets at midnight. Contact support if you need it raised.` : null };
}
