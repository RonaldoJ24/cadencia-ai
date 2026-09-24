// Access identity boundary: Cloudflare Access JWT verification with test double.
//
// Production path verifies the `cf-access-jwt-assertion` header per
// https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/:
// RS256 signature against the team JWKS endpoint, issuer pinned to the team
// domain, audience pinned to the application AUD tag, expiration enforced.
// Required configuration (fail closed when absent):
//   CADENCIA_ACCESS_TEAM_DOMAIN e.g. https://<team>.cloudflareaccess.com
//   CADENCIA_ACCESS_AUD        the Access application AUD tag
// Identity is derived only from verified claims (`sub` + `email`).
// The test double (`x-test-user-sub` / `x-test-user-email`) works only for
// loopback requests when CADENCIA_ALLOW_TEST_IDENTITY=true. Forged
// `cf-access-authenticated-user-email` headers are never read.

import { RUNTIME_ENV_KEY } from './live.ts';

export type VerifiedUser = {
  id: string;
  accessSubject: string;
  emailHash: string;
};

export type IdentityFailure =
  | { ok: false; reason: 'missing_credentials' | 'test_identity_disabled' | 'invalid_test_identity' | 'needs_verification' };
export type IdentityResult = { ok: true; user: Omit<VerifiedUser, 'id'> } | IdentityFailure;

type EnvLike = Record<string, unknown>;

export type IdentityDeps = {
  /** Override the JWKS fetch (tests). Defaults to global fetch. */
  fetchJwks?: (url: string, init: { signal: AbortSignal }) => Promise<Response>;
  /** Override current time in seconds (tests). Defaults to Date.now()/1000. */
  nowSec?: () => number;
};

const JWKS_TIMEOUT_MS = 5_000;
const JWKS_CACHE_TTL_MS = 10 * 60_000;
const JWKS_MAX_BYTES = 65_536;
const CLOCK_SKEW_SEC = 60;
/** Cooldown between JWKS refresh attempts per issuer. */
const JWKS_REFRESH_COOLDOWN_MS = 30_000;
/** Hard caps applied before any JWT parsing work. */
const MAX_ASSERTION_CHARS = 8_192;
const MAX_KID_CHARS = 256;

type JwksCache = { url: string; expiresAtMs: number; keys: unknown[] };
/**
 * Per-issuer refresh gate. A network refresh is attempted at most once per
 * cooldown window no matter how many distinct attacker-controlled kids
 * arrive — including cold starts, failed fetches, and malformed or
 * oversized bodies. The slot is claimed BEFORE attempting the fetch, so a
 * failure still consumes it. Tradeoff, documented: genuine key rotation is
 * picked up at most JWKS_REFRESH_COOLDOWN_MS after the cached set stops
 * matching; cached known-key verification is never gated.
 */
type RefreshGate = { url: string; nextRefreshMs: number };
type Inflight = { url: string; promise: Promise<unknown[] | null> };

let jwksCache: JwksCache | null = null;
let refreshGate: RefreshGate | null = null;
let inflight: Inflight | null = null;

/** Test-only state reset so JWKS fixtures stay isolated between cases. */
export function resetAccessKeyCache(): void {
  jwksCache = null;
  refreshGate = null;
  inflight = null;
}

function envString(env: EnvLike | undefined, name: string): string {
  if (!env) return '';
  const value = env[name];
  return typeof value === 'string' ? value.trim() : '';
}

function validEmail(value: string): boolean {
  if (value.length === 0 || value.length > 320) return false;
  if (value.includes(' ') || value.includes('\n')) return false;
  const at = value.indexOf('@');
  return at > 0 && at < value.length - 1 && value.indexOf('@', at + 1) === -1;
}

export async function hashEmailHex(email: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(email.trim().toLowerCase()),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function testIdentityFrom(request: Request): { subject: string; email: string } | null {
  const subject = (request.headers.get('x-test-user-sub') ?? '').trim();
  const email = (request.headers.get('x-test-user-email') ?? '').trim();
  if (!subject && !email) return null;
  return { subject, email };
}

function isLoopbackRequest(request: Request): boolean {
  try {
    const host = new URL(request.url).hostname.toLowerCase();
    return (
      host === 'localhost' ||
      host === '::1' ||
      host === '[::1]' ||
      /^127(?:\.\d{1,3}){3}$/u.test(host)
    );
  } catch {
    return false;
  }
}

function base64UrlDecode(segment: string): Uint8Array {
  const padded = segment.replace(/-/gu, '+').replace(/_/gu, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function jsonObject(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function normalizedTeamDomain(raw: string): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.replace(/\/+$/u, ''));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    return null;
  }
  if (url.pathname !== '/' && url.pathname !== '') return null;
  return `${url.protocol}//${url.host}`;
}

async function readCappedText(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) {
    const raw = await response.text();
    if (new TextEncoder().encode(raw).byteLength > JWKS_MAX_BYTES) return null;
    return raw;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > JWKS_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(part.value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return null;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

async function fetchJwksKeys(
  url: string,
  fetcher: NonNullable<IdentityDeps['fetchJwks']>,
): Promise<unknown[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JWKS_TIMEOUT_MS);
  try {
    const response = await fetcher(url, { signal: controller.signal });
    // Never follow a redirect with identity trust: a 3xx is a failure.
    if (response.status >= 300 && response.status < 400) return null;
    if (!response.ok) return null;
    const raw = await readCappedText(response);
    if (raw === null) return null;
    const root: unknown = JSON.parse(raw);
    if (typeof root !== 'object' || root === null || Array.isArray(root)) return null;
    const keys = (root as Record<string, unknown>).keys;
    return Array.isArray(keys) ? keys : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Single-flight JWKS fetch per URL: concurrent requests share one network
 * call instead of stampeding the certs endpoint. The cache is filled before
 * the in-flight slot is released, so a request arriving between the two
 * never finds neither and trips the cooldown gate.
 */
function singleFlightFetch(
  url: string,
  fetcher: NonNullable<IdentityDeps['fetchJwks']>,
  nowMs: number,
): Promise<unknown[] | null> {
  if (inflight && inflight.url === url) return inflight.promise;
  const promise = fetchJwksKeys(url, fetcher)
    .then((keys) => {
      if (keys !== null) {
        jwksCache = { url, expiresAtMs: nowMs + JWKS_CACHE_TTL_MS, keys };
      }
      return keys;
    })
    .finally(() => {
      if (inflight && inflight.url === url) inflight = null;
    });
  inflight = { url, promise };
  return promise;
}

function jwkForKid(keys: unknown[], kid: string): Record<string, unknown> | null {
  for (const key of keys) {
    if (typeof key !== 'object' || key === null || Array.isArray(key)) continue;
    const candidate = key as Record<string, unknown>;
    if (candidate.kid === kid && candidate.kty === 'RSA') return candidate;
  }
  return null;
}

async function verifyRs256(
  signingInput: Uint8Array,
  signature: Uint8Array,
  jwk: Record<string, unknown>,
): Promise<boolean> {
  try {
    if (typeof jwk.n !== 'string' || typeof jwk.e !== 'string') return false;
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      signature as BufferSource,
      signingInput as BufferSource,
    );
  } catch {
    return false;
  }
}

function audienceMatches(aud: unknown, expected: string): boolean {
  if (typeof aud === 'string') return aud === expected;
  if (Array.isArray(aud)) return aud.some((entry) => entry === expected);
  return false;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

const ACCESS_ENV_NAMES = ['CADENCIA_ACCESS_TEAM_DOMAIN', 'CADENCIA_ACCESS_AUD'] as const;

function dictOf(value: unknown): EnvLike {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as EnvLike)
    : {};
}

/**
 * Ambient Access configuration. `resolveRouteDeps` only carries the three
 * live-service strings, so the two Access names are also read from the
 * Worker binding bridge, the Node process environment, and `worker.env`.
 * Explicit handler env always wins; ambient sources only fill gaps.
 */
async function ambientAccessEnv(): Promise<EnvLike> {
  const out: EnvLike = {};
  const scope = globalThis as Record<string, unknown>;
  const sources: EnvLike[] = [dictOf(scope[RUNTIME_ENV_KEY])];
  if (typeof process !== 'undefined' && process.env) sources.push(process.env as EnvLike);
  try {
    const worker = await import('cloudflare:workers');
    sources.push(dictOf((worker.env as unknown as Record<string, unknown>) ?? {}));
  } catch {
    // Non-Worker runtimes (tests, Node dev) simply skip this source.
  }
  for (const name of ACCESS_ENV_NAMES) {
    for (const source of sources) {
      if (typeof source[name] === 'string' && (source[name] as string).trim()) {
        out[name] = source[name];
        break;
      }
    }
  }
  return out;
}

/**
 * Resolve verified beta identity from a Cloudflare Access JWT.
 * Never trusts browser input except via the explicit test double, which
 * requires both CADENCIA_ALLOW_TEST_IDENTITY=true and a loopback request
 * URL. Any unverifiable assertion — including missing Access configuration
 * — fails closed.
 */
export async function resolveIdentity(
  request: Request,
  env?: EnvLike,
  deps?: IdentityDeps,
): Promise<IdentityResult> {
  const testIdentity = testIdentityFrom(request);
  if (testIdentity) {
    if (envString(env, 'CADENCIA_ALLOW_TEST_IDENTITY') !== 'true' || !isLoopbackRequest(request)) {
      return { ok: false, reason: 'test_identity_disabled' };
    }
    const { subject, email } = testIdentity;
    if (subject.length === 0 || subject.length > 256 || !validEmail(email)) {
      return { ok: false, reason: 'invalid_test_identity' };
    }
    return {
      ok: true,
      user: { accessSubject: `test:${subject}`, emailHash: await hashEmailHex(email) },
    };
  }

  const assertion = (request.headers.get('cf-access-jwt-assertion') ?? '').trim();
  if (!assertion) return { ok: false, reason: 'missing_credentials' };
  if (assertion.length > MAX_ASSERTION_CHARS) return { ok: false, reason: 'needs_verification' };

  const ambient = await ambientAccessEnv();
  const teamDomain = normalizedTeamDomain(
    envString(env, 'CADENCIA_ACCESS_TEAM_DOMAIN') || envString(ambient, 'CADENCIA_ACCESS_TEAM_DOMAIN'),
  );
  const audience = envString(env, 'CADENCIA_ACCESS_AUD') || envString(ambient, 'CADENCIA_ACCESS_AUD');
  if (!teamDomain || !audience || audience.length > 256) {
    return { ok: false, reason: 'needs_verification' };
  }

  const segments = assertion.split('.');
  if (segments.length !== 3) return { ok: false, reason: 'needs_verification' };
  let header: Record<string, unknown> | null;
  let claims: Record<string, unknown> | null;
  let signingInput: Uint8Array;
  let signature: Uint8Array;
  try {
    header = jsonObject(base64UrlDecode(segments[0]));
    claims = jsonObject(base64UrlDecode(segments[1]));
    signingInput = new TextEncoder().encode(`${segments[0]}.${segments[1]}`);
    signature = base64UrlDecode(segments[2]);
  } catch {
    return { ok: false, reason: 'needs_verification' };
  }
  if (
    !header ||
    header.alg !== 'RS256' ||
    typeof header.kid !== 'string' ||
    !header.kid ||
    header.kid.length > MAX_KID_CHARS
  ) {
    return { ok: false, reason: 'needs_verification' };
  }
  if (!claims) return { ok: false, reason: 'needs_verification' };
  const kid = header.kid;

  const nowSec = deps?.nowSec ? deps.nowSec() : Date.now() / 1000;
  if (!Number.isFinite(nowSec)) return { ok: false, reason: 'needs_verification' };
  if (claims.iss !== teamDomain) return { ok: false, reason: 'needs_verification' };
  if (!audienceMatches(claims.aud, audience)) return { ok: false, reason: 'needs_verification' };
  if (!finiteNumber(claims.exp) || !(claims.exp + CLOCK_SKEW_SEC > nowSec)) {
    return { ok: false, reason: 'needs_verification' };
  }
  if (
    claims.nbf !== undefined &&
    (!finiteNumber(claims.nbf) || !(claims.nbf - CLOCK_SKEW_SEC <= nowSec))
  ) {
    return { ok: false, reason: 'needs_verification' };
  }
  if (
    claims.iat !== undefined &&
    (!finiteNumber(claims.iat) || !(claims.iat - CLOCK_SKEW_SEC <= nowSec))
  ) {
    return { ok: false, reason: 'needs_verification' };
  }
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 256) {
    return { ok: false, reason: 'needs_verification' };
  }
  if (typeof claims.email !== 'string' || !validEmail(claims.email)) {
    return { ok: false, reason: 'needs_verification' };
  }

  const fetcher = deps?.fetchJwks ??
    ((url: string, init: { signal: AbortSignal }) =>
      fetch(url, { ...init, redirect: 'manual' }));
  const certsUrl = `${teamDomain}/cdn-cgi/access/certs`;
  const nowMs = nowSec * 1000;
  const freshCache = jwksCache && jwksCache.url === certsUrl && jwksCache.expiresAtMs > nowMs
    ? jwksCache
    : null;
  const cachedJwk = freshCache ? jwkForKid(freshCache.keys, kid) : null;
  const authed = async (jwk: Record<string, unknown>): Promise<IdentityResult> => {
    if (!(await verifyRs256(signingInput, signature, jwk))) {
      return { ok: false, reason: 'needs_verification' };
    }
    return {
      ok: true,
      user: {
        accessSubject: `access:${claims.sub as string}`,
        emailHash: await hashEmailHex(claims.email as string),
      },
    };
  };
  if (cachedJwk) return authed(cachedJwk);
  // A refresh for this issuer is already in flight (possibly started by a
  // concurrent request): join it instead of failing or fetching again.
  if (inflight && inflight.url === certsUrl) {
    const shared = await inflight.promise;
    const jwk = shared ? jwkForKid(shared, kid) : null;
    if (!jwk) return { ok: false, reason: 'needs_verification' };
    return authed(jwk);
  }
  // Refresh path, bounded per issuer regardless of kid: skip the network
  // when the cooldown window claimed by an earlier attempt is still open.
  if (refreshGate && refreshGate.url === certsUrl && refreshGate.nextRefreshMs > nowMs) {
    return { ok: false, reason: 'needs_verification' };
  }
  refreshGate = { url: certsUrl, nextRefreshMs: nowMs + JWKS_REFRESH_COOLDOWN_MS };
  const keys = await singleFlightFetch(certsUrl, fetcher, nowMs);
  const jwk = keys ? jwkForKid(keys, kid) : null;
  if (!jwk) return { ok: false, reason: 'needs_verification' };
  return authed(jwk);
}
