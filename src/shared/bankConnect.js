// Yapily bank connection — institution list, starting the hosted consent flow, reconnecting a
// lapsed consent, and the user-facing connection state. Shared by the full app's Bank Feeds
// and /mobile's Cash tab. The Yapily secret stays server-side (api/yapily/*); the callback
// returns to /?bank_connected=1&company_id=… (or ?bank_error=…), which main.jsx routes to
// /mobile for a phone.
import { supabase } from '../supabase.js';

export async function fetchInstitutions(country = 'IE') {
  const res  = await fetch(`/api/yapily/institutions?country=${country}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not load banks');
  return { institutions: data.institutions ?? [], environment: data.environment ?? null };
}

export function filterInstitutions(institutions, search) {
  const q = (search || '').trim().toLowerCase();
  return institutions.filter(i => !q || i.name.toLowerCase().includes(q) || i.id.toLowerCase().includes(q));
}

// Starts the hosted consent flow; resolves to the Yapily URL to send the browser to.
export async function startBankConnect(companyId, inst) {
  const res  = await fetch('/api/yapily/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${await window.Clerk?.session?.getToken()}` },
    body: JSON.stringify({
      company_id:            companyId,
      institution:           inst.id,
      institutionCountryCode: inst.countryCode,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.hostedUrl) throw new Error(data.error || 'Failed to initiate connection');
  return data.hostedUrl;
}

// Reconnect — for EU 180-day (UK 90-day) consents the user re-authorises via a fresh hosted
// consent flow after expiry, rather than extending the old one. Marks the lapsed row expired so
// it doesn't keep showing as active once the fresh consent (a new bank_connections row) is
// created by /api/yapily/connect; returns the institution to start that flow with.
export async function prepareReconnect(conn, institutions = []) {
  if (conn.status !== 'expired' && conn.status !== 'revoked') {
    await supabase.from('bank_connections').update({ status: 'expired', yapily_consent_token: null, updated_at: new Date().toISOString() }).eq('id', conn.id);
  }
  return institutions.find(i => i.id === conn.institution_id) || {
    id:          conn.institution_id,
    name:        conn.institution_id,
    countryCode: conn.institution_id === 'modelo-sandbox' ? 'GB' : 'IE',
  };
}

// Surface a warning within this many days of the expiry deadline — but the check itself
// is date-based so sandbox's ~10-minute window still correctly falls straight into
// "expiring"/"expired" for quick end-to-end testing.
export const EXPIRY_WARNING_DAYS = 14;

// Derive the user-facing lifecycle state from the stored dates — independent of whatever
// `status` last got written by a sync attempt, since reconfirmBy can lapse with no sync
// having run at all. `fmtDate` formats the expiry date for the 'expiring' label.
export function connectionState(c, fmtDate) {
  if (c.status === 'revoked') return { key: 'revoked', label: 'Revoked', tone: 'faint' };
  if (c.status === 'pending') return { key: 'pending', label: 'Pending', tone: 'warn' };
  if (c.status === 'failed')  return { key: 'failed',  label: 'Failed',  tone: 'danger' };

  const deadline = c.yapily_reconfirm_by || c.consent_expires_at;
  const deadlineMs = deadline ? new Date(deadline).getTime() : null;
  const now = Date.now();

  if (c.status === 'expired' || (deadlineMs && now >= deadlineMs)) {
    return { key: 'expired', label: 'Expired — reconnect needed', tone: 'danger' };
  }
  if (deadlineMs && now >= deadlineMs - EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000) {
    return { key: 'expiring', label: `Expires ${fmtDate(deadline)}`, tone: 'warn' };
  }
  return { key: 'active', label: 'Active', tone: 'accent' };
}
