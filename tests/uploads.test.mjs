// BNK-14 step 2: signed upload URLs, with fake Supabase clients. Run: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { startUpload, finishUpload, cleanupStaging, sniffType, UploadError, STAGING_BUCKET, SOURCE_BUCKET, ARCHIVE_BUCKET } from '../api/_uploads.js';

const CO = '5f4e4585-8937-4624-b0fc-079a8379a160';
const sha = b => createHash('sha256').update(b).digest('hex');
const MB = 1024 * 1024;
const pdfOf = n => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(n - 9, 0x41)]);

// ── fakes ─────────────────────────────────────────────────────────────────────────────────────
function fakeTable(rows) {
  const q = (filters = [], opts = {}) => {
    const apply = () => {
      let out = rows.filter(r => filters.every(f => f(r)));
      if (opts.order) out.sort((a, b) => (a[opts.order.c] < b[opts.order.c] ? -1 : 1) * (opts.order.asc === false ? -1 : 1));
      if (opts.limit) out = out.slice(0, opts.limit);
      return out;
    };
    const api = {
      select() { return api; },
      eq(c, v) { filters.push(r => r[c] === v); return api; },
      in(c, vs) { filters.push(r => vs.includes(r[c])); return api; },
      lt(c, v) { filters.push(r => r[c] < v); return api; },
      order(c, o = {}) { opts.order = { c, asc: o.ascending }; return api; },
      limit(n) { opts.limit = n; return api; },
      maybeSingle() { opts.one = true; return api; },
      single() { opts.one = true; return api; },
      then(res) {
        if (opts.update) {
          const hit = apply(); hit.forEach(r => Object.assign(r, opts.update));
          return Promise.resolve(res({ data: opts.selectAfter ? hit : null, error: null }));
        }
        const out = apply();
        return Promise.resolve(res({ data: opts.one ? out[0] ?? null : out, error: null }));
      },
    };
    return api;
  };
  return {
    rows,
    from() {
      const api = q();
      api.insert = row => {
        const r = { id: row.id || `id-${rows.length + 1}`, ...row };
        rows.push(r);
        const done = { data: r, error: null };
        return { select: () => ({ single: async () => done }), then: res => Promise.resolve(res({ data: null, error: null })) };
      };
      api.update = patch => { const filters = []; const opts = { update: patch }; const u = q(filters, opts); u.select = () => { opts.selectAfter = true; return u; }; return u; };
      return api;
    },
  };
}
function fakes({ approvals = [], files = [], now = '2026-10-09T10:00:00.000Z' } = {}) {
  const t = { uploads: fakeTable([]), source_documents: fakeTable([]), fs_approval_files: fakeTable(files), fs_approvals: fakeTable(approvals), statement_reads: fakeTable([]) };
  const buckets = { [STAGING_BUCKET]: new Map(), [SOURCE_BUCKET]: new Map(), [ARCHIVE_BUCKET]: new Map() };
  const removed = [];
  const storage = name => ({
    createSignedUploadUrl: async path => ({ data: { signedUrl: `https://storage/upload/sign/${name}/${path}?token=t`, token: 't', path }, error: null }),
    download: async path => buckets[name].has(path) ? { data: new Blob([buckets[name].get(path).buf]), error: null } : { data: null, error: { message: 'Object not found' } },
    upload: async (path, buf, o) => { if (buckets[name].has(path) && !o.upsert) return { error: { message: 'The resource already exists' } }; buckets[name].set(path, { buf, created_at: now }); return { data: { path }, error: null }; },
    remove: async paths => { paths.forEach(p => { removed.push(`${name}/${p}`); buckets[name].delete(p); }); return { data: paths, error: null }; },
    list: async prefix => {
      const out = new Map();
      for (const [p, v] of buckets[name]) {
        if (!p.startsWith(`${prefix}/`)) continue;
        const rest = p.slice(prefix.length + 1); const head = rest.split('/')[0];
        out.set(head, rest.includes('/') ? { name: head, id: null } : { name: head, id: p, created_at: v.created_at });
      }
      return { data: [...out.values()], error: null };
    },
  });
  let n = 0;
  const deps = { userDb: { from: name => t[name].from() }, serviceDb: { from: name => t[name].from(), storage: { from: storage } },
    newId: () => `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`, now: () => now };
  // the browser's PUT to the signed URL
  const browserUpload = (path, buf, created_at = now) => buckets[STAGING_BUCKET].set(path, { buf, created_at });
  return { deps, t, buckets, removed, browserUpload };
}
const who = { companyId: CO, userId: 'user_peter', userName: 'Peter' };

test('sniffing: PDF by its first bytes; CSV as text; binary is neither', () => {
  assert.equal(sniffType(Buffer.from('%PDF-1.4 x')), 'application/pdf');
  assert.equal(sniffType(Buffer.from('Date,Details\n01/01/2026,x')), 'text/csv');
  assert.equal(sniffType(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01])), null);
});

test('a 6 MB statement goes straight to storage, is checked by the server, and is archived', async () => {
  const f = fakes();
  const buf = pdfOf(6 * MB);
  assert.ok(buf.length > 5 * MB);
  const s = await startUpload(f.deps, { ...who, purpose: 'bank_statement', filename: 'AIB Sept.pdf', size: buf.length, type: 'application/pdf' });
  assert.match(s.signed_url, /upload\/sign\/uploads-staging\/staging\//);
  assert.equal(s.path, `staging/${CO}/${s.upload_id}`);
  f.browserUpload(s.path, buf);
  const out = await finishUpload(f.deps, { ...who, uploadId: s.upload_id });
  assert.equal(out.size_bytes, buf.length);
  assert.equal(out.sha256, sha(buf));
  assert.equal(out.destination.bucket, SOURCE_BUCKET);
  assert.ok(f.buckets[SOURCE_BUCKET].has(`${CO}/bank_statement/${s.upload_id}.pdf`));
  // the temporary copy stays until the clean-up, so the signed URL cannot be used again
  assert.ok(f.buckets[STAGING_BUCKET].has(s.path));
  const reuse = await f.deps.serviceDb.storage.from(STAGING_BUCKET).upload(s.path, pdfOf(100), { upsert: false });
  assert.match(reuse.error.message, /already exists/);
  const doc = f.t.source_documents.rows[0];
  assert.deepEqual([doc.purpose, doc.filename, doc.size_bytes, doc.sha256, doc.uploaded_by], ['bank_statement', 'AIB Sept.pdf', buf.length, sha(buf), 'user_peter']);
  const up = f.t.uploads.rows[0];
  assert.deepEqual([up.status, up.finished_by, up.sha256], ['accepted', 'user_peter', sha(buf)]);
});

test('refusals at start are recorded with who and why', async () => {
  const f = fakes({ approvals: [{ id: 'old', company_id: CO, status: 'superseded' }] });
  const tries = [
    [{ purpose: 'bank_statement', filename: 'big.pdf', size: 76 * MB, type: 'application/pdf' }, /76\.0 MB, over the 32\.0 MB size limit, and Ledgrly cannot read photographed statements yet\. Ask for the PDF downloaded from online banking/],
    [{ purpose: 'signed_copy', filename: 's.pdf', size: 11 * MB, type: 'application/pdf', approvalId: 'old', kind: 'full' }, /limit is 10\.0 MB/],
    [{ purpose: 'prior_accounts', filename: 'a.xlsx', size: 1000, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, /Only PDF/],
    [{ purpose: 'bank_statement', filename: 'e.csv', size: 0, type: 'text/csv' }, /empty/],
    [{ purpose: 'signed_copy', filename: 's.pdf', size: 1000, type: 'application/pdf', approvalId: 'old', kind: 'full' }, /superseded/],
    [{ purpose: 'nonsense', filename: 'x', size: 10, type: 'application/pdf' }, /Unknown purpose/],
  ];
  for (const [args, msg] of tries) await assert.rejects(startUpload(f.deps, { ...who, ...args }), e => e instanceof UploadError && msg.test(e.message));
  assert.equal(f.t.uploads.rows.length, tries.length);
  for (const r of f.t.uploads.rows) {
    assert.equal(r.status, 'rejected');
    assert.equal(r.created_by, 'user_peter');
    assert.equal(r.finished_by, 'user_peter');
    assert.ok(r.rejected_reason.length > 0);
    assert.equal(r.staging_path, undefined);
  }
});

test('rejections at finish are recorded with who and why; nothing is archived; the temporary file goes', async () => {
  const f = fakes();
  const start = async (args = {}) => startUpload(f.deps, { ...who, purpose: 'bank_statement', filename: 'x.pdf', size: 2000, type: 'application/pdf', ...args });
  const cases = [];
  // no file arrived
  cases.push([await start(), null, /No file arrived/]);
  // a different size from the one declared
  cases.push([await start(), pdfOf(1999), /not the 2000 declared/]);
  // declared a PDF, stored text
  cases.push([await start(), Buffer.alloc(2000, 0x41), /not a PDF/]);
  // declared CSV, stored binary
  cases.push([await start({ type: 'text/csv', filename: 'x.csv' }), Buffer.concat([Buffer.from('PK'), Buffer.alloc(1998, 0)]), /neither a PDF nor a text CSV/]);
  for (const [s, buf, msg] of cases) {
    if (buf) f.browserUpload(s.path, buf);
    await assert.rejects(finishUpload(f.deps, { ...who, userId: 'user_sean', uploadId: s.upload_id }), e => e instanceof UploadError && msg.test(e.message));
    const r = f.t.uploads.rows.find(x => x.id === s.upload_id);
    assert.deepEqual([r.status, r.created_by, r.finished_by], ['rejected', 'user_peter', 'user_sean']);
    assert.match(r.rejected_reason, msg);
  }
  assert.equal(f.buckets[SOURCE_BUCKET].size, 0);
  assert.equal(f.t.source_documents.rows.length, 0);
  // a finished upload cannot be finished again
  await assert.rejects(finishUpload(f.deps, { ...who, uploadId: cases[0][0].upload_id }), e => e.status === 409);
});

test('an expired link is rejected; the same file twice is rejected as a duplicate', async () => {
  const f = fakes();
  const buf = pdfOf(3000);
  const a = await startUpload(f.deps, { ...who, purpose: 'bank_statement', filename: 'one.pdf', size: 3000, type: 'application/pdf' });
  f.browserUpload(a.path, buf);
  await finishUpload(f.deps, { ...who, uploadId: a.upload_id });
  const b = await startUpload(f.deps, { ...who, purpose: 'bank_statement', filename: 'again.pdf', size: 3000, type: 'application/pdf' });
  f.browserUpload(b.path, buf);
  await assert.rejects(finishUpload(f.deps, { ...who, uploadId: b.upload_id }), e => /already uploaded \(one\.pdf/.test(e.message) && e.duplicate_of === f.t.source_documents.rows[0].id);
  const c = await startUpload(f.deps, { ...who, purpose: 'bank_statement', filename: 'late.pdf', size: 3000, type: 'application/pdf' });
  f.browserUpload(c.path, pdfOf(3000).fill(0x42, 20));
  f.deps.now = () => '2026-10-09T13:00:00.000Z'; // three hours later: the 2-hour link has expired
  await assert.rejects(finishUpload(f.deps, { ...who, uploadId: c.upload_id }), /expired/);
  assert.equal(f.t.source_documents.rows.length, 1);
});

test('signed copies: stored beside the approval, numbered, never replacing; the same file twice is refused', async () => {
  const appr = { id: 'a1', company_id: CO, status: 'approved', period_end: '2026-12-31', abridged_pdf_path: null };
  const f = fakes({ approvals: [appr] });
  const put = async buf => {
    const s = await startUpload(f.deps, { ...who, purpose: 'signed_copy', filename: 'signed.pdf', size: buf.length, type: 'application/pdf', approvalId: 'a1', kind: 'full' });
    f.browserUpload(s.path, buf);
    return finishUpload(f.deps, { ...who, uploadId: s.upload_id });
  };
  const one = await put(pdfOf(5000)), two = await put(pdfOf(5001));
  assert.deepEqual([one.destination.n, two.destination.n], [1, 2]);
  assert.deepEqual([...f.buckets[ARCHIVE_BUCKET].keys()], [`${CO}/2026-12-31/a1/signed-full-1.pdf`, `${CO}/2026-12-31/a1/signed-full-2.pdf`]);
  await assert.rejects(put(pdfOf(5000)), /already stored as signed copy 1/);
  await assert.rejects(startUpload(f.deps, { ...who, purpose: 'signed_copy', filename: 's.pdf', size: 10, type: 'application/pdf', approvalId: 'a1', kind: 'abridged' }), /no abridged copy/);
  assert.equal(f.t.fs_approval_files.rows.length, 2);
});

test('clean-up removes old temporary files only; an accepted one only once its archive copy is confirmed; archives untouched', async () => {
  const f = fakes();
  const old = '2026-10-07T09:00:00.000Z', fresh = '2026-10-09T09:30:00.000Z';
  // accepted, archive copy present: its old temporary file is removed
  const acc = await startUpload(f.deps, { ...who, purpose: 'bank_statement', filename: 'a.pdf', size: 4000, type: 'application/pdf' });
  f.browserUpload(acc.path, pdfOf(4000));
  const accDone = await finishUpload(f.deps, { ...who, uploadId: acc.upload_id });
  f.browserUpload(acc.path, pdfOf(4000), old);
  // accepted, but its archive copy is missing: the temporary file is kept
  const lost = await startUpload(f.deps, { ...who, purpose: 'bank_statement', filename: 'l.pdf', size: 4001, type: 'application/pdf' });
  f.browserUpload(lost.path, pdfOf(4001));
  const lostDone = await finishUpload(f.deps, { ...who, uploadId: lost.upload_id });
  f.buckets[SOURCE_BUCKET].delete(lostDone.destination.path);
  f.browserUpload(lost.path, pdfOf(4001), old);
  // a pending upload never finished, old: removed and its record marked expired
  const pend = await startUpload(f.deps, { ...who, purpose: 'bank_statement', filename: 'p.pdf', size: 4000, type: 'application/pdf' });
  f.browserUpload(pend.path, pdfOf(4000), old);
  f.t.uploads.rows.find(r => r.id === pend.upload_id).expires_at = '2026-10-07T11:00:00.000Z';
  // a file with no upload record at all, old: removed
  f.browserUpload(`staging/${CO}/stray`, pdfOf(100), old);
  // a pending upload from half an hour ago: kept
  const recent = await startUpload(f.deps, { ...who, purpose: 'bank_statement', filename: 'r.pdf', size: 4000, type: 'application/pdf' });
  f.browserUpload(recent.path, pdfOf(4000), fresh);
  f.t.uploads.rows.find(r => r.id === recent.upload_id).expires_at = '2026-10-09T11:30:00.000Z';
  const archived = [...f.buckets[SOURCE_BUCKET].keys()];
  f.removed.length = 0;

  const out = await cleanupStaging(f.deps);
  assert.deepEqual(out, { examined: 4, removed: 3, kept_archive_unconfirmed: 1, expired: 1, stuck_reads_closed: 0 });
  assert.ok(f.removed.every(p => p.startsWith(`${STAGING_BUCKET}/staging/`)), 'deletes only temporary paths');
  assert.deepEqual(f.removed.sort(), [`${STAGING_BUCKET}/${acc.path}`, `${STAGING_BUCKET}/${pend.path}`, `${STAGING_BUCKET}/staging/${CO}/stray`].sort());
  assert.ok(f.buckets[STAGING_BUCKET].has(lost.path) && f.buckets[STAGING_BUCKET].has(recent.path));
  assert.deepEqual([...f.buckets[SOURCE_BUCKET].keys()], archived, 'archived copies untouched');
  assert.ok(f.buckets[SOURCE_BUCKET].has(accDone.destination.path));
  assert.equal(f.t.uploads.rows.find(r => r.id === pend.upload_id).status, 'expired');
  assert.equal(f.t.uploads.rows.find(r => r.id === acc.upload_id).status, 'accepted');
});

test('clean-up closes a statement read still "reading" after 10 minutes, and only that one', async () => {
  const f = fakes();
  f.t.statement_reads.rows.push({ id: 'r1', status: 'reading', created_at: '2026-10-09T09:40:00.000Z' }, { id: 'r2', status: 'reading', created_at: '2026-10-09T09:55:00.000Z' }, { id: 'r3', status: 'read', created_at: '2026-10-09T08:00:00.000Z' });
  const out = await cleanupStaging(f.deps);
  assert.equal(out.stuck_reads_closed, 1);
  assert.deepEqual(f.t.statement_reads.rows.map(r => r.status), ['failed', 'reading', 'read']);
});
