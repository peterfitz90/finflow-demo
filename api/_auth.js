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

// Returns the verified caller's Clerk user id if they are the accountant for
// companyId (direct owner via companies.clerk_user_id, or role='accountant' in
// user_company_access). Throws AuthError (with .status) otherwise.
export async function requireAccountant(req, companyId) {
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
  if (co?.clerk_user_id === userId) return userId;

  const { data: access } = await db
    .from("user_company_access").select("role")
    .eq("company_id", companyId).eq("user_id", userId).maybeSingle();
  if (access?.role === "accountant") return userId;

  throw new AuthError("Forbidden — accountant access required", 403);
}

export { AuthError };
