// POST /api/invite-business-owner
// Invites a business_owner (client) to a company — distinct from invite-user.js, which
// invites accountant colleagues. Clerk's own admin/member role is not used to carry this
// distinction (see api/_auth.js) — instead this records a pending_business_owner_invites
// row keyed on (company_id, email), which api/clerk/webhook.js consults when the
// invitation is accepted (organizationMembership.created) to set
// user_company_access.role = 'business_owner' rather than the 'accountant' default.
import { createClient } from '@supabase/supabase-js';
import { requireAccountant, AuthError } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { companyId, orgId, emailAddress } = req.body ?? {};
  if (!companyId || !orgId || !emailAddress) {
    return res.status(400).json({ error: 'companyId, orgId and emailAddress required' });
  }

  let accountantId;
  try {
    accountantId = await requireAccountant(req, companyId);
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    throw e;
  }

  const secretKey     = process.env.CLERK_SECRET_KEY?.trim();
  const supabaseUrl   = process.env.SUPABASE_URL?.trim();
  const serviceKey    = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!secretKey || !supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  const db = createClient(supabaseUrl, serviceKey);
  const normalisedEmail = emailAddress.trim().toLowerCase();

  // Record the pending invite BEFORE calling Clerk — the webhook needs this row to be
  // able to classify the eventual organizationMembership.created event as a business
  // owner (rather than defaulting to 'accountant').
  const { error: pendingErr } = await db
    .from('pending_business_owner_invites')
    .upsert(
      { company_id: companyId, email: normalisedEmail, invited_by: accountantId },
      { onConflict: 'company_id,email' },
    );
  if (pendingErr) {
    return res.status(500).json({ error: 'Failed to record pending invite: ' + pendingErr.message });
  }

  // Clerk's own role is irrelevant here (the app-level role lives in
  // user_company_access, not Clerk) — 'org:member' is used only because it's the
  // lower-privilege Clerk-native option, never surfaced to the business owner.
  const invRes = await fetch(`https://api.clerk.com/v1/organizations/${orgId}/invitations`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email_address: normalisedEmail, role: 'org:member' }),
  });

  const data = await invRes.json();
  if (!invRes.ok) {
    // Roll back the pending-invite row so a failed Clerk invite doesn't leave a
    // dangling entry that could misclassify some unrelated future membership.
    await db.from('pending_business_owner_invites')
      .delete().eq('company_id', companyId).eq('email', normalisedEmail);
    return res.status(400).json({ error: data.errors?.[0]?.long_message || data.errors?.[0]?.message || 'Invitation failed' });
  }

  res.status(200).json({ status: data.status, id: data.id });
}
