// STA-01 Stages 5b and 5c: the approval, the archive and the signed copies, behind
// api/statements-approval.js. Dependencies are passed in (deps), so the whole flow is tested with
// fakes (tests/statementsApproval.test.mjs):
//   deps.userDb      supabase client carrying the caller's own token: every read (RLS decides, as
//                    on screen): the statements, the sign-offs, the approvals and files lists
//   deps.serviceDb   service-role client: ONLY the three writes (archive upload, fs_record_approval,
//                    the fs_approval_files insert), the signed URLs, and removing this request's own
//                    uploads when a later step fails. Used only after the caller's role is checked.
//   deps.load        loadStatements(db, companyId, yearEnd, today)
//   deps.render      renderStatementsPdf(m)
//   deps.today, deps.newId, deps.build { commit, deployment }; deps.wordingStatus: tests only
import { createHash } from 'node:crypto';
import { evaluateApproval, ledgerFingerprintParts, wordingCanonical, buildSnapshot } from '../src/shared/statements/approvalRule.js';

export const BUCKET = 'statutory-documents';
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
const sha256 = b => createHash('sha256').update(b).digest('hex');
const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };
export class ApprovalError extends Error { constructor(message, status, extra = {}) { super(message); this.status = status; Object.assign(this, extra); } }

// Inputs in a stable form, so "changed since approval" can compare them.
const inputsCanonical = inp => JSON.stringify({
  profile: inp.profile || null,
  directors: [...(inp.directors || [])].sort((a, b) => String(a.id).localeCompare(String(b.id))),
  yearInputs: inp.yearInputs || null,
  disclosures: [...(inp.disclosures || [])].sort((a, b) => String(a.disclosure_key).localeCompare(String(b.disclosure_key))),
  comparatives: (inp.comparatives || []).filter(r => r.status === 'confirmed').map(r => [r.id, r.line_key, r.confirmed_amount]).sort(),
});

async function liveApprovals(db, companyId, yearEnd) {
  return must(await db.from('fs_approvals').select('id, status, period_start, period_end, recorded_at, approved_by_name, directors_approval_date, full_pdf_sha256, abridged_pdf_sha256, snapshot->ledger, snapshot->inputs_sha256')
    .eq('company_id', companyId).eq('period_end', yearEnd).order('recorded_at', { ascending: false }), 'approvals');
}

// Everything the rule and the snapshot need, read with the caller's token.
async function prepare(deps, companyId, yearEnd, ack) {
  const { company, assembled: A, journals, inputs } = await deps.load(deps.userDb, companyId, yearEnd, deps.today);
  const events = must(await deps.userDb.from('period_signoff_events').select('*').eq('company_id', companyId).order('occurred_at'), 'sign-offs');
  const rule = evaluateApproval({ A, yearEnd, signoffEvents: events || [], ack, ...(deps.wordingStatus ? { wordingStatus: deps.wordingStatus } : {}) });
  const fp = ledgerFingerprintParts(journals);
  const hashes = { ledger: sha256(fp.canonical), wording: sha256(wordingCanonical()), inputs: sha256(inputsCanonical(inputs)) };
  return { company, A, journals, inputs, rule, fp, hashes };
}

// 'check': the rule, the live approval of this period and whether anything changed since it.
export async function checkApproval(deps, { companyId, yearEnd, ack }) {
  const p = await prepare(deps, companyId, yearEnd, ack);
  const approvals = await liveApprovals(deps.userDb, companyId, yearEnd);
  const live = (approvals || []).find(a => a.status === 'approved') || null;
  const changed = live ? {
    ledger: live.ledger?.sha256 !== p.hashes.ledger,
    inputs: live.inputs_sha256 !== p.hashes.inputs,
    journals_then: live.ledger?.journal_count ?? null, journals_now: p.fp.count,
  } : null;
  return { rule: p.rule, ledger: { journal_count: p.fp.count, journal_total: p.fp.total, sha256: p.hashes.ledger },
    live: live ? { id: live.id, recorded_at: live.recorded_at, approved_by_name: live.approved_by_name, directors_approval_date: live.directors_approval_date } : null,
    changedSinceApproval: changed ? { ...changed, any: changed.ledger || changed.inputs } : null };
}

// 'approve': rule met -> both PDFs (no watermark) -> stored -> the snapshot with both hashes, in
// that order. A failure at any step stores nothing: uploads made by this request are removed.
export async function approve(deps, { companyId, yearEnd, ack, userId, userName, supersedes = null, supersedeReason = null }) {
  const p = await prepare(deps, companyId, yearEnd, ack);
  if (!p.rule.ok) throw new ApprovalError('The approval rule is not met', 409, { rule: p.rule });
  const approvals = await liveApprovals(deps.userDb, companyId, yearEnd);
  const live = (approvals || []).find(a => a.status === 'approved');
  if (live && live.id !== supersedes) throw new ApprovalError('This period already has an approval: supersede it with a reason', 409, { live: { id: live.id } });
  if (live && !(supersedeReason || '').trim()) throw new ApprovalError('A reason is required to supersede the approval', 400);

  const id = deps.newId();
  const base = `${companyId}/${yearEnd}/${id}`;
  const m = { companyName: p.company.name, croNumber: p.company.cro_number, assembled: p.A, yearEnd, approved: true };
  const full = Buffer.from(await deps.render({ ...m, variant: 'full' }));
  const abridged = p.rule.abridged ? Buffer.from(await deps.render({ ...m, variant: 'abridged' })) : null;
  const files = [{ path: `${base}/full.pdf`, buf: full }, ...(abridged ? [{ path: `${base}/abridged.pdf`, buf: abridged }] : [])];

  const uploaded = [];
  try {
    for (const f of files) {
      must(await deps.serviceDb.storage.from(BUCKET).upload(f.path, f.buf, { contentType: 'application/pdf', upsert: false }), `archive ${f.path}`);
      uploaded.push(f.path);
    }
    const snapshot = buildSnapshot({ A: p.A, company: p.company, yearEnd, inputs: p.inputs, rule: p.rule, fingerprint: p.fp, hashes: p.hashes, build: deps.build });
    snapshot.inputs_sha256 = p.hashes.inputs;
    snapshot.pdfs = files.map(f => ({ path: f.path, sha256: sha256(f.buf), bytes: f.buf.length }));
    const row = {
      id, company_id: companyId, regime: 'FRS105', period_start: p.A.fyStart, period_end: yearEnd,
      approved_by: userId, approved_by_name: (userName || '').slice(0, 120) || null,
      directors_approval_date: p.A.approvalISO, snapshot,
      full_pdf_path: files[0].path, full_pdf_sha256: sha256(full),
      abridged_pdf_path: abridged ? files[1].path : null, abridged_pdf_sha256: abridged ? sha256(abridged) : null,
      writes_after_signoff: p.rule.writes.length,
      ack_count: p.rule.writes.length ? p.rule.ack.count : null, ack_reason: p.rule.writes.length ? p.rule.ack.reason : null,
    };
    const rec = must(await deps.serviceDb.rpc('fs_record_approval', { p_row: row, p_supersedes: live ? live.id : null, p_supersede_reason: live ? supersedeReason.trim() : null }), 'record approval');
    return { approval: { id: rec.id, recorded_at: rec.recorded_at, full_pdf_sha256: rec.full_pdf_sha256, abridged_pdf_sha256: rec.abridged_pdf_sha256 }, superseded: live ? live.id : null };
  } catch (e) {
    if (uploaded.length) await deps.serviceDb.storage.from(BUCKET).remove(uploaded).catch(() => {});
    throw e;
  }
}

// 'list': the approvals and signed copies the caller may see (RLS: the accountant every row, a
// business owner approved rows only). No snapshot body: the screen needs the summary.
export async function listArchive(deps, { companyId }) {
  const approvals = must(await deps.userDb.from('fs_approvals').select('id, status, period_start, period_end, recorded_at, approved_by_name, directors_approval_date, full_pdf_path, full_pdf_sha256, abridged_pdf_path, abridged_pdf_sha256, writes_after_signoff, ack_count, ack_reason, superseded_at, superseded_by, supersede_reason')
    .eq('company_id', companyId).order('period_end', { ascending: false }).order('recorded_at', { ascending: false }), 'approvals');
  const files = must(await deps.userDb.from('fs_approval_files').select('id, approval_id, kind, n, path, sha256, size_bytes, uploaded_by_name, uploaded_at')
    .eq('company_id', companyId).order('uploaded_at'), 'signed copies');
  return { approvals: approvals || [], files: files || [] };
}

// 'url': a 60-second signed URL for one archived file, only if the caller can see the row that
// names it (so a business owner can open approved documents only).
export async function signedUrl(deps, { companyId, path }) {
  if (typeof path !== 'string' || !path.startsWith(`${companyId}/`)) throw new ApprovalError('Not found', 404);
  const { approvals, files } = await listArchive(deps, { companyId });
  const named = approvals.some(a => a.full_pdf_path === path || a.abridged_pdf_path === path) || files.some(f => f.path === path);
  if (!named) throw new ApprovalError('Not found', 404);
  const name = path.split('/').slice(-3).join('-');
  const r = must(await deps.serviceDb.storage.from(BUCKET).createSignedUrl(path, 60, { download: name }), 'signed url');
  return { url: r.signedUrl, expires_in: 60 };
}

// 'upload_signed': the directors' signed copy (full set or abridged), stored beside the approved
// PDF and never replacing it; a corrected copy is the next n.
export async function uploadSigned(deps, { companyId, approvalId, kind, pdf, userId, userName }) {
  if (!['full', 'abridged'].includes(kind)) throw new ApprovalError('kind must be full or abridged', 400);
  if (!Buffer.isBuffer(pdf) || pdf.length === 0) throw new ApprovalError('No file', 400);
  if (pdf.length > MAX_PDF_BYTES) throw new ApprovalError('The file is over 10 MB', 413);
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new ApprovalError('The file is not a PDF', 415);
  const a = must(await deps.userDb.from('fs_approvals').select('id, company_id, status, period_end, abridged_pdf_path').eq('id', approvalId).eq('company_id', companyId).maybeSingle(), 'approval');
  if (!a) throw new ApprovalError('Approval not found', 404);
  if (a.status !== 'approved') throw new ApprovalError('That approval has been superseded: upload against the current one', 409);
  if (kind === 'abridged' && !a.abridged_pdf_path) throw new ApprovalError('This approval has no abridged copy', 400);
  const fileKind = `signed_${kind}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const prev = must(await deps.serviceDb.from('fs_approval_files').select('n').eq('approval_id', approvalId).eq('kind', fileKind).order('n', { ascending: false }).limit(1), 'signed copies');
    const n = ((prev && prev[0]?.n) || 0) + 1;
    const path = `${companyId}/${a.period_end}/${approvalId}/signed-${kind}-${n}.pdf`;
    const up = await deps.serviceDb.storage.from(BUCKET).upload(path, pdf, { contentType: 'application/pdf', upsert: false });
    if (up.error) { if (attempt === 0 && /exists|duplicate/i.test(up.error.message)) continue; throw new Error(`archive ${path}: ${up.error.message}`); }
    const ins = await deps.serviceDb.from('fs_approval_files').insert({
      approval_id: approvalId, company_id: companyId, kind: fileKind, n, path, sha256: sha256(pdf), size_bytes: pdf.length,
      uploaded_by: userId, uploaded_by_name: (userName || '').slice(0, 120) || null,
    }).select('id, n, path, sha256, size_bytes, uploaded_at').single();
    if (ins.error) {
      await deps.serviceDb.storage.from(BUCKET).remove([path]).catch(() => {});
      if (attempt === 0 && ins.error.code === '23505') continue;
      throw new Error(`signed copy: ${ins.error.message}`);
    }
    return ins.data;
  }
  throw new ApprovalError('Another upload took that number: try again', 409);
}
