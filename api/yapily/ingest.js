// POST /api/yapily/ingest
// Fetches transactions from Yapily and posts BOOKED/EUR ones to the ledger.
// Mirrors the CSV bank import pipeline: journals + bank_transactions + bank_matches.
//
// Request body:
//   company_id    {string}  required
//   allow_pending {bool}    default false — pass true for sandbox (modelo-sandbox only returns PENDING)
//   dry_run       {bool}    default false — return preview without posting anything
//   limit         {number}  optional — only post the first N new transactions (after dedup)
//   import_from   {string}  optional 'YYYY-MM-DD' — convenience lower bound for a clean
//                            migration off prior CSV history. Narrows the Yapily fetch window
//                            when later than the 90-day default AND is enforced as a hard
//                            filter on the mapped results — but dedup (id + cross-source
//                            content match) always runs regardless of whether this is set.
//
// SECURITY: YAPILY_APP_SECRET and consent tokens are SERVER-SIDE ONLY. Never sent to client.

import { createClient } from '@supabase/supabase-js';
import { withSentry, captureError } from '../_sentry.js';
import { decryptToken } from '../_token-crypto.js';

// ── Yapily auth ───────────────────────────────────────────────────────────────
function yapilyBasicAuth() {
  const id  = process.env.YAPILY_APP_ID?.trim();
  const sec = process.env.YAPILY_APP_SECRET?.trim();
  if (!id || !sec) throw new Error('[yapily/ingest] YAPILY_APP_ID or YAPILY_APP_SECRET not set');
  return 'Basic ' + Buffer.from(`${id}:${sec}`).toString('base64');
}

async function yapilyGet(path, consentToken) {
  const res  = await fetch(`https://api.yapily.com${path}`, {
    headers: {
      'Authorization': yapilyBasicAuth(),
      'Consent':       consentToken,
      'Accept':        'application/json',
    },
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

// ── Yapily transaction mappers ────────────────────────────────────────────────
// Yapily returns amount as an object: { amount: "50.00", currency: "EUR" }
function extractAmount(tx) {
  if (tx.amount && typeof tx.amount === 'object') {
    return parseFloat(tx.amount.amount ?? 0);
  }
  const raw = tx.amount ?? tx.transactionAmount?.amount ?? 0;
  return typeof raw === 'string' ? parseFloat(raw) : Number(raw);
}

function extractCurrency(tx, accountCurrency) {
  if (tx.amount && typeof tx.amount === 'object' && tx.amount.currency) return tx.amount.currency;
  return tx.currency ?? tx.transactionAmount?.currency ?? accountCurrency ?? 'EUR';
}

// ── Cross-source duplicate detection ──────────────────────────────────────────
// The feed's dedup key (Yapily tx.id) and CSV imports' dedup key (a synthetic hash — see
// parseAIBCSV/aibHash in App.jsx) live in completely different namespaces, so an id-only
// check can never catch the same real transaction arriving from both a prior CSV import and
// the live feed. This normalizes descriptions well enough to compare across those two very
// differently-formatted sources (AIB's feed transactionInformation is the same underlying
// text as CSV's Description1/2/3, per buildDescription's comment above, but not byte-identical).
function normDescForMatch(raw) {
  return (raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function descriptionsLikelyMatch(a, b) {
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

function buildDescription(tx) {
  // transactionInformation can be a string or an array (e.g. AIB returns 3 elements).
  // JOIN all elements — taking only [0] loses the payee name in real Irish bank feeds
  // (AIB's array is equivalent to CSV Description1+Description2+Description3 concatenated).
  const txInfo = Array.isArray(tx.transactionInformation)
    ? tx.transactionInformation.join(' ').trim()
    : tx.transactionInformation;

  const parts = [txInfo, tx.description, tx.payeeDetails?.name, tx.merchantName]
    .filter(p => p && String(p).trim());

  // Deduplicate adjacent identical values (case-insensitive)
  const unique = parts.filter((p, i) =>
    i === 0 || String(p).toLowerCase() !== String(parts[i - 1]).toLowerCase()
  );
  return unique.join(' — ').slice(0, 255) || 'Bank Transaction';
}

// ── Rules engine — exact copy of applyRules / preCleanDesc from App.jsx ───────
function preCleanDesc(raw) {
  let s = (raw || '').trim();
  s = s.replace(/^(VDP-|VDC-|VDA-|VDP |VDC |VDA |D\/D |DD )/i, '').trim();
  s = s.replace(/^\*/, '').trim();
  s = s.replace(/\s*TxnDate:.*$/i, '').trim();
  s = s.replace(/\bIE\d{2}[A-Z0-9]+\b.*$/i, '').trim();
  s = s.replace(/\s*\*\d{4}\b.*$/, '').trim();
  s = s.replace(/\s+\d{2}[A-Z]{3}\d{2,4}(\s+\d{2}:\d{2})?$/i, '').trim();
  return s.toLowerCase();
}

function applyRules(description, amount, rules) {
  const rawLower   = (description || '').toLowerCase();
  const cleanLower = preCleanDesc(description);
  const isIncome   = amount > 0;

  const MATCH_RANK  = { exact: 0, startswith: 1, contains: 2, regex: 3 };
  const SOURCE_RANK = { user: 0, learned: 1, system: 2 };

  const sorted = [...rules].sort((a, b) => {
    const src = (SOURCE_RANK[a.source] ?? 2) - (SOURCE_RANK[b.source] ?? 2);
    if (src !== 0) return src;
    const mt = (MATCH_RANK[a.match_type] ?? 2) - (MATCH_RANK[b.match_type] ?? 2);
    if (mt !== 0) return mt;
    return b.pattern.length - a.pattern.length; // longer = more specific
  });

  for (const rule of sorted) {
    if (rule.direction === 'in'  && !isIncome) continue;
    if (rule.direction === 'out' &&  isIncome) continue;
    const p = rule.pattern.toLowerCase();
    let hit = false;
    try {
      switch (rule.match_type) {
        case 'exact':      hit = rawLower === p || cleanLower === p; break;
        case 'startswith': hit = rawLower.startsWith(p) || cleanLower.startsWith(p); break;
        case 'regex': { const rx = new RegExp(rule.pattern, 'i'); hit = rx.test(rawLower) || rx.test(cleanLower); break; }
        default:           hit = rawLower.includes(p) || cleanLower.includes(p);
      }
    } catch (_) { /* invalid regex — skip */ }
    if (hit) return rule;
  }
  return null;
}

// VAT codes the app recognises app-wide (matches COA_VAT_LABELS in src/App.jsx) — used to
// validate client-supplied overrides before they touch the ledger.
const KNOWN_VAT_CODES = new Set(['STD23', 'RED13', 'RED9', 'ZERO', 'EXEMPT', 'NONE', 'RCT', 'RC_EU']);

// ── Main handler ──────────────────────────────────────────────────────────────
export default withSentry(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: 'Supabase not configured' });

  const {
    company_id,
    allow_pending = false,
    dry_run       = false,
    limit         = null,         // only import first N new EUR transactions after dedup
    // Preview-edit overrides keyed by extId → { nominal_code, vat_code, save_rule }. Only
    // consulted when !dry_run — these are the values the user corrected in the Preview UI
    // and are the source of truth for what actually posts (see step 13 below).
    overrides     = {},
    // Optional 'YYYY-MM-DD' — user-set lower bound for a clean migration off prior CSV
    // history (e.g. "only import from the day after my last CSV row"). A convenience filter
    // on top of dedup, not a replacement for it — dedup (step 7/7b below) always runs
    // regardless of this being set.
    import_from   = null,
  } = req.body ?? {};

  if (!company_id) return res.status(400).json({ error: 'company_id required' });

  const db = createClient(supabaseUrl, serviceKey);

  // ── 1. Active bank connection ─────────────────────────────────────────────────
  const { data: conn, error: connErr } = await db
    .from('bank_connections')
    .select('id, yapily_consent_token, institution_id, consent_expires_at')
    .eq('company_id', company_id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (connErr) {
    captureError(connErr, { company_id, operation: 'yapily-ingest-conn' });
    return res.status(500).json({ error: connErr.message });
  }
  if (!conn) return res.status(404).json({ error: 'No active bank connection for this company' });
  if (conn.consent_expires_at && new Date(conn.consent_expires_at) < new Date()) {
    await db.from('bank_connections').update({ status: 'expired', updated_at: new Date().toISOString() }).eq('id', conn.id);
    return res.status(403).json({ error: 'Bank connection has expired — please reconnect' });
  }

  // Decrypt the consent token — it's stored encrypted (AES-256-GCM).
  // Hard-fails on plaintext values so they can never silently be used.
  let consentToken;
  try {
    consentToken = decryptToken(conn.yapily_consent_token);
  } catch (decErr) {
    captureError(decErr, { company_id, operation: 'yapily-ingest-decrypt' });
    return res.status(500).json({ error: 'Could not decrypt bank token — ' + decErr.message });
  }

  // ── 2. Fetch accounts ─────────────────────────────────────────────────────────
  const { ok: acctOk, status: acctStatus, data: acctData } = await yapilyGet('/accounts', consentToken);
  if (!acctOk) {
    return res.status(502).json({ error: acctData?.message || `Yapily accounts error ${acctStatus}` });
  }
  const accounts = acctData?.data ?? acctData ?? [];
  if (!accounts.length) {
    return res.status(200).json({ imported: 0, skipped: 0, message: 'No accounts on this connection' });
  }

  // ── 3. Fetch transactions across all accounts (90 days) ───────────────────────
  // AIB's real Open Banking rail rejects a date-only `from` ("2026-06-16") as invalid —
  // confirmed via the actual Yapily error body: "Pagination filter provided [from] with
  // invalid date... Date should be in valid ISO 8601 format." Revolut's aggregator tolerates
  // the truncated date; AIB enforces the full ISO 8601 datetime. Send the untruncated
  // .toISOString() value to Yapily; keep the date-only form only for user-facing display.
  const windowStart = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  // import_from narrows the fetch window when it's later than the 90-day default (no point
  // asking Yapily for history we're only going to filter back out below); it can only move
  // the window forward, never extend it earlier than what Yapily itself allows.
  const importFromValid = /^\d{4}-\d{2}-\d{2}$/.test(import_from || '') ? import_from : null;
  const importFromMs    = importFromValid ? new Date(`${importFromValid}T00:00:00.000Z`).getTime() : null;
  const effectiveStart  = (importFromMs && importFromMs > windowStart.getTime()) ? new Date(importFromMs) : windowStart;
  const fromDateTime = effectiveStart.toISOString();
  const fromDate      = fromDateTime.slice(0, 10); // display-only — "90-day window from ..." / effective start
  const rawTxns  = [];
  const accountErrors = []; // { account_id, status, message, issues, body } — for real institutions
                             // like AIB that reject this call, the status code alone tells you
                             // nothing; the body (data.message / data.issues) is what actually
                             // explains why. Previously discarded entirely (console.warn + continue),
                             // which is why an AIB-specific 400 was invisible until traced live.

  for (const account of accounts) {
    const { ok, status: s, data } = await yapilyGet(
      `/accounts/${account.id}/transactions?from=${encodeURIComponent(fromDateTime)}&limit=500`,
      consentToken,
    );
    if (!ok) {
      const errInfo = {
        account_id: account.id,
        status:     s,
        message:    data?.message ?? null,
        issues:     data?.issues ?? null,
        body:       data ?? null,
      };
      accountErrors.push(errInfo);
      console.error(`[yapily/ingest] transactions failed for account ${account.id}: HTTP ${s}`, JSON.stringify(data));
      captureError(new Error(`Yapily transactions fetch failed: HTTP ${s} for account ${account.id}`), {
        company_id, operation: 'yapily-ingest-transactions', account_id: account.id,
        status: s, yapily_body: data,
      });
      continue;
    }
    for (const tx of (data?.data ?? data ?? [])) {
      rawTxns.push({ tx, accountCurrency: account.currency });
    }
  }
  console.log(`[yapily/ingest] fetched ${rawTxns.length} raw across ${accounts.length} accounts (${accountErrors.length} account(s) errored)`);

  // If EVERY account's transactions call failed, this is a real fetch failure, not "no
  // transactions" — surface it as an actual error instead of falling through to the generic
  // zero-results message below, which would misreport a hard failure as an empty, healthy feed.
  if (accountErrors.length > 0 && accountErrors.length === accounts.length) {
    return res.status(502).json({
      error: `Yapily rejected the transactions request for all ${accounts.length} account(s) — HTTP ${accountErrors[0].status}: ${accountErrors[0].message || 'no message returned'}`,
      account_errors: accountErrors,
    });
  }

  // ── 4. Filter: BOOKED only (or PENDING when allow_pending) ───────────────────
  const allowed = allow_pending ? ['BOOKED', 'PENDING'] : ['BOOKED'];
  const statusFiltered = rawTxns.filter(({ tx }) =>
    allowed.includes((tx.status ?? '').toUpperCase())
  );
  const pendingSkipped = rawTxns.length - statusFiltered.length;

  if (!statusFiltered.length) {
    return res.status(200).json({
      imported: 0, skipped: 0, pending_skipped: pendingSkipped,
      message: allow_pending
        ? 'No transactions returned by Yapily'
        : 'No BOOKED transactions — sandbox only returns PENDING. Retry with allow_pending:true.',
      // Present when some (but not all) accounts errored — the accounts that DID succeed
      // genuinely had zero matching transactions, but this failure shouldn't be silent either.
      ...(accountErrors.length ? { account_errors: accountErrors } : {}),
    });
  }

  // ── 5. Map to ledger shape ────────────────────────────────────────────────────
  const allMapped = statusFiltered.map(({ tx, accountCurrency }) => {
    const amount   = extractAmount(tx);
    const currency = extractCurrency(tx, accountCurrency);
    const date     = (tx.bookingDateTime ?? tx.date ?? '').slice(0, 10);
    const desc     = buildDescription(tx);
    const extId    = tx.id || tx.transactionHash || null;
    return { extId, date, description: desc, amount, currency };
  })
    .filter(r => r.extId && r.date) // drop any with no stable ID or date
    // Defensive: import_from is a convenience bound on what gets IMPORTED, independent of
    // (and enforced regardless of) exactly what Yapily's from= param happened to return.
    .filter(r => !importFromValid || r.date >= importFromValid);

  // ── 6. CURRENCY GUARD — non-EUR transactions are skipped, not posted ──────────
  // The journals table has no currency column; amount is implicitly EUR.
  // Posting GBP/USD amounts as EUR would corrupt the ledger.
  const eurMapped     = allMapped.filter(r => !r.currency || r.currency === 'EUR');
  const foreignSkipped = allMapped
    .filter(r => r.currency && r.currency !== 'EUR')
    .map(r => ({ extId: r.extId, date: r.date, description: r.description, amount: r.amount, currency: r.currency }));

  if (foreignSkipped.length) {
    console.warn(`[yapily/ingest] skipping ${foreignSkipped.length} non-EUR transactions`);
  }

  // ── 7. Dedup (Tier 1 — exact id): skip any tx.id already in bank_transactions.revolut_id ──
  // revolut_id is the external-ID column regardless of import source (legacy name). Cheap and
  // exact — catches same-source re-imports (e.g. re-running the feed, or a repeat Preview).
  // Does NOT catch cross-source overlap: a CSV import's revolut_id is a synthetic hash
  // (aibHash(date|desc|amount|rowIndex) in App.jsx's parseAIBCSV) in a completely different
  // namespace from Yapily's own tx.id — the two will never collide even for the identical
  // real-world transaction. That's what Tier 2 below is for.
  const candidateIds = eurMapped.map(r => r.extId);
  const { data: existingById } = await db
    .from('bank_transactions')
    .select('revolut_id')
    .eq('company_id', company_id)
    .in('revolut_id', candidateIds);

  const existingIds   = new Set((existingById ?? []).map(r => r.revolut_id));
  const afterIdDedup   = eurMapped.filter(r => !existingIds.has(r.extId));
  const idDupCount     = eurMapped.length - afterIdDedup.length;

  // ── 7b. Dedup (Tier 2 — cross-source content match): date + amount + similar description ──
  // Catches the case Tier 1 structurally cannot: the same real transaction already sitting in
  // the ledger from a prior CSV import. Matched on attributes any source reliably has (date,
  // amount, description) rather than a source-specific id. Requires an EXACT date+amount match
  // (the strong signal) before even looking at description — two genuinely different €50
  // payments on the same day only collide here if their descriptions are also similar.
  const uniqueDates = [...new Set(afterIdDedup.map(r => r.date))];
  let crossSourceDupes = [];
  if (uniqueDates.length) {
    const { data: sameDateExisting } = await db
      .from('bank_transactions')
      .select('date, amount, description, revolut_id, bank_format')
      .eq('company_id', company_id)
      .in('date', uniqueDates);

    const byDateAmount = new Map(); // "date|amount" → existing rows
    for (const row of (sameDateExisting ?? [])) {
      const key = `${row.date}|${Number(row.amount).toFixed(2)}`;
      if (!byDateAmount.has(key)) byDateAmount.set(key, []);
      byDateAmount.get(key).push(row);
    }

    crossSourceDupes = afterIdDedup
      .map(r => {
        const key = `${r.date}|${Number(r.amount).toFixed(2)}`;
        const candidates = byDateAmount.get(key) ?? [];
        const match = candidates.find(c => descriptionsLikelyMatch(c.description, r.description));
        return match ? { ...r, matched_revolut_id: match.revolut_id, matched_bank_format: match.bank_format } : null;
      })
      .filter(Boolean);
  }
  const crossSourceIds = new Set(crossSourceDupes.map(d => d.extId));
  const newTxns        = afterIdDedup.filter(r => !crossSourceIds.has(r.extId));
  const crossSourceDupCount = crossSourceDupes.length;
  const dupCount             = idDupCount + crossSourceDupCount; // combined "already in ledger"

  console.log(`[yapily/ingest] ${newTxns.length} new EUR, ${dupCount} dupes (${idDupCount} same-source id, ${crossSourceDupCount} cross-source content match), ${foreignSkipped.length} foreign`);
  if (crossSourceDupCount) {
    console.log('[yapily/ingest] cross-source duplicates (skipped):', JSON.stringify(crossSourceDupes.map(d => ({ date: d.date, amount: d.amount, description: d.description, matched_bank_format: d.matched_bank_format }))));
  }

  if (!newTxns.length) {
    return res.status(200).json({
      dry_run,
      imported:              0,
      skipped:               dupCount,
      cross_source_skipped:  crossSourceDupCount,
      cross_source_details:  crossSourceDupes,
      pending_skipped:       pendingSkipped,
      foreign_skipped:       foreignSkipped.length,
      foreign_details:       foreignSkipped,
      from_date:             fromDate,
      message:               'All EUR transactions already imported — feed is up to date.',
    });
  }

  // ── 8. Apply limit (dry_run preview can show all; real import respects limit) ─
  const toProcess = (limit && !dry_run) ? newTxns.slice(0, limit) : newTxns;
  const limitedOut = newTxns.length - toProcess.length;

  // ── 9. Rules + chart of accounts (parallel) ───────────────────────────────────
  // REQUIRES: service_role must have SELECT on these tables.
  //   Run: GRANT SELECT ON public.transaction_rules TO service_role;
  //        GRANT SELECT ON public.chart_of_accounts TO service_role;
  // Without these grants, queries return null/permission-denied and txRules/coaMap
  // become empty — silently producing Sundry (6600) and null VAT on every transaction.
  const [rulesRes, coaRes] = await Promise.all([
    db.from('transaction_rules')
      .select('pattern, match_type, direction, nominal_code, nominal_name, vat_code, confidence, source, is_active')
      .or(`company_id.eq.${company_id},company_id.is.null`)
      .eq('is_active', true),
    db.from('chart_of_accounts')
      .select('code, name, default_vat_code')
      .eq('company_id', company_id),
  ]);

  if (rulesRes.error) {
    // Permission denied → all transactions fall through to AI → Sundry.
    // Fix: GRANT SELECT ON public.transaction_rules TO service_role
    captureError(rulesRes.error, { company_id, operation: 'yapily-ingest-rules-read' });
    console.error('[yapily/ingest] RULES READ FAILED — all transactions will use AI defaults:', rulesRes.error.message, '| code:', rulesRes.error.code);
  }
  if (coaRes.error) {
    // Permission denied → coaMap empty → vat_code null on every journal.
    // Fix: GRANT SELECT ON public.chart_of_accounts TO service_role
    captureError(coaRes.error, { company_id, operation: 'yapily-ingest-coa-read' });
    console.error('[yapily/ingest] COA READ FAILED — all journals will have null vat_code:', coaRes.error.message, '| code:', coaRes.error.code);
  }

  const txRules = rulesRes.data ?? [];
  const coaMap  = Object.fromEntries((coaRes.data ?? []).map(r => [r.code, { name: r.name, vat: r.default_vat_code }]));

  console.log(`[yapily/ingest] rules loaded: ${txRules.length} | COA loaded: ${Object.keys(coaMap).length} accounts`);

  // ── 10. Categorise: rules first, AI fallback for remainder ───────────────────
  const nominals     = {};  // extId → nominal_code
  const nominalNames = {};  // extId → nominal_name
  const vats         = {};  // extId → vat_code override from a matched rule (else falls back to coaMap default)

  const needAI = toProcess.filter(row => {
    const matched = applyRules(row.description, row.amount, txRules);
    if (matched) {
      nominals[row.extId]     = matched.nominal_code;
      nominalNames[row.extId] = matched.nominal_name || coaMap[matched.nominal_code]?.name || matched.nominal_code;
      if (matched.vat_code) vats[row.extId] = matched.vat_code;
      return false;
    }
    // Default pending AI
    const defaultCode = row.amount >= 0 ? '4100' : '6600';
    nominals[row.extId]     = defaultCode;
    nominalNames[row.extId] = coaMap[defaultCode]?.name || defaultCode;
    return true;
  });

  console.log(`[yapily/ingest] rules: ${toProcess.length - needAI.length} matched, ${needAI.length} → AI`);

  if (needAI.length) {
    const payeeMap = {};
    for (const row of needAI) {
      const key = preCleanDesc(row.description) || row.description.toLowerCase().slice(0, 40);
      if (!payeeMap[key]) payeeMap[key] = { key, name: row.description, count: 0, total: 0, pos: 0 };
      payeeMap[key].count++;
      payeeMap[key].total += row.amount;
      if (row.amount > 0) payeeMap[key].pos++;
    }
    const uniquePayees = Object.values(payeeMap).map(p => ({
      key: p.key, name: p.name, count: p.count,
      totalAmount: Math.round(p.total * 100) / 100,
      direction: p.pos > p.count / 2 ? 'income' : 'expense',
    }));

    try {
      const proto  = req.headers['x-forwarded-proto'] || 'https';
      const host   = req.headers['x-forwarded-host'] || req.headers.host;
      const catRes = await fetch(`${proto}://${host}/api/categorise`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ payees: uniquePayees }),
      });
      if (catRes.ok) {
        const { results } = await catRes.json();
        const aiMap = Object.fromEntries(results.map(r => [r.key, r.code]));
        for (const row of needAI) {
          const key = preCleanDesc(row.description) || row.description.toLowerCase().slice(0, 40);
          if (aiMap[key]) {
            nominals[row.extId]     = aiMap[key];
            nominalNames[row.extId] = coaMap[aiMap[key]]?.name || aiMap[key];
          }
        }
        console.log(`[yapily/ingest] AI categorised ${results.length} unique payees`);
      } else {
        console.warn(`[yapily/ingest] AI categorise failed ${catRes.status} — defaults kept`);
      }
    } catch (aiErr) {
      captureError(aiErr, { company_id, operation: 'yapily-ingest-categorise' });
      console.warn('[yapily/ingest] AI categorise threw:', aiErr.message, '— defaults kept');
    }
  }

  // ── 11. Build preview (always) ────────────────────────────────────────────────
  const preview = toProcess.map(row => {
    const nominal = nominals[row.extId] || (row.amount >= 0 ? '4100' : '6600');
    const vatCode = vats[row.extId] ?? coaMap[nominal]?.vat ?? null;
    return {
      extId:        row.extId,
      date:         row.date,
      description:  row.description,
      amount:       row.amount,
      currency:     row.currency,
      is_income:    row.amount >= 0,
      nominal_code: nominal,
      nominal_name: nominalNames[row.extId] || coaMap[nominal]?.name || nominal,
      vat_code:     vatCode,
    };
  });

  // ── 12. DRY RUN — return preview without posting ──────────────────────────────
  if (dry_run) {
    console.log(`[yapily/ingest] dry_run — previewing ${preview.length} transactions`);
    return res.status(200).json({
      dry_run:              true,
      preview,
      total_new:            newTxns.length,      // total available to import
      showing:              preview.length,
      skipped:              dupCount,
      cross_source_skipped: crossSourceDupCount,
      cross_source_details: crossSourceDupes,
      pending_skipped:      pendingSkipped,
      foreign_skipped:      foreignSkipped.length,
      foreign_details:      foreignSkipped,
      from_date:            fromDate,
      import_from:          importFromValid,
      accounts:             accounts.length,
      ...(accountErrors.length ? { account_errors: accountErrors } : {}),
    });
  }

  // ── 13. Apply preview-edit overrides — these are the source of truth for what posts ──
  // The client sends back the exact nominal/VAT it showed in the Preview (edited or not),
  // keyed by extId. Validate each override against the real COA / known VAT codes before
  // trusting it — an unrecognised code falls back to the freshly-computed rules/AI value
  // rather than corrupting the ledger.
  const finalNominals = {};
  const finalVats     = {};
  const rulesToSave   = []; // rows where the user opted in to "save rule for this payee"

  for (const row of toProcess) {
    const computedNominal = nominals[row.extId] || (row.amount >= 0 ? '4100' : '6600');
    const computedVat     = vats[row.extId] ?? coaMap[computedNominal]?.vat ?? null;

    let finalNominal = computedNominal;
    let finalVat      = computedVat;

    const ov = overrides?.[row.extId];
    if (ov) {
      if (ov.nominal_code && coaMap[ov.nominal_code]) finalNominal = ov.nominal_code;
      else if (ov.nominal_code) console.warn('[yapily/ingest] ignoring override with unknown nominal_code:', ov.nominal_code, '| extId:', row.extId);

      if (ov.vat_code === null) finalVat = null;
      else if (ov.vat_code && KNOWN_VAT_CODES.has(ov.vat_code)) finalVat = ov.vat_code;
      else if (ov.vat_code) console.warn('[yapily/ingest] ignoring override with unknown vat_code:', ov.vat_code, '| extId:', row.extId);

      if (ov.save_rule) rulesToSave.push({ row, nominal: finalNominal, vat: finalVat });
    }

    finalNominals[row.extId] = finalNominal;
    finalVats[row.extId]     = finalVat;
  }

  // ── 13b. AP-bill suppression — don't blind-post a payment that might already belong to
  // an open AP bill. Amount is the primary, dominant signal (bank-feed payee text is too
  // noisy to lead on); date proximity is a secondary filter to avoid suppressing on a
  // coincidental match against a long-stale bill. This is deliberately amount-tolerant
  // (€0.50, matching the app's existing settlement tolerance) rather than exact-only —
  // the point is to catch plausible matches, not just perfect ones. Suppressed
  // transactions get no journal and stay unreconciled; the existing Reconciliation
  // matching engine (which already scores ap_invoices candidates) picks them up from
  // there — this reuses that machinery rather than duplicating it.
  const AP_SUPPRESS_AMOUNT_TOLERANCE = 0.50;
  const AP_SUPPRESS_DATE_WINDOW_DAYS = 30;

  const { data: openApBills } = await db
    .from('ap_invoices')
    .select('id, gross_amount, amount, amount_paid, invoice_date')
    .eq('company_id', company_id)
    .in('status', ['pending', 'approved', 'part_paid']);

  const openBillOutstanding = (openApBills ?? [])
    .map(b => ({
      id: b.id,
      outstanding: Number(b.gross_amount ?? b.amount ?? 0) - Number(b.amount_paid ?? 0),
      date: b.invoice_date,
    }))
    .filter(b => b.outstanding > 0.005);

  const suppressedExtIds = new Set();
  if (openBillOutstanding.length) {
    for (const row of toProcess) {
      if (row.amount >= 0) continue; // only outgoing payments can be paying a bill
      const absAmt = Math.abs(row.amount);
      const plausible = openBillOutstanding.some(b => {
        if (Math.abs(absAmt - b.outstanding) > AP_SUPPRESS_AMOUNT_TOLERANCE) return false;
        if (!b.date) return true; // no date on the bill — amount match alone is enough to be cautious
        const days = Math.abs(new Date(row.date) - new Date(b.date)) / 86400000;
        return days <= AP_SUPPRESS_DATE_WINDOW_DAYS;
      });
      if (plausible) suppressedExtIds.add(row.extId);
    }
  }
  if (suppressedExtIds.size) {
    console.log(`[yapily/ingest] suppressing ${suppressedExtIds.size} transaction(s) — plausible open AP bill match, routing to Reconciliation instead of auto-posting`);
  }

  // ── 14. Build journal + bank_transaction rows and INSERT ──────────────────────
  const batchId = crypto.randomUUID();
  const now     = new Date().toISOString();

  const journals = toProcess
    .filter(row => !suppressedExtIds.has(row.extId))
    .map(row => {
      const nominal = finalNominals[row.extId];
      const isIn    = row.amount >= 0;
      return {
        company_id,
        date:                row.date,
        description:         row.description,
        reference:           row.extId,
        debit_account:       isIn ? '1000' : nominal,
        credit_account:      isIn ? nominal : '1000',
        amount:              Math.abs(row.amount),
        vat_code:            finalVats[row.extId],
        import_batch_id:     batchId,
        source_recurring_id: null,
        is_accrual_reversal: false,
      };
    });

  const btRows = toProcess.map(row => {
    const suppressed = suppressedExtIds.has(row.extId);
    return {
      company_id,
      revolut_id:      row.extId,
      date:            row.date,
      description:     row.description,
      amount:          row.amount,
      currency:        row.currency,
      balance:         null,
      nominal_account: suppressed ? null : finalNominals[row.extId],
      bank_format:     'yapily',
      import_batch_id: batchId,
      reconciled:      !suppressed,
      reconciled_at:   suppressed ? null : now,
    };
  });

  const { data: insertedJournals, error: jErr } = await db
    .from('journals').insert(journals).select('id, reference');
  if (jErr) {
    captureError(jErr, { company_id, operation: 'yapily-ingest-journals' });
    return res.status(500).json({ error: 'Journal insert failed: ' + jErr.message });
  }

  const { data: insertedBts, error: btErr } = await db
    .from('bank_transactions').insert(btRows).select('id, revolut_id');
  if (btErr) {
    captureError(btErr, { company_id, operation: 'yapily-ingest-bank-txns' });
    return res.status(500).json({ error: 'Bank transaction insert failed: ' + btErr.message });
  }

  // bank_matches — non-fatal (mirrors CSV import behaviour)
  if (insertedJournals?.length && insertedBts?.length) {
    const btByRef = Object.fromEntries(insertedBts.map(bt => [bt.revolut_id, bt.id]));
    const matchRows = insertedJournals
      .map(j => {
        const btId = btByRef[j.reference];
        return btId ? {
          company_id,
          bank_transaction_id: btId,
          matched_type:        'journal',
          matched_id:          j.id,
          confidence:          100,
          status:              'confirmed',
          matched_by:          'auto',
          confirmed_at:        now,
        } : null;
      })
      .filter(Boolean);

    if (matchRows.length) {
      const { error: mErr } = await db.from('bank_matches').insert(matchRows);
      if (mErr) console.warn('[yapily/ingest] bank_matches insert skipped:', mErr.message);
    }
  }

  await db.from('bank_connections').update({ updated_at: now }).eq('id', conn.id);

  // ── 15. Save opt-in rules from corrected rows — REUSES transaction_rules, the same
  // table/structure the categorisation pipeline (feed AND CSV) reads from. Never auto-created:
  // only rows where the user explicitly checked "save rule for this payee". Non-fatal — a rule
  // save failure must not undo an already-posted import.
  let rulesSaved = 0;
  if (rulesToSave.length) {
    // Dedup within this batch — multiple rows for the same payee/direction collapse to one rule.
    const byKey = {};
    for (const { row, nominal, vat } of rulesToSave) {
      const isIncome = row.amount >= 0;
      const pattern  = preCleanDesc(row.description) || row.description.toLowerCase().slice(0, 60);
      if (!pattern) continue;
      byKey[`${pattern}::${isIncome ? 'in' : 'out'}`] = {
        company_id,
        pattern,
        match_type:   'contains',
        direction:    isIncome ? 'in' : 'out',
        nominal_code: nominal,
        nominal_name: coaMap[nominal]?.name || nominal,
        vat_code:     vat,
        confidence:   'high',
        source:       'user',
        created_from: 'learned',
        is_active:    true,
      };
    }

    for (const ruleRow of Object.values(byKey)) {
      const { error: insErr } = await db.from('transaction_rules').insert(ruleRow);
      if (!insErr) { rulesSaved++; continue; }
      if (insErr.code === '23505') {
        // Rule for this payee/direction already exists — update it rather than duplicate.
        const { error: updErr } = await db.from('transaction_rules')
          .update({
            nominal_code: ruleRow.nominal_code,
            nominal_name: ruleRow.nominal_name,
            vat_code:     ruleRow.vat_code,
            confidence:   'high',
            source:       'user',
            created_from: 'learned',
            is_active:    true,
          })
          .eq('company_id', company_id).eq('pattern', ruleRow.pattern).eq('direction', ruleRow.direction);
        if (updErr) {
          captureError(updErr, { company_id, operation: 'yapily-ingest-rule-update' });
          console.warn('[yapily/ingest] rule update failed for pattern', ruleRow.pattern, ':', updErr.message);
        } else {
          rulesSaved++;
        }
      } else {
        captureError(insErr, { company_id, operation: 'yapily-ingest-rule-insert' });
        console.warn('[yapily/ingest] rule insert failed for pattern', ruleRow.pattern, ':', insErr.message);
      }
    }
    console.log(`[yapily/ingest] saved ${rulesSaved} rule(s) from user corrections`);
  }

  console.log(`[yapily/ingest] done — imported ${toProcess.length}, skipped ${dupCount} dupes, ${foreignSkipped.length} foreign, ${pendingSkipped} pending`);

  return res.status(200).json({
    dry_run:              false,
    imported:             toProcess.length,
    limited_out:          limitedOut,       // how many were held back by the limit
    skipped:              dupCount,
    cross_source_skipped: crossSourceDupCount,
    cross_source_details: crossSourceDupes,
    pending_skipped:      pendingSkipped,
    foreign_skipped:      foreignSkipped.length,
    foreign_details:      foreignSkipped,
    batch_id:             batchId,
    accounts:             accounts.length,
    from_date:            fromDate,
    import_from:          importFromValid,
    rules_saved:          rulesSaved,
    ...(accountErrors.length ? { account_errors: accountErrors } : {}),
  });
});
