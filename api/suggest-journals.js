// Prepayment classifier — called by the SuggestedJournals engine AFTER code-based
// detection has already identified candidates and computed all amounts from real data.
// Claude is used ONLY to:
//   (a) confirm whether a large expense is genuinely a prepayment, and
//   (b) write a plain-English rationale.
// It NEVER invents amounts, accounts, or journal entries.

export const config = { api: { bodyParser: { sizeLimit: "256kb" } } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { candidates, period } = req.body ?? {};
  if (!Array.isArray(candidates) || !candidates.length) return res.json({ results: [] });

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();

  // ── Heuristic fallback (no API key or called in tests) ────────────────────────
  const heuristicFallback = () =>
    res.json({
      results: candidates.map((c, i) => ({
        id: i,
        code: c.code,
        is_prepayment: true,
        spread_months: c.spread_estimate,
        rationale:
          `${c.account_name} payment of ${c.amount_fmt} is ` +
          `${(c.amount / c.avg_per_month).toFixed(1)}× the typical monthly spend of ` +
          `${c.avg_fmt}. Likely an advance or annual payment.`,
      })),
    });

  if (!apiKey) return heuristicFallback();

  // ── Build the strict-JSON prompt ─────────────────────────────────────────────
  const inputList = candidates.map((c, i) => ({
    id: i,
    account: `${c.code} — ${c.account_name}`,
    period,
    payment_amount: c.amount,
    typical_monthly_spend: c.avg_per_month,
    multiple_of_typical: parseFloat((c.amount / c.avg_per_month).toFixed(2)),
    payment_description: c.description,
    keyword_detected: c.has_keyword,
  }));

  const prompt =
`You are a professional Irish accountant. For each expense payment below, decide whether it is a prepayment under FRS 102 (an advance payment to be deferred over multiple periods) and estimate the spread period.

Return ONLY a JSON array — no prose, no questions, no markdown fences. One object per input.

Input:
${JSON.stringify(inputList, null, 2)}

Each output object:
{
  "id": <integer matching input id>,
  "is_prepayment": true | false,
  "spread_months": <integer 1-24; 1 means the full amount belongs to this period>,
  "rationale": "<1-2 sentences. Cite ONLY figures from the input. Do not invent amounts.>"
}

Classification guide:
- Annual insurance premium → typically 12 months
- Monthly SaaS/software subscription paid annually → 12 months
- Rent in advance → 1, 3, or 6 months depending on context
- Quarterly maintenance → 3 months
- If not a clear prepayment, set is_prepayment: false and spread_months: 1
- Do NOT ask questions; do NOT output anything other than the JSON array`;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 800,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const aiData = await resp.json();
    const raw = (aiData.content?.[0]?.text ?? "").replace(/```(?:json)?/gi, "").trim();
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return heuristicFallback();

    const aiResults = JSON.parse(match[0]);
    const byId = Object.fromEntries(aiResults.map((r) => [r.id, r]));

    const results = candidates.map((c, i) => {
      const ai = byId[i];
      if (!ai) return { id: i, code: c.code, is_prepayment: true, spread_months: c.spread_estimate, rationale: null };
      return {
        id: i,
        code: c.code,
        is_prepayment: Boolean(ai.is_prepayment),
        spread_months: Math.min(Math.max(Number(ai.spread_months) || c.spread_estimate, 1), 24),
        rationale: typeof ai.rationale === "string" ? ai.rationale : null,
      };
    });

    return res.json({ results });
  } catch (_err) {
    return heuristicFallback();
  }
}
