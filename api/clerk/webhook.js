import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "crypto";

// Raw body required for Svix signature verification — a re-serialised JSON body would not
// reproduce the exact bytes Clerk signed.
export const config = { api: { bodyParser: false } };

async function rawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Clerk webhooks are signed by Svix. Spec: https://docs.svix.com/receiving/verifying-payloads/how-manual
function verifySvixSignature(rawBodyBuf, headers, secret) {
  const svixId        = headers["svix-id"];
  const svixTimestamp  = headers["svix-timestamp"];
  const svixSignature  = headers["svix-signature"];
  if (!svixId || !svixTimestamp || !svixSignature || !secret) return false;

  // Replay protection — reject anything outside a 5 minute window (same tolerance as the
  // existing Stripe webhook handler).
  const ts = Number(svixTimestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const secretBytes    = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signedContent  = `${svixId}.${svixTimestamp}.${rawBodyBuf.toString("utf8")}`;
  const expected        = createHmac("sha256", secretBytes).update(signedContent).digest();

  // svix-signature can carry multiple space-separated "v1,<base64>" values (secret rotation) —
  // accept if any match.
  return svixSignature.split(" ").some(part => {
    const [version, sigB64] = part.split(",");
    if (version !== "v1" || !sigB64) return false;
    let given;
    try { given = Buffer.from(sigB64, "base64"); } catch { return false; }
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

// organizationMembership webhooks nest the org/user differently depending on Clerk API version —
// accept both shapes rather than assuming one and failing silently on the other.
function extractOrgAndUser(data) {
  const orgId  = data?.organization?.id ?? data?.organization_id ?? null;
  const userId = data?.public_user_data?.user_id ?? data?.user_id ?? null;
  return { orgId, userId };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const secret      = process.env.CLERK_WEBHOOK_SECRET?.trim();
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!secret || !supabaseUrl || !serviceKey) {
    console.error("[clerk-webhook] Missing CLERK_WEBHOOK_SECRET or Supabase service config");
    return res.status(500).json({ error: "Server not configured" });
  }

  const body = await rawBody(req);

  if (!verifySvixSignature(body, req.headers, secret)) {
    console.warn("[clerk-webhook] Signature verification failed");
    return res.status(401).json({ error: "Signature verification failed" });
  }

  let event;
  try {
    event = JSON.parse(body.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const { type, data } = event;
  console.log("[clerk-webhook] received:", type);
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    if (type === "organizationMembership.created") {
      const { orgId, userId } = extractOrgAndUser(data);
      if (!orgId || !userId) {
        console.warn("[clerk-webhook] created: could not extract org/user from payload", JSON.stringify(data));
        return res.status(400).json({ error: "Missing organization/user id" });
      }

      const { data: co, error: coErr } = await supabase
        .from("companies").select("id").eq("clerk_org_id", orgId).maybeSingle();
      if (coErr) throw coErr;
      if (!co) {
        // No company linked to this org yet — e.g. the fleeting window between an org being
        // created and companies.clerk_org_id being set by the app right after. Harmless: the
        // org creator already has access via companies.clerk_user_id regardless of this table.
        return res.json({ received: true, action: "no_matching_company" });
      }

      const { error: upsertErr } = await supabase
        .from("user_company_access")
        .upsert({ user_id: userId, company_id: co.id }, { onConflict: "user_id,company_id" });
      if (upsertErr) throw upsertErr;

      return res.json({ received: true, action: "granted" });
    }

    if (type === "organizationMembership.deleted") {
      const { orgId, userId } = extractOrgAndUser(data);
      if (!orgId || !userId) {
        console.warn("[clerk-webhook] deleted: could not extract org/user from payload", JSON.stringify(data));
        return res.status(400).json({ error: "Missing organization/user id" });
      }

      const { data: co, error: coErr } = await supabase
        .from("companies").select("id").eq("clerk_org_id", orgId).maybeSingle();
      if (coErr) throw coErr;
      if (!co) return res.json({ received: true, action: "no_matching_company" });

      const { error: delErr } = await supabase
        .from("user_company_access")
        .delete().eq("user_id", userId).eq("company_id", co.id);
      if (delErr) throw delErr;

      return res.json({ received: true, action: "revoked" });
    }

    if (type === "organization.deleted") {
      const orgId = data?.id;
      if (!orgId) return res.status(400).json({ error: "Missing organization id" });

      const { data: co } = await supabase
        .from("companies").select("id").eq("clerk_org_id", orgId).maybeSingle();
      if (co) {
        await supabase.from("user_company_access").delete().eq("company_id", co.id);
      }
      return res.json({ received: true, action: "org_cleanup" });
    }

    if (type === "user.deleted") {
      const userId = data?.id;
      if (!userId) return res.status(400).json({ error: "Missing user id" });
      await supabase.from("user_company_access").delete().eq("user_id", userId);
      return res.json({ received: true, action: "user_cleanup" });
    }

    // organizationMembership.updated (role changes) and anything else: role does not currently
    // affect data visibility — user_company_access has no role column, RLS only checks row
    // presence — so no sync action is needed here today.
    return res.json({ received: true, action: "ignored" });
  } catch (e) {
    console.error("[clerk-webhook] Handler error:", e.message);
    return res.status(500).json({ error: e.message });
  }
}
