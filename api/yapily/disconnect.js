// POST /api/yapily/disconnect
// Revokes a bank connection: calls Yapily DELETE /consents/{consentId} server-side,
// then marks the bank_connections row 'revoked' so no further sync can use it.
// SECURITY: YAPILY_APP_SECRET is server-side only. Scoped to company_id — a company
// can only revoke its own connections.

import { createClient } from '@supabase/supabase-js';
import { withSentry, captureError } from '../_sentry.js';
import { requireAccountant, AuthError } from '../_auth.js';

function yapilyBasicAuth() {
  const id  = process.env.YAPILY_APP_ID?.trim();
  const sec = process.env.YAPILY_APP_SECRET?.trim();
  if (!id || !sec) throw new Error('[yapily/disconnect] YAPILY_APP_ID or YAPILY_APP_SECRET not set');
  return 'Basic ' + Buffer.from(`${id}:${sec}`).toString('base64');
}

export default withSentry(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: 'Supabase not configured' });

  const { company_id, connection_id } = req.body ?? {};
  if (!company_id)    return res.status(400).json({ error: 'company_id required' });
  if (!connection_id) return res.status(400).json({ error: 'connection_id required' });

  try {
    await requireAccountant(req, company_id);
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    throw e;
  }

  const db = createClient(supabaseUrl, serviceKey);

  // Scope to company_id — a company can only revoke its OWN connection.
  const { data: conn, error: connErr } = await db
    .from('bank_connections')
    .select('id, company_id, institution_id, status, yapily_consent_id')
    .eq('id', connection_id)
    .eq('company_id', company_id)
    .maybeSingle();

  if (connErr) {
    captureError(connErr, { company_id, operation: 'yapily-disconnect-lookup' });
    return res.status(500).json({ error: connErr.message });
  }
  if (!conn) return res.status(404).json({ error: 'Bank connection not found for this company' });

  if (conn.status === 'revoked') {
    return res.status(200).json({ success: true, already_revoked: true });
  }

  // ── Revoke at Yapily (uses consentId, not the consent token) ──────────────────
  let yapilyRevoked = false;
  let yapilyWarning = null;

  if (!conn.yapily_consent_id) {
    // Pre-dates consentId capture — nothing to revoke upstream. Still disconnect
    // locally so the row stops syncing; flag it for manual follow-up.
    yapilyWarning = 'No Yapily consentId stored for this connection — could not revoke upstream. Disconnected locally only.';
    console.warn('[yapily/disconnect] no yapily_consent_id on connection', connection_id, '— local-only revoke');
  } else {
    try {
      const auth = yapilyBasicAuth();
      const path = `/consents/${conn.yapily_consent_id}?forceDelete=true`;
      console.log('[yapily/disconnect] → DELETE', path);
      const delRes = await fetch(
        `https://api.yapily.com${path}`,
        { method: 'DELETE', headers: { 'Authorization': auth, 'Accept': 'application/json' } },
      );
      if (delRes.ok || delRes.status === 404) {
        // 404 = already gone at Yapily (e.g. user revoked at the bank) — treat as revoked.
        yapilyRevoked = true;
      } else {
        const delData = await delRes.json().catch(() => ({}));
        yapilyWarning = delData?.error?.message ?? delData?.message ?? `Yapily delete failed (${delRes.status})`;
        console.error('[yapily/disconnect] Yapily DELETE failed:', delRes.status, JSON.stringify(delData).slice(0, 300));
        captureError(new Error(yapilyWarning), { company_id, operation: 'yapily-disconnect-delete', connection_id });
      }
    } catch (err) {
      yapilyWarning = 'Could not reach Yapily: ' + err.message;
      captureError(err, { company_id, operation: 'yapily-disconnect-delete-fetch', connection_id });
    }
  }

  // ── Mark revoked locally regardless of Yapily outcome ──────────────────────────
  // A disconnect request must stop local sync immediately, even if the upstream
  // call failed — sync.js/ingest.js only ever pick up status='active' rows, so this
  // alone halts further imports. The consent token is cleared since it's dead weight
  // (and a live credential) once we no longer intend to use it.
  const { error: updErr } = await db.from('bank_connections').update({
    status: 'revoked',
    yapily_consent_token: null,
    updated_at: new Date().toISOString(),
  }).eq('id', conn.id);

  if (updErr) {
    captureError(updErr, { company_id, operation: 'yapily-disconnect-update', connection_id });
    return res.status(500).json({ error: 'Yapily revocation ' + (yapilyRevoked ? 'succeeded' : 'attempted') + ' but failed to update connection status: ' + updErr.message });
  }

  console.log('[yapily/disconnect] connection', connection_id, 'revoked | yapily_revoked:', yapilyRevoked, '| company:', company_id);

  return res.status(200).json({
    success: true,
    yapily_revoked: yapilyRevoked,
    warning: yapilyWarning,
  });
});
