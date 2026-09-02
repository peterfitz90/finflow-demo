import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { withSentry, captureError } from './_sentry.js';

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

export default withSentry(async function handler(req, res) {
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
    .select("id, name, currency, plan")
    .eq("mailbox_slug", slug)
    .maybeSingle();

  console.log("[inbound-email] company query — found:", !!company, "| error:", coErr?.message ?? "none", "| code:", coErr?.code ?? "none");

  if (coErr || !company) {
    console.warn("[inbound-email] no company for slug:", slug);
    return res.status(200).json({ skipped: "unknown slug" });
  }

  const companyId = company.id;

  // ── Plan gate: ap_mailbox requires founder+ plan ──────────────────────────────
  const MAILBOX_ALLOWED_PLANS = new Set(['founder', 'practice', 'enterprise']);
  if (!MAILBOX_ALLOWED_PLANS.has(company.plan)) {
    console.log('[inbound-email] plan_blocked — company', companyId, 'on plan:', company.plan);
    return res.status(200).json({ skipped: 'plan_blocked' });
  }

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

  // ── Select the real invoice attachment, ignoring inline/signature images ────────
  // Postmark sets ContentID on inline images (cid: references in HTML body).
  // Priority: non-inline PDF > non-inline image > 20 KB (scanned invoice).
  // Tiny images (< 10 KB) are always skipped — they're logos, not invoices.
  const INLINE_SIZE_SKIP = 10 * 1024;   // < 10 KB → always skip
  const SCAN_SIZE_MIN    = 20 * 1024;   // image must be ≥ 20 KB to be a scan
  const htmlBody         = body.HtmlBody ?? "";

  function isInline(att) {
    if (att.ContentID) return true;
    // also catch cid: references embedded in the HTML body
    if (att.ContentID === undefined && att.Name) {
      const safeName = att.Name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`cid:.*${safeName}`, 'i').test(htmlBody)) return true;
    }
    return false;
  }

  const rawAttachments = Array.isArray(body.Attachments) ? body.Attachments : [];
  console.log("[inbound-email] attachments received:", rawAttachments.map(a =>
    `${a.Name ?? '?'} mime=${a.ContentType} len=${a.ContentLength ?? '?'} cid=${a.ContentID ?? 'none'}`
  ));

  // Build candidate list — non-inline, known mime, not tiny
  const candidates = rawAttachments.filter(att => {
    const mime = (att.ContentType ?? "").toLowerCase().split(";")[0].trim();
    if (!ALLOWED_MIME.has(mime)) return false;
    if (isInline(att)) return false;
    const bytes = att.ContentLength ?? (att.Content ? Buffer.byteLength(att.Content, 'base64') : 0);
    if (mime.startsWith("image/") && bytes < INLINE_SIZE_SKIP) return false;
    return true;
  });

  // Sort: PDFs first, then by size descending (largest = most likely the invoice)
  candidates.sort((a, b) => {
    const aPdf = (a.ContentType ?? "").includes("pdf") ? 1 : 0;
    const bPdf = (b.ContentType ?? "").includes("pdf") ? 1 : 0;
    if (bPdf !== aPdf) return bPdf - aPdf;
    const aLen = a.ContentLength ?? 0;
    const bLen = b.ContentLength ?? 0;
    return bLen - aLen;
  });

  // Images additionally need to meet the scan size threshold
  const chosen = candidates.find(att => {
    const mime = (att.ContentType ?? "").toLowerCase().split(";")[0].trim();
    if (mime === "application/pdf") return true;
    const bytes = att.ContentLength ?? (att.Content ? Buffer.byteLength(att.Content, 'base64') : 0);
    return bytes >= SCAN_SIZE_MIN;
  }) ?? null;

  console.log("[inbound-email] chosen attachment:", chosen
    ? `${chosen.Name ?? '?'} (${chosen.ContentType})`
    : "none — no valid invoice attachment found");

  // ── Upload chosen attachment to storage ───────────────────────────────────────
  let storagePath  = null;
  let attachBase64 = null;
  let attachMime   = null;

  if (chosen) {
    const mime = (chosen.ContentType ?? "").toLowerCase().split(";")[0].trim();
    const ext  = extFromMime(mime);
    const key  = `ap/${companyId}/${randomUUID()}.${ext}`;
    const buf  = Buffer.from(chosen.Content, "base64");

    const { error: upErr } = await supabase.storage
      .from("journal-attachments")
      .upload(key, buf, { contentType: mime, upsert: false });

    if (upErr) {
      console.error("[inbound-email] storage upload failed:", upErr.message);
    } else {
      storagePath  = key;
      attachBase64 = chosen.Content;
      attachMime   = mime;
    }
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
  // `Number(x) || null` was crashing when x=0 (Claude's "unknown" default): 0||null = null,
  // violating the NOT NULL constraint on `amount`. Use 0 as the safe floor; flag for review.
  const gross = Number(parsed.gross ?? parsed.net ?? 0) || 0;
  const net   = Number(parsed.net ?? 0) || 0;
  const vat   = Number(parsed.vat ?? 0) || 0;
  const amountMissing = gross === 0 && !(Number(parsed.gross) > 0) && !(Number(parsed.net) > 0);
  const noAttachment  = !chosen;
  const draftNotes = noAttachment
    ? "⚠ No invoice attachment found (email contained only inline/signature images or no attachment) — please attach the invoice and enter details manually."
    : amountMissing
      ? "⚠ Amount could not be extracted from this email/attachment — please enter manually before posting."
      : "";

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
    notes:             draftNotes,
  });

  if (insErr) {
    // Unique violation on raw_email_id means race-condition duplicate; treat as success.
    if (insErr.code === "23505") {
      return res.status(200).json({ skipped: "duplicate" });
    }
    captureError(insErr, { company_id: companyId, operation: 'inbound-email-insert', supplier: supplierName });
    console.error("[inbound-email] insert failed:", insErr.message);
    return res.status(500).json({ error: insErr.message });
  }

  console.log("[inbound-email] invoice queued for review | company:", companyId, "supplier:", supplierName);
  return res.status(200).json({ ok: true });
});
