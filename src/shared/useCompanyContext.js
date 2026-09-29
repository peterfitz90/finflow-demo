// Company / role / access resolution — shared by the desktop app (App.jsx) and the phone app
// (Mobile.jsx) so the two can't drift apart again. Moved out of App.jsx unchanged in behaviour.
//
// Mobile.jsx used to resolve its company with `companies.clerk_user_id = user.id … limit(1)`:
// owners only, first company only. A business_owner reaches their company through
// user_company_access, not ownership, so /mobile showed every business owner an empty app, and
// accountants could never switch client. This hook is the one source of truth for both.
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useUser } from '@clerk/clerk-react';
import { supabase } from '../supabase.js';
import { captureError } from '../sentry.js';
import { isAccountantFor } from './practicePortfolio.js';

// Resolves any pending business_owner invite for the CURRENTLY signed-in Clerk user
// synchronously, instead of relying solely on the async organizationMembership.created
// webhook (api/clerk/webhook.js) to have already written user_company_access by the time
// company resolution runs. Used both by the company-resolution effect below and as a
// last-ditch guard before OnboardingWizard creates a new company, so an invited user can
// never be routed into "create your own company" while their real invite is still pending.
// Best-effort — resolves to [] (not the resolved company ids) on any failure; callers fall
// through to their existing behaviour.
export async function resolvePendingAccess() {
  try {
    const token = await window.Clerk?.session?.getToken();
    if (!token) return [];
    const res = await fetch('/api/resolve-pending-access', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data?.resolved || [];
  } catch {
    return [];
  }
}

export function useCompanyContext() {
  const { user, isLoaded } = useUser();

  const [companies, setCompanies] = useState([]);
  const [company, setCompany] = useState(null);
  const [onboarding, setOnboarding] = useState(false);
  const [companyLoading, setCompanyLoading] = useState(true);

  // Accountant vs business_owner — authoritative signal is user_company_access.role via
  // this RPC (see [[user_company_role]] migration), NOT Clerk's own admin/member field,
  // which carries a different, unrelated distinction (colleague read-only).
  const [companyRole, setCompanyRole] = useState(null); // 'accountant' | 'business_owner' | null (loading)
  useEffect(() => {
    if (!company?.id) { setCompanyRole(null); return; }
    let cancelled = false;
    supabase.rpc('user_company_role', { p_company_id: company.id }).then(({ data, error }) => {
      if (cancelled) return;
      setCompanyRole(error ? null : (data || 'accountant'));
    });
    return () => { cancelled = true; };
  }, [company?.id]);
  const isBusinessOwner = companyRole === 'business_owner';

  // The user's role on every company (RLS: own user_company_access rows only; owners count as
  // accountant). Drives the Practice Dashboard's accountant-only scope (RPT-02) — the
  // companies list comes from RLS (user_company_ids()), which includes business_owner
  // companies too.
  const [roleByCompanyId, setRoleByCompanyId] = useState({});
  useEffect(() => {
    if (!user?.id) { setRoleByCompanyId({}); return; }
    let cancelled = false;
    supabase.from('user_company_access').select('company_id, role').eq('user_id', user.id)
      .then(({ data, error }) => {
        if (error) { captureError(error, { operation: 'practice-roles-load' }); return; }
        if (!cancelled) setRoleByCompanyId(Object.fromEntries((data || []).map(r => [r.company_id, r.role])));
      });
    return () => { cancelled = true; };
  }, [user?.id, companies.length]);
  const accountantCompanies = useMemo(
    () => companies.filter(c => isAccountantFor(c, user?.id, roleByCompanyId)),
    [companies, user?.id, roleByCompanyId]);

  // Bumped by the zeroCompanyCheck safety net below when a delayed resolvePendingAccess
  // retry succeeds (or by refresh()), to force the company-resolution effect to re-run and
  // pick up newly-granted access (user?.id/isLoaded alone wouldn't change in that case).
  const [resolveNonce, setResolveNonce] = useState(0);
  const refresh = useCallback(() => setResolveNonce(n => n + 1), []);

  useEffect(() => {
    if (!isLoaded) return;
    if (!user) { setCompanyLoading(false); return; }
    setCompanyLoading(true);

    // RLS already returns exactly the companies this user can access — direct ownership
    // (companies.clerk_user_id) or user_company_access membership, either role — so no
    // manual filtering is needed. One source of truth.
    //
    // resolvePendingAccess() runs FIRST and is awaited: a just-accepted business_owner
    // invite is granted synchronously here rather than depending on the async Clerk
    // webhook having already landed, so the companies query below reliably sees it instead
    // of racing it (see [[resolve-pending-access]] — was the root cause of an invited user
    // landing in the create-company wizard and creating a phantom company).
    (async () => {
      await resolvePendingAccess();
      const { data } = await supabase.from("companies").select("*");
      if (!data || data.length === 0) {
        setOnboarding(true);
      } else {
        setCompanies(data);
        setCompany(prev => prev ? (data.find(c => c.id === prev.id) || data[0]) : data[0]);
        setOnboarding(false);
      }
      setCompanyLoading(false);
    })();
  }, [user?.id, isLoaded, resolveNonce]);

  // Zero companies resolved could mean two very different things: a genuinely new
  // accountant who hasn't created their first company yet (show the create-company
  // wizard), or an invited user (business_owner or colleague) hitting a resolution hiccup
  // — they already have access via user_company_access, just not reflected yet. There's no
  // company to check a role against at this point, so this is a lightweight, role-agnostic
  // side check: does this user have ANY user_company_access row at all?
  //
  // Safety net for the residual race (resolvePendingAccess above hit a transient failure):
  // before concluding "new", make one more resolve attempt (surfaced as the 'pending' state —
  // "setting up your access…"), and only fall through to 'new' if a short wait afterward
  // still shows no access.
  const [zeroCompanyCheck, setZeroCompanyCheck] = useState(null); // null (checking) | 'new' | 'has_access' | 'pending'
  useEffect(() => {
    if (!onboarding || !user?.id) { setZeroCompanyCheck(null); return; }
    let cancelled = false;
    (async () => {
      const { count } = await supabase.from('user_company_access')
        .select('company_id', { count: 'exact', head: true }).eq('user_id', user.id);
      if (cancelled) return;
      if (count > 0) { setZeroCompanyCheck('has_access'); return; }

      setZeroCompanyCheck('pending');
      const resolved = await resolvePendingAccess();
      if (cancelled) return;
      if (resolved.length > 0) { setResolveNonce(n => n + 1); return; } // re-run resolution above

      await new Promise(r => setTimeout(r, 1500));
      if (cancelled) return;
      const { count: count2 } = await supabase.from('user_company_access')
        .select('company_id', { count: 'exact', head: true }).eq('user_id', user.id);
      if (cancelled) return;
      setZeroCompanyCheck(count2 > 0 ? 'has_access' : 'new');
    })();
    return () => { cancelled = true; };
  }, [onboarding, user?.id]);

  // Reset company/role state the instant the signed-in user actually changes (not on
  // initial mount), so a previous session's company/role is never visible even briefly
  // during a login transition. RLS independently scopes every real query regardless, so
  // this is a display-staleness fix, not a data-access one.
  const prevUserIdRef = useRef(user?.id);
  useEffect(() => {
    if (prevUserIdRef.current === user?.id) return;
    prevUserIdRef.current = user?.id;
    setCompany(null);
    setCompanies([]);
    setCompanyRole(null);
  }, [user?.id]);

  return {
    user, isLoaded,
    companies, setCompanies,
    company, setCompany,
    onboarding, setOnboarding,
    companyLoading,
    companyRole, isBusinessOwner,
    roleByCompanyId, accountantCompanies,
    zeroCompanyCheck,
    refresh,
  };
}
