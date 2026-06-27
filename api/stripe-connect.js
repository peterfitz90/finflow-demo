import { createClient } from "@supabase/supabase-js";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

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

  // ── GET: list active connections for a company ────────────────────────────
  if (req.method === "GET") {
    const { company_id } = req.query;
    if (!company_id) return res.status(400).json({ error: "company_id required" });
    const { data, error } = await supabase
      .from("provider_connections")
      .select("id,provider,status,display_name,last_event_at,acc_sales,acc_clearing,acc_fees,acc_bank,webhook_secret_hint,created_at")
      .eq("company_id", company_id)
      .neq("status", "disconnected")
      .order("created_at");
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ connections: data || [] });
  }

  // ── DELETE: soft-delete a connection ─────────────────────────────────────
  if (req.method === "DELETE") {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "id required" });
    await supabase.from("provider_connections").update({ status: "disconnected" }).eq("id", id);
    return res.json({ ok: true });
  }

  if (req.method !== "POST") return res.status(405).end();

  // ── POST: create or update connection ─────────────────────────────────────
  const { company_id, api_key, signing_secret, acc_sales, acc_clearing, acc_fees, acc_bank } = req.body ?? {};
  if (!company_id || !api_key) return res.status(400).json({ error: "company_id and api_key required" });

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

  const creds = JSON.stringify({ api_key: api_key.trim(), signing_secret: (signing_secret || "").trim() });
  const credentialsEnc = encrypt(creds, credKeyHex);
  const hint = signing_secret ? `whsec_…${signing_secret.slice(-4)}` : null;

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
