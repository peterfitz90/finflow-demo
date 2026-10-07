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

// The pure summary (no React or Supabase) lives in signoffSummary.js, so the server's approval rule
// uses the same code.
export { summariseSignoffs, activeOverlapping } from './signoffSummary.js';
import { summariseSignoffs } from './signoffSummary.js';

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
