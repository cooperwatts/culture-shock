import { DomainError } from "@culture-shock/domain";
import { fromBase64Url } from "@culture-shock/crypto";

export interface OidcDiscovery {
  readonly issuer: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly jwks_uri: string;
}

export interface IdTokenClaims {
  readonly iss: string;
  readonly sub: string;
  readonly aud: string | string[];
  readonly exp: number;
  readonly iat: number;
  readonly nonce?: string;
  readonly email?: string;
  readonly name?: string;
  readonly tid?: string;
  readonly hd?: string;
}

interface CachedJwks {
  readonly keys: JsonWebKey[];
  readonly fetchedAt: number;
}

const DISCOVERY_TTL_MS = 10 * 60 * 1000;
const JWKS_TTL_MS = 10 * 60 * 1000;
const discoveryCache = new Map<string, { value: OidcDiscovery; fetchedAt: number }>();
const jwksCache = new Map<string, CachedJwks>();

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new DomainError("dependency_unavailable", "Identity provider metadata could not be retrieved");
  }
  return (await response.json()) as T;
}

/** Discovery documents are cached with a bounded TTL to limit provider calls. */
export async function discover(issuer: string): Promise<OidcDiscovery> {
  const cached = discoveryCache.get(issuer);
  if (cached && Date.now() - cached.fetchedAt < DISCOVERY_TTL_MS) return cached.value;

  const normalized = issuer.replace(/\/$/, "");
  const document = await fetchJson<OidcDiscovery>(`${normalized}/.well-known/openid-configuration`);

  // The discovered issuer must match what the installation configured, so a
  // hijacked metadata document cannot redirect token validation elsewhere.
  if (document.issuer.replace(/\/$/, "") !== normalized) {
    throw new DomainError("dependency_unavailable", "Identity provider issuer mismatch");
  }

  discoveryCache.set(issuer, { value: document, fetchedAt: Date.now() });
  return document;
}

async function loadJwks(jwksUri: string): Promise<JsonWebKey[]> {
  const cached = jwksCache.get(jwksUri);
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;
  const document = await fetchJson<{ keys: JsonWebKey[] }>(jwksUri);
  jwksCache.set(jwksUri, { keys: document.keys, fetchedAt: Date.now() });
  return document.keys;
}

function decodeSegment<T>(segment: string): T {
  return JSON.parse(new TextDecoder().decode(fromBase64Url(segment))) as T;
}

export interface VerifyOptions {
  readonly issuer: string;
  readonly clientId: string;
  readonly nonce: string;
  readonly allowedTenantIds: readonly string[];
  readonly allowedDomains: readonly string[];
  readonly now?: number;
}

/**
 * Verifies an ID token: RS256 signature against the provider JWKS, issuer,
 * audience, expiry, nonce, and the installation's tenant/domain allowlist.
 * Fails closed on any ambiguity, including multiple candidate keys failing.
 */
export async function verifyIdToken(idToken: string, options: VerifyOptions): Promise<IdTokenClaims> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new DomainError("unauthenticated", "Malformed identity token");
  const [headerSegment, payloadSegment, signatureSegment] = parts as [string, string, string];

  const header = decodeSegment<{ alg: string; kid?: string }>(headerSegment);
  if (header.alg !== "RS256") {
    throw new DomainError("unauthenticated", "Unsupported identity token algorithm");
  }

  const discovery = await discover(options.issuer);
  const keys = await loadJwks(discovery.jwks_uri);
  const candidates = header.kid
    ? keys.filter((key) => (key as { kid?: string }).kid === header.kid)
    : keys;
  if (candidates.length === 0) {
    throw new DomainError("unauthenticated", "Identity token signing key was not found");
  }

  const data = new TextEncoder().encode(`${headerSegment}.${payloadSegment}`);
  const signature = fromBase64Url(signatureSegment);

  let verified = false;
  for (const jwk of candidates) {
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    if (await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, data)) {
      verified = true;
      break;
    }
  }
  if (!verified) throw new DomainError("unauthenticated", "Identity token signature is invalid");

  const claims = decodeSegment<IdTokenClaims>(payloadSegment);
  const now = Math.floor((options.now ?? Date.now()) / 1000);

  if (claims.iss.replace(/\/$/, "") !== discovery.issuer.replace(/\/$/, "")) {
    throw new DomainError("unauthenticated", "Identity token issuer is not trusted");
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(options.clientId)) {
    throw new DomainError("unauthenticated", "Identity token audience is not trusted");
  }
  if (claims.exp <= now) throw new DomainError("unauthenticated", "Identity token has expired");
  if (claims.iat > now + 300) throw new DomainError("unauthenticated", "Identity token is not yet valid");
  if (claims.nonce !== options.nonce) {
    throw new DomainError("unauthenticated", "Identity token nonce does not match");
  }
  if (options.allowedTenantIds.length > 0 && (!claims.tid || !options.allowedTenantIds.includes(claims.tid))) {
    throw new DomainError("forbidden", "Identity is outside the permitted tenant");
  }
  if (options.allowedDomains.length > 0) {
    // Domain is a secondary check only; the tenant and issuer are the identity.
    const domain = claims.hd ?? claims.email?.split("@")[1];
    if (!domain || !options.allowedDomains.includes(domain.toLowerCase())) {
      throw new DomainError("forbidden", "Identity is outside the permitted domain");
    }
  }

  return claims;
}

export interface TokenExchangeInput {
  readonly tokenEndpoint: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly code: string;
  readonly redirectUri: string;
  readonly codeVerifier: string;
}

export async function exchangeCode(input: TokenExchangeInput): Promise<{ id_token: string }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code_verifier: input.codeVerifier,
  });

  const response = await fetch(input.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
  });
  if (!response.ok) {
    throw new DomainError("unauthenticated", "Authorization code could not be exchanged");
  }
  const payload = (await response.json()) as { id_token?: string };
  if (!payload.id_token) throw new DomainError("unauthenticated", "Identity provider returned no identity token");
  return { id_token: payload.id_token };
}

/** Only exact same-origin paths from the configured allowlist are honoured. */
export function safeRedirectPath(requested: string | null, allowed: readonly string[]): string {
  if (!requested) return allowed[0] ?? "/";
  return allowed.includes(requested) ? requested : (allowed[0] ?? "/");
}
