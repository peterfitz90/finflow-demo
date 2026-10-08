// POST /api/uploads (BNK-14 step 2). Accountant only (requireAccountant on company_id).
//   start   { company_id, purpose: signed_copy | prior_accounts | bank_statement, filename, size, type,
//             approval_id?, kind? (signed_copy: full | abridged), uploader_name? }
//           -> { upload_id, bucket, path, token, signed_url, max_bytes }: the browser then uploads the
//              file straight to private storage with the signed URL (no file passes through here)
//   finish  { company_id, upload_id } -> the server reads the stored file, checks it and archives it
// Every refusal and rejection is recorded in public.uploads with who attempted it and why.
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { withSentry } from './_sentry.js';
import { requireAccountant, AuthError } from './_auth.js';
import { startUpload, finishUpload, UploadError } from './_uploads.js';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default withSentry(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const b = req.body ?? {};
  if (!['start', 'finish'].includes(b.action)) return res.status(400).json({ error: 'Unknown action' });
  if (!UUID.test(b.company_id || '')) return res.status(400).json({ error: 'company_id required' });
  let userId;
  try { userId = await requireAccountant(req, b.company_id); }
  catch (e) { if (e instanceof AuthError) return res.status(e.status).json({ error: e.message }); throw e; }

  const url = process.env.SUPABASE_URL?.trim(), anonKey = process.env.SUPABASE_ANON_KEY?.trim(), serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !anonKey || !serviceKey) return res.status(500).json({ error: 'Server not configured' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const deps = {
    userDb: createClient(url, anonKey, { accessToken: async () => token, auth: { persistSession: false } }),
    serviceDb: createClient(url, serviceKey, { auth: { persistSession: false } }),
    newId: randomUUID, now: () => new Date().toISOString(),
  };
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (b.action === 'start') {
      if (b.purpose === 'signed_copy' && !UUID.test(b.approval_id || '')) return res.status(400).json({ error: 'approval_id required' });
      return res.status(200).json(await startUpload(deps, { companyId: b.company_id, userId, userName: b.uploader_name, purpose: b.purpose,
        filename: b.filename, size: b.size, type: b.type, approvalId: b.approval_id || null, kind: b.kind || null }));
    }
    if (!UUID.test(b.upload_id || '')) return res.status(400).json({ error: 'upload_id required' });
    return res.status(200).json(await finishUpload(deps, { companyId: b.company_id, userId, userName: b.uploader_name, uploadId: b.upload_id }));
  } catch (e) {
    if (e instanceof UploadError) return res.status(e.status).json({ error: e.message, ...(e.upload_id ? { upload_id: e.upload_id } : {}) });
    throw e;
  }
});
