// POST /api/statements-approval (STA-01 Stages 5b and 5c). One endpoint, five actions:
//   check          { company_id, year_end, ack_count?, ack_reason? }  accountant
//                  -> the approval rule, the live approval, "changed since approval"
//   approve        { ..., approver_name?, supersedes?, supersede_reason? }  accountant
//                  -> both PDFs without the watermark, archived, and the snapshot with their hashes
//   list           { company_id }  accountant or business owner (RLS: a business owner sees approved rows only)
//   url            { company_id, path }  accountant or business owner -> a 60-second signed URL
//   upload_signed  { company_id, approval_id, kind: full|abridged, pdf_base64, uploader_name? }  accountant
// Reads use the caller's own token, so RLS applies as on screen. The service role is used only for
// the archive uploads, the approval and signed-copy rows (fs_record_approval, fs_approval_files),
// and signing URLs, and only after the caller's role on company_id is verified.
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { withSentry } from './_sentry.js';
import { requireAccountant, requireCompanyMember, AuthError } from './_auth.js';
import { loadStatements } from './_statements-data.js';
import { renderStatementsPdf } from './_statements-pdf-doc.js';
import { checkApproval, approve, listArchive, signedUrl, uploadSigned, ApprovalError } from './_statements-approval.js';
import { todayStr } from '../src/shared/dates.js';

// a 10 MB PDF is about 13.4 MB as base64
export const config = { api: { bodyParser: { sizeLimit: '15mb' } } };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNTANT_ACTIONS = new Set(['check', 'approve', 'upload_signed']);
const MEMBER_ACTIONS = new Set(['list', 'url']);

export default withSentry(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const b = req.body ?? {};
  const action = b.action;
  if (!ACCOUNTANT_ACTIONS.has(action) && !MEMBER_ACTIONS.has(action)) return res.status(400).json({ error: 'Unknown action' });
  if (!UUID.test(b.company_id || '')) return res.status(400).json({ error: 'company_id required' });
  if ((action === 'check' || action === 'approve') && !ISO.test(b.year_end || '')) return res.status(400).json({ error: 'year_end (YYYY-MM-DD) required' });

  let userId;
  try {
    userId = ACCOUNTANT_ACTIONS.has(action) ? await requireAccountant(req, b.company_id) : (await requireCompanyMember(req, b.company_id)).userId;
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    throw e;
  }

  const url = process.env.SUPABASE_URL?.trim();
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !anonKey || !serviceKey) return res.status(500).json({ error: 'Server not configured' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const deps = {
    userDb: createClient(url, anonKey, { accessToken: async () => token, auth: { persistSession: false } }),
    serviceDb: createClient(url, serviceKey, { auth: { persistSession: false } }),
    load: loadStatements, render: renderStatementsPdf, today: todayStr(), newId: randomUUID,
    build: { commit: process.env.VERCEL_GIT_COMMIT_SHA || null, deployment: process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_URL || null },
  };
  const ack = { count: b.ack_count ?? null, reason: b.ack_reason ?? '' };
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (action === 'check') return res.status(200).json(await checkApproval(deps, { companyId: b.company_id, yearEnd: b.year_end, ack }));
    if (action === 'approve') {
      if (b.supersedes != null && !UUID.test(b.supersedes)) return res.status(400).json({ error: 'supersedes must be an approval id' });
      return res.status(200).json(await approve(deps, { companyId: b.company_id, yearEnd: b.year_end, ack, userId, userName: b.approver_name,
        supersedes: b.supersedes || null, supersedeReason: b.supersede_reason || null }));
    }
    if (action === 'list') return res.status(200).json(await listArchive(deps, { companyId: b.company_id }));
    if (action === 'url') return res.status(200).json(await signedUrl(deps, { companyId: b.company_id, path: b.path }));
    if (action === 'upload_signed') {
      if (!UUID.test(b.approval_id || '')) return res.status(400).json({ error: 'approval_id required' });
      const pdf = typeof b.pdf_base64 === 'string' ? Buffer.from(b.pdf_base64, 'base64') : null;
      return res.status(200).json(await uploadSigned(deps, { companyId: b.company_id, approvalId: b.approval_id, kind: b.kind, pdf, userId, userName: b.uploader_name }));
    }
  } catch (e) {
    if (e instanceof ApprovalError) return res.status(e.status).json({ error: e.message, ...(e.rule ? { rule: e.rule } : {}), ...(e.live ? { live: e.live } : {}) });
    if (e.status === 404) return res.status(404).json({ error: e.message });
    throw e;
  }
});
