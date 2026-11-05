import { Hono } from "hono";
import { DomainError, authorize } from "@culture-shock/domain";
import { manifestChecksum } from "@culture-shock/pack-sdk";
import { z } from "zod";
import type { AppBindings } from "../env.js";
import { Database, parseJson } from "../db/database.js";
import { PackDraftRepository } from "../db/pack-drafts.js";
import { PackRepository } from "../db/repositories.js";
import { requirePrincipal, stepUpMaxAge } from "../auth/session.js";
import { accepted, created, mapConcurrencyError, ok, type AppContext } from "../http/responses.js";
import { generateDraft, reviewDraft } from "../services/pack-draft-service.js";

export const packDraftRoutes = new Hono<AppBindings>();

const DRAFT_TTL_DAYS = 30;

const generateRequestSchema = z.object({
  objective: z.string().min(10).max(600),
  audience: z.string().max(300).optional(),
});

const publishRequestSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/).default("1.0.0"),
  /** Explicit, recorded confirmation that a human reviewed the draft. */
  acknowledgedReview: z.literal(true),
  reviewNote: z.string().max(300).optional(),
});

function context(c: AppContext) {
  const organizationId = c.get("organizationId");
  const config = c.get("config");
  if (!organizationId || !config) throw new DomainError("dependency_unavailable", "Installation not loaded");
  return { config, db: new Database(c.env.DB, organizationId) };
}

packDraftRoutes.get("/packs/drafts", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { db } = context(c);
  authorize(principal, "packs:draft");

  const drafts = await new PackDraftRepository(db).list();
  return ok(
    c,
    drafts.map((draft) => {
      const manifest = parseJson<{ id?: string; name?: Record<string, string> }>(draft.manifest_json, {});
      const validation = parseJson<{ ok?: boolean; source?: string }>(draft.validation_json, {});
      return {
        id: draft.id,
        slug: manifest.id ?? "unknown",
        source: draft.source,
        generator: validation.source ?? null,
        ready: validation.ok === true,
        createdAt: draft.created_at,
        expiresAt: draft.expires_at,
      };
    }),
  );
});

packDraftRoutes.get("/packs/drafts/:id", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { db } = context(c);
  authorize(principal, "packs:draft");

  const draft = await new PackDraftRepository(db).findById(c.req.param("id"));
  if (!draft) throw new DomainError("not_found", "Draft not found");

  return ok(c, {
    id: draft.id,
    source: draft.source,
    manifest: parseJson<unknown>(draft.manifest_json, null),
    review: parseJson<unknown>(draft.validation_json, null),
    createdAt: draft.created_at,
    expiresAt: draft.expires_at,
  });
});

/**
 * Generates a draft. The response is a proposal: it is stored as a draft and is
 * not installed, enabled, or visible to designers until an administrator
 * publishes it.
 */
packDraftRoutes.post("/packs/drafts:generate", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { db, config } = context(c);
  authorize(principal, "packs:draft");

  const body = generateRequestSchema.parse(await c.req.json());
  const packs = await new PackRepository(db).list();

  const generated = await generateDraft({
    env: c.env,
    config,
    db,
    userId: principal.userId,
    existingSlugs: packs.map((pack) => pack.slug),
    request: body,
  });

  const draftId = await new PackDraftRepository(db).create({
    authorUserId: principal.userId,
    source: generated.source === "ai" ? "ai" : "human",
    manifest: generated.review.manifest,
    validation: {
      ok: generated.review.ok,
      source: generated.source,
      rationale: generated.rationale,
      provenance: generated.provenance,
      validationIssues: generated.review.validationIssues,
      dryRun: generated.review.dryRun,
      matching: generated.review.matching,
      blockingReasons: generated.review.blockingReasons,
    },
    ttlDays: DRAFT_TTL_DAYS,
  });

  return accepted(c, {
    draftId,
    source: generated.source,
    rationale: generated.rationale,
    ready: generated.review.ok,
    blockingReasons: generated.review.blockingReasons,
    requiresHumanApproval: true,
  });
});

packDraftRoutes.post("/packs/drafts/:id/validate", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { db, config } = context(c);
  authorize(principal, "packs:draft");

  const drafts = new PackDraftRepository(db);
  const draft = await drafts.findById(c.req.param("id"));
  if (!draft) throw new DomainError("not_found", "Draft not found");

  const review = reviewDraft(parseJson<unknown>(draft.manifest_json, null), config);
  const existing = parseJson<Record<string, unknown>>(draft.validation_json, {});
  await drafts.saveValidation(draft.id, {
    ...existing,
    ok: review.ok,
    validationIssues: review.validationIssues,
    dryRun: review.dryRun,
    matching: review.matching,
    blockingReasons: review.blockingReasons,
  });

  return ok(c, {
    ok: review.ok,
    validationIssues: review.validationIssues,
    dryRun: review.dryRun,
    matching: review.matching,
    blockingReasons: review.blockingReasons,
  });
});

/**
 * Publication is the human approval gate. It re-runs the full review rather
 * than trusting the stored result, records the approver, and creates an
 * immutable template.
 */
packDraftRoutes.post("/packs/drafts/:id/publish", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { db, config } = context(c);
  authorize(principal, "packs:publish", { now: Date.now(), stepUpMaxAgeSeconds: stepUpMaxAge(config) });

  const body = publishRequestSchema.parse(await c.req.json());
  const drafts = new PackDraftRepository(db);
  const draft = await drafts.findById(c.req.param("id"));
  if (!draft) throw new DomainError("not_found", "Draft not found");

  const review = reviewDraft(parseJson<unknown>(draft.manifest_json, null), config);
  if (!review.ok || !review.manifest) {
    throw new DomainError("validation_failed", "This draft cannot be published", {
      blockingReasons: review.blockingReasons,
      issues: review.validationIssues.filter((issue) => issue.severity === "error").slice(0, 10),
    });
  }

  const manifest = { ...review.manifest, version: body.version };
  const packs = new PackRepository(db);
  const packId = await packs.upsertPack({ slug: manifest.id, origin: manifest.provenance.origin });

  try {
    const templateId = await packs.publishTemplate({
      packId,
      version: manifest.version,
      schemaVersion: manifest.schemaVersion,
      manifest,
      checksum: await manifestChecksum(manifest),
      provenance: {
        ...manifest.provenance,
        approvedByUserId: principal.userId,
        reviewNote: body.reviewNote ?? null,
      },
      actorUserId: principal.userId,
    });

    await drafts.discard(draft.id, principal.userId, "published");

    // A generated pack is published but left disabled; enabling it is a
    // separate, separately audited decision.
    return created(c, {
      templateId,
      slug: manifest.id,
      version: manifest.version,
      enabled: false,
      issues: review.validationIssues,
    });
  } catch (error) {
    mapConcurrencyError(error);
  }
});

packDraftRoutes.delete("/packs/drafts/:id", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { db } = context(c);
  authorize(principal, "packs:draft");

  const drafts = new PackDraftRepository(db);
  const draft = await drafts.findById(c.req.param("id"));
  if (!draft) throw new DomainError("not_found", "Draft not found");

  await drafts.discard(draft.id, principal.userId, "discarded_by_reviewer");
  return c.body(null, 204);
});
