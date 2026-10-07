// AI categorisation of bank payees, shared in-process by the /api/categorise endpoint (the app's
// statement import) and the bank feed ingest (api/yapily/ingest.js). The ingest used to reach the
// endpoint over HTTP with no token, which the 29 Sep 2026 auth lock-down (412aa2f) refused with a
// 401 that the ingest only logged, so feed lines silently kept the 4100 / 6600 defaults.
//
// categorisePayees never throws for an AI failure: it returns { results, ai }, where ai is 'ok' or
// 'fallback' (with error); a fallback gives each payee 4000 (income) or 6600 (expense), confidence
// low, and the caller decides how loudly to report it. `call` is injectable for tests.
import { AI_MODEL, callClaude } from './_anthropic.js';
import { categoryFromAI } from '../src/shared/transferHold.js';

export const AI_SYSTEM = `You are a bookkeeper categorising Irish bank transactions. For each payee, return the most likely nominal account from this list:

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
TRANSFER Transfer - money moved between the company's own accounts (e.g. "To EUR", "Exchanged to EUR", "To savings", a transfer to another account in the company's own name)

Rules:
- Positive amount = money IN = use 4000 or 4100
- Payment to a person's name = 6000 Payroll if negative, 4100 if positive
- When unsure, pick the closest match — avoid 6600 Sundry unless truly unidentifiable
- Never return a bank account code (1000-1099): an internal transfer is TRANSFER

Return ONLY a JSON array: [{"id":"payee_key","nominal_code":"6000","nominal_name":"Payroll & PAYE","confidence":"high"}]`;

const fallbackFor = p => ({ key: p.key, code: p.direction === "income" ? "4000" : "6600", confidence: "low" });

export async function categorisePayees(payees, { company_id, call = callClaude } = {}) {
  const fallback = error => ({ results: payees.map(fallbackFor), ai: 'fallback', error });
  let res;
  try {
    res = await call({
      model: AI_MODEL.categorise,
      // Sonnet 5.5's tokenizer makes the same JSON ~30% longer: a 75-payee chunk with long payee keys
      // measured 4,342 output tokens (2026-10-01), so 4000 truncated it and the whole chunk fell back.
      max_tokens: 8000,
      system: AI_SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(payees) }],
      operation: 'categorise-anthropic-call',
      company_id,
    });
  } catch (e) {
    return fallback(e.message);
  }
  const { ok, status, text: raw = '' } = res || {};
  if (ok === false) return fallback(`Anthropic call failed (${status})`);

  const stripped = raw.replace(/```(?:json)?/gi, "").trim();
  const m = stripped.match(/\[[\s\S]*\]/);
  if (!m) return fallback('no JSON array in the reply');
  let parsed;
  try { parsed = JSON.parse(m[0]); } catch (e) { return fallback(`JSON parse failed: ${e.message}`); }

  const resultKeys = new Set();
  const results = parsed.map(r => {
    // Accept both "key" and "id" fields from the model response
    const key = r.key || r.id;
    resultKeys.add(key);
    return {
      key,
      // A bank nominal as the category would post Dr bank / Cr bank (same-account guard,
      // src/shared/transferHold.js): an internal transfer is held for the accountant instead.
      code: categoryFromAI(r.nominal_code || (r.direction === "income" ? "4000" : "6600")),
      confidence: ["high", "medium", "low"].includes(r.confidence) ? r.confidence : "medium",
    };
  });
  for (const p of payees) if (!resultKeys.has(p.key)) results.push(fallbackFor(p));
  return { results, ai: 'ok' };
}

// The bank feed's categorisation: chunks of 75 payees (one reply must fit max_tokens), each through
// categorisePayees. Returns { codes: { payeeKey: code } for payees the AI categorised, ai: 'ok' |
// 'partial' | 'fallback', failedChunks, error }. Payees in a failed chunk get no code, so the
// ingest keeps its own defaults for them and reports the failure.
export const FEED_CHUNK = 75;
export async function categoriseFeedPayees(payees, { company_id, call } = {}) {
  const codes = {};
  let failedChunks = 0, chunks = 0, error = null;
  for (let i = 0; i < payees.length; i += FEED_CHUNK) {
    chunks++;
    const slice = payees.slice(i, i + FEED_CHUNK);
    let r = await categorisePayees(slice, { company_id, ...(call ? { call } : {}) });
    if (r.ai !== 'ok') r = await categorisePayees(slice, { company_id, ...(call ? { call } : {}) }); // one retry
    if (r.ai !== 'ok') { failedChunks++; error = r.error; continue; }
    for (const x of r.results) if (x.key) codes[x.key] = x.code;
  }
  const ai = failedChunks === 0 ? 'ok' : failedChunks === chunks ? 'fallback' : 'partial';
  return { codes, ai, failedChunks, chunks, error };
}
