// POST /api/statement-read (BNK-14 step 3a). Accountant only (requireAccountant on company_id).
//   read        { company_id, source_document_id }  -> the statement read and verified: sections,
//               rows, checks, cost. Recorded in statement_reads; the document's period and its
//               retention date (six years after the financial year ends) are filled in.
//   pdf_url     { company_id, source_document_id } -> a short-lived signed URL, so the review screen
//               can show the page beside the rows
//   link_batch  { company_id, read_id, section_key, import_batch_id, ack? } -> records which import
//               batch came from which section of the read, and the accountant's tick on it (who and
//               when, from the server; the number of flagged and OCR-unconfirmed lines)
//   reopen      { company_id, source_document_id } -> the stored read of that statement, with no model
//               call (the structured read is kept with the document, accountant-only)
//   recent      { company_id } -> the company's recent PDF statements and their reads
// Reads use the caller's token (RLS); the service role only downloads the stored PDF, writes the
// read record and fills in the document's period, after the role check.
import { createClient } from '@supabase/supabase-js';
import { withSentry, captureError, flushSentry } from './_sentry.js';
import { readCapStatus, irishDayStart } from './_read-cap.js';
import { requireAccountant, AuthError } from './_auth.js';
import { AI_MODEL, callClaude } from './_anthropic.js';
import { readStatementPdf } from './_statement-pdf-read.js';
import { fiscalYearContaining, fiscalConfig } from '../src/shared/fiscalYear.js';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };
const addYears = (iso, n) => `${Number(iso.slice(0, 4)) + n}${iso.slice(4)}`;

// What the screen needs from a read: sections with their rows, checks and row errors (no raw chunks).
function forScreen(out) {
  return {
    period: out.result.period, summary: out.result.summary,
    sections: out.result.sections.map(s => ({ key: s.key, label: s.label, currency: s.currency, ok: s.ok, verifiable: s.verifiable,
      checks: s.checks.map(({ breaks, ...c }) => ({ ...c, breaks: (breaks || []).map(b => ({ date: b.date, expected: b.expected, printed: b.printed })) })),
      errors: s.errors, rows: s.rows.map(r => ({ revolut_id: r.revolut_id, date: r.date, description: r.description, amount: r.amount, balance: r.balance, currency: r.currency, page: r.page, flags: r.flags || null, status: r.status })) })),
  };
}

export default withSentry(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const b = req.body ?? {};
  if (!['read', 'pdf_url', 'link_batch', 'reopen', 'recent'].includes(b.action)) return res.status(400).json({ error: 'Unknown action' });
  if (!UUID.test(b.company_id || '')) return res.status(400).json({ error: 'company_id required' });
  let userId;
  try { userId = await requireAccountant(req, b.company_id); }
  catch (e) { if (e instanceof AuthError) return res.status(e.status).json({ error: e.message }); throw e; }

  const url = process.env.SUPABASE_URL?.trim(), anonKey = process.env.SUPABASE_ANON_KEY?.trim(), serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !anonKey || !serviceKey) return res.status(500).json({ error: 'Server not configured' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const userDb = createClient(url, anonKey, { accessToken: async () => token, auth: { persistSession: false } });
  const serviceDb = createClient(url, serviceKey, { auth: { persistSession: false } });
  res.setHeader('Cache-Control', 'no-store');

  if (b.action === 'link_batch') {
    if (!UUID.test(b.read_id || '') || !UUID.test(b.import_batch_id || '')) return res.status(400).json({ error: 'read_id and import_batch_id required' });
    const read = must(await userDb.from('statement_reads').select('id, imports').eq('id', b.read_id).eq('company_id', b.company_id).maybeSingle(), 'read');
    if (!read) return res.status(404).json({ error: 'Read not found' });
    const n = v => Math.max(0, Math.min(100000, Math.floor(Number(v) || 0)));
    const a = b.ack || {};
    const ack = { ticked: !!a.ticked, image_read: !!a.image_read, ocr_ran: !!a.ocr_ran, flagged_lines: n(a.flagged_lines),
      ocr_unconfirmed_lines: n(a.ocr_unconfirmed_lines), unreadable_lines: n(a.unreadable_lines), failed_checks: n(a.failed_checks) };
    const imports = [...(read.imports || []), { section_key: String(b.section_key || '').slice(0, 80), import_batch_id: b.import_batch_id,
      at: new Date().toISOString(), by: userId, by_name: (b.reader_name || '').slice(0, 120) || null, ack }];
    must(await serviceDb.from('statement_reads').update({ imports }).eq('id', read.id), 'link batch');
    return res.status(200).json({ ok: true });
  }

  if (b.action === 'recent') {
    const docs = must(await userDb.from('source_documents').select('id, filename, uploaded_at, period_start, period_end')
      .eq('company_id', b.company_id).eq('purpose', 'bank_statement').order('uploaded_at', { ascending: false }).limit(15), 'documents') || [];
    const reads = docs.length ? must(await userDb.from('statement_reads').select('source_document_id, status, mode, created_at, imports, refused_reason')
      .in('source_document_id', docs.map(d => d.id)).order('created_at', { ascending: false }), 'reads') || [] : [];
    const latest = {}; for (const r of reads) if (!latest[r.source_document_id]) latest[r.source_document_id] = r;
    const hasRead = new Set(reads.filter(r => r.status === 'read').map(r => r.source_document_id));
    return res.status(200).json({ documents: docs.map(d => ({ ...d, read: latest[d.id] ? { status: latest[d.id].status, mode: latest[d.id].mode, at: latest[d.id].created_at,
      imports: (latest[d.id].imports || []).length, refused_reason: latest[d.id].refused_reason } : null, can_reopen: hasRead.has(d.id) })) });
  }

  if (!UUID.test(b.source_document_id || '')) return res.status(400).json({ error: 'source_document_id required' });
  const doc = must(await userDb.from('source_documents').select('id, company_id, purpose, path, mime, filename, period_end, retain_until').eq('id', b.source_document_id).eq('company_id', b.company_id).maybeSingle(), 'document');
  if (!doc || doc.purpose !== 'bank_statement') return res.status(404).json({ error: 'Statement not found' });

  if (b.action === 'reopen') {
    const r = must(await userDb.from('statement_reads').select('id, mode, pages, chunks, cost_usd, ms, result, imports, created_at')
      .eq('company_id', b.company_id).eq('source_document_id', doc.id).eq('status', 'read').order('created_at', { ascending: false }).limit(1).maybeSingle(), 'read');
    if (!r?.result) return res.status(404).json({ error: 'This statement has no completed read to reopen', can_read: true });
    return res.status(200).json({ read_id: r.id, reopened: true, read_at: r.created_at, mode: r.mode || r.result.mode || 'text', pages: r.pages, chunks: r.chunks,
      cost_usd: Number(r.cost_usd), ms: r.ms, imports: r.imports || [], ...r.result });
  }

  if (b.action === 'pdf_url') {
    const s = must(await serviceDb.storage.from('source-documents').createSignedUrl(doc.path, 300), 'signed url');
    return res.status(200).json({ url: s.signedUrl, expires_in: 300 });
  }

  if (doc.mime !== 'application/pdf') return res.status(400).json({ error: 'This document is not a PDF' });
  // the per-company daily cap on model reads (statement_reads drives it)
  const today = must(await serviceDb.from('statement_reads').select('status, tokens_in, cost_usd').eq('company_id', b.company_id).gte('created_at', irishDayStart()), 'reads today') || [];
  const override = must(await serviceDb.from('company_read_limits').select('max_reads_per_day, max_usd_per_day').eq('company_id', b.company_id).maybeSingle(), 'read limits');
  const cap = readCapStatus(today, override);
  if (cap.reached) {
    captureError(new Error('Statement read cap reached'), { company_id: b.company_id, operation: 'statement-read-cap', reads_today: cap.reads_today, usd_today: cap.usd_today });
    await flushSentry();
    return res.status(429).json({ error: cap.message, cap });
  }
  const dl = await serviceDb.storage.from('source-documents').download(doc.path);
  if (dl.error || !dl.data) return res.status(404).json({ error: 'The stored statement could not be read' });
  const buf = Buffer.from(await dl.data.arrayBuffer());
  const model = AI_MODEL.readStatement;
  const base = { company_id: b.company_id, source_document_id: doc.id, model, created_by: userId, created_by_name: (b.reader_name || '').slice(0, 120) || null };
  // The read is recorded when it starts (status 'reading') and updated as each part finishes, so the
  // screen can show progress; image reads (no usable text layer) are read in parallel parts.
  let readId = null;
  const deps = {
    callClaude,
    onStart: async s => {
      const rec = must(await serviceDb.from('statement_reads').insert({ ...base, mode: s.mode, status: 'reading', pages: s.pages, chunks: s.chunks, chunks_done: 0 }).select('id').single(), 'record the read');
      readId = rec.id;
    },
    onProgress: async p => { if (readId) await serviceDb.from('statement_reads').update({ chunks_done: p.done }).eq('id', readId); },
  };
  const finish = async fields => {
    if (readId) { must(await serviceDb.from('statement_reads').update(fields).eq('id', readId), 'record the read'); return readId; }
    return must(await serviceDb.from('statement_reads').insert({ ...base, mode: fields.mode || 'text', ...fields }).select('id').single(), 'record the read').id;
  };
  let out;
  try {
    out = await readStatementPdf(deps, { buf, model, companyId: b.company_id, allowImage: true });
  } catch (e) {
    await finish({ status: 'failed', refused_reason: e.message.slice(0, 500) });
    return res.status(502).json({ error: `The statement could not be read: ${e.message}` });
  }
  const cost = { mode: out.mode, tokens_in: out.tokens?.input || 0, tokens_out: out.tokens?.output || 0, cost_usd: Number((out.cost?.usd || 0).toFixed(4)), ms: out.ms || null, pages: out.pages, chunks: out.chunks?.length || 0, chunks_done: out.chunks?.length || 0 };
  if (out.refused) {
    const id = await finish({ ...cost, status: 'refused', refused_reason: out.refused });
    return res.status(200).json({ read_id: id, refused: out.refused, mode: out.mode, kind: out.kind, pages: out.pages, cost_usd: cost.cost_usd });
  }
  const screen = forScreen(out);
  const rec = { id: await finish({ ...cost, status: 'read', period_start: screen.period.start, period_end: screen.period.end, summary: screen.summary, result: { ...screen, mode: out.mode } }) };
  // the document's period and retention date: six years after the financial year that contains the
  // statement's last day ends (Peter, 8 Oct 2026). Filled in once, never moved.
  if (screen.period.end && !doc.period_end) {
    const company = must(await userDb.from('companies').select('year_end_month, fy_end_day').eq('id', b.company_id).maybeSingle(), 'company');
    const periods = must(await userDb.from('financial_periods').select('period_start, period_end').eq('company_id', b.company_id), 'periods') || [];
    const fy = fiscalYearContaining(screen.period.end, fiscalConfig(company, periods));
    must(await serviceDb.from('source_documents').update({ period_start: screen.period.start, period_end: screen.period.end, retain_until: addYears(fy.end, 6) }).eq('id', doc.id), 'retention');
  }
  return res.status(200).json({ read_id: rec.id, mode: out.mode, kind: out.kind, pages: out.pages, chunks: out.chunks.length, cost_usd: cost.cost_usd, ms: cost.ms, ...screen });
});
