// POST /api/resolve-pending-access
// Synchronously resolves any pending_business_owner_invites for the CALLING user, instead
// of relying solely on the async Clerk organizationMembership.created webhook (api/clerk/
// webhook.js) to write user_company_access. Without this, a user who lands in the app
// right after accepting an invite can hit a window where the webhook hasn't landed yet —
// the app sees zero companies, guesses "brand new accountant", and shows the create-company
// wizard (which can create a real phantom company if they proceed through step 1).
//
// Security: the match is against the caller's own Clerk-VERIFIED email address(es), fetched
// server-side from Clerk using the userId out of their verified session token — never a
// client-supplied email. A pending_business_owner_invites row only ever exists because an
// accountant called the authenticated /api/invite-business-owner flow for that exact email,
// so this endpoint cannot be used to self-grant access to an arbitrary company.
//
// Idempotent — safe to call on every load. No-ops if there's nothing pending (already
// resolved by this endpoint or by the webhook).
import { verifyToken } from '@clerk/backend';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing Authorization token' });

  const secretKey   = process.env.CLERK_SECRET_KEY?.trim();
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!secretKey || !supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  let userId;
  try {
    const payload = await verifyToken(token, { secretKey });
    userId = payload?.sub;
  } catch {
    return res.status(401).json({ error: 'Invalid session token' });
  }
  if (!userId) return res.status(401).json({ error: 'Invalid session token' });

  // Fetch the caller's own verified email addresses from Clerk directly — not trusted
  // from the client — same REST pattern already used in api/invite-business-owner.js.
  let verifiedEmails = [];
  try {
    const userRes = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    if (!userRes.ok) return res.status(502).json({ error: 'Could not verify caller identity' });
    const userData = await userRes.json();
    verifiedEmails = (userData.email_addresses || [])
      .filter(e => e.verification?.status === 'verified')
      .map(e => e.email_address.toLowerCase());
  } catch (e) {
    return res.status(502).json({ error: 'Could not verify caller identity: ' + e.message });
  }

  if (verifiedEmails.length === 0) {
    return res.status(200).json({ resolved: [] });
  }

  const db = createClient(supabaseUrl, serviceKey);

  const { data: pending, error: pendingErr } = await db
    .from('pending_business_owner_invites')
    .select('id, company_id')
    .in('email', verifiedEmails);
  if (pendingErr) return res.status(500).json({ error: pendingErr.message });
  if (!pending || pending.length === 0) return res.status(200).json({ resolved: [] });

  const resolved = [];
  for (const inv of pending) {
    const { error: upsertErr } = await db
      .from('user_company_access')
      .upsert({ user_id: userId, company_id: inv.company_id, role: 'business_owner' }, { onConflict: 'user_id,company_id' });
    if (upsertErr) continue; // leave the pending row for the next call/webhook to retry
    await db.from('pending_business_owner_invites').delete().eq('id', inv.id);
    resolved.push(inv.company_id);
  }

  return res.status(200).json({ resolved });
}
