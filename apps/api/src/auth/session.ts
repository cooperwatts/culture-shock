import {
  DEFAULT_STEP_UP_MAX_AGE_SECONDS,
  newId,
  unauthenticated,
  type ExperienceId,
  type ExperienceRole,
  type OrganizationId,
  type Principal,
  type SessionId,
  type UserId,
} from "@culture-shock/domain";
import type { InstallationConfig } from "@culture-shock/config";
import { Database } from "../db/database.js";
import { SessionRepository, UserRepository } from "../db/repositories.js";
import {
  randomToken,
  sha256Base64Url,
  timingSafeEqual,
} from "@culture-shock/crypto";

const SESSION_COOKIE_BASE = "cs_session";
const CSRF_COOKIE_BASE = "cs_csrf";

export const SESSION_COOKIE = `__Host-${SESSION_COOKIE_BASE}`;
export const CSRF_COOKIE = `__Host-${CSRF_COOKIE_BASE}`;
export const CSRF_HEADER = "x-cs-csrf";

/**
 * The `__Host-` prefix requires `Secure`, which cannot be set over plain HTTP.
 * Local development drops the prefix; every deployed environment keeps it.
 */
export function sessionCookieName(secure: boolean): string {
  return secure ? SESSION_COOKIE : SESSION_COOKIE_BASE;
}

export function csrfCookieName(secure: boolean): string {
  return secure ? CSRF_COOKIE : CSRF_COOKIE_BASE;
}

export interface IssuedSession {
  readonly sessionToken: string;
  readonly csrfToken: string;
  readonly sessionId: string;
}

/**
 * Builds a session cookie. `__Host-` forces Secure and path `/` with no Domain,
 * which prevents a sibling subdomain from setting or reading the cookie.
 */
export function sessionCookie(
  token: string,
  maxAgeSeconds: number,
  secure: boolean,
): string {
  const attributes = [
    `${sessionCookieName(secure)}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

/** The CSRF cookie is deliberately readable by same-origin script for double-submit. */
export function csrfCookie(
  token: string,
  maxAgeSeconds: number,
  secure: boolean,
): string {
  const attributes = [
    `${csrfCookieName(secure)}=${token}`,
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function clearCookie(name: string, secure: boolean): string {
  const attributes = [`${name}=`, "Path=/", "Max-Age=0", "SameSite=Lax"];
  if (name.endsWith(SESSION_COOKIE_BASE)) attributes.push("HttpOnly");
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function readCookie(
  header: string | undefined,
  name: string,
): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

/** Issues a fresh session and rotates the CSRF token at the same time. */
export async function issueSession(
  db: Database,
  userId: UserId,
  config: InstallationConfig,
): Promise<IssuedSession> {
  const sessionToken = randomToken(32);
  const csrfToken = randomToken(32);
  const sessions = new SessionRepository(db);
  const sessionId = await sessions.create({
    userId,
    tokenHash: await sha256Base64Url(sessionToken),
    csrfTokenHash: await sha256Base64Url(csrfToken),
    ttlSeconds: config.authentication.sessionTtlSeconds,
    absoluteTtlSeconds: config.authentication.sessionAbsoluteTtlSeconds,
  });
  return { sessionToken, csrfToken, sessionId };
}

export interface ResolvedSession {
  readonly principal: Principal;
  readonly csrfTokenHash: string;
}

/**
 * Resolves a session cookie into a principal. Expiry, absolute expiry, and
 * revocation are all checked server-side; the cookie itself carries no claims.
 */
export async function resolveSession(
  db: Database,
  organizationId: OrganizationId,
  sessionToken: string,
  config: InstallationConfig,
): Promise<ResolvedSession | null> {
  const sessions = new SessionRepository(db);
  const row = await sessions.findByTokenHash(
    await sha256Base64Url(sessionToken),
  );
  if (!row) return null;

  const now = Date.now();
  if (row.revoked_at !== null) return null;
  if (new Date(row.expires_at).getTime() <= now) return null;
  if (new Date(row.absolute_expires_at).getTime() <= now) return null;

  const users = new UserRepository(db);
  const user = await users.findById(row.user_id as UserId);
  if (!user || user.status !== "active") return null;

  const roles = await users.installationRoles(row.user_id as UserId);
  const grants = await users.experienceGrants(row.user_id as UserId);

  await sessions.touch(row.id, config.authentication.sessionTtlSeconds);

  return {
    principal: {
      userId: row.user_id as UserId,
      organizationId,
      sessionId: row.id as SessionId,
      roles,
      experienceGrants: grants.map((grant) => ({
        experienceId: grant.experienceId as ExperienceId,
        role: grant.role as ExperienceRole,
      })),
      authenticatedAt: new Date(row.authenticated_at).getTime(),
    },
    csrfTokenHash: row.csrf_token_hash,
  };
}

/**
 * Double-submit CSRF check bound to the server-side session record, so a token
 * minted for another session cannot be replayed.
 */
export async function verifyCsrf(
  presentedToken: string | null,
  expectedHash: string,
): Promise<boolean> {
  if (!presentedToken) return false;
  return timingSafeEqual(await sha256Base64Url(presentedToken), expectedHash);
}

export function stepUpMaxAge(config: InstallationConfig | null): number {
  return (
    config?.authentication.stepUpMaxAgeSeconds ??
    DEFAULT_STEP_UP_MAX_AGE_SECONDS
  );
}

export function requirePrincipal(principal: Principal | null): Principal {
  if (!principal) throw unauthenticated();
  return principal;
}

export function newRequestId(): string {
  return newId("AuditEventId").slice(4, 20);
}
