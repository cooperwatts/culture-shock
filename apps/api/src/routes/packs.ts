import { Hono } from "hono";
import { DomainError, authorize, newId } from "@culture-shock/domain";
import { manifestChecksum } from "@culture-shock/pack-sdk";
import { packImportRequestSchema } from "@culture-shock/contracts";
import type { AppBindings } from "../env.js";
import { Database, parseJson } from "../db/database.js";
import { PackRepository } from "../db/repositories.js";
import { requirePrincipal, stepUpMaxAge } from "../auth/session.js";
import { created, mapConcurrencyError, ok, type AppContext } from "../http/responses.js";
import { manifestFromTemplate, validate } from "../services/pack-service.js";

export const packRoutes = new Hono<AppBindings>();

function context(c: AppContext) {
  const organizationId = c.get("organizationId");
  const config = c.get("config");
  if (!organizationId || !config) throw new DomainError("dependency_unavailable", "Installation not loaded");
  return { config, db: new Database(c.env.DB, organizationId) };
}

packRoutes.get("/packs", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { db, config } = context(c);
  authorize(principal, "packs:read");

  const packs = new PackRepository(db);
  const rows = await packs.list();
  const summaries = [];

  for (const row of rows) {
    const latest = await packs.latestPublishedTemplate(row.id);
    const manifest = latest ? manifestFromTemplate(latest) : null;
    const locale = config.organization.defaultLocale;
    summaries.push({
      id: row.id,
      slug: row.slug,
      origin: row.origin,
      enabled: row.enabled === 1,
      status: row.status,
      latestVersion: latest?.version ?? null,
      pinnedVersion: row.pinned_version ?? config.culturePacks.pinnedVersions[row.slug] ?? null,
      name: manifest?.name[locale] ?? manifest?.name["en-CA"] ?? row.slug,
      summary: manifest?.summary[locale] ?? manifest?.summary["en-CA"] ?? "",
    });
  }

  return ok(c, summaries);
});

packRoutes.get("/packs/:slug/versions/:version", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { db } = context(c);
  authorize(principal, "packs:read");

  const packs = new PackRepository(db);
  const pack = await packs.findBySlug(c.req.param("slug"));
  if (!pack) throw new DomainError("not_found", "Culture Pack not found");

  const template = await packs.templateByVersion(pack.id, c.req.param("version"));
  if (!template) throw new DomainError("not_found", "Culture Pack version not found");

  return ok(c, {
    slug: pack.slug,
    version: template.version,
    schemaVersion: template.schema_version,
    checksum: template.checksum,
    state: template.state,
    manifest: parseJson<unknown>(template.manifest_json, null),
  });
});

/**
 * Import validates and stores a draft. It can never publish directly: an
 * administrator must review the diagnostics and publish explicitly.
 */
packRoutes.post("/packs/import", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { db, config } = context(c);
  authorize(principal, "packs:import", { now: Date.now(), stepUpMaxAgeSeconds: stepUpMaxAge(config) });

  if (!config.culturePacks.allowImportedPacks) {
    throw new DomainError("capability_disabled", "Imported Culture Packs are disabled for this installation");
  }

  const body = packImportRequestSchema.parse(await c.req.json());
  const result = validate(body.manifest, config);
  const checksum = result.manifest ? await manifestChecksum(result.manifest) : null;

  if (body.dryRun || !result.ok || !result.manifest) {
    return ok(c, { ok: result.ok, checksum, issues: result.issues });
  }

  const packs = new PackRepository(db);
  const packId = await packs.upsertPack({ slug: result.manifest.id, origin: "imported" });

  const timestamp = new Date().toISOString();
  await db.commit(
    [
      db.statement(
        `INSERT INTO pack_drafts
           (id, organization_id, pack_id, author_user_id, source, manifest_json, validation_json, revision, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'import', ?, ?, 1, ?, ?, ?)`,
        [
          newId("PackDraftId"),
          db.organizationId,
          packId,
          principal.userId,
          JSON.stringify(result.manifest),
          JSON.stringify({ ok: result.ok, issues: result.issues, checksum }),
          new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
          timestamp,
          timestamp,
        ],
      ),
    ],
    {
      actorUserId: principal.userId,
      actorKind: "user",
      action: "pack.imported",
      resourceType: "culture_pack",
      resourceId: packId,
      purpose: "pack_catalog",
      metadata: { slug: result.manifest.id, version: result.manifest.version, checksum },
    },
  );

  return created(c, { ok: true, checksum, issues: result.issues, state: "draft" });
});

packRoutes.post("/packs/:slug/enable", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { db, config } = context(c);
  authorize(principal, "packs:enable", { now: Date.now(), stepUpMaxAgeSeconds: stepUpMaxAge(config) });

  const packs = new PackRepository(db);
  const pack = await packs.findBySlug(c.req.param("slug"));
  if (!pack) throw new DomainError("not_found", "Culture Pack not found");
  if (pack.status === "retired") {
    throw new DomainError("conflict", "A retired Culture Pack cannot be re-enabled");
  }

  const latest = await packs.latestPublishedTemplate(pack.id);
  if (!latest) throw new DomainError("conflict", "Culture Pack has no published version");

  await packs.setEnabled(pack.id, true, principal.userId);
  return ok(c, { slug: pack.slug, enabled: true, version: latest.version });
});

packRoutes.post("/packs/:slug/retire", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { db, config } = context(c);
  authorize(principal, "packs:retire", { now: Date.now(), stepUpMaxAgeSeconds: stepUpMaxAge(config) });

  const packs = new PackRepository(db);
  const pack = await packs.findBySlug(c.req.param("slug"));
  if (!pack) throw new DomainError("not_found", "Culture Pack not found");

  // Retirement must not break live instances, which keep their own snapshot.
  await packs.retire(pack.id, principal.userId);
  return ok(c, { slug: pack.slug, status: "retired" });
});

packRoutes.post("/packs/:slug/versions", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { db, config } = context(c);
  authorize(principal, "packs:publish", { now: Date.now(), stepUpMaxAgeSeconds: stepUpMaxAge(config) });

  const body = (await c.req.json()) as { manifest?: unknown };
  const result = validate(body.manifest, config);
  if (!result.ok || !result.manifest) {
    throw new DomainError("validation_failed", "Manifest did not pass validation", {
      issues: result.issues.filter((issue) => issue.severity === "error").slice(0, 10),
    });
  }
  if (result.manifest.id !== c.req.param("slug")) {
    throw new DomainError("validation_failed", "Manifest id does not match the pack slug");
  }

  const packs = new PackRepository(db);
  const packId = await packs.upsertPack({ slug: result.manifest.id, origin: result.manifest.provenance.origin });

  try {
    const templateId = await packs.publishTemplate({
      packId,
      version: result.manifest.version,
      schemaVersion: result.manifest.schemaVersion,
      manifest: result.manifest,
      checksum: await manifestChecksum(result.manifest),
      provenance: result.manifest.provenance,
      actorUserId: principal.userId,
    });
    return created(c, { templateId, version: result.manifest.version, issues: result.issues });
  } catch (error) {
    mapConcurrencyError(error);
  }
});
