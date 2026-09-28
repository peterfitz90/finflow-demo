// Shared bank-import duplicate handling — used by BOTH the live feed (api/yapily/ingest.js)
// and the CSV import (App.jsx BankImport). Pure module: no browser or server globals.

// ── Content-based (cross-file / cross-source) duplicate detection ─────────────
// Moved verbatim from api/yapily/ingest.js's Tier-2 dedup. An id-only check can't catch the
// same real transaction arriving under two different ids: the feed's Yapily tx.id vs a CSV's
// synthetic hash, or — for AIB CSVs — the same row in two overlapping statement files, whose
// ids differ because aibHash salts in the row's position within the file.
export function normDescForMatch(raw) {
  return (raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function descriptionsLikelyMatch(a, b) {
  const na = normDescForMatch(a);
  const nb = normDescForMatch(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  // Token-overlap fallback — catches reordered/partially-truncated descriptions from
  // differently-formatted sources without requiring a near-exact string match.
  const wa = new Set(na.split(' ').filter(w => w.length > 2));
  const wb = new Set(nb.split(' ').filter(w => w.length > 2));
  if (!wa.size || !wb.size) return false;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common / Math.min(wa.size, wb.size) >= 0.5;
}

// Returns an array parallel to `incoming`: the matched existing row, or null. Requires an
// EXACT date + amount + account match (the strong signal) before looking at description, so
// two genuinely different same-day, same-amount payments only collide if their descriptions
// are also similar.
//
// ONE-TO-ONE: each existing row can absorb at most one incoming row. Two genuine identical
// charges on the same day (e.g. two €1 parking charges) where only one is already in the
// ledger → one is flagged as a duplicate, the other still imports. (The feed's original
// `candidates.find` let a single existing row swallow every identical incoming row.)
//
// accountOfIncoming / accountOfExisting resolve each side's bank account id; null means
// "unknown". The feed passes a strict per-account key (null only for genuinely unmapped rows,
// which then only match other unmapped rows — unchanged behaviour). The CSV import can't
// always know its account at file-load time, so it passes `unknownMatchesAny: true`.
export function findContentDuplicates(incoming, existing, {
  accountOfIncoming = r => r.bank_account_id ?? null,
  accountOfExisting = r => r.bank_account_id ?? null,
  unknownMatchesAny = false,
} = {}) {
  const byDateAmount = new Map(); // "date|amount" → [existing rows not yet consumed]
  for (const row of existing) {
    const key = `${row.date}|${Number(row.amount).toFixed(2)}`;
    if (!byDateAmount.has(key)) byDateAmount.set(key, []);
    byDateAmount.get(key).push(row);
  }
  const accountsCompatible = (a, b) =>
    a === b || (unknownMatchesAny && (a == null || b == null));

  return incoming.map(r => {
    const pool = byDateAmount.get(`${r.date}|${Number(r.amount).toFixed(2)}`);
    if (!pool?.length) return null;
    const acct = accountOfIncoming(r);
    const idx = pool.findIndex(c =>
      accountsCompatible(acct, accountOfExisting(c)) && descriptionsLikelyMatch(c.description, r.description));
    if (idx < 0) return null;
    return pool.splice(idx, 1)[0]; // consume — see ONE-TO-ONE above
  });
}

// ── Posting: bank transactions FIRST, journals second ─────────────────────────
// bank_transactions carries the unique (company_id, revolut_id) constraint, so inserting it
// first makes the database the final duplicate gate: a row that slipped past the app-level
// checks is rejected BEFORE any journal exists for it, instead of leaving an orphaned journal
// behind (the old journals-first order). If the journal insert then fails, the bank
// transactions just inserted are deleted, so a batch lands whole or not at all.
//
// `pairs` = [{ bt, journal }] with journal.reference === bt.revolut_id (journal may be
// null for a bank transaction recorded without a posting). On a 23505
// (unique violation) the batch is treated as "some rows were already imported": those rows
// are looked up, dropped, and the remainder retried once.
// Returns { insertedBts, insertedJournals, skippedDuplicates, error }.
const UNIQUE_VIOLATION = '23505';

export async function postImportBatch(db, companyId, pairs) {
  let todo = pairs;
  let skippedDuplicates = 0;
  let insertedBts = null;

  for (let attempt = 0; attempt < 2 && todo.length; attempt++) {
    const { data, error } = await db.from('bank_transactions')
      .insert(todo.map(p => p.bt)).select('id, revolut_id');
    if (!error) { insertedBts = data || []; break; }
    if (error.code !== UNIQUE_VIOLATION || attempt === 1) {
      return { insertedBts: [], insertedJournals: [], skippedDuplicates, error };
    }
    // Some of these revolut_ids already exist — find which, drop them, retry the rest.
    const ids = todo.map(p => p.bt.revolut_id);
    const { data: existing, error: lookupErr } = await db.from('bank_transactions')
      .select('revolut_id').eq('company_id', companyId).in('revolut_id', ids);
    if (lookupErr) return { insertedBts: [], insertedJournals: [], skippedDuplicates, error: lookupErr };
    const already = new Set((existing || []).map(r => r.revolut_id));
    const before = todo.length;
    todo = todo.filter(p => !already.has(p.bt.revolut_id));
    skippedDuplicates += before - todo.length;
    if (before === todo.length) {
      // The conflict isn't with the ledger (e.g. two rows sharing an id inside this batch).
      return { insertedBts: [], insertedJournals: [], skippedDuplicates, error };
    }
  }
  if (!todo.length || !insertedBts) {
    return { insertedBts: [], insertedJournals: [], skippedDuplicates, error: null };
  }

  // journal may be null — the feed records some rows (e.g. suppressed internal transfers) as
  // bank transactions with no journal posted.
  const journalRows = todo.map(p => p.journal).filter(Boolean);
  if (!journalRows.length) return { insertedBts, insertedJournals: [], skippedDuplicates, error: null };
  const { data: insertedJournals, error: jErr } = await db.from('journals')
    .insert(journalRows).select('id, reference');
  if (jErr) {
    // Roll back this batch's bank transactions so nothing is left half-posted.
    const { error: rbErr } = await db.from('bank_transactions').delete().in('id', insertedBts.map(b => b.id));
    return { insertedBts: [], insertedJournals: [], skippedDuplicates, error: jErr, rollbackError: rbErr || null };
  }
  return { insertedBts, insertedJournals: insertedJournals || [], skippedDuplicates, error: null };
}
