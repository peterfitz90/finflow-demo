import { createClient } from '@supabase/supabase-js';
import { requireAccountant, AuthError } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { companyId, companyName } = req.body;
  if (!companyId || !companyName) {
    return res.status(400).json({ error: 'companyId, companyName required' });
  }

  let userId;
  try {
    userId = await requireAccountant(req, companyId);
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    throw e;
  }

  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  if (!secretKey) return res.status(500).json({ error: 'CLERK_SECRET_KEY not configured — organisation features require server configuration' });
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: 'Supabase not configured' });
  const db = createClient(supabaseUrl, serviceKey);

  // companies.clerk_org_id is now written ONLY here, server-side (a DB trigger rejects any
  // client that tries to set or change it) — it's the binding invites and the Clerk webhook
  // trust to map an org to a company, so a client must never be able to point its own
  // company at someone else's org. One org per company: return the existing one if set.
  const { data: existing } = await db.from('companies').select('clerk_org_id').eq('id', companyId).maybeSingle();
  if (existing?.clerk_org_id) return res.status(200).json({ orgId: existing.clerk_org_id, existing: true });

  const headers = {
    'Authorization': `Bearer ${secretKey}`,
    'Content-Type': 'application/json',
  };

  // 1. Create Clerk organisation
  const orgRes = await fetch('https://api.clerk.com/v1/organizations', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: companyName }),
  });
  if (!orgRes.ok) {
    const err = await orgRes.json();
    return res.status(500).json({ error: err.errors?.[0]?.message || 'Failed to create organisation' });
  }
  const org = await orgRes.json();

  // 2. Add the creating user as org:admin
  await fetch(`https://api.clerk.com/v1/organizations/${org.id}/memberships`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ user_id: userId, role: 'org:admin' }),
  });

  // 3. Bind the org to the company — only if still unset (a concurrent call can't overwrite).
  const { data: bound, error: bindErr } = await db.from('companies')
    .update({ clerk_org_id: org.id }).eq('id', companyId).is('clerk_org_id', null).select('clerk_org_id');
  if (bindErr) return res.status(500).json({ error: 'Organisation created but could not be linked: ' + bindErr.message });
  if (!bound?.length) {
    // Lost a race — another request linked an org first. Use that one; this new org is unused.
    const { data: winner } = await db.from('companies').select('clerk_org_id').eq('id', companyId).maybeSingle();
    return res.status(200).json({ orgId: winner?.clerk_org_id ?? null, existing: true });
  }

  res.status(200).json({ orgId: org.id });
}
