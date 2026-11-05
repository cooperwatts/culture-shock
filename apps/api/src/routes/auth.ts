import { Hono } from "hono";
import {
  DomainError,
  newId,
  type OrganizationId,
  type UserId,
} from "@culture-shock/domain";
import { meResponseSchema } from "@culture-shock/contracts";
import type { AppBindings } from "../env.js";
import { requireSecret, secret } from "../env.js";
import { Database, nowIso } from "../db/database.js";
import { UserRepository } from "../db/repositories.js";
import { RateLimiter } from "../db/guards.js";
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  csrfCookieName,
  sessionCookieName,
  clearCookie,
  csrfCookie,
  issueSession,
  requirePrincipal,
  sessionCookie,
} from "../auth/session.js";
import {
  discover,
  exchangeCode,
  safeRedirectPath,
  verifyIdToken,
} from "../auth/oidc.js";
import {
  decryptField,
  encryptField,
  fromBase64Url,
  lookupHmac,
  pkceChallenge,
  randomToken,
  sha256Base64Url,
} from "@culture-shock/crypto";
import { ok } from "../http/responses.js";
import { SessionRepository } from "../db/repositories.js";

export const authRoutes = new Hono<AppBindings>();

const CHALLENGE_TTL_SECONDS = 600;
const PROVIDER_SECRET_PREFIX = "OIDC_CLIENT_SECRET_";

function providerSecretName(kind: string): string {
  return `${PROVIDER_SECRET_PREFIX}${kind.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

authRoutes.get("/auth/:provider/start", async (c) => {
  const config = c.get("config");
  const organizationId = c.get("organizationId");
  if (!config || !organizationId)
    throw new DomainError("dependency_unavailable", "Installation not loaded");

  const kind = c.req.param("provider");
  const provider = config.authentication.providers.find(
    (candidate) => candidate.kind === kind && candidate.enabled,
  );
  if (!provider)
    throw new DomainError("not_found", "Identity provider is not enabled");

  const limiter = new RateLimiter(c.env.DB);
  const decision = await limiter.consume(
    `auth_start:${c.req.header("cf-connecting-ip") ?? "unknown"}`,
    20,
    300,
  );
  if (!decision.allowed) {
    throw new DomainError("rate_limited", "Too many sign-in attempts");
  }

  const discovery = await discover(provider.issuer);
  const state = randomToken(32);
  const nonce = randomToken(32);
  const codeVerifier = randomToken(48);

  const db = new Database(c.env.DB, organizationId);
  const encryptedVerifier = await encryptField(
    requireSecret(c.env, "FIELD_ENCRYPTION_KEY"),
    1,
    codeVerifier,
  );

  await db.run(
    `INSERT INTO auth_challenges
       (id, organization_id, kind, state_hash, code_verifier_enc, nonce_hash, redirect_path, expires_at, created_at)
     VALUES (?, ?, 'oidc', ?, ?, ?, ?, ?, ?)`,
    [
      newId("SessionId"),
      organizationId,
      await sha256Base64Url(state),
      encryptedVerifier.ciphertext,
      await sha256Base64Url(nonce),
      safeRedirectPath(
        c.req.query("redirect") ?? null,
        config.authentication.allowedRedirectPaths,
      ),
      new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000).toISOString(),
      nowIso(),
    ],
  );

  const authorizeUrl = new URL(discovery.authorization_endpoint);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", provider.clientId);
  authorizeUrl.searchParams.set(
    "redirect_uri",
    `${c.env.PUBLIC_BASE_URL}/api/v1/auth/${kind}/callback`,
  );
  authorizeUrl.searchParams.set("scope", provider.scopes.join(" "));
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("nonce", nonce);
  authorizeUrl.searchParams.set(
    "code_challenge",
    await pkceChallenge(codeVerifier),
  );
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  return c.redirect(authorizeUrl.toString(), 302);
});

authRoutes.get("/auth/:provider/callback", async (c) => {
  const config = c.get("config");
  const organizationId = c.get("organizationId") as OrganizationId;
  if (!config || !organizationId)
    throw new DomainError("dependency_unavailable", "Installation not loaded");

  const kind = c.req.param("provider");
  const provider = config.authentication.providers.find(
    (candidate) => candidate.kind === kind && candidate.enabled,
  );
  if (!provider)
    throw new DomainError("not_found", "Identity provider is not enabled");

  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state)
    throw new DomainError(
      "unauthenticated",
      "Incomplete authorization response",
    );

  const db = new Database(c.env.DB, organizationId);
  const stateHash = await sha256Base64Url(state);

  // The challenge row is consumed atomically, so a replayed callback fails.
  const consumed = await db.run(
    `UPDATE auth_challenges SET consumed_at = ?
      WHERE state_hash = ? AND organization_id = ? AND consumed_at IS NULL AND expires_at > ?`,
    [nowIso(), stateHash, organizationId, nowIso()],
  );
  if ((consumed.meta.changes ?? 0) === 0) {
    throw new DomainError(
      "unauthenticated",
      "Authorization request is no longer valid",
    );
  }

  const challenge = await db.first<{
    code_verifier_enc: string;
    nonce_hash: string;
    redirect_path: string;
  }>(
    `SELECT code_verifier_enc, nonce_hash, redirect_path FROM auth_challenges
      WHERE state_hash = ? AND organization_id = ?`,
    [stateHash, organizationId],
  );
  if (!challenge)
    throw new DomainError(
      "unauthenticated",
      "Authorization request is no longer valid",
    );

  const codeVerifier = await decryptField(
    requireSecret(c.env, "FIELD_ENCRYPTION_KEY"),
    challenge.code_verifier_enc,
  );

  const discovery = await discover(provider.issuer);
  const tokens = await exchangeCode({
    tokenEndpoint: discovery.token_endpoint,
    clientId: provider.clientId,
    clientSecret: requireSecret(c.env, providerSecretName(provider.kind)),
    code,
    redirectUri: `${c.env.PUBLIC_BASE_URL}/api/v1/auth/${kind}/callback`,
    codeVerifier,
  });

  // The stored nonce is hashed, so the raw nonce is recovered from the token
  // and compared by hash rather than kept in plaintext at rest.
  const unverifiedNonce = JSON.parse(
    new TextDecoder().decode(
      fromBase64Url(tokens.id_token.split(".")[1] ?? ""),
    ),
  ) as { nonce?: string };
  if (
    !unverifiedNonce.nonce ||
    (await sha256Base64Url(unverifiedNonce.nonce)) !== challenge.nonce_hash
  ) {
    throw new DomainError(
      "unauthenticated",
      "Identity token nonce does not match",
    );
  }

  const claims = await verifyIdToken(tokens.id_token, {
    issuer: provider.issuer,
    clientId: provider.clientId,
    nonce: unverifiedNonce.nonce,
    allowedTenantIds: provider.allowedTenantIds,
    allowedDomains: provider.allowedDomains.map((domain) =>
      domain.toLowerCase(),
    ),
  });

  const providerRow = await db.first<{ id: string }>(
    `SELECT id FROM identity_providers WHERE organization_id = ? AND kind = ? AND enabled = 1`,
    [organizationId, provider.kind],
  );
  if (!providerRow)
    throw new DomainError(
      "dependency_unavailable",
      "Identity provider is not provisioned",
    );

  const users = new UserRepository(db);
  let user = await users.findByProviderSubject(providerRow.id, claims.sub);

  if (!user) {
    const emailKey = secret(c.env, "EMAIL_LOOKUP_HMAC_KEY");
    const fieldKey = secret(c.env, "FIELD_ENCRYPTION_KEY");
    const email = claims.email ?? null;

    // The first account provisioned on a fresh installation becomes the
    // administrator; every later account starts as a participant.
    const anyAdmin = await db.first<{ count: number }>(
      `SELECT COUNT(*) AS count FROM role_grants WHERE organization_id = ? AND role = 'admin'`,
      [organizationId],
    );

    const userId = await users.createWithIdentity({
      providerId: providerRow.id,
      subject: claims.sub,
      displayName: claims.name ?? null,
      emailCiphertext:
        email && fieldKey
          ? (await encryptField(fieldKey, 1, email)).ciphertext
          : null,
      emailHmac: email && emailKey ? await lookupHmac(emailKey, email) : null,
      keyVersion: email && fieldKey ? 1 : null,
      defaultRole: (anyAdmin?.count ?? 0) === 0 ? "admin" : "participant",
    });
    user = {
      id: userId,
      status: "active",
      display_name: claims.name ?? null,
      work_email_ciphertext: null,
    };
  }

  // Session fixation defence: any prior session for this user is revoked and a
  // fresh identifier is issued on every successful authentication.
  await new SessionRepository(db).revokeAllForUser(user.id as UserId);
  const issued = await issueSession(db, user.id as UserId, config);
  const secureCookies = c.env.ENVIRONMENT !== "development";

  c.header(
    "set-cookie",
    sessionCookie(
      issued.sessionToken,
      config.authentication.sessionTtlSeconds,
      secureCookies,
    ),
    { append: true },
  );
  c.header(
    "set-cookie",
    csrfCookie(
      issued.csrfToken,
      config.authentication.sessionTtlSeconds,
      secureCookies,
    ),
    { append: true },
  );

  return c.redirect(
    `${c.env.PUBLIC_BASE_URL}${safeRedirectPath(challenge.redirect_path, config.authentication.allowedRedirectPaths)}`,
    302,
  );
});

authRoutes.post("/auth/logout", async (c) => {
  const principal = c.get("principal");
  const organizationId = c.get("organizationId");
  const secureCookies = c.env.ENVIRONMENT !== "development";

  if (principal && organizationId) {
    const db = new Database(c.env.DB, organizationId);
    await new SessionRepository(db).revoke(principal.sessionId);
    await db.commit([], {
      actorUserId: principal.userId,
      actorKind: "user",
      action: "session.revoked",
      resourceType: "session",
      resourceId: principal.sessionId,
      purpose: "authentication",
    });
  }

  c.header(
    "set-cookie",
    clearCookie(sessionCookieName(secureCookies), secureCookies),
    { append: true },
  );
  c.header(
    "set-cookie",
    clearCookie(csrfCookieName(secureCookies), secureCookies),
    { append: true },
  );
  return c.body(null, 204);
});

authRoutes.get("/me", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const config = c.get("config");
  const organizationId = c.get("organizationId");
  if (!config || !organizationId)
    throw new DomainError("dependency_unavailable", "Installation not loaded");

  const db = new Database(c.env.DB, organizationId);
  const user = await new UserRepository(db).findById(principal.userId);

  return ok(
    c,
    meResponseSchema.parse({
      userId: principal.userId,
      displayName: user?.display_name ?? null,
      roles: principal.roles,
      locale: config.organization.defaultLocale,
      timeZone: config.organization.defaultTimeZone,
      authenticatedAt: new Date(principal.authenticatedAt).toISOString(),
    }),
  );
});
