import { createClient } from "@supabase/supabase-js";
import { renderInvoicePDF } from "./_invoice-pdf-doc.js";
import { withSentry, captureError } from './_sentry.js';

export const config = { api: { bodyParser: { sizeLimit: "16kb" } } };

export default withSentry(async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { invoice_id, company_id } = req.body ?? {};
  if (!invoice_id || !company_id) {
    return res.status(400).json({ error: "invoice_id and company_id required" });
  }

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: "Storage not configured" });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const [invRes, linesRes, setRes, compRes] = await Promise.all([
    supabase.from("invoices").select("*").eq("id", invoice_id).eq("company_id", company_id).single(),
    supabase.from("invoice_lines").select("*").eq("invoice_id", invoice_id).order("sort_order"),
    supabase.from("invoice_settings").select("*").eq("company_id", company_id).maybeSingle(),
    supabase.from("companies").select("name").eq("id", company_id).single(),
  ]);

  if (!invRes.data) return res.status(404).json({ error: "Invoice not found" });

  if (linesRes.error) {
    captureError(linesRes.error, { company_id, operation: 'invoice-pdf-lines', invoice_id });
    return res.status(500).json({ error: "Failed to load invoice lines — PDF generation aborted: " + linesRes.error.message });
  }

  const inv         = invRes.data;
  const lines       = linesRes.data || [];
  const settings    = setRes.data;
  const companyName = compRes.data?.name || "";

  // A properly finalized AR invoice always has line items (finaliseInvoice requires them) —
  // reaching here with zero indicates an upstream problem, not a legitimately empty invoice.
  if (!lines.length) {
    captureError(new Error('Invoice has no line items — refusing to generate PDF'), { company_id, operation: 'invoice-pdf-empty-lines', invoice_id });
    return res.status(422).json({ error: "Invoice has no line items — refusing to generate an empty invoice PDF" });
  }

  let customer = null;
  if (inv.customer_id) {
    const { data } = await supabase.from("customers").select("*").eq("id", inv.customer_id).single();
    customer = data;
  }

  const buffer = await renderInvoicePDF(inv, lines, customer, settings, companyName);

  const filename = `${inv.invoice_number || "invoice"}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", buffer.length);
  res.setHeader("Cache-Control", "no-store");
  res.send(buffer);
});
