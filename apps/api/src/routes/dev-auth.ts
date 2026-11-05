import { Hono } from "hono";
import {
  DomainError,
  INSTALLATION_ROLES,
  newId,
  type InstallationRole,
  type OrganizationId,
  type UserId,
} from "@culture-shock/domain";
import type { AppBindings } from "../env.js";
import { Database, nowIso } from "../db/database.js";
import { UserRepository } from "../db/repositories.js";
import { csrfCookie, issueSession, sessionCookie } from "../auth/session.js";

export const devAuthRoutes = new Hono<AppBindings>();

/**
 * Signs in as a local account without an identity provider.
 *
 * This exists so the interface can be used on a laptop. It is hard-gated on
 * ENVIRONMENT being "development", which the staging and production wrangler
 * environments both override, and it is the only route in the system that
 * creates a session without verifying an identity token.
 */
devAuthRoutes.get("/auth/dev-login", async (c) => {
  if (c.env.ENVIRONMENT !== "development") {
    throw new DomainError("not_found", "Resource not found");
  }

  const config = c.get("config");
  const organizationId = c.get("organizationId") as OrganizationId;
  if (!config || !organizationId) {
    throw new DomainError(
      "dependency_unavailable",
      "Run the bootstrap call first",
    );
  }

  const requested = c.req.query("as") ?? "admin";
  if (!INSTALLATION_ROLES.includes(requested as InstallationRole)) {
    throw new DomainError("validation_failed", `Unknown role "${requested}"`, {
      roles: INSTALLATION_ROLES,
    });
  }

  const role = requested as InstallationRole;
  const handle = c.req.query("handle") ?? role;
  const db = new Database(c.env.DB, organizationId);

  const existing = await db.first<{ id: string }>(
    `SELECT u.id FROM users u
       JOIN identities i ON i.user_id = u.id
      WHERE i.provider_subject = ? AND u.organization_id = ? AND u.deleted_at IS NULL`,
    [`dev:${handle}`, organizationId],
  );

  let userId: UserId;
  if (existing) {
    userId = existing.id as UserId;
    // `?as=` is the whole point of the route, so it wins over whatever the
    // handle was created with. Otherwise reusing a handle silently keeps the
    // old role and the test you thought you were running is not the one that ran.
    await setInstallationRole(db, userId, role);
  } else {
    const providerId = await ensureDevProvider(db, organizationId);
    userId = await new UserRepository(db).createWithIdentity({
      providerId,
      subject: `dev:${handle}`,
      displayName: `${handle.charAt(0).toUpperCase()}${handle.slice(1)} (local)`,
      emailCiphertext: null,
      emailHmac: null,
      keyVersion: null,
      defaultRole: role,
    });
  }

  const issued = await issueSession(db, userId, config);

  c.header(
    "set-cookie",
    sessionCookie(
      issued.sessionToken,
      config.authentication.sessionTtlSeconds,
      false,
    ),
    {
      append: true,
    },
  );
  c.header(
    "set-cookie",
    csrfCookie(
      issued.csrfToken,
      config.authentication.sessionTtlSeconds,
      false,
    ),
    {
      append: true,
    },
  );

  return c.redirect(c.req.query("redirect") ?? "/", 302);
});

/** Replaces the installation grants so the account holds exactly one role. */
async function setInstallationRole(
  db: Database,
  userId: UserId,
  role: InstallationRole,
): Promise<void> {
  const current = await new UserRepository(db).installationRoles(userId);
  if (current.length === 1 && current[0] === role) return;

  const timestamp = nowIso();
  await db.commit(
    [
      db.statement(
        `DELETE FROM role_grants
          WHERE user_id = ? AND organization_id = ? AND scope_type = 'installation'`,
        [userId, db.organizationId],
      ),
      db.statement(
        `INSERT INTO role_grants
           (id, organization_id, user_id, role, scope_type, scope_id, scope_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'installation', NULL, '', ?, ?)`,
        [
          newId("RoleGrantId"),
          db.organizationId,
          userId,
          role,
          timestamp,
          timestamp,
        ],
      ),
    ],
    {
      actorUserId: null,
      actorKind: "system",
      action: "user.roles_replaced",
      resourceType: "user",
      resourceId: userId,
      purpose: "authentication",
      metadata: { role, previous: current.join(",") },
    },
  );
}

async function ensureDevProvider(
  db: Database,
  organizationId: OrganizationId,
): Promise<string> {
  const existing = await db.first<{ id: string }>(
    `SELECT id FROM identity_providers WHERE organization_id = ? AND kind = 'magic-link' AND issuer = 'dev'`,
    [organizationId],
  );
  if (existing) return existing.id;

  const id = newId("IdentityProviderId");
  const timestamp = nowIso();
  await db.run(
    `INSERT INTO identity_providers
       (id, organization_id, kind, issuer, client_id, allowed_domains, enabled, config_version, created_at, updated_at)
     VALUES (?, ?, 'magic-link', 'dev', 'dev', '[]', 0, 1, ?, ?)`,
    [id, organizationId, timestamp, timestamp],
  );
  return id;
}
