// /api/categorise — AI categorisation for the app's statement import (any member of the company).
// The work is in api/_categorise.js, which the bank feed ingest calls in-process.
import { withSentry } from './_sentry.js';
import { requireCompanyMember, AuthError } from './_auth.js';
import { categorisePayees } from './_categorise.js';

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
  // An AI failure falls back to low-confidence defaults (reported to Sentry by callClaude).
  const { results, ai, error } = await categorisePayees(payees, { company_id });
  if (ai !== 'ok') console.warn("[categorise] fell back to defaults:", error);
  res.status(200).json({ results, ai });
});
