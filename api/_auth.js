// Verifies the caller's Clerk session token and confirms they hold accountant-level
// access to a given company, before an endpoint acts on Clerk's Management API or
// touches org membership. Without this, company_id/orgId alone was trusted from the
// request body — anyone who knew or guessed a valid id could invite themselves as an
// admin to any org, or disconnect any company's bank feed.
import { verifyToken } from "@clerk/backend";
import { createClient } from "@supabase/supabase-js";

class AuthError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Verifies the Bearer token and resolves the caller's role on companyId:
// 'accountant' (direct owner via companies.clerk_user_id, or role='accountant' in
// user_company_access), 'business_owner', or null (no access). Throws AuthError on a
// missing/invalid token. Same membership rule as the RLS helper user_company_ids().
async function resolveCompanyRole(req, companyId) {
  if (!companyId) throw new AuthError("company_id required", 400);

  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) throw new AuthError("Missing Authorization token", 401);

  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!secretKey || !supabaseUrl || !serviceKey) throw new AuthError("Server not configured", 500);

  let payload;
  try {
    payload = await verifyToken(token, { secretKey });
  } catch {
    throw new AuthError("Invalid session token", 401);
  }
  const userId = payload?.sub;
  if (!userId) throw new AuthError("Invalid session token", 401);

  const db = createClient(supabaseUrl, serviceKey);

  const { data: co } = await db
    .from("companies").select("clerk_user_id").eq("id", companyId).maybeSingle();
  if (co?.clerk_user_id === userId) return { userId, role: "accountant" };

  const { data: access } = await db
    .from("user_company_access").select("role")
    .eq("company_id", companyId).eq("user_id", userId).maybeSingle();
  return { userId, role: access?.role ?? null };
}

// Returns the verified caller's Clerk user id if they are the accountant for
// companyId (direct owner via companies.clerk_user_id, or role='accountant' in
// user_company_access). Throws AuthError (with .status) otherwise.
export async function requireAccountant(req, companyId) {
  const { userId, role } = await resolveCompanyRole(req, companyId);
  if (role === "accountant") return userId;
  throw new AuthError("Forbidden — accountant access required", 403);
}

// Any member of companyId — accountant OR business_owner — i.e. exactly who RLS lets read
// and write that company's rows. For endpoints both roles legitimately use (the bank feed:
// a business_owner connects their own bank and imports from it). Returns { userId, role }.
export async function requireCompanyMember(req, companyId) {
  const { userId, role } = await resolveCompanyRole(req, companyId);
  if (role === "accountant" || role === "business_owner") return { userId, role };
  throw new AuthError("Forbidden — no access to this company", 403);
}

// The Clerk organisation that belongs to companyId, read server-side. Endpoints that act on
// an org (invites, member listing) must use THIS, never an orgId from the request: the
// caller's access was verified against companyId, so an org taken from the body could be
// any other company's — an accountant of their own company could invite themselves into a
// client's org and, on acceptance, be granted accountant access to that client.
export async function companyOrgId(companyId) {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) throw new AuthError("Server not configured", 500);
  const db = createClient(supabaseUrl, serviceKey);
  const { data } = await db.from("companies").select("clerk_org_id").eq("id", companyId).maybeSingle();
  if (!data?.clerk_org_id) throw new AuthError("This company has no organisation yet — set one up in Settings first", 409);
  return data.clerk_org_id;
}

export { AuthError };
