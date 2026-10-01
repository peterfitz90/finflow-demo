// BNK-01 — accountant period sign-off. Reads period_signoff_events (append-only; written only by
// the sign_off_period / withdraw_signoff RPCs and the write_after_signoff triggers) and derives
// each period's current status. Shared by Month End's sign-off control and the GL / Financial
// Statements badges.
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabase.js';
import { monthStart, monthEnd } from './dates.js';

// 'YYYY-MM' → the calendar month as a range (the default sign-off period).
export function monthRange(selPeriod) {
  const [y, m] = selPeriod.split('-').map(Number);
  return { start: monthStart(y, m), end: monthEnd(y, m) };
}

export function rangeLabel(start, end) {
  const s = new Date(start + 'T00:00:00'), e = new Date(end + 'T00:00:00');
  const isMonth = start.endsWith('-01') && start.slice(0, 7) === end.slice(0, 7) && end === monthEnd(s.getFullYear(), s.getMonth() + 1);
  if (isMonth) return s.toLocaleDateString('en-IE', { month: 'long', year: 'numeric' });
  const f = d => d.toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${f(s)} – ${f(e)}`;
}

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

export function usePeriodSignoffs(companyId) {
  const [events, setEvents] = useState(null);
  const [error, setError]   = useState(null);
  const load = useCallback(async () => {
    if (!companyId) { setEvents([]); return; }
    const { data, error: e } = await supabase.from('period_signoff_events').select('*')
      .eq('company_id', companyId).order('occurred_at');
    if (e) { setError(e.message); setEvents([]); } else { setError(null); setEvents(data || []); }
  }, [companyId]);
  useEffect(() => { load(); }, [load]);
  return { events, summaries: events ? summariseSignoffs(events) : null, error, reload: load };
}

export async function signOffPeriod(companyId, start, end, note, actorName) {
  const { data, error } = await supabase.rpc('sign_off_period', { p_company_id: companyId, p_period_start: start, p_period_end: end, p_note: note || null, p_actor_name: actorName || null });
  if (error) throw new Error(error.message);
  return data;
}

export async function withdrawSignoff(companyId, start, end, reason, actorName) {
  const { data, error } = await supabase.rpc('withdraw_signoff', { p_company_id: companyId, p_period_start: start, p_period_end: end, p_reason: reason, p_actor_name: actorName || null });
  if (error) throw new Error(error.message);
  return data;
}
