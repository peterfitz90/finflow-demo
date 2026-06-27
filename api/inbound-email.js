import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

export const config = {
  api: { bodyParser: { sizeLimit: "15mb" } },
};

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function extFromMime(mime) {
  return { "application/pdf": "pdf", "image/jpeg": "jpg", "image/jpg": "jpg",
           "image/png": "png", "image/webp": "webp", "image/gif": "gif" }[mime] ?? "bin";
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  // ── Auth: verify shared secret before touching anything ──────────────────────
  const secret = process.env.POSTMARK_INBOUND_SECRET;
  if (!secret || req.query.secret !== secret) {
    console.warn("[inbound-email] 401 — missing or wrong secret");
    return res.status(401).json({ error: "Unauthorized" });
  }

  const apiKey      = process.env.ANTHROPIC_API_KEY?.trim();
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!supabaseUrl || !serviceKey) {
    console.error("[inbound-email] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set");
    return res.status(500).json({ error: "Storage not configured" });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const body = req.body ?? {};
  const messageId = body.MessageID ?? body.ID ?? null;
  const fromRaw   = body.From ?? "";
  const subject   = body.Subject ?? "";

  // ── Resolve company from mailbox slug ────────────────────────────────────────
  // Addresses are bills-{slug}@inbound.ledgrly.ie
  // Extract the local part, strip any "+suffix" (plus-addressing), then strip
  // the "bills-" prefix to get the bare slug stored on companies.mailbox_slug.
  // Resolution is an exact match against the stored slug — never re-derived
  // from the company name at request time, so collisions are impossible.
  const toEmail    = body.ToFull?.[0]?.Email ?? body.To ?? "";
  const rawLocal   = toEmail.split("@")[0]?.split("+")[0]?.toLowerCase() ?? "";
  const slug       = rawLocal.startsWith("bills-") ? rawLocal.slice(6) : rawLocal;

  console.log("[inbound-email] slug:", slug, "| toEmail:", toEmail);
  console.log("[inbound-email] env check — SUPABASE_URL:", !!supabaseUrl, "| SERVICE_ROLE_KEY:", !!serviceKey);

  if (!slug) {
    console.warn("[inbound-email] no slug found in To address:", toEmail);
    return res.status(200).json({ skipped: "no slug" });
  }

  const { data: company, error: coErr } = await supabase
    .from("companies")
    .select("id, name, currency")
    .eq("mailbox_slug", slug)
    .maybeSingle();

  console.log("[inbound-email] company query — found:", !!company, "| error:", coErr?.message ?? "none", "| code:", coErr?.code ?? "none");

  if (coErr || !company) {
    console.warn("[inbound-email] no company for slug:", slug);
    return res.status(200).json({ skipped: "unknown slug" });
  }

  const companyId = company.id;

  // ── Idempotency: skip if we've already processed this email ──────────────────
  if (messageId) {
    const { data: existing } = await supabase
      .from("ap_invoices")
      .select("id")
      .eq("raw_email_id", messageId)
      .maybeSingle();
    if (existing) {
      console.log("[inbound-email] duplicate MessageID, skipping:", messageId);
      return res.status(200).json({ skipped: "duplicate" });
    }
  }

  // ── Upload first usable attachment to storage ─────────────────────────────────
  let storagePath  = null;
  let attachBase64 = null;
  let attachMime   = null;

  const attachments = Array.isArray(body.Attachments) ? body.Attachments : [];
  for (const att of attachments) {
    const mime = (att.ContentType ?? "").toLowerCase().split(";")[0].trim();
    if (!ALLOWED_MIME.has(mime)) continue;

    const ext      = extFromMime(mime);
    const key      = `ap/${companyId}/${randomUUID()}.${ext}`;
    const buf      = Buffer.from(att.Content, "base64");

    const { error: upErr } = await supabase.storage
      .from("journal-attachments")
      .upload(key, buf, { contentType: mime, upsert: false });

    if (upErr) {
      console.error("[inbound-email] storage upload failed:", upErr.message);
      continue;
    }

    storagePath  = key;
    attachBase64 = att.Content;
    attachMime   = mime;
    break; // process the first usable attachment only
  }

  // ── Parse invoice with Claude ─────────────────────────────────────────────────
  let parsed = {};

  if (apiKey && (attachBase64 || subject)) {
    try {
      const contentBlocks = [];

      if (attachBase64 && attachMime === "application/pdf") {
        contentBlocks.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: attachBase64 },
        });
      } else if (attachBase64 && attachMime?.startsWith("image/")) {
        contentBlocks.push({
          type: "image",
          source: { type: "base64", media_type: attachMime, data: attachBase64 },
        });
      }

      const emailContext = `Email subject: "${subject}"\nFrom: "${fromRaw}"\nBody snippet: "${
        (body.TextBody ?? body.HtmlBody ?? "").slice(0, 800)
      }"`;

      contentBlocks.push({
        type: "text",
        text: `Extract invoice data from the attached document (or email if no document).
Context: ${emailContext}

Return ONLY a JSON object:
{
  "supplier_name":          string,
  "invoice_number":         string,
  "invoice_date":           "YYYY-MM-DD or empty",
  "due_date":               "YYYY-MM-DD or empty",
  "currency":               "EUR",
  "net":                    number,
  "vat":                    number,
  "gross":                  number,
  "vat_rate":               "23% or 13.5% or 9% or empty",
  "suggested_nominal_code": "one of: 5000,5100,5200,5300,6000,6100,6200,6300,6400,6500,6600,6700,6800,6900",
  "line_items":             [{"description": string, "amount": number}]
}
If a value is unknown, use null or 0. Return only the JSON object.`,
      });

      const headers = {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      };
      if (attachMime === "application/pdf") {
        headers["anthropic-beta"] = "pdfs-2024-09-25";
      }

      const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1024,
          messages: [{ role: "user", content: contentBlocks }],
        }),
      });

      const claudeData = await claudeRes.json();
      const raw = claudeData.content?.[0]?.text ?? "";
      const m   = raw.replace(/```(?:json)?/gi, "").trim().match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
      console.log("[inbound-email] claude parsed:", JSON.stringify(parsed).slice(0, 300));
    } catch (parseErr) {
      console.error("[inbound-email] claude parse failed:", parseErr.message);
    }
  }

  // ── Check if supplier is new ──────────────────────────────────────────────────
  const supplierName = parsed.supplier_name || fromRaw.replace(/<[^>]+>/, "").trim() || "Unknown Supplier";
  let newSupplierFlag = false;

  if (supplierName && supplierName !== "Unknown Supplier") {
    const { data: priorInv } = await supabase
      .from("ap_invoices")
      .select("id")
      .eq("company_id", companyId)
      .ilike("supplier", supplierName)
      .limit(1)
      .maybeSingle();
    newSupplierFlag = !priorInv;
  }

  // ── Insert draft into ap_invoices ─────────────────────────────────────────────
  const gross    = Number(parsed.gross ?? parsed.net ?? 0) || null;
  const net      = Number(parsed.net   ?? 0)              || null;
  const vat      = Number(parsed.vat   ?? 0)              || null;

  const { error: insErr } = await supabase.from("ap_invoices").insert({
    company_id:        companyId,
    source:            "email",
    raw_email_id:      messageId,
    status:            "needs_review",
    supplier:          supplierName,
    invoice_ref:       parsed.invoice_number || subject.slice(0, 80) || "",
    invoice_date:      parsed.invoice_date   || null,
    due_date:          parsed.due_date       || null,
    amount:            gross,
    gross_amount:      gross,
    net_amount:        net,
    vat_amount:        vat,
    vat_rate:          parsed.vat_rate       || null,
    currency:          parsed.currency       || company.currency || "EUR",
    suggested_nominal: parsed.suggested_nominal_code || null,
    line_items:        parsed.line_items?.length ? parsed.line_items : null,
    attachment_path:   storagePath,
    new_supplier_flag: newSupplierFlag,
    payment_method:    "bank transfer",
    notes:             "",
  });

  if (insErr) {
    // Unique violation on raw_email_id means race-condition duplicate; treat as success.
    if (insErr.code === "23505") {
      return res.status(200).json({ skipped: "duplicate" });
    }
    console.error("[inbound-email] insert failed:", insErr.message);
    return res.status(500).json({ error: insErr.message });
  }

  console.log("[inbound-email] invoice queued for review | company:", companyId, "supplier:", supplierName);
  return res.status(200).json({ ok: true });
}
