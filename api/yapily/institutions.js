// GET /api/yapily/institutions?country=IE
// Returns institutions available to this Yapily application, filtered by country.
// Includes modelo-sandbox so sandbox testing remains selectable.
// SECURITY: YAPILY_APP_SECRET is server-side only — never in the client.

import { withSentry, captureError } from '../_sentry.js';

function yapilyBasicAuth() {
  const id  = process.env.YAPILY_APP_ID?.trim();
  const sec = process.env.YAPILY_APP_SECRET?.trim();
  if (!id || !sec) throw new Error('YAPILY_APP_ID or YAPILY_APP_SECRET not set');
  return 'Basic ' + Buffer.from(`${id}:${sec}`).toString('base64');
}

function pickLogo(media) {
  if (!Array.isArray(media) || !media.length) return null;
  // Prefer 'icon' > 'logo' > first available
  const icon = media.find(m => m.type === 'icon');
  const logo = media.find(m => m.type === 'logo' || m.type === 'image');
  const picked = icon ?? logo ?? media[0];
  return picked?.source ?? null;
}

// Yapily's institution.countries is an array of { countryCode2, countryCode3, displayName }
// objects (e.g. { countryCode2: 'GB', displayName: 'United Kingdom' }) — NOT plain ISO strings.
// The old logic compared displayName ("United Kingdom") against the alpha-2 filter ("IE"),
// which never matched, then fell back to displayName itself — sending Yapily a full country
// name ("United Kingdom") as institutionCountryCode and triggering its 400 validation error.
// This always resolves to a real ISO 3166 alpha-2 code, uppercase, never an object/array/name.
function pickCountryCode(inst, preferredCountry) {
  const entries = inst.countries ?? inst.countryCodes ?? [];
  const codes = entries
    .map(c => (typeof c === 'string' ? c : c.countryCode2 ?? c.countryCode ?? c.code))
    .filter(c => typeof c === 'string' && c.length === 2)
    .map(c => c.toUpperCase());
  if (!codes.length) return (preferredCountry || 'IE').toUpperCase();
  const preferred = (preferredCountry || '').toUpperCase();
  return codes.includes(preferred) ? preferred : codes[0];
}

export default withSentry(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const country = (req.query.country || 'IE').toUpperCase();

  let auth;
  try { auth = yapilyBasicAuth(); }
  catch (e) { return res.status(500).json({ error: e.message }); }

  // ── Fetch institution list from Yapily ────────────────────────────────────────
  let yapilyData;
  try {
    const url = `https://api.yapily.com/institutions?country=${country}`;
    const yapilyRes = await fetch(url, {
      headers: { 'Authorization': auth, 'Accept': 'application/json' },
    });
    yapilyData = await yapilyRes.json();

    if (!yapilyRes.ok) {
      console.error('[yapily/institutions] Yapily error:', yapilyRes.status, JSON.stringify(yapilyData).slice(0, 300));
      return res.status(502).json({ error: yapilyData?.error?.message ?? `Yapily error ${yapilyRes.status}` });
    }
  } catch (fetchErr) {
    captureError(fetchErr, { operation: 'yapily-institutions-fetch' });
    return res.status(502).json({ error: 'Could not reach Yapily API: ' + fetchErr.message });
  }

  const raw = yapilyData?.data ?? yapilyData ?? [];

  // ── Normalise each institution ────────────────────────────────────────────────
  const institutions = raw.map(inst => ({
    id:           inst.id,
    name:         inst.name,
    countryCode:  pickCountryCode(inst, country),
    logo:         pickLogo(inst.media),
    features:     inst.features ?? [],
  })).filter(inst => inst.id && inst.name);

  // ── Detect application environment from the returned institution set ──────────
  // Sandbox apps only see sandbox institutions; production apps see real banks.
  const hasSandboxOnly = institutions.length > 0
    && institutions.every(i => i.id.includes('sandbox') || i.id.includes('mock') || i.id.includes('modelo'));
  const hasRealBanks   = institutions.some(i =>
    !i.id.includes('sandbox') && !i.id.includes('mock') && !i.id.includes('modelo')
  );
  const environment = hasRealBanks ? 'production' : (hasSandboxOnly ? 'sandbox' : 'unknown');

  console.log(`[yapily/institutions] country=${country} → ${institutions.length} institutions | env=${environment}`);

  // ── Always include modelo-sandbox so test flow is selectable ─────────────────
  // (It may already be in the list; add it only if absent.)
  const hasSandbox = institutions.some(i => i.id === 'modelo-sandbox');
  const finalList  = hasSandbox ? institutions : [
    ...institutions,
    {
      id:          'modelo-sandbox',
      name:        'Modelo (Sandbox)',
      countryCode: 'GB',
      logo:        null,
      features:    [],
    },
  ];

  // Sort: real banks first (alphabetical), sandbox at the end
  finalList.sort((a, b) => {
    const aS = a.id === 'modelo-sandbox' ? 1 : 0;
    const bS = b.id === 'modelo-sandbox' ? 1 : 0;
    if (aS !== bS) return aS - bS;
    return a.name.localeCompare(b.name);
  });

  return res.status(200).json({ institutions: finalList, environment, country });
});
