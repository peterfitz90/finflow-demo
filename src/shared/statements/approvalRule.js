// STA-01 Stage 5b: the approval rule and the approval snapshot. Pure (no React, no Supabase, no
// crypto): the server (api/statements-approval.js) runs it before anything is stored, and the
// statements page shows the same checks. Hashing is the caller's (node:crypto on the server).
//
// The rule, all on the server:
//   1. a year end in the company's period list (a period that has ended);
//   2. the signed-off ranges (each sign-off minus any withdrawal) cover every day of the period;
//   3. "information required" is empty;
//   4. no DRAFT ledger conditions: no unmapped balances, no imbalance, opening balances present;
//   5. zero writes since sign-off, or an acknowledgement: the exact count and a written reason;
//   6. every wording item that prints is verified (wording.js WORDING_STATUS).
import { summariseSignoffs, activeOverlapping, uncoveredRanges } from '../signoffSummary.js';
import { ledgerLines } from './comparatives.js';
import { printedWordingKeys, wordingGate, CHOICE, VARIANTS, ABRIDGED, CURRENCY, WORDING_STATUS } from './wording.js';

export const RULE_VERSION = 1;

// The writes logged against the covering sign-offs since each was made.
export function writesAfterSignoff(summaries, from, to) {
  return activeOverlapping(summaries, from, to).flatMap(r => r.changes.map(c => ({
    id: c.id, period_start: r.start, period_end: r.end, table: c.affected_table, row_id: c.affected_row_id, at: c.occurred_at,
  })));
}

// A: assembleStatements output. signoffEvents: period_signoff_events rows for the company.
// ack: { count, reason } from the accountant (only needed when writes were logged after sign-off).
// wordingStatus: tests only (the server always uses wording.js's WORDING_STATUS).
export function evaluateApproval({ A, yearEnd, signoffEvents = [], ack = null, wordingStatus = WORDING_STATUS }) {
  const from = A.fyStart, to = yearEnd;
  const summaries = summariseSignoffs(signoffEvents);
  const covering = from ? activeOverlapping(summaries, from, to) : [];
  const gaps = from ? uncoveredRanges(summaries, from, to) : [{ start: null, end: to }];
  const writes = from ? writesAfterSignoff(summaries, from, to) : [];
  const abridged = !!A.abridgedElected;
  const gate = wordingGate(printedWordingKeys(A, { abridged }), wordingStatus);
  const ackCount = ack?.count == null || ack.count === '' ? null : Number(ack.count);
  const ackReason = (ack?.reason || '').trim();
  const ackOk = writes.length === 0 || (ackCount === writes.length && ackReason.length > 0);

  const checks = [
    { key: 'period', label: 'A year end in the company\'s period list that has ended', ok: !!A.selectedPeriod,
      detail: A.selectedPeriod ? `${from} to ${to}` : `${to} is not a year end in the period list, or it has not ended yet` },
    { key: 'signoff', label: 'Sign-offs cover every day of the period', ok: !!from && gaps.length === 0,
      detail: gaps.length ? `Not covered: ${gaps.map(g => (g.start === g.end ? g.start : `${g.start} to ${g.end}`)).join('; ')}` : `${covering.length} sign-off${covering.length === 1 ? '' : 's'} cover the period` },
    { key: 'info', label: '"Information required" is empty', ok: A.infoRequired.length === 0,
      detail: A.infoRequired.length ? `${A.infoRequired.length} item${A.infoRequired.length === 1 ? '' : 's'}: ${A.infoRequired.map(i => i.label).join('; ')}` : 'Nothing outstanding' },
    { key: 'ledger', label: 'No DRAFT ledger conditions', ok: A.ledgerDraftConditions.length === 0,
      detail: A.ledgerDraftConditions.length ? A.ledgerDraftConditions.join('; ') : 'Opening balances present, nothing unmapped, balanced' },
    { key: 'writes', label: 'No changes since sign-off, or the changes acknowledged', ok: ackOk,
      detail: writes.length === 0 ? 'No changes logged since sign-off'
        : ackOk ? `${writes.length} change${writes.length === 1 ? '' : 's'} acknowledged`
        : `${writes.length} change${writes.length === 1 ? '' : 's'} logged since sign-off: enter the exact count and a reason` },
    { key: 'wording', label: 'Every printed wording item is verified', ok: gate.blocking.length === 0,
      detail: gate.blocking.length ? `Unverified: ${gate.blocking.map(i => i.item).join('; ')}` : `${gate.items.length} items verified` },
  ];
  return {
    ok: checks.every(c => c.ok), checks, period: { start: from, end: to }, abridged,
    covering: covering.map(r => ({ start: r.start, end: r.end, signed_event_id: r.signed?.id, signed_at: r.signed?.occurred_at, signed_by: r.signed?.actor_name || r.signed?.actor })),
    gaps, writes, ack: writes.length ? { count: ackCount, reason: ackReason } : null, wording: gate,
  };
}

// Journals in a fixed order and form, for the ledger fingerprint: the caller hashes `canonical`.
export function ledgerFingerprintParts(journals = []) {
  const rows = [...journals].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  const total = Math.round(rows.reduce((t, j) => t + Number(j.amount || 0), 0) * 100) / 100;
  const latest = rows.reduce((m, j) => (j.created_at && (!m || j.created_at > m) ? j.created_at : m), null);
  const canonical = rows.map(j => [j.id, j.date, j.debit_account, j.credit_account, Number(j.amount).toFixed(2)].join('|')).join('\n');
  return { count: rows.length, total, latestCreatedAt: latest, canonical };
}

// The wording as printed, in a stable form for hashing (the caller hashes it).
export function wordingCanonical() {
  return JSON.stringify({ CHOICE, VARIANTS, ABRIDGED, CURRENCY, WORDING_STATUS });
}

// The approval snapshot (fs_approvals.snapshot). Everything a later reader needs to see what was
// approved, without the ledger: figures as printed, the inputs and attestations, the wording and
// its status, the comparatives, the ledger fingerprint and the rule evidence. hashes: { ledger,
// wording } (hex sha256, computed by the caller); build: { commit, deployment }.
export function buildSnapshot({ A, company, yearEnd, inputs, rule, fingerprint, hashes, build }) {
  const reserves = A.notes.find(n => n.title === 'Reserves and dividends');
  return {
    rule_version: RULE_VERSION,
    identity: {
      company_id: company.id, company_name: company.name, cro_number: company.cro_number || null, regime: 'FRS105',
      period_start: A.fyStart, period_end: yearEnd, period_kind: A.selectedPeriod?.kind || null,
      directors_approval_date: A.approvalISO, abridged_elected: !!A.abridgedElected,
    },
    figures: {
      year: ledgerLines(A.frs105),
      prior: { bs: A.prior.bs, pnl: A.prior.pnl },
      reserves: reserves ? reserves.table : null,
    },
    inputs: {
      profile: inputs.profile || null, directors: inputs.directors || [], year_inputs: inputs.yearInputs || null,
      disclosures: (inputs.disclosures || []).map(d => ({ ...d })),
    },
    printed: { bs_statements: A.bsStatements, notes: A.notes, abridged_bs_statements: A.abridgedElected ? A.abridgedBs : null,
      abridged_notes: A.abridgedElected ? A.abridgedNotes : null, certification: A.abridgedElected ? A.certification : null },
    wording: { choice: CHOICE, sha256: hashes.wording, status: rule.wording.items, commit: build?.commit || null, deployment: build?.deployment || null, engine_mode: 'schedule3b' },
    comparatives: (inputs.comparatives || []).filter(r => r.status === 'confirmed').map(r => ({
      id: r.id, line_key: r.line_key, confirmed_amount: r.confirmed_amount, source: r.source, source_file: r.source_file,
      source_page: r.source_page, confirmed_by: r.confirmed_by, confirmed_at: r.confirmed_at,
    })),
    ledger: { journal_count: fingerprint.count, journal_total: fingerprint.total, latest_created_at: fingerprint.latestCreatedAt, sha256: hashes.ledger },
    rule: { checks: rule.checks, covering: rule.covering, info_required: A.infoRequired, writes_after_signoff: rule.writes.length, writes: rule.writes, ack: rule.ack },
  };
}
