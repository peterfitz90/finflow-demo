// INT-01 Stage 2: verify a Clerk OAuth access token (JWT format) locally, against the instance's
// published keys, without @clerk/backend. Not wired to any endpoint yet.
//
// Why each check exists:
// - Clerk signs session tokens, ID tokens and OAuth access tokens with the SAME instance key and
//   issuer, so signature + issuer alone would accept a browser session token. The client_id
//   allow-list and the required scope are what make a token "an access token for this server".
// - Clerk's docs don't list the access-token claims (checked 2026-10-05), so the scope claim is read
//   from `scp` (array or string) or `scope` (string), and the client from `client_id` or `azp`.
//   Confirm against a real development-instance token before relying on any one name.
// - Clerk documents no RFC 8707 `resource` / `aud` for access tokens; `audience` is enforced only
//   when configured.
// - Revocation: a JWT stays valid until `exp` (Clerk documents 1 day; one example shows 2 hours).
//   Local verification can't see /oauth/token/revoke; `maxTokenAgeSec` caps how long a token is
//   honoured regardless of `exp`.
import { createRemoteJWKSet, jwtVerify, decodeProtectedHeader, errors } from 'jose';

const DEFAULT_CLOCK_TOLERANCE_SEC = 30;

// Remote key sets are cached per JWKS URL for the life of the warm function instance. jose caches
// the keys (cacheMaxAge) and refetches on an unknown `kid`, at most once per cooldownDuration.
const jwksCache = new Map();
function remoteJwks(url) {
  if (!jwksCache.has(url)) {
    jwksCache.set(url, createRemoteJWKSet(new URL(url), { cacheMaxAge: 10 * 60_000, cooldownDuration: 30_000, timeoutDuration: 5_000 }));
  }
  return jwksCache.get(url);
}

export function scopesOf(payload) {
  const raw = payload.scp ?? payload.scope;
  if (Array.isArray(raw)) return raw.filter(s => typeof s === 'string');
  if (typeof raw === 'string') return raw.split(/\s+/).filter(Boolean);
  return [];
}

const fail = (code, detail) => ({ ok: false, code, detail });

// options:
//   issuer            exact `iss` (the Clerk Frontend API URL), required
//   jwksUrl           defaults to `${issuer}/.well-known/jwks.json`
//   jwks              a key resolver (tests pass createLocalJWKSet); overrides jwksUrl
//   allowedClientIds  non-empty list of OAuth client ids (or CIMD client URLs) allowed to call us
//   requiredScopes    every one must be present
//   audience          optional: enforced only when given
//   clockToleranceSec default 30
//   maxTokenAgeSec    optional: reject tokens whose `iat` is older than this
export function createClerkTokenVerifier(options) {
  const { issuer, allowedClientIds, requiredScopes = [], audience, clockToleranceSec = DEFAULT_CLOCK_TOLERANCE_SEC, maxTokenAgeSec } = options || {};
  if (!issuer) throw new Error('issuer is required');
  if (!Array.isArray(allowedClientIds) || !allowedClientIds.length) throw new Error('allowedClientIds must be a non-empty list');
  const keys = options.jwks || remoteJwks(options.jwksUrl || `${issuer.replace(/\/$/, '')}/.well-known/jwks.json`);

  return async function verify(token, { now } = {}) {
    if (typeof token !== 'string' || token.split('.').length !== 3) return fail('malformed', 'not a compact JWS');
    let header;
    try { header = decodeProtectedHeader(token); } catch { return fail('malformed', 'unreadable header'); }
    if (header.alg !== 'RS256') return fail('bad_alg', `alg ${header.alg}`);
    if (header.typ && !['JWT', 'at+jwt', 'application/at+jwt'].includes(header.typ)) return fail('bad_typ', `typ ${header.typ}`);

    let payload;
    try {
      ({ payload } = await jwtVerify(token, keys, {
        issuer,
        audience,                       // undefined → not checked
        algorithms: ['RS256'],
        clockTolerance: clockToleranceSec,
        maxTokenAge: maxTokenAgeSec,    // uses iat
        requiredClaims: ['sub', 'exp', 'iat'],
        currentDate: now,
      }));
    } catch (e) {
      // jose reports maxTokenAge as a JWTExpired on `iat`, so check the claim before the class.
      if (e instanceof errors.JWTExpired) return fail(e.claim === 'iat' ? 'too_old' : 'expired', e.message);
      if (e instanceof errors.JWTClaimValidationFailed) {
        if (e.claim === 'iss') return fail('wrong_issuer', e.message);
        if (e.claim === 'aud') return fail('wrong_audience', e.message);
        if (e.claim === 'iat' || e.claim === 'nbf') return fail('not_yet_valid', e.message);
        return fail('missing_claim', e.message);
      }
      if (e instanceof errors.JWKSNoMatchingKey) return fail('unknown_key', e.message);
      if (e instanceof errors.JWSSignatureVerificationFailed) return fail('bad_signature', e.message);
      if (e instanceof errors.JWKSTimeout || e?.code === 'ERR_JOSE_GENERIC') return fail('keys_unavailable', e.message);
      return fail('invalid', e.message);
    }

    const clientId = payload.client_id ?? payload.azp;
    if (!clientId || !allowedClientIds.includes(clientId)) return fail('client_not_allowed', `client ${clientId ?? '(none)'}`);
    const scopes = scopesOf(payload);
    const missing = requiredScopes.filter(s => !scopes.includes(s));
    if (missing.length) return fail('missing_scope', `missing ${missing.join(' ')}`);
    if (typeof payload.sub !== 'string' || !payload.sub.startsWith('user_')) return fail('bad_subject', 'sub is not a Clerk user id');

    return { ok: true, userId: payload.sub, clientId, scopes, orgId: payload.org_id ?? null, expiresAt: payload.exp, issuedAt: payload.iat };
  };
}
