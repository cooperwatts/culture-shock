import { Hono } from "hono";
import { DomainError, newId, type OrganizationId } from "@culture-shock/domain";
import { z } from "zod";
import type { AppBindings } from "../env.js";
import { secret } from "../env.js";
import { Database, nowIso } from "../db/database.js";
import { findActiveOrganization } from "../db/repositories.js";
import { ok } from "../http/responses.js";
import { BUILT_IN_MANIFESTS } from "../services/builtin-packs.js";
import { defaultInstallationConfig } from "../services/defaults.js";
import { seedPack } from "../services/pack-service.js";
import { timingSafeEqual } from "@culture-shock/crypto";

export const bootstrapRoutes = new Hono<AppBindings>();

const bootstrapSchema = z.object({
  organizationName: z.string().min(1).max(120),
  organizationSlug: z.string().regex(/^[a-z0-9-]{2,60}$/),
  locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).default("en-CA"),
  timeZone: z.string().min(1).max(64).default("UTC"),
  identityProviders: z
    .array(
      z.object({
        kind: z.enum(["entra-id", "google-workspace"]),
        issuer: z.string().url(),
        clientId: z.string().min(1).max(200),
        allowedDomains: z.array(z.string().max(253)).max(50).default([]),
      }),
    )
    .max(4)
    .default([]),
});

/**
 * One-time installation bootstrap.
 *
 * Runs before any identity exists, so it is authenticated by the deployer's
 * `SETUP_TOKEN` Worker secret and refuses to run once an organization is
 * provisioned. The deployer should unset the secret after setup.
 */
bootstrapRoutes.post("/admin/bootstrap", async (c) => {
  const setupToken = secret(c.env, "SETUP_TOKEN");
  if (!setupToken) {
    throw new DomainError("forbidden", "Bootstrap is disabled for this installation");
  }

  const presented = c.req.header("x-setup-token");
  if (!presented || !timingSafeEqual(presented, setupToken)) {
    throw new DomainError("forbidden", "Bootstrap token is not valid");
  }

  const existing = await findActiveOrganization(c.env.DB);
  if (existing) {
    throw new DomainError("conflict", "This installation has already been provisioned");
  }

  const body = bootstrapSchema.parse(await c.req.json());
  const organizationId = newId("OrganizationId");
  const timestamp = nowIso();

  await c.env.DB.prepare(
    `INSERT INTO organizations (id, slug, display_name, locale, time_zone, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
  )
    .bind(organizationId, body.organizationSlug, body.organizationName, body.locale, body.timeZone, timestamp, timestamp)
    .run();

  const db = new Database(c.env.DB, organizationId as OrganizationId);

  for (const provider of body.identityProviders) {
    await db.run(
      `INSERT INTO identity_providers
         (id, organization_id, kind, issuer, client_id, allowed_domains, enabled, config_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
      [
        newId("IdentityProviderId"),
        organizationId,
        provider.kind,
        provider.issuer,
        provider.clientId,
        JSON.stringify(provider.allowedDomains),
        timestamp,
        timestamp,
      ],
    );
  }

  const config = defaultInstallationConfig(body.organizationName, body.organizationSlug, body.locale);
  await db.run(
    `INSERT INTO configurations
       (id, organization_id, scope, scope_key, revision, schema_version, config_json, status, created_at, updated_at)
     VALUES (?, ?, 'installation', '', 1, ?, ?, 'published', ?, ?)`,
    [
      newId("ConfigurationId"),
      organizationId,
      config.schemaVersion,
      JSON.stringify(config),
      timestamp,
      timestamp,
    ],
  );

  const seeded = [];
  for (const manifest of BUILT_IN_MANIFESTS) {
    seeded.push(await seedPack(db, config, manifest, null));
  }

  await db.commit([], {
    actorUserId: null,
    actorKind: "system",
    action: "installation.bootstrapped",
    resourceType: "organization",
    resourceId: organizationId,
    purpose: "installation",
    metadata: { packs: seeded.length, providers: body.identityProviders.length },
  });

  return ok(c, {
    organizationId,
    packs: seeded,
    nextSteps: [
      "Unset the SETUP_TOKEN secret.",
      "Sign in with a configured identity provider; the first account receives the admin role.",
      "Publish an installation configuration with setupComplete set to true.",
    ],
  });
});
