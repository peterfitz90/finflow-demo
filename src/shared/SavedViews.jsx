// Saved report views (RPT-01) — a "Views ▾" menu for GL Reports, Cash Flow and Overview.
// Rows live in user_report_views (supabase/add_user_report_views.sql): per user, either
// pinned to one company or company_id NULL = "all my clients". RLS limits every read/write
// to the caller's own rows and companies they can access.
import { useState, useEffect, useRef, useCallback } from 'react';
import { useUser } from '@clerk/clerk-react';
import { supabase } from '../supabase.js';
import { captureError } from '../sentry.js';

// What each screen may save — and nothing else. A loaded config is checked against this, so
// a view saved by an older build (or edited by hand) can't put a screen into a broken state:
// unknown keys are dropped, and a field with an unexpected value is simply not applied.
const oneOf = (...vals) => v => vals.includes(v);
const isBool = v => typeof v === 'boolean';
const PERIODS = ['current_month', 'last_month'];

export const SAVED_VIEW_SCHEMAS = {
  gl_reports: {
    tab:       oneOf('tb', 'pnl', 'pl_trend', 'bs', 'gl', 'fullgl', 'spend', 'aged_ap'),
    ytdMode:   isBool,
    cmpMode:   oneOf('none', 'prev', 'prev_year'),
    spendSort: oneOf('asc', 'desc'),
  },
  cash_flow: {
    ytdMode: isBool,
    cmpMode: oneOf('none', 'prev', 'prev_year'),
  },
  overview: {
    ytdMode:   isBool,
    cmpMode:   oneOf('none', 'prev', 'prev_year'),
    chartMode: oneOf('line', 'bars'),
  },
};

// Returns only the valid, known fields of `config` for `screen` (+ an optional relative period).
export function sanitizeViewConfig(screen, config) {
  const schema = SAVED_VIEW_SCHEMAS[screen];
  const out = {};
  if (!schema || !config || typeof config !== 'object' || Array.isArray(config)) return out;
  for (const [key, valid] of Object.entries(schema)) {
    if (key in config && valid(config[key])) out[key] = config[key];
  }
  // GL Reports doesn't offer "previous period" while YTD is on — don't restore that combination.
  if (screen === 'gl_reports' && out.ytdMode === true && out.cmpMode === 'prev') out.cmpMode = 'none';
  if (PERIODS.includes(config.period)) out.period = config.period;
  return out;
}

// The app-wide period is shared by every screen, so a view never stores an absolute month —
// only "current month" / "last month", resolved to YYYY-MM when the view is applied.
function resolvePeriod(period) {
  const now = new Date();
  const d = period === 'last_month' ? new Date(now.getFullYear(), now.getMonth() - 1, 1) : now;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const SCOPE_LABEL = { company: 'This client', all: 'All my clients' };

// current:  { field: value } — the screen's live state for its schema fields
// apply:    (sanitizedConfig) => void — sets the screen's state from a view (period excluded)
// setSelPeriod: optional — lets a view carry a relative period
// skipDefault:  don't auto-apply the default this time (e.g. GL Reports opened by a drill-down
//               straight into one account's ledger — a default view must not pull the user off it)
export function useSavedViews({ screen, companyId, current, apply, setSelPeriod, skipDefault = false }) {
  const { user } = useUser();
  const userId = user?.id;
  const [views, setViews] = useState([]);
  const [error, setError] = useState(null);
  const appliedFor = useRef(null); // `${userId}|${companyId}` the default was last applied for
  const applyRef = useRef(apply);
  applyRef.current = apply;

  const applyView = useCallback((view) => {
    const cfg = sanitizeViewConfig(screen, view?.config);
    const { period, ...fields } = cfg;
    applyRef.current(fields);
    if (period && setSelPeriod) setSelPeriod(resolvePeriod(period));
  }, [screen, setSelPeriod]);

  const load = useCallback(async () => {
    if (!userId || !companyId) return [];
    const { data, error: err } = await supabase.from('user_report_views')
      .select('id, company_id, name, config, is_default, updated_at')
      .eq('user_id', userId).eq('screen', screen)
      .or(`company_id.eq.${companyId},company_id.is.null`)
      .order('name');
    if (err) { setError(err.message); captureError(err, { operation: 'saved-views-load', screen }); return []; }
    setViews(data || []);
    return data || [];
  }, [userId, companyId, screen]);

  // On open (and on a company switch): load, then apply the default — a company-scoped
  // default beats an "all my clients" default, which beats the screen's built-in state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await load();
      const key = `${userId}|${companyId}`;
      if (cancelled || !userId || !companyId || appliedFor.current === key) return;
      appliedFor.current = key;
      if (skipDefault) return;
      const def = rows.find(v => v.is_default && v.company_id === companyId)
               || rows.find(v => v.is_default && v.company_id == null);
      if (def) applyView(def);
    })();
    return () => { cancelled = true; };
  }, [load, applyView, userId, companyId]);

  const clearDefaultIn = async (scopeCompanyId) => {
    let q = supabase.from('user_report_views').update({ is_default: false })
      .eq('user_id', userId).eq('screen', screen).eq('is_default', true);
    q = scopeCompanyId ? q.eq('company_id', scopeCompanyId) : q.is('company_id', null);
    const { error: err } = await q;
    if (err) throw err;
  };

  // Saves the screen's current state. Same name in the same scope = overwrite that view.
  const saveView = async ({ name, scope, period, makeDefault }) => {
    setError(null);
    const trimmed = (name || '').trim();
    if (!trimmed) { setError('Give the view a name'); return false; }
    const scopeCompanyId = scope === 'company' ? companyId : null;
    const config = sanitizeViewConfig(screen, { ...current, ...(period ? { period } : {}) });
    try {
      if (makeDefault) await clearDefaultIn(scopeCompanyId);
      const existing = views.find(v => v.name === trimmed && (v.company_id ?? null) === scopeCompanyId);
      const row = { config, ...(makeDefault ? { is_default: true } : {}) };
      const { error: err } = existing
        ? await supabase.from('user_report_views').update(row).eq('id', existing.id)
        : await supabase.from('user_report_views').insert({ ...row, user_id: userId, company_id: scopeCompanyId, screen, name: trimmed });
      if (err) throw err;
      await load();
      return true;
    } catch (err) {
      setError(err.message); captureError(err, { operation: 'saved-views-save', screen }); return false;
    }
  };

  const setDefault = async (view, on) => {
    setError(null);
    try {
      if (on) await clearDefaultIn(view.company_id ?? null);
      const { error: err } = await supabase.from('user_report_views').update({ is_default: on }).eq('id', view.id);
      if (err) throw err;
      await load();
    } catch (err) { setError(err.message); captureError(err, { operation: 'saved-views-default', screen }); }
  };

  const deleteView = async (view) => {
    setError(null);
    const { error: err } = await supabase.from('user_report_views').delete().eq('id', view.id);
    if (err) { setError(err.message); captureError(err, { operation: 'saved-views-delete', screen }); return; }
    await load();
  };

  return { views, error, applyView, saveView, setDefault, deleteView, canSave: !!userId && !!companyId };
}

const ctrlStyle = {
  fontSize: 11, fontFamily: 'Source Code Pro, monospace', background: 'var(--surface)', color: 'var(--text)',
  border: '1px solid var(--border)', borderRadius: 4, padding: '3px 8px', cursor: 'pointer',
};

export function ViewsMenu({ savedViews, companyName }) {
  const { views, error, applyView, saveView, setDefault, deleteView, canSave } = savedViews;
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);        // save form visible
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [form, setForm] = useState({ name: '', scope: 'company', period: '', makeDefault: false });
  const [flash, setFlash] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setSaving(false); setConfirmDelete(null); } };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const pick = (v) => { applyView(v); setOpen(false); setFlash(`Applied “${v.name}”`); setTimeout(() => setFlash(null), 2200); };
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const ok = await saveView(form);
    setBusy(false);
    if (ok) { setSaving(false); setForm({ name: '', scope: 'company', period: '', makeDefault: false }); setFlash('View saved'); setTimeout(() => setFlash(null), 2200); }
  };

  const scopeOf = v => (v.company_id ? 'company' : 'all');
  const row = { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', fontSize: 12 };

  return (
    <div ref={ref} className="no-print" style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <button type="button" style={ctrlStyle} onClick={() => { setOpen(o => !o); setSaving(false); }} aria-expanded={open} aria-haspopup="menu">
        Views ▾
      </button>
      {flash && <span role="status" style={{ fontSize: 10, color: 'var(--teal, var(--accent))', fontFamily: 'Source Code Pro, monospace' }}>{flash}</span>}
      {open && (
        <div role="menu" style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 400, width: 'min(320px, 86vw)',
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card, 8px)', boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}>
          {!saving && (
            <>
              <div style={{ maxHeight: 260, overflowY: 'auto', padding: '4px 0' }}>
                {views.length === 0 && <div style={{ ...row, color: 'var(--text-faint, var(--muted))' }}>No saved views yet</div>}
                {views.map(v => (
                  <div key={v.id} style={{ ...row, justifyContent: 'space-between' }}>
                    {confirmDelete === v.id ? (
                      <>
                        <span style={{ flex: 1, minWidth: 0 }}>Delete “{v.name}”?</span>
                        <button type="button" className="btn btn-d btn-sm" onClick={async () => { setConfirmDelete(null); await deleteView(v); }}>Delete</button>
                        <button type="button" className="btn btn-s btn-sm" onClick={() => setConfirmDelete(null)}>Keep</button>
                      </>
                    ) : (
                      <>
                        <button type="button" role="menuitem" onClick={() => pick(v)} title="Apply this view"
                          style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', padding: 0, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {v.name}
                        </button>
                        <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint, var(--muted))', flexShrink: 0 }}>
                          {SCOPE_LABEL[scopeOf(v)]}
                        </span>
                        <button type="button" onClick={() => setDefault(v, !v.is_default)}
                          title={v.is_default ? 'Default — click to stop opening with this view' : 'Set as default (opens with this view)'}
                          aria-label={v.is_default ? `Unset ${v.name} as default` : `Set ${v.name} as default`}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: v.is_default ? 'var(--gold, #d4a017)' : 'var(--text-faint, var(--muted))', padding: '0 2px' }}>
                          {v.is_default ? '★' : '☆'}
                        </button>
                        <button type="button" onClick={() => setConfirmDelete(v.id)} aria-label={`Delete ${v.name}`} title="Delete"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-faint, var(--muted))', padding: '0 2px' }}>✕</button>
                      </>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ borderTop: '1px solid var(--border)', padding: 6 }}>
                <button type="button" role="menuitem" disabled={!canSave} onClick={() => setSaving(true)}
                  style={{ ...ctrlStyle, width: '100%', border: 'none', textAlign: 'left', color: 'var(--accent)' }}>
                  Save current view…
                </button>
              </div>
            </>
          )}
          {saving && (
            <form onSubmit={submit} style={{ padding: 12, display: 'grid', gap: 8, fontSize: 12 }}>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ color: 'var(--muted)' }}>Name</span>
                <input className="f-input" autoFocus maxLength={80} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. TB — YTD vs last year" />
              </label>
              <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'grid', gap: 4 }}>
                <legend style={{ color: 'var(--muted)', marginBottom: 4 }}>Available for</legend>
                <label><input type="radio" name="scope" checked={form.scope === 'company'} onChange={() => setForm(f => ({ ...f, scope: 'company' }))} /> This client{companyName ? ` (${companyName})` : ''}</label>
                <label><input type="radio" name="scope" checked={form.scope === 'all'} onChange={() => setForm(f => ({ ...f, scope: 'all' }))} /> All my clients</label>
              </fieldset>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ color: 'var(--muted)' }}>Period when applied</span>
                <select className="f-input" value={form.period} onChange={e => setForm(f => ({ ...f, period: e.target.value }))}>
                  <option value="">Keep the period I'm on</option>
                  <option value="current_month">Current month</option>
                  <option value="last_month">Last month</option>
                </select>
              </label>
              <label><input type="checkbox" checked={form.makeDefault} onChange={e => setForm(f => ({ ...f, makeDefault: e.target.checked }))} /> Open with this view by default</label>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-s btn-sm" onClick={() => setSaving(false)}>Cancel</button>
                <button type="submit" className="btn btn-p btn-sm" disabled={busy}>{busy ? 'Saving…' : 'Save view'}</button>
              </div>
            </form>
          )}
          {error && <div role="alert" style={{ borderTop: '1px solid var(--border)', padding: '6px 10px', fontSize: 11, color: 'var(--danger, var(--red))' }}>{error}</div>}
        </div>
      )}
    </div>
  );
}
