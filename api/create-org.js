export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { companyId, companyName, userId } = req.body;
  if (!companyId || !companyName || !userId) {
    return res.status(400).json({ error: 'companyId, companyName, userId required' });
  }

  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  if (!secretKey) return res.status(500).json({ error: 'CLERK_SECRET_KEY not configured' });

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

  res.status(200).json({ orgId: org.id });
}
