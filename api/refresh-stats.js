// Cron handler: compute the cross-company 30-day automation rollup and cache it
// in the public_stats singleton row. Called hourly by Vercel cron.
//
// Definition mirrors useApprovalStats and fix_automation_rollup.sql exactly:
//   autoHandled    = bank_matches WHERE matched_by='auto' AND suggestion_kept IS NOT FALSE
//                    (engine auto-confirmed [NULL] + AI-suggested kept [true]; excludes corrected [false])
//   totalProcessed = bank_transactions reconciled in window
//   companyCount   = distinct companies with ≥1 reconciled transaction in window
//
// Uses SUPABASE_SERVICE_ROLE_KEY (elevated access, server-side only).
// Never called directly by users — protected by CRON_SECRET.

import { createClient } from '@supabase/supabase-js';

const WINDOW_DAYS = 30;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  // Vercel sets CRON_SECRET automatically; all cron requests carry it.
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end();
  }

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) {
    console.error('[refresh-stats] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set');
    return res.status(500).json({ error: 'storage not configured' });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Call the SQL rollup function — runs as SECURITY DEFINER to reach all companies.
  const { data, error } = await supabase.rpc('compute_automation_rollup', {
    window_days: WINDOW_DAYS,
  });

  if (error) {
    console.error('[refresh-stats] rollup rpc error', error);
    return res.status(500).json({ error: error.message });
  }

  if (!data || !data[0]) {
    console.error('[refresh-stats] rollup rpc returned empty result', data);
    return res.status(500).json({ error: 'rollup returned no rows' });
  }

  const { total_processed, auto_handled, company_count } = data[0];

  // Explicit field validation — if any value is missing or not a finite number the
  // migration that creates compute_automation_rollup() has not been run, or the
  // function returned unexpected column names. Fail loudly; do NOT write refreshed_at
  // to fake a successful run against stale data.
  if (
    typeof total_processed !== 'number' || !isFinite(total_processed) ||
    typeof auto_handled    !== 'number' || !isFinite(auto_handled)    ||
    typeof company_count   !== 'number' || !isFinite(company_count)
  ) {
    console.error('[refresh-stats] rollup fields missing or invalid — check that add_public_stats.sql has been applied', {
      raw: data[0],
      total_processed, auto_handled, company_count,
    });
    return res.status(500).json({ error: 'rollup fields invalid', raw: data[0] });
  }

  // Store with 2 decimal places; public endpoint rounds to whole number for display.
  const pct_automated = total_processed > 0
    ? Math.round((auto_handled / total_processed) * 10000) / 100
    : null;

  // Write ALL rollup fields atomically. If the upsert fails, refreshed_at is NOT
  // updated — the row stays honestly stale rather than showing a fake timestamp.
  const { error: upsertErr } = await supabase
    .from('public_stats')
    .upsert(
      {
        id: 'singleton',
        total_processed,
        auto_handled,
        pct_automated,
        company_count,
        window_days: WINDOW_DAYS,
        refreshed_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );

  if (upsertErr) {
    console.error('[refresh-stats] upsert failed', upsertErr);
    return res.status(500).json({ error: upsertErr.message });
  }

  console.log('[refresh-stats] ok', { total_processed, auto_handled, company_count, pct_automated });
  return res.json({ ok: true });
}
