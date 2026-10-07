// BNK-01 / STA-01 Stage 5b: the period sign-off summary, pure (no React, no Supabase), shared by
// the Month End control, the statement badges and the server's approval rule.

// One entry per range that has ever been signed off: its latest signed_off / withdrawn event
// decides the status; changes = write_after_signoff rows logged since the latest sign-off.
export function summariseSignoffs(events) {
  const by = new Map();
  for (const ev of [...(events || [])].sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : 1))) {
    const key = `${ev.period_start}|${ev.period_end}`;
    if (!by.has(key)) by.set(key, { key, start: ev.period_start, end: ev.period_end, status: null, signed: null, withdrawn: null, changes: [], history: [] });
    const r = by.get(key);
    r.history.push(ev);
    if (ev.action === 'signed_off') { r.status = 'signed_off'; r.signed = ev; r.withdrawn = null; r.changes = []; }
    else if (ev.action === 'withdrawn') { r.status = 'withdrawn'; r.withdrawn = ev; }
    else if (ev.action === 'write_after_signoff' && r.status === 'signed_off') r.changes.push(ev);
  }
  return [...by.values()].filter(r => r.status);
}

// Currently signed-off ranges that overlap [from, to].
export const activeOverlapping = (summaries, from, to) =>
  (summaries || []).filter(r => r.status === 'signed_off' && r.start <= to && r.end >= from);

// Days in [from, to] (inclusive, YYYY-MM-DD) not covered by any currently signed-off range, as
// ranges. Empty = every day is covered.
export function uncoveredRanges(summaries, from, to) {
  const act = activeOverlapping(summaries, from, to).map(r => [r.start < from ? from : r.start, r.end > to ? to : r.end])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const next = d => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
  const prev = d => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };
  const gaps = [];
  let cursor = from;
  for (const [s, e] of act) {
    if (s > cursor) gaps.push({ start: cursor, end: prev(s) });
    if (e >= cursor) cursor = next(e);
    if (cursor > to) break;
  }
  if (cursor <= to) gaps.push({ start: cursor, end: to });
  return gaps;
}
