// STA-01 Stages 5b and 5c: the approval rule, the approval flow, the archive and the signed copies,
// with fake Supabase clients. Run: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { evaluateApproval, ledgerFingerprintParts } from '../src/shared/statements/approvalRule.js';
import { WORDING_STATUS, printedWordingKeys } from '../src/shared/statements/wording.js';
import { assembleStatements } from '../src/shared/statements/assemble.js';
import { uncoveredRanges, summariseSignoffs } from '../src/shared/signoffSummary.js';
import { checkApproval, approve, listArchive, signedUrl, uploadSigned, ApprovalError, MAX_PDF_BYTES } from '../api/_statements-approval.js';

const CO = '5f4e4585-8937-4624-b0fc-079a8379a160';
const sha = b => createHash('sha256').update(b).digest('hex');
const ALL_VERIFIED = Object.fromEntries(Object.entries(WORDING_STATUS).map(([k, v]) => [k, { ...v, status: 'verified', by: 'Test', on: '2026-10-09' }]));

// A real assembled year (2026, December year end), with the inputs-side conditions cleared so the
// rule can pass; each test breaks one condition.
function assembled({ abridged = true } = {}) {
  const J = (date, d, c, a) => ({ id: `${date}-${d}-${c}-${a}`, date, debit_account: d, credit_account: c, amount: a, created_at: `${date}T09:00:00Z` });
  const chart = [{ code: '1000', name: 'Bank', account_type: 'asset' }, { code: '4000', name: 'Sales', account_type: 'income' }, { code: '3000', name: 'Share capital', account_type: 'equity' }];
  const journals = [J('2026-01-01', '1000', '3000', 2), J('2026-03-02', '1000', '4000', 100)];
  const claimed = [{ disclosure_key: 'audit_exemption', has_items: true, details: { section: '359' } }, { disclosure_key: 'no_s334_notice', has_items: false }];
  const inputs = { directors: [{ id: 'd1', full_name: 'Sean Moylan' }, { id: 'd2', full_name: 'Peter Fitzsimons' }], disclosures: claimed, comparatives: [],
    yearInputs: { approval_date: '2027-01-07', policy_inputs: { abridged: { elected: abridged, certification: { director_ids: ['d1', 'd2'], date: '2027-01-07' } } } } };
  const A = assembleStatements({ company: { id: CO, name: 'Fitzsimons Test', year_end_month: 12 }, companyName: 'Fitzsimons Test', journals, chart,
    bankCodes: ['1000'], yearEnd: '2026-12-31', today: '2027-01-08', periods: [], inputs });
  A.infoRequired = []; A.ledgerDraftConditions = [];
  return { A, journals, inputs };
}
const signed = (start, end, id = 'e1', at = '2027-01-05T10:00:00Z') => ({ id, company_id: CO, period_start: start, period_end: end, action: 'signed_off', actor_name: 'Peter', occurred_at: at });
const written = (start, end, id, at) => ({ id, company_id: CO, period_start: start, period_end: end, action: 'write_after_signoff', affected_table: 'journals', affected_row_id: 'j', occurred_at: at });
const YEAR = [signed('2026-01-01', '2026-12-31')];

test('coverage: gaps between signed-off ranges, and withdrawn ranges do not count', () => {
  const s = summariseSignoffs([signed('2026-01-01', '2026-06-30', 'a'), signed('2026-08-01', '2026-12-31', 'b'),
    signed('2026-07-01', '2026-07-31', 'c', '2027-01-01T00:00:00Z'), { id: 'd', period_start: '2026-07-01', period_end: '2026-07-31', action: 'withdrawn', occurred_at: '2027-01-02T00:00:00Z' }]);
  assert.deepEqual(uncoveredRanges(s, '2026-01-01', '2026-12-31'), [{ start: '2026-07-01', end: '2026-07-31' }]);
  assert.deepEqual(uncoveredRanges(summariseSignoffs(YEAR), '2026-01-01', '2026-12-31'), []);
  // monthly sign-offs covering every day are enough
  const months = Array.from({ length: 12 }, (_, i) => { const m = String(i + 1).padStart(2, '0'); const end = new Date(Date.UTC(2026, i + 1, 0)).toISOString().slice(0, 10); return signed(`2026-${m}-01`, end, `m${m}`); });
  assert.deepEqual(uncoveredRanges(summariseSignoffs(months), '2026-01-01', '2026-12-31'), []);
});

test('the rule: every condition must hold; wording unverified blocks; changes need the exact count and a reason', () => {
  const { A } = assembled();
  const ok = evaluateApproval({ A, yearEnd: '2026-12-31', signoffEvents: YEAR, wordingStatus: ALL_VERIFIED });
  assert.equal(ok.ok, true, JSON.stringify(ok.checks.filter(c => !c.ok)));
  // the real status: every item verified (full set by Peter on 7 October 2026), so nothing blocks
  const real = evaluateApproval({ A, yearEnd: '2026-12-31', signoffEvents: YEAR });
  assert.equal(real.ok, true);
  assert.deepEqual(real.wording.blocking, []);
  // an unverified printed item blocks
  const one = { ...ALL_VERIFIED, 'full.9': { ...ALL_VERIFIED['full.9'], status: 'unverified' } };
  assert.deepEqual(evaluateApproval({ A, yearEnd: '2026-12-31', signoffEvents: YEAR, wordingStatus: one }).wording.blocking.map(i => i.key), ['full.9']);
  // no sign-off
  assert.equal(evaluateApproval({ A, yearEnd: '2026-12-31', signoffEvents: [], wordingStatus: ALL_VERIFIED }).checks.find(c => c.key === 'signoff').ok, false);
  // information required
  const B = { ...A, infoRequired: [{ key: 'x', label: 'Approval date' }] };
  assert.equal(evaluateApproval({ A: B, yearEnd: '2026-12-31', signoffEvents: YEAR, wordingStatus: ALL_VERIFIED }).checks.find(c => c.key === 'info').ok, false);
  // ledger conditions
  const C = { ...A, ledgerDraftConditions: ['unmapped balances'] };
  assert.equal(evaluateApproval({ A: C, yearEnd: '2026-12-31', signoffEvents: YEAR, wordingStatus: ALL_VERIFIED }).ok, false);
  // two writes after sign-off
  const ev = [...YEAR, written('2026-01-01', '2026-12-31', 'w1', '2027-01-06T00:00:00Z'), written('2026-01-01', '2026-12-31', 'w2', '2027-01-06T01:00:00Z')];
  const r = ack => evaluateApproval({ A, yearEnd: '2026-12-31', signoffEvents: ev, ack, wordingStatus: ALL_VERIFIED });
  assert.equal(r(null).ok, false);
  assert.equal(r({ count: 1, reason: 'Accrual posted' }).ok, false, 'wrong count');
  assert.equal(r({ count: 2, reason: '  ' }).ok, false, 'no reason');
  assert.equal(r({ count: 2, reason: 'Accrual and CT charge posted after review' }).ok, true);
  // writes before a re-sign-off do not count
  const resigned = [...ev, signed('2026-01-01', '2026-12-31', 'e2', '2027-01-07T00:00:00Z')];
  assert.equal(evaluateApproval({ A, yearEnd: '2026-12-31', signoffEvents: resigned, wordingStatus: ALL_VERIFIED }).writes.length, 0);
});

test('wording record: every full-set item verified by Peter on 7 October 2026 (system clock)', () => {
  const keys = Object.keys(WORDING_STATUS).filter(k => k.startsWith('full.'));
  assert.deepEqual(keys, ['full.3', 'full.4', 'full.5', 'full.8', 'full.9', 'full.10', 'full.notes', 'full.notes.share_capital', 'full.notes.post_bs_events']);
  for (const k of keys) assert.deepEqual([WORDING_STATUS[k].status, WORDING_STATUS[k].by, WORDING_STATUS[k].on], ['verified', 'Peter', '2026-10-07'], k);
  assert.ok(Object.values(WORDING_STATUS).every(v => v.status === 'verified'), 'none open');
});

test('wording gate: only items that print can block', () => {
  const { A } = assembled({ abridged: false });
  assert.ok(!printedWordingKeys(A).some(k => k.startsWith('abridged.')));
  const noClaim = { ...A, bsStatements: { ...A.bsStatements, auditExemption: null } };
  assert.ok(!printedWordingKeys(noClaim).includes('full.4'));
  // share capital note prints here (3000 has a balance); no post-balance-sheet note without an attestation
  assert.ok(printedWordingKeys(A).includes('full.notes.share_capital'));
  assert.ok(!printedWordingKeys(A).includes('full.notes.post_bs_events'));
  assert.ok(printedWordingKeys({ ...A, notes: [...A.notes, { title: 'Events after the balance sheet date' }] }).includes('full.notes.post_bs_events'));
  const ab = assembled().A;
  assert.ok(printedWordingKeys(ab, { abridged: true }).includes('abridged.A1'));
  // the abridged copy always prints its Dividends note (the attested sentence even with none paid)
  assert.ok(printedWordingKeys(ab, { abridged: true }).includes('abridged.dividends'));
  assert.ok(!printedWordingKeys({ ...ab, abridgedNotes: [] }, { abridged: true }).includes('abridged.dividends'));
});

test('ledger fingerprint: order-independent input, any change to a journal changes it', () => {
  const { journals } = assembled();
  const a = ledgerFingerprintParts(journals), b = ledgerFingerprintParts([...journals].reverse());
  assert.equal(a.canonical, b.canonical);
  assert.deepEqual([a.count, a.total, a.latestCreatedAt], [2, 102, '2026-03-02T09:00:00Z']);
  assert.notEqual(ledgerFingerprintParts([{ ...journals[0], amount: 3 }, journals[1]]).canonical, a.canonical);
});

// ── fakes ─────────────────────────────────────────────────────────────────────────────────────
function table(rows) {
  return {
    rows,
    query() {
      let out = [...rows], one = null;
      const q = {
        select() { return q; }, eq(c, v) { out = out.filter(r => r[c] === v); return q; },
        order(c, o = {}) { out.sort((x, y) => ((x[c] < y[c] ? -1 : x[c] > y[c] ? 1 : 0) * (o.ascending === false ? -1 : 1))); return q; },
        limit(n) { out = out.slice(0, n); return q; }, maybeSingle() { one = 'maybe'; return q; }, single() { one = 'single'; return q; },
        then(res) { return Promise.resolve(res({ data: one ? out[0] ?? null : out, error: null })); },
      };
      return q;
    },
  };
}
function fakes({ A, journals, inputs, events = YEAR, approvals = [], files = [], rpcError = null, uploadError = null }) {
  const store = new Map(), removed = [], rpcCalls = [], serviceReads = [];
  const t = { period_signoff_events: table(events), fs_approvals: table(approvals), fs_approval_files: table(files) };
  const userDb = { from: n => t[n].query() };
  const serviceDb = {
    from: n => {
      serviceReads.push(n);
      const q = t[n].query();
      q.insert = row => { const r = { id: `f${t[n].rows.length + 1}`, uploaded_at: 'now', ...row }; t[n].rows.push(r); return { select: () => ({ single: async () => ({ data: r, error: null }) }) }; };
      return q;
    },
    rpc: async (name, args) => { rpcCalls.push({ name, args }); return rpcError ? { data: null, error: { message: rpcError } } : { data: { ...args.p_row, recorded_at: 'now' }, error: null }; },
    storage: { from: () => ({
      upload: async (path, buf, o) => { if (uploadError) return { error: { message: uploadError } }; if (store.has(path) && !o.upsert) return { error: { message: 'The resource already exists' } }; store.set(path, buf); return { data: { path }, error: null }; },
      remove: async paths => { for (const p of paths) { store.delete(p); removed.push(p); } return { data: paths, error: null }; },
      createSignedUrl: async (path, s, o) => ({ data: { signedUrl: `https://signed/${path}?ttl=${s}&dl=${o.download}` }, error: null }),
    }) },
  };
  const deps = { userDb, serviceDb, today: '2027-01-08', newId: () => '11111111-1111-1111-1111-111111111111', build: { commit: 'abc', deployment: 'dpl' },
    wordingStatus: ALL_VERIFIED, load: async () => ({ company: { id: CO, name: 'Fitzsimons Test', cro_number: '999' }, assembled: A, journals, inputs }),
    render: async m => Buffer.from(`%PDF-1.4 ${m.variant} approved=${m.approved}`) };
  return { deps, store, removed, rpcCalls, serviceReads, t };
}

test('approve: both PDFs without the watermark, archived, then the snapshot with both hashes', async () => {
  const { A, journals, inputs } = assembled();
  const f = fakes({ A, journals, inputs });
  const out = await approve(f.deps, { companyId: CO, yearEnd: '2026-12-31', ack: null, userId: 'user_p', userName: 'Peter' });
  const base = `${CO}/2026-12-31/11111111-1111-1111-1111-111111111111`;
  assert.deepEqual([...f.store.keys()], [`${base}/full.pdf`, `${base}/abridged.pdf`]);
  assert.match(f.store.get(`${base}/full.pdf`).toString(), /full approved=true/);
  const row = f.rpcCalls[0].args.p_row;
  assert.equal(f.rpcCalls.length, 1);
  assert.equal(row.full_pdf_sha256, sha(f.store.get(`${base}/full.pdf`)));
  assert.equal(row.abridged_pdf_sha256, sha(f.store.get(`${base}/abridged.pdf`)));
  assert.deepEqual([row.period_start, row.period_end, row.directors_approval_date, row.approved_by], ['2026-01-01', '2026-12-31', '2027-01-07', 'user_p']);
  const s = row.snapshot;
  assert.equal(s.ledger.sha256, sha(ledgerFingerprintParts(journals).canonical));
  assert.equal(s.ledger.journal_count, 2);
  assert.match(s.wording.sha256, /^[0-9a-f]{64}$/);
  assert.ok(s.wording.status.every(i => i.status === 'verified'));
  assert.equal(s.pdfs.length, 2);
  assert.equal(s.figures.year['pnl.1'], 100);
  assert.equal(s.rule.writes_after_signoff, 0);
  assert.equal(out.approval.id, '11111111-1111-1111-1111-111111111111');
  assert.deepEqual(f.serviceReads, [], 'nothing read with the service role');
});

test('approve: abridged not elected -> the full set only', async () => {
  const { A, journals, inputs } = assembled({ abridged: false });
  const f = fakes({ A, journals, inputs });
  await approve(f.deps, { companyId: CO, yearEnd: '2026-12-31', userId: 'u' });
  assert.equal(f.store.size, 1);
  assert.equal(f.rpcCalls[0].args.p_row.abridged_pdf_path, null);
});

test('approve: rule not met -> 409, nothing stored', async () => {
  const { A, journals, inputs } = assembled();
  const f = fakes({ A, journals, inputs, events: [] });
  await assert.rejects(approve(f.deps, { companyId: CO, yearEnd: '2026-12-31', userId: 'u' }), e => e instanceof ApprovalError && e.status === 409 && e.rule.checks.some(c => c.key === 'signoff' && !c.ok));
  assert.equal(f.store.size, 0);
  assert.equal(f.rpcCalls.length, 0);
  // and with an unverified printed item
  const g = fakes({ A, journals, inputs }); g.deps.wordingStatus = { ...ALL_VERIFIED, 'full.3': { ...ALL_VERIFIED['full.3'], status: 'unverified' } };
  await assert.rejects(approve(g.deps, { companyId: CO, yearEnd: '2026-12-31', userId: 'u' }), e => e.status === 409 && e.rule.checks.find(c => c.key === 'wording').ok === false);
  assert.equal(g.store.size, 0);
});

test('approve: a failure after the uploads removes them; an upload failure stores nothing', async () => {
  const { A, journals, inputs } = assembled();
  const f = fakes({ A, journals, inputs, rpcError: 'boom' });
  await assert.rejects(approve(f.deps, { companyId: CO, yearEnd: '2026-12-31', userId: 'u' }), /record approval: boom/);
  assert.equal(f.store.size, 0);
  assert.equal(f.removed.length, 2);
  const g = fakes({ A, journals, inputs, uploadError: 'quota' });
  await assert.rejects(approve(g.deps, { companyId: CO, yearEnd: '2026-12-31', userId: 'u' }), /quota/);
  assert.equal(g.rpcCalls.length, 0);
});

test('approve: an existing approval is superseded only when named, with a reason', async () => {
  const { A, journals, inputs } = assembled();
  const live = { id: 'old', company_id: CO, period_end: '2026-12-31', status: 'approved', recorded_at: '2027-01-07' };
  const f = fakes({ A, journals, inputs, approvals: [live] });
  await assert.rejects(approve(f.deps, { companyId: CO, yearEnd: '2026-12-31', userId: 'u' }), e => e.status === 409 && e.live.id === 'old');
  await assert.rejects(approve(f.deps, { companyId: CO, yearEnd: '2026-12-31', userId: 'u', supersedes: 'old', supersedeReason: ' ' }), e => e.status === 400);
  assert.equal(f.store.size, 0);
  await approve(f.deps, { companyId: CO, yearEnd: '2026-12-31', userId: 'u', supersedes: 'old', supersedeReason: 'Corrected accruals' });
  assert.deepEqual([f.rpcCalls[0].args.p_supersedes, f.rpcCalls[0].args.p_supersede_reason], ['old', 'Corrected accruals']);
});

test('check: the rule, and "changed since approval" from the ledger and inputs hashes', async () => {
  const { A, journals, inputs } = assembled();
  const f = fakes({ A, journals, inputs });
  await approve(f.deps, { companyId: CO, yearEnd: '2026-12-31', userId: 'u' });
  const row = f.rpcCalls[0].args.p_row;
  const stored = { id: row.id, company_id: CO, period_end: '2026-12-31', status: 'approved', recorded_at: 'now', ledger: row.snapshot.ledger, inputs_sha256: row.snapshot.inputs_sha256 };
  const same = await checkApproval(fakes({ A, journals, inputs, approvals: [stored] }).deps, { companyId: CO, yearEnd: '2026-12-31' });
  assert.equal(same.rule.ok, true);
  assert.equal(same.changedSinceApproval.any, false);
  const moreJournals = [...journals, { id: 'x', date: '2026-12-30', debit_account: '1000', credit_account: '4000', amount: 5 }];
  const moved = await checkApproval(fakes({ A, journals: moreJournals, inputs, approvals: [stored] }).deps, { companyId: CO, yearEnd: '2026-12-31' });
  assert.deepEqual([moved.changedSinceApproval.ledger, moved.changedSinceApproval.journals_now], [true, 3]);
  const newInputs = { ...inputs, yearInputs: { ...inputs.yearInputs, average_employees: 3 } };
  assert.equal((await checkApproval(fakes({ A, journals, inputs: newInputs, approvals: [stored] }).deps, { companyId: CO, yearEnd: '2026-12-31' })).changedSinceApproval.inputs, true);
});

test('signed URLs only for files named by a row the caller can see', async () => {
  const { A, journals, inputs } = assembled();
  const a = { id: 'a1', company_id: CO, period_end: '2026-12-31', status: 'approved', full_pdf_path: `${CO}/2026-12-31/a1/full.pdf`, abridged_pdf_path: null };
  const f = fakes({ A, journals, inputs, approvals: [a], files: [{ id: 'f1', approval_id: 'a1', company_id: CO, path: `${CO}/2026-12-31/a1/signed-full-1.pdf` }] });
  assert.match((await signedUrl(f.deps, { companyId: CO, path: a.full_pdf_path })).url, /ttl=60&dl=2026-12-31-a1-full\.pdf/);
  assert.ok((await signedUrl(f.deps, { companyId: CO, path: `${CO}/2026-12-31/a1/signed-full-1.pdf` })).url);
  await assert.rejects(signedUrl(f.deps, { companyId: CO, path: `${CO}/2026-12-31/zz/full.pdf` }), e => e.status === 404);
  await assert.rejects(signedUrl(f.deps, { companyId: CO, path: `59fc55e0-10ac-471b-a3e4-283ae510f1db/2026-12-31/a1/full.pdf` }), e => e.status === 404);
  // what RLS hides (a business owner and a superseded row) cannot be signed: the fake's userDb
  // stands in for RLS, so an empty list means "not visible"
  const bo = fakes({ A, journals, inputs, approvals: [] });
  await assert.rejects(signedUrl(bo.deps, { companyId: CO, path: a.full_pdf_path }), e => e.status === 404);
  assert.deepEqual((await listArchive(f.deps, { companyId: CO })).approvals.map(x => x.id), ['a1']);
});

test('signed copies: PDF only, 10 MB, current approval only, numbered, never replacing', async () => {
  const { A, journals, inputs } = assembled();
  const a = { id: 'a1', company_id: CO, period_end: '2026-12-31', status: 'approved', abridged_pdf_path: null };
  const f = fakes({ A, journals, inputs, approvals: [a, { id: 'old', company_id: CO, period_end: '2026-12-31', status: 'superseded' }] });
  const pdf = Buffer.from('%PDF-1.7 signed');
  const up = args => uploadSigned(f.deps, { companyId: CO, approvalId: 'a1', kind: 'full', pdf, userId: 'u', userName: 'Peter', ...args });
  await assert.rejects(up({ pdf: Buffer.from('hello') }), e => e.status === 415);
  await assert.rejects(up({ pdf: Buffer.alloc(MAX_PDF_BYTES + 1, 0x25) }), e => e.status === 413);
  await assert.rejects(up({ kind: 'abridged' }), e => e.status === 400);
  await assert.rejects(up({ approvalId: 'old' }), e => e.status === 409);
  await assert.rejects(up({ approvalId: 'nope' }), e => e.status === 404);
  const one = await up(), two = await up();
  assert.deepEqual([one.n, two.n], [1, 2]);
  assert.deepEqual([...f.store.keys()], [`${CO}/2026-12-31/a1/signed-full-1.pdf`, `${CO}/2026-12-31/a1/signed-full-2.pdf`]);
  assert.equal(one.sha256, sha(pdf));
});
