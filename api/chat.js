export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  console.log("[chat] API key present:", !!apiKey, "| first 10 chars:", apiKey ? apiKey.slice(0, 10) : "MISSING");
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    if (!response.ok) {
      return res.status(500).json({ error: data.error?.message || `Anthropic API error ${response.status}` });
    }
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
