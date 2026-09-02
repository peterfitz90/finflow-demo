// GET /api/yapily/callback
// Yapily redirects here after the user completes (or cancels) the hosted consent flow.
// Hosted Pages pattern: poll GET /hosted/consent-requests/{consentRequestId} SERVER-SIDE
// until it reports AUTHORIZED, then read consentToken/consentId straight off that response.
// There is no /consent-one-time-token exchange in Hosted Pages — that endpoint belongs to a
// different (non-hosted) integration pattern and must not be called here.
// SECURITY: consentToken is obtained and stored here — never sent to the browser.

import { createClient } from '@supabase/supabase-js';
import { captureError } from '../_sentry.js';
import { encryptToken } from '../_token-crypto.js';

function yapilyBasicAuth() {
  const id  = process.env.YAPILY_APP_ID?.trim();
  const sec = process.env.YAPILY_APP_SECRET?.trim();
  if (!id || !sec) throw new Error('[yapily/callback] YAPILY_APP_ID or YAPILY_APP_SECRET not set');
  return 'Basic ' + Buffer.from(`${id}:${sec}`).toString('base64');
}

function appUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host  = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Terminal failure statuses the hosted consent request can settle into — anything else
// (PENDING/AWAITING_AUTHORISATION/etc.) means "still polling".
const FAILURE_STATUSES = new Set(['FAILED', 'EXPIRED', 'REJECTED', 'DECLINED', 'ERRORED', 'CANCELLED']);

// Backoff between polls — the bank auth has already completed by the time the browser
// lands back on this callback, so the consent request is usually AUTHORIZED within the
// first attempt or two; this budget (~16s total) covers slower propagation.
const POLL_DELAYS_MS = [300, 600, 1200, 2000, 3000, 3000, 3000, 3000];

async function pollConsentRequest(consentRequestId) {
  for (let attempt = 0; attempt <= POLL_DELAYS_MS.length; attempt++) {
    const path = `/hosted/consent-requests/${consentRequestId}`;
    console.log('[yapily/callback] → GET', path);
    const res  = await fetch(`https://api.yapily.com${path}`, {
      headers: { 'Authorization': yapilyBasicAuth(), 'Accept': 'application/json' },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data?.error?.message ?? data?.message ?? `Yapily API error ${res.status}` };
    }
    const payload = data?.data ?? data ?? {};
    const status  = payload.status ?? null;
    console.log('[yapily/callback] poll attempt', attempt, '| status:', status);

    if (status === 'AUTHORIZED') return { ok: true, payload };
    if (status && FAILURE_STATUSES.has(status)) {
      return { ok: false, error: `Consent request ${status.toLowerCase()}`, status };
    }
    if (attempt < POLL_DELAYS_MS.length) await sleep(POLL_DELAYS_MS[attempt]);
  }
  return { ok: false, error: 'Timed out waiting for consent authorisation' };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const base        = appUrl(req);

  // Yapily passes these query params on redirect. Parameter naming varies slightly across
  // SDK versions — handle both forms.
  const q = req.query;
  const consentReqId = q['consent-request-id'] || q['consentRequestId'] || null;
  const errorCode    = q['error'] || null;

  console.log('[yapily/callback] received — consentReqId:', consentReqId, '| error:', errorCode);

  // ── Error from Yapily (user declined, timeout, etc.) ────────────────────────
  if (errorCode) {
    const desc = q['error_description'] || errorCode;
    if (consentReqId && supabaseUrl && serviceKey) {
      const db = createClient(supabaseUrl, serviceKey);
      await db.from('bank_connections')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('yapily_consent_request_id', consentReqId);
    }
    return res.redirect(302, `${base}/?bank_error=${encodeURIComponent(desc)}`);
  }

  if (!consentReqId) {
    console.error('[yapily/callback] no consent-request-id in callback params:', q);
    return res.redirect(302, `${base}/?bank_error=${encodeURIComponent('No consent request id in callback')}`);
  }

  if (!supabaseUrl || !serviceKey) {
    return res.redirect(302, `${base}/?bank_error=${encodeURIComponent('Server configuration error')}`);
  }

  const db = createClient(supabaseUrl, serviceKey);

  // Fetch the pending row up front — created_at is needed as the base for the reconfirmBy
  // fallback below if Yapily's response somehow omits it.
  const { data: rows } = await db.from('bank_connections')
    .select('id, company_id, created_at')
    .eq('yapily_consent_request_id', consentReqId)
    .order('created_at', { ascending: false })
    .limit(1);
  const updateTarget = rows?.[0] ?? null;

  // ── Poll the hosted consent request until authorised ────────────────────────
  let consentToken, consentId;
  let reconfirmBy      = null; // AIS reconfirmation deadline — ~180 days EEA, ~90 days UK.
  let lastConfirmedAt  = null;
  try {
    const result = await pollConsentRequest(consentReqId);
    if (!result.ok) {
      console.error('[yapily/callback] consent request did not authorise:', result.error);
      await db.from('bank_connections')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('yapily_consent_request_id', consentReqId);
      return res.redirect(302, `${base}/?bank_error=${encodeURIComponent(result.error)}`);
    }

    const payload = result.payload;

    // Log the full authorised response once (consentToken redacted) so the exact field
    // nesting (top-level vs payload.consent.*) can be confirmed from prod logs — the Consent
    // object has been observed nested differently across Yapily response variants.
    const debugPayload = JSON.parse(JSON.stringify(payload));
    if (debugPayload.consentToken) debugPayload.consentToken = '[redacted]';
    if (debugPayload.consent?.consentToken) debugPayload.consent.consentToken = '[redacted]';
    console.log('[yapily/callback] authorised consent request payload (consentToken redacted):', JSON.stringify(debugPayload));

    // The Consent sub-object may be nested under `consent`, or the fields may sit directly
    // on the payload — check both so we don't silently miss reconfirmBy.
    const consentObj = payload.consent ?? payload;

    consentToken = payload.consentToken ?? consentObj.consentToken ?? null;
    if (!consentToken) {
      console.error('[yapily/callback] no consentToken in authorised consent request:', JSON.stringify(debugPayload).slice(0, 300));
      return res.redirect(302, `${base}/?bank_error=${encodeURIComponent('No consent token returned')}`);
    }
    // consentId is required later for DELETE /consents/{consentId} (revocation). Distinct
    // from consentRequestId (the hosted flow's request id) and from the consentToken itself.
    consentId = payload.consentId ?? consentObj.id ?? payload.id ?? null;
    if (!consentId) {
      console.warn('[yapily/callback] no consentId in consent request — revocation will not be possible for this connection:', JSON.stringify(debugPayload).slice(0, 300));
    }

    // reconfirmBy is the ~180-day (EEA) / ~90-day (UK) consent-validity deadline — this is
    // what must drive consent_expires_at / yapily_reconfirm_by.
    // authorisationExpiresAt is a SEPARATE, much shorter (~10 min) window to complete the bank
    // auth step itself — it must never be used for consent validity. Logged only, below.
    reconfirmBy     = consentObj.reconfirmBy     ?? payload.reconfirmBy     ?? null;
    lastConfirmedAt = consentObj.lastConfirmedAt ?? payload.lastConfirmedAt ?? null;
    // expiresAt is only present if the app has opted OUT of long-lived consent — we haven't,
    // so it's expected to usually be absent and must not be relied on either.
    const authorisationExpiresAt = payload.authorisationExpiresAt ?? null;
    console.log('[yapily/callback] reconfirmBy:', reconfirmBy, '| authorisationExpiresAt (auth-window only, not used for validity):', authorisationExpiresAt);
  } catch (err) {
    captureError(err, { operation: 'yapily-callback-poll', consentReqId });
    return res.redirect(302, `${base}/?bank_error=${encodeURIComponent(err.message)}`);
  }

  // Fall back to created_at + 180 days (EEA) ONLY if Yapily's response omitted reconfirmBy —
  // never fall back to authorisationExpiresAt, which is the short auth-completion window.
  if (!reconfirmBy) {
    const baseTime = updateTarget?.created_at ? new Date(updateTarget.created_at).getTime() : Date.now();
    reconfirmBy = new Date(baseTime + 180 * 24 * 60 * 60 * 1000).toISOString();
    console.warn('[yapily/callback] reconfirmBy missing from Yapily response — using created_at + 180d fallback:', reconfirmBy);
  }
  const consentExpiresAt = reconfirmBy;
  if (!lastConfirmedAt) lastConfirmedAt = new Date().toISOString();

  // ── Update the bank_connections row ─────────────────────────────────────────
  let companyId = null;
  if (updateTarget) {
    companyId = updateTarget.company_id;

    // Encrypt the consent token before storing — it's a live credential granting
    // access to real bank data and must never sit in plaintext in the DB.
    let encryptedToken;
    try {
      encryptedToken = encryptToken(consentToken);
    } catch (encErr) {
      captureError(encErr, { company_id: companyId, operation: 'yapily-callback-encrypt' });
      console.error('[yapily/callback] token encryption failed:', encErr.message);
      return res.redirect(302, `${base}/?bank_error=${encodeURIComponent('Server encryption error — connection not saved')}`);
    }

    const { error: updErr } = await db.from('bank_connections').update({
      yapily_consent_token: encryptedToken,
      yapily_consent_id: consentId,
      status: 'active',
      consent_expires_at: consentExpiresAt,
      yapily_reconfirm_by: reconfirmBy,
      yapily_last_confirmed_at: lastConfirmedAt,
      updated_at: new Date().toISOString(),
    }).eq('id', updateTarget.id);
    if (updErr) {
      captureError(updErr, { company_id: companyId, operation: 'yapily-callback-update' });
      console.error('[yapily/callback] db update error:', updErr.message);
    } else {
      console.log('[yapily/callback] connection activated | company:', companyId);
    }
  } else {
    // No pending row found — insert one now (handles edge case where connect didn't store a row)
    console.warn('[yapily/callback] no pending row found for consentReqId:', consentReqId);
  }

  // ── Redirect user back into the SPA ─────────────────────────────────────────
  const params = new URLSearchParams({ bank_connected: '1' });
  if (companyId) params.set('company_id', companyId);
  return res.redirect(302, `${base}/?${params.toString()}`);
}
