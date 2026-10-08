// Cron (daily): removes temporary upload files that never became a record (BNK-14 step 2). Deletes
// only in the uploads-staging bucket, under staging/, older than 24 hours, and never a file whose
// upload was accepted; archived records are never touched. Marks expired pending uploads.
// Protected by CRON_SECRET (fails closed when unset), as api/refresh-stats.js.
import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'crypto';
import { withSentry } from './_sentry.js';
import { cleanupStaging } from './_uploads.js';

export default withSentry(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) { console.error('[uploads-cleanup] CRON_SECRET not set — refusing to run'); return res.status(401).end(); }
  const got = Buffer.from(req.headers.authorization || '');
  const want = Buffer.from(`Bearer ${cronSecret}`);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return res.status(401).end();

  const url = process.env.SUPABASE_URL?.trim(), serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) return res.status(500).json({ error: 'Server not configured' });
  const serviceDb = createClient(url, serviceKey, { auth: { persistSession: false } });
  const result = await cleanupStaging({ serviceDb, now: () => new Date().toISOString() });
  console.log('[uploads-cleanup]', JSON.stringify(result));
  return res.status(200).json(result);
});
