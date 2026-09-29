import { createClient } from "@supabase/supabase-js";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { requireAccountant, AuthError } from "./_auth.js";

export const config = { api: { bodyParser: { sizeLimit: "16kb" } } };

function encrypt(text, keyHex) {
  const key = Buffer.from(keyHex, "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [iv.toString("hex"), cipher.getAuthTag().toString("hex"), enc.toString("hex")].join(":");
}

export default async function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const credKeyHex  = process.env.STRIPE_CRED_KEY?.trim();

  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: "Storage not configured" });

  const supabase = createClient(supabaseUrl, serviceKey);

  // Every method is accountant-only and scoped to the verified company. The service-role
  // client bypasses RLS, so company_id from the request must be checked against the caller:
  // unauthenticated, anyone could replace a company's Stripe credentials (then sign their
  // own events into its books via the webhook) or disconnect any connection by id.
  // (The unused GET listing was removed — the app reads provider_connections directly,
  // under RLS.)
  const company_id = req.method === "DELETE" ? req.query.company_id : req.body?.company_id;
  if (req.method !== "DELETE" && req.method !== "POST") return res.status(405).end();
  try {
    await requireAccountant(req, company_id);
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    throw e;
  }

  // ── DELETE: soft-delete a connection (only this company's) ───────────────
  if (req.method === "DELETE") {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "id required" });
    const { data, error } = await supabase.from("provider_connections")
      .update({ status: "disconnected" }).eq("id", id).eq("company_id", company_id).select("id");
    if (error) return res.status(500).json({ error: error.message });
    if (!data?.length) return res.status(404).json({ error: "Connection not found" });
    return res.json({ ok: true });
  }

  // ── POST: create or update connection ─────────────────────────────────────
  const { api_key, signing_secret, acc_sales, acc_clearing, acc_fees, acc_bank } = req.body ?? {};
  if (!api_key) return res.status(400).json({ error: "company_id and api_key required" });
  // Mandatory: without it the webhook can't verify that events really come from Stripe.
  if (typeof signing_secret !== "string" || !signing_secret.trim().startsWith("whsec_")) {
    return res.status(400).json({ error: "The webhook signing secret (whsec_…) is required — copy it from the Stripe webhook endpoint you created for the URL shown." });
  }

  // Validate key against Stripe
  let accountName = "Stripe Account";
  try {
    const r = await fetch("https://api.stripe.com/v1/account", {
      headers: { Authorization: `Bearer ${api_key.trim()}` },
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      return res.status(400).json({ error: `Stripe rejected this key: ${e.error?.message || r.status}` });
    }
    const acct = await r.json();
    accountName = acct.settings?.dashboard?.display_name || acct.email || accountName;
  } catch {
    return res.status(400).json({ error: "Could not reach Stripe to validate the API key" });
  }

  if (!credKeyHex) {
    return res.status(500).json({ error: "STRIPE_CRED_KEY env var not set — credentials cannot be encrypted" });
  }

  const creds = JSON.stringify({ api_key: api_key.trim(), signing_secret: signing_secret.trim() });
  const credentialsEnc = encrypt(creds, credKeyHex);
  const hint = `whsec_…${signing_secret.trim().slice(-4)}`;

  const { data, error } = await supabase
    .from("provider_connections")
    .upsert({
      company_id,
      provider: "stripe",
      status: "active",
      credentials_enc: credentialsEnc,
      webhook_secret_hint: hint,
      display_name: accountName,
      acc_sales:    acc_sales    || "4000",
      acc_clearing: acc_clearing || "1300",
      acc_fees:     acc_fees     || "6500",
      acc_bank:     acc_bank     || "1000",
      updated_at: new Date().toISOString(),
    }, { onConflict: "company_id,provider" })
    .select("id,display_name,status,acc_sales,acc_clearing,acc_fees,acc_bank,webhook_secret_hint,created_at")
    .single();

  if (error) return res.status(500).json({ error: error.message });

  return res.json({
    connection: data,
    webhook_url: `https://app.ledgrly.ie/api/stripe-webhook?cid=${company_id}`,
    message: `Connected to "${accountName}" successfully.`,
  });
}
