import { requireCompanyMember, AuthError } from './_auth.js';
import { AI_MODEL, callClaude } from './_anthropic.js';

const MAX_BASE64_CHARS = 10_000_000; // ~7.5 MB image

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { company_id } = req.body ?? {};
  // Was fully open — anyone could run image extraction on our API key. Any member (receipts are captured on mobile by the owner).
  try {
    await requireCompanyMember(req, company_id);
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    throw e;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });

  const { base64, mediaType } = req.body;
  if (!base64) return res.status(400).json({ error: "base64 required" });
  if (typeof base64 !== "string" || base64.length > MAX_BASE64_CHARS) return res.status(413).json({ error: "Image too large" });

  const supportedTypes = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
  const mt = (mediaType || "image/jpeg").toLowerCase();
  if (!supportedTypes.includes(mt)) {
    return res.status(200).json({ supplier: "", date: "", total_amount: 0, vat_amount: 0, vat_rate: null, net_amount: 0, description: "", line_items: [] });
  }

  console.log("[extract-receipt] processing", mt, "image, base64 length:", base64.length);

  try {
    // A failed call is reported to Sentry by callClaude; the empty-fields fallback below still applies.
    const { status, data, text: raw } = await callClaude({
        model: AI_MODEL.extractReceipt,
        max_tokens: 1024,
        operation: 'extract-receipt-anthropic-call',
        company_id,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mt, data: base64 } },
            {
              type: "text",
              text: `Extract all receipt data from this image. Return ONLY a JSON object with these exact fields:
- supplier: string (business/merchant name)
- date: string (ISO YYYY-MM-DD format, empty string if not found)
- total_amount: number (total amount charged including VAT, 0 if not found)
- vat_amount: number (VAT/tax amount shown, 0 if not found or not shown)
- vat_rate: number or null (the VAT rate % printed on the receipt, e.g. 23, 13.5 or 9; null if no rate is shown — do not infer it)
- net_amount: number (total minus VAT, 0 if not found)
- description: string (brief description: what was purchased, e.g. "Office supplies", "Business lunch", "Fuel")
- line_items: array of objects with { description: string, amount: number }

Irish VAT rates: 23% standard, 13.5% reduced (food, hotels), 9% (hospitality). If total is shown but VAT is not, do not estimate VAT.
Return only the JSON object, no other text.`,
            },
          ],
        }],
    });
    console.log("[extract-receipt] API status:", status, "| usage:", JSON.stringify(data?.usage));
    console.log("[extract-receipt] raw:", raw.slice(0, 400));

    const stripped = raw.replace(/```(?:json)?/gi, "").trim();
    const m = stripped.match(/\{[\s\S]*\}/);
    if (!m) {
      console.warn("[extract-receipt] no JSON found in response");
      return res.status(200).json({ supplier: "", date: "", total_amount: 0, vat_amount: 0, vat_rate: null, net_amount: 0, description: "", line_items: [] });
    }

    const parsed = JSON.parse(m[0]);
    res.status(200).json({
      supplier:      String(parsed.supplier     || ""),
      date:          String(parsed.date         || ""),
      total_amount:  Number(parsed.total_amount || 0),
      vat_amount:    Number(parsed.vat_amount   || 0),
      // The printed rate, like the emailed-bill reader's vat_rate — feeds the VAT-code suggestion.
      vat_rate:      parsed.vat_rate === null || parsed.vat_rate === undefined || parsed.vat_rate === "" || !Number.isFinite(Number(parsed.vat_rate)) ? null : Number(parsed.vat_rate),
      net_amount:    Number(parsed.net_amount   || 0),
      description:   String(parsed.description  || ""),
      line_items:    Array.isArray(parsed.line_items) ? parsed.line_items : [],
    });
  } catch (error) {
    console.error("[extract-receipt] error:", error);
    res.status(500).json({ error: error.message });
  }
}
