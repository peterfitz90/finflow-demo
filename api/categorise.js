const AI_SYSTEM = `You are a bookkeeper categorising Irish bank transactions. For each payee, return the most likely nominal account from this list:

4000 Sales Revenue - money received from customers
4100 Other Income - other receipts, transfers in
5000 Cost of Sales - direct costs of goods/services sold
5100 Materials & Supplies - purchases of materials
6000 Payroll & PAYE - wages, salaries, payroll transfers (any payment to a person's name)
6100 Rent & Rates - rent, lease payments
6200 Motor & Travel - fuel, parking, transport
6300 Telecoms & IT - phone, internet, software subscriptions (Google, Microsoft, Adobe, Zoom, Slack)
6400 Professional Fees - accountant, solicitor, consultant fees
6500 Bank Charges - bank fees, Revolut fees, card charges
6600 Sundry Expenses - anything that does not fit above
6700 Marketing - advertising, social media, marketing agencies
6800 Insurance - any insurance payment
6900 Repairs & Maintenance - repairs, maintenance, contractors
2100 VAT Control - Revenue, ROS, Collector General payments
2000 Trade Creditors - supplier invoices being paid
1000 Bank - internal transfers between own accounts

Rules:
- Positive amount = money IN = use 4000 or 4100
- Payment to a person's name = 6000 Payroll if negative, 4100 if positive
- When unsure, pick the closest match — avoid 6600 Sundry unless truly unidentifiable

Return ONLY a JSON array: [{"id":"payee_key","nominal_code":"6000","nominal_name":"Payroll & PAYE","confidence":"high"}]`;

import { withSentry, captureError } from './_sentry.js';
import { requireCompanyMember, AuthError } from './_auth.js';
import { AI_MODEL, callClaude } from './_anthropic.js';

const MAX_PAYEES = 100;          // the client sends chunks of 75
const MAX_PAYEE_JSON = 40000;    // chars of JSON per request

export default withSentry(async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { company_id } = req.body ?? {};
  // Was fully open — anyone could run Claude on our API key. Any member (a business_owner imports their own bank CSV).
  try {
    await requireCompanyMember(req, company_id);
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    throw e;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });

  const { payees } = req.body;
  if (!Array.isArray(payees) || !payees.length) {
    return res.status(400).json({ error: "payees array required" });
  }
  if (payees.length > MAX_PAYEES || JSON.stringify(payees).length > MAX_PAYEE_JSON) {
    return res.status(413).json({ error: `Too many payees in one request (max ${MAX_PAYEES})` });
  }

  console.log("[categorise] categorising", payees.length, "unique payees");

  try {
    // A failed call (bad model, error status) is reported to Sentry by callClaude; the low-confidence
    // fallback below still applies.
    const { status, data, text: raw } = await callClaude({
      model: AI_MODEL.categorise,
      // Sonnet 5.5's tokenizer makes the same JSON ~30% longer: a 75-payee chunk with long payee keys
      // measured 4,342 output tokens (2026-10-01), so 4000 truncated it and the whole chunk fell back.
      max_tokens: 8000,
      system: AI_SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(payees) }],
      operation: 'categorise-anthropic-call',
      company_id,
    });
    console.log("[categorise] API status:", status, "| usage:", JSON.stringify(data?.usage));
    console.log("[categorise] raw response (first 600):", raw.slice(0, 600));

    const stripped = raw.replace(/```(?:json)?/gi, "").trim();
    const m = stripped.match(/\[[\s\S]*\]/);
    if (!m) {
      console.warn("[categorise] no JSON array in response, falling back");
      return res.status(200).json({
        results: payees.map(p => ({ key: p.key, code: p.direction === "income" ? "4000" : "6600", confidence: "low" })),
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(m[0]);
    } catch (e) {
      console.error("[categorise] JSON parse failed:", e.message);
      return res.status(200).json({
        results: payees.map(p => ({ key: p.key, code: p.direction === "income" ? "4000" : "6600", confidence: "low" })),
      });
    }

    const resultKeys = new Set();
    const results = parsed.map(r => {
      // Accept both "key" and "id" fields from the model response
      const key = r.key || r.id;
      resultKeys.add(key);
      return {
        key,
        code: String(r.nominal_code || (r.direction === "income" ? "4000" : "6600")),
        confidence: ["high", "medium", "low"].includes(r.confidence) ? r.confidence : "medium",
      };
    });

    payees.forEach(p => {
      if (!resultKeys.has(p.key)) {
        results.push({ key: p.key, code: p.direction === "income" ? "4000" : "6600", confidence: "low" });
      }
    });

    console.log("[categorise] returning", results.length, "results");
    res.status(200).json({ results });
  } catch (error) {
    captureError(error, { operation: 'categorise-anthropic-call' });
    console.error("[categorise] handler error:", error);
    res.status(500).json({ error: error.message });
  }
});
