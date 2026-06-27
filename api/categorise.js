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

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });

  const { payees } = req.body;
  if (!Array.isArray(payees) || !payees.length) {
    return res.status(400).json({ error: "payees array required" });
  }

  console.log("[categorise] categorising", payees.length, "unique payees");

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 4000,
        system: AI_SYSTEM,
        messages: [{ role: "user", content: JSON.stringify(payees) }],
      }),
    });

    const data = await response.json();
    console.log("[categorise] API status:", response.status, "| usage:", JSON.stringify(data.usage));
    const raw = data.content?.[0]?.text ?? "";
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
    console.error("[categorise] handler error:", error);
    res.status(500).json({ error: error.message });
  }
}
