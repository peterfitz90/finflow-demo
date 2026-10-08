// BNK-14 step 2: signed upload URLs, behind api/uploads.js (start, finish) and
// api/uploads-cleanup.js (daily). Dependencies are passed in, so the flow is tested with fakes
// (tests/uploads.test.mjs):
//   deps.userDb     the caller's own token (RLS): reads the approval a signed copy belongs to
//   deps.serviceDb  service role, used only after requireAccountant: the uploads and
//                   source_documents rows, fs_approval_files, the two private buckets and the
//                   archive bucket
//   deps.newId, deps.now
import { createHash } from 'node:crypto';

export const STAGING_BUCKET = 'uploads-staging';
export const SOURCE_BUCKET = 'source-documents';
export const ARCHIVE_BUCKET = 'statutory-documents';
export const STAGING_PREFIX = 'staging/';
const MB = 1024 * 1024;
export const PURPOSES = {
  signed_copy:    { maxBytes: 10 * MB, types: ['application/pdf'] },
  prior_accounts: { maxBytes: 10 * MB, types: ['application/pdf'] },
  bank_statement: { maxBytes: 32 * MB, types: ['application/pdf', 'text/csv'] },
};
export const CLEANUP_AFTER_HOURS = 24;
export const UPLOAD_LINK_HOURS = 2;

export class UploadError extends Error { constructor(message, status, extra = {}) { super(message); this.status = status; Object.assign(this, extra); } }
const sha256 = b => createHash('sha256').update(b).digest('hex');
const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };
const cleanName = s => String(s || '').replace(/[\u0000-\u001f\\/]+/g, ' ').trim().slice(0, 200) || 'file';
const fmtMB = n => `${(n / MB).toFixed(1)} MB`;

// What the stored bytes are, from the bytes: a PDF starts %PDF-; a CSV is text (no NUL bytes,
// valid UTF-8 or Windows-1252 text).
export function sniffType(buf) {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  const head = buf.subarray(0, 8192);
  if (head.length && !head.includes(0)) return 'text/csv';
  return null;
}

// The temporary file is left where it is, after a rejection and after acceptance: while it occupies
// its path, the signed upload URL (valid up to 2 hours) cannot be used again, because storage never
// overwrites. The daily clean-up removes it once it is 24 hours old.
async function reject(deps, row, reason, by) {
  // the outcome is recorded with who attempted it and why
  must(await deps.serviceDb.from('uploads').update({ status: 'rejected', rejected_reason: reason, finished_by: by, finished_at: deps.now() }).eq('id', row.id), 'record the rejection');
  return new UploadError(reason, 422, { upload_id: row.id });
}

// start: checks what can be checked before the file exists, records the attempt, and returns a
// signed upload URL for a fresh staging path. A refusal here is recorded too.
export async function startUpload(deps, { companyId, userId, userName, purpose, filename, size, type, approvalId = null, kind = null }) {
  const base = { company_id: companyId, purpose: PURPOSES[purpose] ? purpose : 'bank_statement', filename: cleanName(filename),
    declared_size: Math.max(0, Math.floor(Number(size) || 0)), declared_type: String(type || '').slice(0, 100) || 'unknown',
    created_by: userId, created_by_name: (userName || '').slice(0, 120) || null,
    purpose_ref: purpose === 'signed_copy' ? { approval_id: approvalId, kind } : null };
  const refuse = async reason => {
    must(await deps.serviceDb.from('uploads').insert({ ...base, id: deps.newId(), status: 'rejected', rejected_reason: reason, finished_by: userId, finished_at: deps.now() }), 'record the refusal');
    return new UploadError(reason, 422);
  };
  const p = PURPOSES[purpose];
  if (!p) throw await refuse(`Unknown purpose "${String(purpose).slice(0, 40)}"`);
  if (!(Number(size) > 0)) throw await refuse('The file is empty');
  if (Number(size) > p.maxBytes) throw await refuse(purpose === 'bank_statement'
    // a statement this large is almost always photographed pages (Peter, 10 Oct 2026)
    ? `This file is ${fmtMB(Number(size))}, over the ${fmtMB(p.maxBytes)} size limit, and Ledgrly cannot read photographed statements yet. Ask for the PDF downloaded from online banking.`
    : `The file is ${fmtMB(Number(size))}; the limit is ${fmtMB(p.maxBytes)}`);
  if (!p.types.includes(base.declared_type)) throw await refuse(`${p.types.includes('text/csv') ? 'Only PDF or CSV' : 'Only PDF'} files are accepted here`);
  if (purpose === 'signed_copy') {
    if (!['full', 'abridged'].includes(kind)) throw await refuse('Choose the full set or the abridged copy');
    const a = must(await deps.userDb.from('fs_approvals').select('id, status, abridged_pdf_path').eq('id', approvalId).eq('company_id', companyId).maybeSingle(), 'approval');
    if (!a) throw await refuse('Approval not found');
    if (a.status !== 'approved') throw await refuse('That approval has been superseded: upload against the current one');
    if (kind === 'abridged' && !a.abridged_pdf_path) throw await refuse('This approval has no abridged copy');
  }
  const id = deps.newId();
  const staging_path = `${STAGING_PREFIX}${companyId}/${id}`;
  // a signed upload URL lasts two hours (Supabase); the record expires with it
  const expires_at = new Date(new Date(deps.now()).getTime() + UPLOAD_LINK_HOURS * 3600 * 1000).toISOString();
  must(await deps.serviceDb.from('uploads').insert({ ...base, id, staging_path, status: 'pending', expires_at }), 'record the upload');
  const signed = must(await deps.serviceDb.storage.from(STAGING_BUCKET).createSignedUploadUrl(staging_path), 'signed upload URL');
  return { upload_id: id, bucket: STAGING_BUCKET, path: staging_path, token: signed.token, signed_url: signed.signedUrl, max_bytes: p.maxBytes };
}

// finish: reads the stored file itself, checks it against the start request, archives it where
// its purpose says, and records it. Any failed check rejects the upload (recorded with who and
// why). The temporary copy stays until the clean-up (see reject()).
export async function finishUpload(deps, { companyId, userId, userName, uploadId }) {
  const row = must(await deps.serviceDb.from('uploads').select('*').eq('id', uploadId).eq('company_id', companyId).maybeSingle(), 'upload');
  if (!row) throw new UploadError('Upload not found', 404);
  if (row.status !== 'pending') throw new UploadError(`This upload is already ${row.status}`, 409);
  if (new Date(row.expires_at) < new Date(deps.now())) throw await reject(deps, row, 'The upload link expired before the file was finished', userId);
  const p = PURPOSES[row.purpose];

  const dl = await deps.serviceDb.storage.from(STAGING_BUCKET).download(row.staging_path);
  if (dl.error || !dl.data) throw await reject(deps, row, 'No file arrived for this upload', userId);
  const buf = Buffer.from(await dl.data.arrayBuffer());
  if (buf.length !== row.declared_size) throw await reject(deps, row, `The stored file is ${buf.length} bytes, not the ${row.declared_size} declared`, userId);
  if (buf.length > p.maxBytes) throw await reject(deps, row, `The file is ${fmtMB(buf.length)}; the limit is ${fmtMB(p.maxBytes)}`, userId);
  const actual = sniffType(buf);
  if (actual !== row.declared_type) throw await reject(deps, row, actual ? `The file is not a ${row.declared_type === 'text/csv' ? 'CSV' : 'PDF'}` : 'The file is neither a PDF nor a text CSV', userId);
  const hash = sha256(buf);

  let destination;
  if (row.purpose === 'signed_copy') {
    const { approval_id, kind } = row.purpose_ref || {};
    const a = must(await deps.userDb.from('fs_approvals').select('id, status, period_end, abridged_pdf_path').eq('id', approval_id).eq('company_id', companyId).maybeSingle(), 'approval');
    if (!a || a.status !== 'approved') throw await reject(deps, row, 'That approval is no longer the current one', userId);
    const fileKind = `signed_${kind}`;
    const same = must(await deps.serviceDb.from('fs_approval_files').select('id, n').eq('approval_id', approval_id).eq('sha256', hash), 'signed copies');
    if (same?.length) throw await reject(deps, row, `This exact file is already stored as signed copy ${same[0].n}`, userId);
    const prev = must(await deps.serviceDb.from('fs_approval_files').select('n').eq('approval_id', approval_id).eq('kind', fileKind).order('n', { ascending: false }).limit(1), 'signed copies');
    const n = ((prev && prev[0]?.n) || 0) + 1;
    const path = `${companyId}/${a.period_end}/${approval_id}/signed-${kind}-${n}.pdf`;
    must(await deps.serviceDb.storage.from(ARCHIVE_BUCKET).upload(path, buf, { contentType: 'application/pdf', upsert: false }), `archive ${path}`);
    const ins = await deps.serviceDb.from('fs_approval_files').insert({ approval_id, company_id: companyId, kind: fileKind, n, path, sha256: hash,
      size_bytes: buf.length, uploaded_by: row.created_by, uploaded_by_name: row.created_by_name }).select('id').single();
    if (ins.error) { await deps.serviceDb.storage.from(ARCHIVE_BUCKET).remove([path]).catch(() => {}); throw new Error(`signed copy: ${ins.error.message}`); }
    destination = { bucket: ARCHIVE_BUCKET, path, record: 'fs_approval_files', id: ins.data.id, n };
  } else {
    const same = must(await deps.serviceDb.from('source_documents').select('id, filename, uploaded_at').eq('company_id', companyId).eq('sha256', hash), 'source documents');
    if (same?.length) {
      const e = await reject(deps, row, `This exact file was already uploaded (${same[0].filename}, ${String(same[0].uploaded_at).slice(0, 10)})`, userId);
      throw Object.assign(e, { duplicate_of: same[0].id }); // the screen offers to reopen it instead
    }
    const ext = row.declared_type === 'text/csv' ? 'csv' : 'pdf';
    const path = `${companyId}/${row.purpose}/${row.id}.${ext}`;
    must(await deps.serviceDb.storage.from(SOURCE_BUCKET).upload(path, buf, { contentType: row.declared_type, upsert: false }), `store ${path}`);
    const ins = await deps.serviceDb.from('source_documents').insert({ company_id: companyId, purpose: row.purpose, upload_id: row.id, path,
      filename: row.filename, mime: row.declared_type, size_bytes: buf.length, sha256: hash, uploaded_by: row.created_by, uploaded_by_name: row.created_by_name }).select('id').single();
    if (ins.error) { await deps.serviceDb.storage.from(SOURCE_BUCKET).remove([path]).catch(() => {}); throw new Error(`source document: ${ins.error.message}`); }
    destination = { bucket: SOURCE_BUCKET, path, record: 'source_documents', id: ins.data.id };
  }
  must(await deps.serviceDb.from('uploads').update({ status: 'accepted', finished_by: userId, finished_at: deps.now(), size_bytes: buf.length, sha256: hash, destination }).eq('id', row.id), 'record the upload');
  return { upload_id: row.id, sha256: hash, size_bytes: buf.length, destination };
}

// Daily clean-up. Deletes only in the staging bucket, only under staging/, only objects older
// than CLEANUP_AFTER_HOURS (long after their upload URL expired). A staging file is never the
// record: for an accepted upload it is removed only once the archived copy is confirmed to exist;
// an unfinished, rejected or unknown one is simply removed. Archived records (statutory-documents,
// source-documents and their tables) are never touched. Pending uploads past expiry are marked
// expired.
export async function cleanupStaging(deps) {
  const cutoff = new Date(new Date(deps.now()).getTime() - CLEANUP_AFTER_HOURS * 3600 * 1000);
  const store = deps.serviceDb.storage.from(STAGING_BUCKET);
  const folders = must(await store.list(STAGING_PREFIX.replace(/\/$/, ''), { limit: 1000 }), 'list staging') || [];
  const candidates = [];
  for (const f of folders) {
    const objs = must(await store.list(`${STAGING_PREFIX}${f.name}`, { limit: 1000 }), 'list staging') || [];
    for (const o of objs) {
      const created = new Date(o.created_at || o.updated_at || 0);
      if (o.id && created < cutoff) candidates.push(`${STAGING_PREFIX}${f.name}/${o.name}`);
    }
  }
  const rows = candidates.length ? must(await deps.serviceDb.from('uploads').select('staging_path, status, destination').in('staging_path', candidates), 'uploads') || [] : [];
  const byPath = Object.fromEntries(rows.map(r => [r.staging_path, r]));
  const archived = async d => {
    if (!d?.bucket || !d?.path || d.bucket === STAGING_BUCKET) return false;
    const dir = d.path.slice(0, d.path.lastIndexOf('/')), file = d.path.slice(d.path.lastIndexOf('/') + 1);
    const l = await deps.serviceDb.storage.from(d.bucket).list(dir, { limit: 100, search: file });
    return !l.error && (l.data || []).some(o => o.name === file);
  };
  const remove = [], kept = [];
  for (const path of candidates) {
    if (!path.startsWith(STAGING_PREFIX)) continue;
    const r = byPath[path];
    if (r?.status === 'accepted' && !(await archived(r.destination))) { kept.push(path); continue; }
    remove.push(path);
  }
  if (remove.length) must(await store.remove(remove), 'remove staging');
  const expired = must(await deps.serviceDb.from('uploads').update({ status: 'expired' }).eq('status', 'pending').lt('expires_at', new Date(deps.now()).toISOString()).select('id'), 'expire') || [];
  // a statement read still 'reading' after 10 minutes stopped (a function timeout): close it as failed
  const stale = new Date(new Date(deps.now()).getTime() - 10 * 60 * 1000).toISOString();
  const stuck = must(await deps.serviceDb.from('statement_reads').update({ status: 'failed', refused_reason: 'The read stopped before it finished (timed out)' })
    .eq('status', 'reading').lt('created_at', stale).select('id'), 'stuck reads') || [];
  return { examined: candidates.length, removed: remove.length, kept_archive_unconfirmed: kept.length, expired: expired.length, stuck_reads_closed: stuck.length };
}
