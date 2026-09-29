import { requireAccountant, companyOrgId, AuthError } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Any orgId in the body is deliberately ignored — the org is derived from the verified
  // company (companyOrgId), so an accountant can only ever invite into their own company's org.
  const { companyId, emailAddress, role } = req.body ?? {};
  if (!companyId || !emailAddress) {
    return res.status(400).json({ error: 'companyId and emailAddress required' });
  }

  let orgId;
  try {
    await requireAccountant(req, companyId);
    orgId = await companyOrgId(companyId);
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    throw e;
  }

  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  if (!secretKey) return res.status(500).json({ error: 'CLERK_SECRET_KEY not configured' });

  const clerkRole = role === 'admin' ? 'org:admin' : 'org:member';

  const invRes = await fetch(`https://api.clerk.com/v1/organizations/${orgId}/invitations`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email_address: emailAddress, role: clerkRole }),
  });

  const data = await invRes.json();
  if (!invRes.ok) {
    return res.status(400).json({ error: data.errors?.[0]?.long_message || data.errors?.[0]?.message || 'Invitation failed' });
  }

  res.status(200).json({ status: data.status, id: data.id });
}
