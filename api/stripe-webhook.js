import { createClient } from "@supabase/supabase-js";
import { createDecipheriv, createHmac } from "crypto";

// Raw body required for Stripe signature verification.
export const config = { api: { bodyParser: false } };

function decrypt(enc, keyHex) {
  const [ivHex, tagHex, dataHex] = enc.split(":");
  const key = Buffer.from(keyHex, "hex");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  d.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([d.update(Buffer.from(dataHex, "hex")), d.final()]).toString("utf8");
}

function verifySignature(rawBody, header, secret) {
  if (!secret || !header) return false;
  const parts  = header.split(",");
  const tPart  = parts.find(p => p.startsWith("t="));
  const v1List = parts.filter(p => p.startsWith("v1="));
  if (!tPart || !v1List.length) return false;
  const ts = tPart.slice(2);
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${ts}.${rawBody.toString("utf8")}`).digest("hex");
  return v1List.some(p => p.slice(3) === expected);
}

function weekBounds(isoDate) {
  const d = new Date(isoDate);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setUTCDate(d.getUTCDate() + diff);
  mon.setUTCHours(0, 0, 0, 0);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  const weekStart = mon.toISOString().slice(0, 10);
  const weekEnd   = sun.toISOString().slice(0, 10);
  const jan4 = new Date(Date.UTC(mon.getUTCFullYear(), 0, 4));
  const wn = Math.ceil(((mon - jan4) / 86400000 + jan4.getUTCDay() + 1) / 7);
  return { weekStart, weekEnd, periodLabel: `W${String(wn).padStart(2, "0")} ${mon.getUTCFullYear()}` };
}

async function rawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const credKeyHex  = process.env.STRIPE_CRED_KEY?.trim();
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: "Storage not configured" });

  const body      = await rawBody(req);
  const sigHeader = req.headers["stripe-signature"];
  const companyId = req.query.cid;
  if (!companyId) return res.status(400).json({ error: "cid required" });

  const supabase = createClient(supabaseUrl, serviceKey);

  // Resolve connection
  const { data: conn } = await supabase
    .from("provider_connections")
    .select("id,credentials_enc,acc_sales,acc_clearing,acc_fees,acc_bank")
    .eq("company_id", companyId)
    .eq("provider", "stripe")
    .neq("status", "disconnected")
    .maybeSingle();

  if (!conn) {
    console.warn(`[stripe-webhook] No active connection for company ${companyId}`);
    return res.status(404).json({ error: "No active Stripe connection" });
  }

  // Signature verification
  if (credKeyHex && conn.credentials_enc) {
    try {
      const { signing_secret } = JSON.parse(decrypt(conn.credentials_enc, credKeyHex));
      if (signing_secret && !verifySignature(body, sigHeader, signing_secret)) {
        console.warn("[stripe-webhook] Signature verification failed");
        return res.status(401).json({ error: "Signature verification failed" });
      }
    } catch (e) {
      console.error("[stripe-webhook] Credential decryption error:", e.message);
      return res.status(500).json({ error: "Credential error" });
    }
  }

  let event;
  try {
    event = JSON.parse(body.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const HANDLED = new Set(["payment_intent.succeeded", "charge.refunded", "payout.paid"]);
  if (!HANDLED.has(event.type)) return res.json({ received: true, action: "ignored" });

  // Idempotency check
  const { data: dup } = await supabase
    .from("revenue_events").select("id").eq("external_id", event.id).maybeSingle();
  if (dup) return res.json({ received: true, action: "duplicate" });

  // Normalise
  let norm = null;
  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object;
    norm = {
      event_type: "charge",
      occurred_at: new Date(pi.created * 1000).toISOString(),
      currency: pi.currency.toUpperCase(),
      gross: pi.amount_received / 100,
      fee: 0, vat: 0, net: pi.amount_received / 100,
      customer_ref: pi.customer || null,
      description: pi.description || "Stripe payment",
    };
  } else if (event.type === "charge.refunded") {
    const ch = event.data.object;
    const rf = ch.refunds?.data?.[0];
    const refundAmt = (rf ? rf.amount : ch.amount_refunded) / 100;
    norm = {
      event_type: "refund",
      occurred_at: rf ? new Date(rf.created * 1000).toISOString() : new Date(ch.created * 1000).toISOString(),
      currency: ch.currency.toUpperCase(),
      gross: -refundAmt,
      fee: 0, vat: 0, net: -refundAmt,
      customer_ref: ch.customer || null,
      description: `Refund: ${ch.description || "Stripe charge"}`,
    };
  } else if (event.type === "payout.paid") {
    const po = event.data.object;
    norm = {
      event_type: "payout",
      occurred_at: new Date(po.arrival_date * 1000).toISOString(),
      currency: po.currency.toUpperCase(),
      gross: po.amount / 100,
      fee: 0, vat: 0, net: po.amount / 100,
      customer_ref: null,
      description: po.description || "Stripe payout",
    };
  }

  if (!norm) return res.json({ received: true, action: "unhandled" });

  // Insert event
  const { data: revEv, error: evErr } = await supabase.from("revenue_events").insert({
    company_id: companyId,
    provider: "stripe",
    connection_id: conn.id,
    external_id: event.id,
    raw_payload: event,
    processed: false,
    ...norm,
  }).select("id").single();

  if (evErr) {
    console.error("[stripe-webhook] Event insert error:", evErr.message);
    return res.status(500).json({ error: evErr.message });
  }

  // Update connection heartbeat
  await supabase.from("provider_connections")
    .update({ last_event_at: new Date().toISOString() }).eq("id", conn.id);

  // Aggregate into review item
  let reviewItemId = null;

  if (norm.event_type === "charge" || norm.event_type === "refund") {
    const { weekStart, weekEnd, periodLabel } = weekBounds(norm.occurred_at);
    const isRefund = norm.event_type === "refund";
    const grossAbs = Math.abs(norm.gross);

    const { data: ri } = await supabase.from("revenue_review_items")
      .select("id,status,charge_count,charge_gross,charge_net,refund_count,refund_gross")
      .eq("company_id", companyId).eq("connection_id", conn.id)
      .eq("item_type", "weekly_summary").eq("week_start", weekStart)
      .maybeSingle();

    if (ri && ri.status === "pending") {
      const upd = isRefund
        ? {
            refund_count: (ri.refund_count || 0) + 1,
            refund_gross: (ri.refund_gross || 0) + grossAbs,
            charge_gross: (ri.charge_gross || 0) - grossAbs,
            charge_net:   (ri.charge_net   || 0) - grossAbs,
          }
        : {
            charge_count: (ri.charge_count || 0) + 1,
            charge_gross: (ri.charge_gross || 0) + grossAbs,
            charge_net:   (ri.charge_net   || 0) + grossAbs,
          };
      await supabase.from("revenue_review_items").update(upd).eq("id", ri.id);
      reviewItemId = ri.id;
    } else if (!ri) {
      const { data: newRi } = await supabase.from("revenue_review_items").insert({
        company_id: companyId, provider: "stripe", connection_id: conn.id,
        item_type: "weekly_summary", period_label: periodLabel,
        week_start: weekStart, week_end: weekEnd, status: "pending",
        charge_count: isRefund ? 0 : 1,
        charge_gross: isRefund ? -grossAbs : grossAbs,
        charge_net:   isRefund ? -grossAbs : grossAbs,
        charge_vat: 0, fee_total: 0,
        refund_count: isRefund ? 1 : 0,
        refund_gross: isRefund ? grossAbs : 0,
      }).select("id").single();
      reviewItemId = newRi?.id;
    } else {
      reviewItemId = ri.id;
    }
  }

  if (norm.event_type === "payout") {
    const pd = norm.occurred_at.slice(0, 10);
    const { data: po } = await supabase.from("revenue_review_items")
      .select("id").eq("company_id", companyId).eq("connection_id", conn.id)
      .eq("item_type", "payout").eq("payout_date", pd).maybeSingle();
    if (!po) {
      const { data: newPo } = await supabase.from("revenue_review_items").insert({
        company_id: companyId, provider: "stripe", connection_id: conn.id,
        item_type: "payout", period_label: pd,
        week_start: pd, week_end: pd, status: "pending",
        payout_amount: norm.gross, payout_date: pd,
      }).select("id").single();
      reviewItemId = newPo?.id;
    } else {
      reviewItemId = po.id;
    }
  }

  if (reviewItemId) {
    await supabase.from("revenue_events")
      .update({ review_item_id: reviewItemId }).eq("id", revEv.id);
  }

  return res.json({ received: true, action: "processed", event_id: revEv.id });
}
