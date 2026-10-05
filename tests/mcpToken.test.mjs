// Unit tests for api/_mcpToken.js with a locally generated RS256 key pair (no network, no Clerk).
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import { createClerkTokenVerifier, scopesOf } from '../api/_mcpToken.js';

const ISS = 'https://valid-unicorn-80.clerk.accounts.dev';
const CLIENT = 'oauth_client_ledgrly_test';
const SCOPE = 'ledgrly:read';

const kp = await generateKeyPair('RS256', { extractable: true });
const other = await generateKeyPair('RS256', { extractable: true });
const jwk = { ...(await exportJWK(kp.publicKey)), kid: 'ins_test', alg: 'RS256', use: 'sig' };
const jwks = createLocalJWKSet({ keys: [jwk] });
const verify = createClerkTokenVerifier({ issuer: ISS, jwks, allowedClientIds: [CLIENT], requiredScopes: [SCOPE] });

const nowSec = () => Math.floor(Date.now() / 1000);
async function mint({ claims = {}, header = {}, key = kp.privateKey, kid = 'ins_test', iat = nowSec(), exp = nowSec() + 3600 } = {}) {
  return new SignJWT({ sub: 'user_test123', client_id: CLIENT, scp: [SCOPE, 'openid'], ...claims })
    .setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT', ...header })
    .setIssuer(claims.iss ?? ISS).setIssuedAt(iat).setExpirationTime(exp).sign(key);
}

test('valid token → user, client, scopes', async () => {
  const r = await verify(await mint());
  assert.equal(r.ok, true);
  assert.equal(r.userId, 'user_test123');
  assert.equal(r.clientId, CLIENT);
  assert.deepEqual(r.scopes, [SCOPE, 'openid']);
});

test('expired token', async () => {
  const r = await verify(await mint({ iat: nowSec() - 7200, exp: nowSec() - 3600 }));
  assert.equal(r.code, 'expired');
});

test('expired by less than the 30s clock tolerance still passes', async () => {
  const r = await verify(await mint({ iat: nowSec() - 600, exp: nowSec() - 10 }));
  assert.equal(r.ok, true);
});

test('wrong issuer (e.g. the production instance)', async () => {
  const r = await verify(await mint({ claims: { iss: 'https://clerk.ledgrly.ie' } }));
  assert.equal(r.code, 'wrong_issuer');
});

test('wrong audience when an audience is configured', async () => {
  const v = createClerkTokenVerifier({ issuer: ISS, jwks, allowedClientIds: [CLIENT], requiredScopes: [SCOPE], audience: 'https://app.ledgrly.ie/api/mcp' });
  assert.equal((await v(await mint({ claims: { aud: 'https://elsewhere.example/mcp' } }))).code, 'wrong_audience');
  assert.equal((await v(await mint({ claims: { aud: 'https://app.ledgrly.ie/api/mcp' } }))).ok, true);
  assert.equal((await v(await mint())).code, 'wrong_audience', 'no aud at all must fail when audience is configured');
});

test('missing required scope', async () => {
  const r = await verify(await mint({ claims: { scp: ['openid', 'profile'] } }));
  assert.equal(r.code, 'missing_scope');
});

test('scope as a space-separated string is accepted', async () => {
  const r = await verify(await mint({ claims: { scp: undefined, scope: `openid ${SCOPE}` } }));
  assert.equal(r.ok, true);
  assert.deepEqual(scopesOf({ scope: 'a  b' }), ['a', 'b']);
});

test('tampered signature', async () => {
  const t = await mint();
  const [h, p, s] = t.split('.');
  const payload = JSON.parse(Buffer.from(p, 'base64url'));
  payload.sub = 'user_attacker';
  const forged = `${h}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${s}`;
  assert.equal((await verify(forged)).code, 'bad_signature');
});

test('unknown key id', async () => {
  const r = await verify(await mint({ kid: 'ins_rotated_away' }));
  assert.equal(r.code, 'unknown_key');
});

test('signed by another key under the known kid', async () => {
  const r = await verify(await mint({ key: other.privateKey }));
  assert.equal(r.code, 'bad_signature');
});

test('a Clerk session token (same key and issuer, no OAuth client, no scope) is rejected', async () => {
  const r = await verify(await mint({ claims: { client_id: undefined, azp: 'https://app.ledgrly.ie', scp: undefined, sid: 'sess_123' } }));
  assert.equal(r.code, 'client_not_allowed');
});

test('another OAuth client on the same instance is rejected', async () => {
  const r = await verify(await mint({ claims: { client_id: 'oauth_client_someone_else' } }));
  assert.equal(r.code, 'client_not_allowed');
});

test('alg confusion: HS256 and none are refused before verification', async () => {
  const hs = await new SignJWT({ sub: 'user_x', client_id: CLIENT, scp: [SCOPE] }).setProtectedHeader({ alg: 'HS256', kid: 'ins_test' })
    .setIssuer(ISS).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode('x'.repeat(32)));
  assert.equal((await verify(hs)).code, 'bad_alg');
  const none = `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'user_x' })).toString('base64url')}.`;
  assert.equal((await verify(none)).code, 'bad_alg');
});

test('an ID-token-like typ is refused', async () => {
  assert.equal((await verify(await mint({ header: { typ: 'id+jwt' } }))).code, 'bad_typ');
});

test('maxTokenAgeSec caps a long-lived token', async () => {
  const v = createClerkTokenVerifier({ issuer: ISS, jwks, allowedClientIds: [CLIENT], requiredScopes: [SCOPE], maxTokenAgeSec: 3600 });
  const r = await v(await mint({ iat: nowSec() - 7200, exp: nowSec() + 80000 }));
  assert.equal(r.code, 'too_old');
});

test('non-user subject is refused', async () => {
  assert.equal((await verify(await mint({ claims: { sub: 'client_abc' } }))).code, 'bad_subject');
});

test('garbage input', async () => {
  for (const t of [undefined, '', 'abc', 'a.b', 'a.b.c']) assert.equal((await verify(t)).ok, false);
});

test('config: issuer and a client allow-list are mandatory', () => {
  assert.throws(() => createClerkTokenVerifier({ allowedClientIds: [CLIENT] }));
  assert.throws(() => createClerkTokenVerifier({ issuer: ISS, allowedClientIds: [] }));
});
