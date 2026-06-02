export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { orgId } = req.query;
  if (!orgId) return res.status(400).json({ error: 'orgId required' });

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
