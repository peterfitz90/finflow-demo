// POST /api/yapily/connect
// Initiates a Yapily hosted consent flow for the given company.
// Returns { hostedUrl } — the frontend redirects the browser there.
// SECURITY: YAPILY_APP_SECRET is only ever referenced in api/ functions.

import { createClient } from '@supabase/supabase-js';
import { withSentry, captureError } from '../_sentry.js';

function yapilyBasicAuth() {
  const id  = process.env.YAPILY_APP_ID?.trim();
  const sec = process.env.YAPILY_APP_SECRET?.trim();
  if (!id || !sec) throw new Error('[yapily/connect] YAPILY_APP_ID or YAPILY_APP_SECRET not set');
  return 'Basic ' + Buffer.from(`${id}:${sec}`).toString('base64');
}

export default withSentry(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  const {
    company_id,
    institution = 'modelo-sandbox',
  } = req.body ?? {};
  if (!company_id) return res.status(400).json({ error: 'company_id required' });

  // institutionCountryCode should come from the picker (the institution's real country,
  // per GET /institutions). Validate it's a proper ISO 3166 alpha-2 code before trusting it —
  // a bad value here (an object, a country name, lowercase, null) is exactly what caused the
  // Yapily 400 "institutionCountryCode is invalid" error. Fall back to a safe per-institution
  // default rather than silently forwarding garbage.
  const safeDefault = institution === 'modelo-sandbox' ? 'GB' : 'IE';
  const rawCountryCode = req.body?.institutionCountryCode;
  const isValidAlpha2 = typeof rawCountryCode === 'string' && /^[A-Za-z]{2}$/.test(rawCountryCode);
  const institutionCountryCode = isValidAlpha2 ? rawCountryCode.toUpperCase() : safeDefault;
  if (rawCountryCode !== undefined && !isValidAlpha2) {
    console.warn('[yapily/connect] invalid institutionCountryCode from caller, using fallback:', JSON.stringify(rawCountryCode), '→', institutionCountryCode, '| institution:', institution);
  }
  console.log('[yapily/connect] resolved institutionCountryCode:', institutionCountryCode, '| institution:', institution, '| company:', company_id);

  const db = createClient(supabaseUrl, serviceKey);

  // Verify company exists
  const { data: co, error: coErr } = await db.from('companies').select('id, name').eq('id', company_id).maybeSingle();
  if (coErr || !co) return res.status(404).json({ error: 'Company not found' });

  // Build the callback URL from the incoming request's host
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host  = req.headers['x-forwarded-host'] || req.headers.host;
  const callbackUrl = `${proto}://${host}/api/yapily/callback`;

  // Stable application user reference for this company
  const applicationUserId = `ledgrly-co-${company_id}`;

  // ── Create hosted consent request ────────────────────────────────────────────
  // oneTimeToken: false — the callback polls GET /hosted/consent-requests/{id} for the
  // consentToken instead of redeeming a one-time-token via POST /consent-one-time-token,
  // so we don't ask Yapily to issue one on the redirect.
  let yapilyRes, yapilyData;
  try {
    const path = '/hosted/consent-requests';
    console.log('[yapily/connect] → POST', path);
    yapilyRes = await fetch(`https://api.yapily.com${path}`, {
      method: 'POST',
      headers: {
        'Authorization': yapilyBasicAuth(),
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        applicationUserId,
        institutionIdentifiers: { institutionId: institution, institutionCountryCode },
        userSettings: { language: 'en', location: 'GB' },
        redirectUrl: callbackUrl,
        oneTimeToken: false,
        accountRequest: { featureScope: ['ACCOUNTS', 'ACCOUNT_BALANCES', 'ACCOUNT_TRANSACTIONS'] },
      }),
    });
    yapilyData = await yapilyRes.json();
  } catch (fetchErr) {
    captureError(fetchErr, { company_id, operation: 'yapily-connect-fetch' });
    return res.status(502).json({ error: 'Could not reach Yapily API: ' + fetchErr.message });
  }

  if (!yapilyRes.ok) {
    console.error('[yapily/connect] consent request failed | institution:', institution, '| institutionCountryCode:', institutionCountryCode, '| status:', yapilyRes.status, '| response:', JSON.stringify(yapilyData).slice(0, 400));
    return res.status(502).json({ error: yapilyData?.error?.message ?? yapilyData?.message ?? `Yapily API error ${yapilyRes.status}` });
  }

  // consentRequestId is the value Yapily puts in the redirect URL query param
  // (?consent-request-id=...) — it's data.consentRequestId, NOT data.id (which is
  // an internal record UUID). Storing data.id here caused the callback lookup to miss.
  const consentRequestId = yapilyData?.data?.consentRequestId ?? yapilyData?.consentRequestId ?? null;
  const hostedUrl        = yapilyData?.data?.hostedUrl ?? yapilyData?.hostedUrl ?? null;
  const yapilyUserId     = yapilyData?.data?.userId ?? yapilyData?.userId ?? null;

  if (!hostedUrl) {
    console.error('[yapily/connect] no hostedUrl in response:', JSON.stringify(yapilyData).slice(0, 500));
    return res.status(502).json({ error: 'No hostedUrl returned by Yapily' });
  }

  // Store pending connection row
  const { error: dbErr } = await db.from('bank_connections').insert({
    company_id,
    yapily_consent_request_id: consentRequestId,
    institution_id: institution,
    status: 'pending',
    application_user_id: applicationUserId,
    yapily_user_uuid: yapilyUserId,
  });
  if (dbErr) {
    captureError(dbErr, { company_id, operation: 'yapily-connect-insert' });
    console.error('[yapily/connect] bank_connections insert failed:', dbErr.message, '| code:', dbErr.code, '| hint:', dbErr.hint);
    return res.status(500).json({ error: 'Failed to record bank connection — please try again' });
  }

  console.log('[yapily/connect] consent request created:', consentRequestId, '| company:', company_id);
  return res.status(200).json({ hostedUrl, consentRequestId });
});
