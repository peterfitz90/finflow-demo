import { withSentry, captureError } from './_sentry.js';
import { requireCompanyMember, AuthError } from './_auth.js';
import { AI_MODEL, callClaude } from './_anthropic.js';

// The request to Anthropic is built here, server-side, from a small allow-list of fields.
// This used to forward req.body verbatim with no auth — an open proxy on our API key
// (any caller could pick the model, max_tokens, tools, etc.).
// The model is pinned server-side in api/_anthropic.js (AI_MODEL.chat), never caller-chosen.
const MAX_TOKENS     = 1000;                // the panel asks for 1000; a caller can ask for less, never more
const MAX_MESSAGES   = 40;
const MAX_MSG_CHARS  = 8000;
const MAX_SYSTEM_CHARS = 60000;             // the panel's system prompt carries the account-data snapshot

export default withSentry(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { company_id, system, messages, max_tokens } = req.body ?? {};
  try {
    await requireCompanyMember(req, company_id);
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    throw e;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return res.status(500).json({ error: 'AI not configured' });

  // Only plain-text user/assistant turns. The Messages API requires the first message to
  // be from the user, so any leading assistant turns (the panel opens with a greeting)
  // are dropped.
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages must be an array' });
  let clean = messages
    .filter(m => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map(m => ({ role: m.role, content: m.content.slice(0, MAX_MSG_CHARS) }));
  while (clean.length && clean[0].role !== 'user') clean.shift();
  clean = clean.slice(-MAX_MESSAGES);
  while (clean.length && clean[0].role !== 'user') clean.shift(); // re-check after trimming
  if (!clean.length) return res.status(400).json({ error: 'No user message to send' });

  try {
    const { ok, status, data } = await callClaude({
      model: AI_MODEL.chat,
      max_tokens: Math.min(Number(max_tokens) || MAX_TOKENS, MAX_TOKENS),
      messages: clean,
      system: typeof system === 'string' && system.trim() ? system.slice(0, MAX_SYSTEM_CHARS) : undefined,
      operation: 'chat-anthropic-call',
      company_id,
    });
    if (!ok) {
      return res.status(500).json({ error: data?.error?.message || `Anthropic API error ${status}` });
    }
    res.status(200).json(data);
  } catch (error) {
    captureError(error, { operation: 'chat-anthropic-call', company_id });
    res.status(500).json({ error: error.message });
  }
});
