// Feed categorisation (api/_categorise.js). Run: node --test "tests/*.test.mjs"
// Regression: from the 29 Sep 2026 auth lock-down the bank feed ingest reached /api/categorise over
// HTTP with no token, got a 401 and silently kept the 4100 / 6600 defaults. These tests fail if the
// feed can't categorise: the ingest must call the shared function in-process, and that function
// must return AI codes when the model answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { categorisePayees, categoriseFeedPayees, FEED_CHUNK } from '../api/_categorise.js';

const payees = n => Array.from({ length: n }, (_, i) => ({ key: `payee ${i}`, name: `Payee ${i}`, count: 1, totalAmount: -10, direction: 'expense' }));
// A stub of callClaude that answers like the model: every payee to 6300, except "to eur" to 1000.
const answering = async ({ messages }) => {
  const ps = JSON.parse(messages[0].content);
  return { ok: true, status: 200, text: JSON.stringify(ps.map(p => ({ id: p.key, nominal_code: p.key === 'to eur' ? '1000' : '6300', confidence: 'high' }))) };
};

test('the feed ingest categorises in-process, never over HTTP without a token', () => {
  const src = readFileSync(new URL('../api/yapily/ingest.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /fetch\([^)]*\/api\/categorise/, 'ingest must not call /api/categorise over HTTP');
  assert.match(src, /categoriseFeedPayees\(uniquePayees, \{ company_id \}\)/);
  assert.match(src, /captureError\(new Error\(`Feed AI categorisation/, 'a failure is reported, not swallowed');
});

test('a feed import categorises every payee when the model answers (more than one chunk)', async () => {
  const ps = [...payees(FEED_CHUNK + 5), { key: 'to eur', name: 'To EUR', count: 1, totalAmount: -100, direction: 'expense' }];
  const r = await categoriseFeedPayees(ps, { company_id: 'c', call: answering });
  assert.equal(r.ai, 'ok');
  assert.equal(r.chunks, 2);
  assert.equal(Object.keys(r.codes).length, ps.length, 'every payee has an AI code');
  assert.equal(r.codes['payee 0'], '6300');
  assert.equal(r.codes['to eur'], 'TRANSFER', 'a bank code from the model becomes a held transfer');
});

test('a failed AI call is reported as a failure, with no codes, not as success', async () => {
  const failing = async () => ({ ok: false, status: 401, text: '' });
  const r = await categoriseFeedPayees(payees(3), { company_id: 'c', call: failing });
  assert.equal(r.ai, 'fallback');
  assert.deepEqual(r.codes, {});
  assert.match(r.error, /401/);
  const partial = await categoriseFeedPayees(payees(FEED_CHUNK + 1), { company_id: 'c', call: async a => (JSON.parse(a.messages[0].content).length === 1 ? failing() : answering(a)) });
  assert.equal(partial.ai, 'partial');
  assert.equal(Object.keys(partial.codes).length, FEED_CHUNK);
});

test('categorisePayees: unparseable or thrown replies fall back to low-confidence defaults', async () => {
  const garbled = await categorisePayees(payees(2), { call: async () => ({ ok: true, status: 200, text: 'no json here' }) });
  assert.equal(garbled.ai, 'fallback');
  assert.deepEqual(garbled.results.map(x => [x.code, x.confidence]), [['6600', 'low'], ['6600', 'low']]);
  const thrown = await categorisePayees(payees(1), { call: async () => { throw new Error('boom'); } });
  assert.equal(thrown.ai, 'fallback');
  assert.equal(thrown.error, 'boom');
});
