import { createClient } from "@supabase/supabase-js";
import { buildInvoicePDF, renderPDF } from "./_invoice-pdf-doc.js";
import { buildInvoiceHTML } from "./_invoice-html.js";

export const config = { api: { bodyParser: { sizeLimit: "16kb" } } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const pmToken = process.env.POSTMARK_SERVER_TOKEN?.trim();
  if (!pmToken) return res.status(500).json({ error: "POSTMARK_SERVER_TOKEN not configured" });

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: "Storage not configured" });

  const { invoice_id, company_id } = req.body ?? {};
  if (!invoice_id || !company_id) {
    return res.status(400).json({ error: "invoice_id and company_id required" });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const [invRes, linesRes, setRes, compRes] = await Promise.all([
    supabase.from("invoices").select("*").eq("id", invoice_id).eq("company_id", company_id).single(),
    supabase.from("invoice_lines").select("*").eq("invoice_id", invoice_id).order("sort_order"),
    supabase.from("invoice_settings").select("*").eq("company_id", company_id).maybeSingle(),
    supabase.from("companies").select("name").eq("id", company_id).single(),
  ]);

  if (!invRes.data) return res.status(404).json({ error: "Invoice not found" });

  const inv         = invRes.data;
  const lines       = linesRes.data || [];
  const settings    = setRes.data;
  const companyName = compRes.data?.name || "";

  let customer = null;
  if (inv.customer_id) {
    const { data } = await supabase.from("customers").select("*").eq("id", inv.customer_id).single();
    customer = data;
  }

  if (!customer?.email) {
    return res.status(400).json({ error: "Customer has no email address on file" });
  }

  const isCN       = inv.type === "credit_note";
  const docType    = isCN ? "Credit Note" : "Invoice";
  const senderName = settings?.trading_name || companyName || "Your Supplier";
  const fromEmail  = process.env.POSTMARK_FROM_EMAIL?.trim() || "noreply@ledgrly.ie";
  const subject    = `${docType} ${inv.invoice_number || ""} from ${senderName}`;
  const filename   = `${inv.invoice_number || "document"}.pdf`;

  // HTML body for email client rendering
  const html = buildInvoiceHTML(inv, lines, customer, settings, companyName);

  // PDF attachment — pure JS, no Puppeteer, ~100–300ms
  const doc       = buildInvoicePDF(inv, lines, customer, settings, companyName);
  const pdfBuf    = await renderPDF(doc);
  const pdfBase64 = pdfBuf.toString("base64");

  const pmRes = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": pmToken,
    },
    body: JSON.stringify({
      From: `${senderName} <${fromEmail}>`,
      To: customer.email,
      Subject: subject,
      HtmlBody: html,
      TextBody: `${docType} ${inv.invoice_number || ""} from ${senderName}. Please open in an HTML-capable email client to view this document.`,
      MessageStream: "outbound",
      Attachments: [{
        Name: filename,
        Content: pdfBase64,
        ContentType: "application/pdf",
      }],
    }),
  });

  if (!pmRes.ok) {
    const err = await pmRes.json().catch(() => ({}));
    return res.status(502).json({ error: err.Message || "Postmark error", code: err.ErrorCode });
  }

  if (!inv.sent_at) {
    await supabase.from("invoices").update({
      status: "sent",
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", invoice_id);
  }

  return res.json({ ok: true, to: customer.email, subject, pdf_attached: true });
}
