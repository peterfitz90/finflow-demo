// POST /api/yapily/sync
// Fetches raw accounts + transactions from Yapily using the stored consentToken.
// Does NOT write to the ledger — returns raw data for shape inspection.
// Stores account_refs on the bank_connections row for future ingestion.
// SECURITY: consentToken lives in Supabase only; sent to Yapily from this function only.

import { createClient } from '@supabase/supabase-js';
import { withSentry, captureError } from '../_sentry.js';
import { decryptToken } from '../_token-crypto.js';

function yapilyBasicAuth() {
  const id  = process.env.YAPILY_APP_ID?.trim();
  const sec = process.env.YAPILY_APP_SECRET?.trim();
  if (!id || !sec) throw new Error('[yapily/sync] YAPILY_APP_ID or YAPILY_APP_SECRET not set');
  return 'Basic ' + Buffer.from(`${id}:${sec}`).toString('base64');
}

async function yapilyGet(path, consentToken) {
  const res  = await fetch(`https://api.yapily.com${path}`, {
    headers: {
      'Authorization': yapilyBasicAuth(),
      'Consent': consentToken,
      'Accept': 'application/json',
    },
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

export default withSentry(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: 'Supabase not configured' });

  const { company_id } = req.body ?? {};
  if (!company_id) return res.status(400).json({ error: 'company_id required' });

  const db = createClient(supabaseUrl, serviceKey);

  // Fetch the active connection for this company
  const { data: connections, error: connErr } = await db
    .from('bank_connections')
    .select('id, yapily_consent_token, institution_id, status, consent_expires_at')
    .eq('company_id', company_id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1);

  if (connErr) {
    captureError(connErr, { company_id, operation: 'yapily-sync-lookup' });
    return res.status(500).json({ error: connErr.message });
  }

  const conn = connections?.[0];
  if (!conn) return res.status(404).json({ error: 'No active bank connection for this company' });

  const { id: connId, yapily_consent_token: encryptedToken, consent_expires_at } = conn;

  // Decrypt the consent token — stored encrypted (AES-256-GCM). Hard-fails on plaintext.
  let consentToken;
  try {
    consentToken = decryptToken(encryptedToken);
  } catch (decErr) {
    captureError(decErr, { company_id, operation: 'yapily-sync-decrypt' });
    return res.status(500).json({ error: 'Could not decrypt bank token — ' + decErr.message });
  }

  // Check expiry
  if (consent_expires_at && new Date(consent_expires_at) < new Date()) {
    await db.from('bank_connections').update({ status: 'expired', updated_at: new Date().toISOString() }).eq('id', connId);
    return res.status(403).json({ error: 'Bank connection has expired — please reconnect' });
  }

  // ── Fetch accounts ────────────────────────────────────────────────────────────
  let accounts = [];
  {
    const { ok, status: s, data } = await yapilyGet('/accounts', consentToken);
    if (!ok) {
      const msg = data?.message || `Yapily accounts error ${s}`;
      console.error('[yapily/sync] accounts fetch failed:', msg);
      // Mark expired if 403
      if (s === 403) await db.from('bank_connections').update({ status: 'expired', updated_at: new Date().toISOString() }).eq('id', connId);
      return res.status(502).json({ error: msg });
    }
    accounts = data?.data ?? data ?? [];
    console.log('[yapily/sync] accounts fetched:', accounts.length);
  }

  // Store account refs on the connection row for future use
  const accountRefs = accounts.map(a => ({ id: a.id, type: a.type, name: a.name, currency: a.currency }));
  await db.from('bank_connections').update({
    account_refs: accountRefs,
    updated_at: new Date().toISOString(),
  }).eq('id', connId);

  // ── Fetch transactions for each account ──────────────────────────────────────
  // Pull 90 days of history; raw data only — no ledger posting
  const fromDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const txnsByAccount = {};

  for (const account of accounts) {
    try {
      const path = `/accounts/${account.id}/transactions?from=${fromDate}&limit=500`;
      const { ok, status: s, data } = await yapilyGet(path, consentToken);
      if (!ok) {
        console.warn(`[yapily/sync] transactions fetch failed for account ${account.id}: ${s}`, data?.message);
        txnsByAccount[account.id] = { error: data?.message || `HTTP ${s}`, transactions: [] };
      } else {
        const txns = data?.data ?? data ?? [];
        txnsByAccount[account.id] = { count: txns.length, transactions: txns };
        console.log(`[yapily/sync] account ${account.id} → ${txns.length} transactions`);
      }
    } catch (err) {
      captureError(err, { company_id, operation: 'yapily-sync-transactions', account_id: account.id });
      txnsByAccount[account.id] = { error: err.message, transactions: [] };
    }
  }

  const totalTxns = Object.values(txnsByAccount).reduce((s, v) => s + (v.transactions?.length ?? 0), 0);
  console.log('[yapily/sync] done — total raw transactions:', totalTxns);

  // Return raw data for shape inspection — do NOT post to ledger
  return res.status(200).json({
    connection_id: connId,
    institution_id: conn.institution_id,
    accounts,
    transactions_by_account: txnsByAccount,
    total_transactions: totalTxns,
    synced_from: fromDate,
    note: 'Raw data — not posted to ledger. Shape-check before building ingestion.',
  });
});
