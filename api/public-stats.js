// Public endpoint — no auth required.
// Returns { available: true, pctAutomated: N } or { available: false }.
// The threshold gate runs server-side; counts NEVER appear in the response.
// pctAutomated is the ONLY number that ever crosses the wire, and only when the
// gate passes.

import { createClient } from '@supabase/supabase-js';

const MIN_COMPANIES = 5;   // tune here — never reaches the client
const MIN_PROCESSED = 500; // tune here — never reaches the client

export default async function handler(req, res) {
  // CORS: widget on ledgrly.ie (different origin) fetches this endpoint.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).end();

  // Cache aligned with the cron refresh interval (1 hour).
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200');

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) {
    return res.json({ available: false });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const { data, error } = await supabase
    .from('public_stats')
    .select('total_processed, auto_handled, pct_automated, company_count')
    .eq('id', 'singleton')
    .maybeSingle();

  if (error || !data) return res.json({ available: false });

  const { total_processed, company_count, pct_automated } = data;

  // Gate — counts are used only for this decision and go no further.
  const gatePass =
    pct_automated != null &&
    company_count >= MIN_COMPANIES &&
    total_processed >= MIN_PROCESSED;

  if (!gatePass) return res.json({ available: false });

  // Math.round handles the 2dp stored value; divide-by-zero already prevented
  // by the pct_automated != null check above.
  return res.json({ available: true, pctAutomated: Math.round(pct_automated) });
}
