// One place for the Claude model used by each AI endpoint, and the single call path to the
// Messages API. Upgrading a tier is a one-line change to STRONG / FAST below.
//
// Every ID is a pinned snapshot (Anthropic: "Every Claude model ID is a pinned snapshot, including
// the dateless IDs used from the 4.6 generation on"), so behaviour doesn't shift under us.
// Retirement dates, from platform.claude.com model-deprecations, checked 2026-10-01:
//   claude-sonnet-5-5          — active; retirement not sooner than 2027-09-28
//   claude-haiku-4-5-20251001  — active, no deprecation notice; not sooner than 2026-10-15
//                                (Anthropic gives at least 60 days' notice)
//   claude-sonnet-4-5 (replaced here) — deprecated 2026-09-30, retires 2026-11-30
//
// Thinking is off on every call, for predictable output and token use. How to say "off" differs by
// model: Sonnet 5.5 rejects {type:"disabled"} with a 400 and takes {type:"between_tools"} instead
// (with no tools, the reply is text only); Haiku 4.5 takes {type:"disabled"}. Omitting `thinking`
// on Sonnet 5.5 runs adaptive thinking, whose reply can lead with an empty thinking block — hence
// firstText(). A model missing from THINKING_OFF throws, so an upgrade can't silently send the
// wrong value: add the new model's entry when changing STRONG / FAST.

import { captureError, flushSentry } from './_sentry.js';

const STRONG = 'claude-sonnet-5-5';
const FAST   = 'claude-haiku-4-5-20251001';

export const AI_MODEL = {
  chat:            STRONG,
  categorise:      STRONG,
  extractReceipt:  STRONG,
  inboundEmail:    STRONG,
  suggestJournals: FAST,
};

const THINKING_OFF = {
  'claude-sonnet-5-5':         { type: 'between_tools' },
  'claude-haiku-4-5-20251001': { type: 'disabled' },
};

const API_URL     = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

// The reply's first text block, wherever it sits — not content[0], which can be a thinking block.
export const firstText = data =>
  (Array.isArray(data?.content) ? data.content : []).find(b => b?.type === 'text' && typeof b.text === 'string')?.text ?? '';

// Returns { ok, status, data, text }. Never throws for API or network failures: those are reported
// to Sentry (tagged with `operation` / `company_id`) and come back as ok:false, so each endpoint
// keeps its own fallback. A reply cut off at max_tokens is also reported (ok stays true).
export async function callClaude({ model, max_tokens, system, messages, extraHeaders, operation = 'anthropic-call', company_id }) {
  const thinking = THINKING_OFF[model];
  if (!thinking) throw new Error(`No thinking-off setting for model "${model}" — add it to THINKING_OFF in api/_anthropic.js`);

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  const report = async (msg, extra = {}) => {
    captureError(new Error(msg), { operation, company_id, model, ...extra });
    await flushSentry();
  };
  if (!apiKey) {
    await report('ANTHROPIC_API_KEY not configured');
    return { ok: false, status: 500, data: { error: { message: 'ANTHROPIC_API_KEY not configured' } }, text: '' };
  }

  const body = { model, max_tokens, thinking, messages, ...(system ? { system } : {}) };
  let response, data;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': API_VERSION, ...(extraHeaders || {}) },
      body: JSON.stringify(body),
    });
    data = await response.json().catch(() => null);
  } catch (e) {
    await report(`Anthropic request failed: ${e.message}`);
    return { ok: false, status: 0, data: { error: { message: e.message } }, text: '' };
  }

  if (!response.ok) {
    const msg = data?.error?.message || `Anthropic API error ${response.status}`;
    await report(`Anthropic ${response.status}: ${msg}`, { status: response.status, error_type: data?.error?.type });
    return { ok: false, status: response.status, data: data ?? { error: { message: msg } }, text: '' };
  }
  if (data?.stop_reason === 'max_tokens') {
    await report('Anthropic reply truncated at max_tokens', { max_tokens, usage: data.usage });
  }
  return { ok: true, status: response.status, data, text: firstText(data) };
}
