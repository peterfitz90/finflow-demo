// The user's role in a company's Clerk organisation — the colleague read-only distinction
// ('org:member' = read-only), unrelated to the accountant / business_owner model. Moved from the
// full app so /mobile gates admin actions (expense approval) exactly as desktop does.
// memberships = useOrganizationList({ userMemberships }).userMemberships.data
export function orgRoleFor(company, userId, memberships) {
  if (!company?.clerk_org_id) return 'owner';
  if (company.clerk_user_id === userId) return 'owner';
  const membership = (memberships || []).find(m => m.organization.id === company.clerk_org_id);
  return membership?.role || 'org:member';
}
