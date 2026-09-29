import { requireAccountant, companyOrgId, AuthError } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  // Was fully open and took ?orgId= from the caller — anyone could list the members (names,
  // emails, user ids) of any Clerk org. Now: the caller must be an accountant of companyId
  // (Settings, where this is used, is accountant-only), and the org is that company's own,
  // read server-side — an orgId in the query is ignored.
  let orgId;
  try {
    await requireAccountant(req, req.query.companyId);
    orgId = await companyOrgId(req.query.companyId);
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    throw e;
  }

  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  if (!secretKey) return res.status(500).json({ error: 'CLERK_SECRET_KEY not configured' });

  const membersRes = await fetch(
    `https://api.clerk.com/v1/organizations/${orgId}/memberships?limit=100`,
    { headers: { 'Authorization': `Bearer ${secretKey}` } }
  );

  if (!membersRes.ok) {
    return res.status(500).json({ error: 'Failed to fetch members' });
  }

  const data = await membersRes.json();
  res.status(200).json({ members: data.data || [] });
}
