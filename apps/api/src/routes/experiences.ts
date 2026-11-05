import { Hono } from "hono";
import {
  DomainError,
  activitiesOpen,
  authorize,
  enrollmentOpen,
  isValidTimeZone,
  type ExperienceId,
  type ExperienceInstanceId,
  type ExperienceInstanceState,
} from "@culture-shock/domain";
import {
  createExperienceSchema,
  createInstanceSchema,
  createMatchRunSchema,
  participantPreferencesSchema,
  patchExperienceSchema,
} from "@culture-shock/contracts";
import type { AppBindings } from "../env.js";
import { Database, parseJson } from "../db/database.js";
import {
  ExperienceRepository,
  InstanceRepository,
  ParticipantRepository,
} from "../db/repositories.js";
import { MatchRunRepository } from "../db/match-runs.js";
import { IdempotencyStore } from "../db/guards.js";
import { requirePrincipal } from "../auth/session.js";
import { stableHash } from "@culture-shock/crypto";
import {
  accepted,
  created,
  mapConcurrencyError,
  ok,
  type AppContext,
} from "../http/responses.js";
import {
  manifestFromTemplate,
  resolveEnabledPack,
} from "../services/pack-service.js";
import {
  buildSnapshot,
  snapshotOf,
  transitionInstance,
} from "../services/instance-service.js";
import { previewMatchRun } from "../services/matching-service.js";
import { computeInsights } from "../services/insights-service.js";
import { PackRepository } from "../db/repositories.js";

export const experienceRoutes = new Hono<AppBindings>();

function context(c: AppContext) {
  const organizationId = c.get("organizationId");
  const config = c.get("config");
  if (!organizationId || !config)
    throw new DomainError("dependency_unavailable", "Installation not loaded");
  return { config, db: new Database(c.env.DB, organizationId) };
}

function requireIdempotencyKey(c: AppContext): string {
  const key = c.req.header("idempotency-key");
  if (!key || key.length < 8 || key.length > 200) {
    throw new DomainError(
      "precondition_required",
      "A valid Idempotency-Key header is required",
    );
  }
  return key;
}

/* ------------------------------------------------------------- experiences */

experienceRoutes.get("/experiences", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { db } = context(c);
  authorize(principal, "experiences:read");

  const limit = Math.min(Number(c.req.query("limit") ?? 25), 100);
  const rows = await new ExperienceRepository(db).list(
    limit,
    c.req.query("cursor") ?? null,
  );
  const activity = await new InstanceRepository(db).activityByExperience(
    rows.map((row) => row.id as ExperienceId),
  );

  return ok(
    c,
    rows.map((row) => {
      const summary = activity.get(row.id);
      return {
        id: row.id,
        name: row.name,
        revision: row.current_revision,
        updatedAt: row.updated_at,
        instanceCount: summary?.instanceCount ?? 0,
        // Null until the first instance exists; the experience itself has no lifecycle.
        latestInstanceState: summary?.latestState ?? null,
        enrolledCount: summary?.enrolled ?? 0,
      };
    }),
    { cursor: rows.at(-1)?.id ?? null },
  );
});

experienceRoutes.post("/experiences", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { db, config } = context(c);
  authorize(principal, "experiences:write");

  const body = createExperienceSchema.parse(await c.req.json());
  const pack = await resolveEnabledPack(
    db,
    config,
    body.packSlug,
    body.packVersion,
  );

  const id = await new ExperienceRepository(db).create({
    name: body.name,
    description: body.description ?? null,
    designerUserId: principal.userId,
    packTemplateId: pack.templateId,
    definition: {
      packSlug: body.packSlug,
      packVersion: pack.version,
      packConfig: {},
      rulesOverride: [],
    },
  });

  return created(c, { id, name: body.name, state: "draft" }, 1);
});

experienceRoutes.get("/experiences/:id", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { db } = context(c);
  const experienceId = c.req.param("id") as ExperienceId;
  authorize(principal, "experiences:read", { experienceId });

  const experiences = new ExperienceRepository(db);
  const row = await experiences.requireById(experienceId);
  const revision = await experiences.currentRevision(experienceId);

  return ok(
    c,
    {
      id: row.id,
      name: row.name,
      description: row.description,
      definition: parseJson<unknown>(revision?.definition_json, {}),
    },
    { revision: row.current_revision },
  );
});

experienceRoutes.patch("/experiences/:id", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { db } = context(c);
  const experienceId = c.req.param("id") as ExperienceId;
  authorize(principal, "experiences:write", { experienceId });

  const ifMatch = c.req.header("if-match");
  if (!ifMatch)
    throw new DomainError(
      "precondition_required",
      "If-Match revision header is required",
    );

  const body = patchExperienceSchema.parse(await c.req.json());
  const experiences = new ExperienceRepository(db);
  const current = await experiences.currentRevision(experienceId);
  if (!current)
    throw new DomainError("not_found", "Experience revision not found");

  const definition = {
    ...parseJson<Record<string, unknown>>(current.definition_json, {}),
    ...(body.packConfig ? { packConfig: body.packConfig } : {}),
    ...(body.rulesOverride ? { rulesOverride: body.rulesOverride } : {}),
  };

  try {
    const revision = await experiences.update({
      experienceId,
      expectedRevision: Number(ifMatch),
      name: body.name,
      description: body.description ?? null,
      definition,
      packTemplateId: current.pack_template_id,
      actorUserId: principal.userId,
    });
    return ok(c, { id: experienceId }, { revision });
  } catch (error) {
    mapConcurrencyError(error);
  }
});

/* --------------------------------------------------------------- instances */

experienceRoutes.post("/experiences/:id/instances", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { db, config } = context(c);
  const experienceId = c.req.param("id") as ExperienceId;
  authorize(principal, "instances:write", { experienceId });

  const idempotencyKey = requireIdempotencyKey(c);
  const rawBody = await c.req.json();
  const body = createInstanceSchema.parse(rawBody);

  if (!isValidTimeZone(body.timeZone)) {
    throw new DomainError(
      "validation_failed",
      "timeZone must be a valid IANA zone identifier",
    );
  }

  const claim = await new IdempotencyStore(db).claim({
    key: idempotencyKey,
    actorUserId: principal.userId,
    route: "POST /experiences/:id/instances",
    requestHash: await stableHash(rawBody),
    ttlSeconds: 86400,
  });
  if (claim.status === "replayed" && claim.responseRef) {
    return ok(c, { id: claim.responseRef, replayed: true });
  }

  const experiences = new ExperienceRepository(db);
  await experiences.requireById(experienceId);
  const revision = await experiences.currentRevision(experienceId);
  if (!revision)
    throw new DomainError("not_found", "Experience revision not found");

  const packs = new PackRepository(db);
  const template = await packs.templateById(revision.pack_template_id);
  if (!template)
    throw new DomainError("not_found", "Culture Pack version not found");

  const manifest = manifestFromTemplate(template);
  const definition = parseJson<{
    packConfig?: Record<string, unknown>;
    rulesOverride?: never[];
  }>(revision.definition_json, {});

  const validation = buildSnapshot({
    manifest,
    templateId: template.id,
    packConfig: { ...(definition.packConfig ?? {}), ...body.packConfig },
    rulesOverride: [
      ...(definition.rulesOverride ?? []),
      ...(body.rulesOverride as never[]),
    ],
    config,
  });
  if (!validation.ok || !validation.snapshot) {
    throw new DomainError(
      "validation_failed",
      "Instance configuration did not validate",
      {
        issues: validation.issues,
      },
    );
  }

  const instanceId = await new InstanceRepository(db).create({
    experienceId,
    experienceRevision: revision.revision,
    packTemplateId: template.id,
    name: body.name,
    snapshot: validation.snapshot,
    timeZone: body.timeZone,
    enrollmentCloseAt: body.enrollmentClosesAt,
    startAt: body.startsAt,
    endAt: body.endsAt,
    actorUserId: principal.userId,
  });

  await new IdempotencyStore(db).complete(idempotencyKey, instanceId, 201);
  return created(c, { id: instanceId, state: "draft" }, 1);
});

experienceRoutes.get("/experiences/:id/instances", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { db } = context(c);
  const experienceId = c.req.param("id") as ExperienceId;
  authorize(principal, "instances:read", { experienceId });

  await new ExperienceRepository(db).requireById(experienceId);
  const rows = await new InstanceRepository(db).listForExperience(experienceId);

  return ok(
    c,
    rows.map((row) => ({
      id: row.id,
      name: row.name,
      state: row.state,
      timeZone: row.time_zone,
      startsAt: row.start_at,
      endsAt: row.end_at,
      enrollmentClosesAt: row.enrollment_close_at,
      revision: row.revision,
    })),
  );
});

experienceRoutes.get("/instances/:id", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { db } = context(c);
  const instanceId = c.req.param("id") as ExperienceInstanceId;

  const instance = await new InstanceRepository(db).requireById(instanceId);
  authorize(principal, "instances:read", {
    experienceId: instance.experience_id as ExperienceId,
  });

  const counts = await db.all<{ status: string; count: number }>(
    `SELECT status, COUNT(*) AS count FROM participants
      WHERE instance_id = ? AND organization_id = ? GROUP BY status`,
    [instanceId, db.organizationId],
  );
  const snapshot = snapshotOf(instance.snapshot_json);

  return ok(
    c,
    {
      id: instance.id,
      experienceId: instance.experience_id,
      name: instance.name,
      state: instance.state,
      timeZone: instance.time_zone,
      startsAt: instance.start_at,
      endsAt: instance.end_at,
      enrollmentClosesAt: instance.enrollment_close_at,
      privacyMode: snapshot.privacyMode,
      revealEnabled: snapshot.revealEnabled,
      packVersion: snapshot.packVersion,
      capabilities: snapshot.capabilities,
      participantCounts: Object.fromEntries(
        counts.map((row) => [row.status, row.count]),
      ),
    },
    { revision: instance.revision },
  );
});

experienceRoutes.post("/instances/:id/launch", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { db } = context(c);
  const instanceId = c.req.param("id") as ExperienceInstanceId;

  const instance = await new InstanceRepository(db).requireById(instanceId);
  authorize(principal, "instances:launch", {
    experienceId: instance.experience_id as ExperienceId,
  });

  requireIdempotencyKey(c);
  const ifMatch = c.req.header("if-match");
  if (!ifMatch)
    throw new DomainError(
      "precondition_required",
      "If-Match revision header is required",
    );

  try {
    const revision = await transitionInstance({
      db,
      instanceId,
      toState: "enrolling",
      expectedRevision: Number(ifMatch),
      actorUserId: principal.userId,
    });
    return ok(c, { id: instanceId, state: "enrolling" }, { revision });
  } catch (error) {
    mapConcurrencyError(error);
  }
});

experienceRoutes.patch("/instances/:id", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { db } = context(c);
  const instanceId = c.req.param("id") as ExperienceInstanceId;

  const instance = await new InstanceRepository(db).requireById(instanceId);
  authorize(principal, "instances:write", {
    experienceId: instance.experience_id as ExperienceId,
  });

  const ifMatch = c.req.header("if-match");
  if (!ifMatch)
    throw new DomainError(
      "precondition_required",
      "If-Match revision header is required",
    );

  const body = (await c.req.json()) as { state?: string };
  if (!body.state)
    throw new DomainError(
      "validation_failed",
      "Only state transitions are supported here",
    );

  try {
    const revision = await transitionInstance({
      db,
      instanceId,
      toState: body.state as never,
      expectedRevision: Number(ifMatch),
      actorUserId: principal.userId,
    });
    return ok(c, { id: instanceId, state: body.state }, { revision });
  } catch (error) {
    mapConcurrencyError(error);
  }
});

/* ----------------------------------------------------------- participation */

experienceRoutes.post("/instances/:id/enroll", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { db } = context(c);
  const instanceId = c.req.param("id") as ExperienceInstanceId;

  const instance = await new InstanceRepository(db).requireById(instanceId);
  authorize(principal, "instances:participate", {
    instanceId,
    participantOfInstance: true,
  });

  if (!enrollmentOpen(instance.state as ExperienceInstanceState)) {
    throw new DomainError(
      "invalid_state_transition",
      "Enrollment is not open for this experience",
    );
  }

  const participantId = await new ParticipantRepository(db).enroll({
    instanceId,
    userId: principal.userId,
    actorUserId: principal.userId,
  });

  return ok(c, { participantId, status: "enrolled" });
});

experienceRoutes.post("/instances/:id/withdraw", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { db } = context(c);
  const instanceId = c.req.param("id") as ExperienceInstanceId;
  authorize(principal, "instances:participate", {
    instanceId,
    participantOfInstance: true,
  });

  await new InstanceRepository(db).requireById(instanceId);
  await new ParticipantRepository(db).withdraw({
    instanceId,
    userId: principal.userId,
    actorUserId: principal.userId,
  });

  return ok(c, { status: "withdrawn" });
});

experienceRoutes.get("/instances/:id/participants/me", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { db } = context(c);
  const instanceId = c.req.param("id") as ExperienceInstanceId;
  authorize(principal, "instances:participate", {
    instanceId,
    participantOfInstance: true,
  });

  const participants = new ParticipantRepository(db);
  const participant = await participants.findForUser(
    instanceId,
    principal.userId,
  );
  if (!participant)
    throw new DomainError(
      "not_found",
      "You are not a participant in this experience",
    );

  const profile = await participants.latestProfile(participant.id as never);
  return ok(c, {
    participantId: participant.id,
    status: participant.status,
    joinedAt: participant.joined_at,
    preferences: profile
      ? parseJson<unknown>(profile.preferences_json, null)
      : null,
    consentVersion: profile?.consent_version ?? null,
  });
});

experienceRoutes.put(
  "/instances/:id/participants/me/preferences",
  async (c) => {
    const principal = requirePrincipal(c.get("principal"));
    const { db, config } = context(c);
    const instanceId = c.req.param("id") as ExperienceInstanceId;
    authorize(principal, "instances:participate", {
      instanceId,
      participantOfInstance: true,
    });

    const body = participantPreferencesSchema.parse(await c.req.json());
    if (!isValidTimeZone(body.timeZone)) {
      throw new DomainError(
        "validation_failed",
        "timeZone must be a valid IANA zone identifier",
      );
    }

    const participants = new ParticipantRepository(db);
    const participant = await participants.findForUser(
      instanceId,
      principal.userId,
    );
    if (!participant)
      throw new DomainError(
        "not_found",
        "You are not a participant in this experience",
      );

    const { consent, ...preferences } = body;
    const revision = await participants.saveProfile({
      participantId: participant.id as never,
      preferences,
      consent,
      consentVersion: config.privacy.consentVersion,
      actorUserId: principal.userId,
    });

    return ok(c, { participantId: participant.id }, { revision });
  },
);

experienceRoutes.delete("/instances/:id/participants/me/profile", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { db } = context(c);
  const instanceId = c.req.param("id") as ExperienceInstanceId;
  authorize(principal, "instances:participate", {
    instanceId,
    participantOfInstance: true,
  });

  const participants = new ParticipantRepository(db);
  const participant = await participants.findForUser(
    instanceId,
    principal.userId,
  );
  if (!participant)
    throw new DomainError(
      "not_found",
      "You are not a participant in this experience",
    );

  await participants.revokeProfile(participant.id as never, principal.userId);
  return c.body(null, 204);
});

/* -------------------------------------------------------------- match runs */

experienceRoutes.post("/instances/:id/match-runs", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { db, config } = context(c);
  const instanceId = c.req.param("id") as ExperienceInstanceId;

  const instance = await new InstanceRepository(db).requireById(instanceId);
  authorize(principal, "matchruns:create", {
    experienceId: instance.experience_id as ExperienceId,
  });
  requireIdempotencyKey(c);

  const body = createMatchRunSchema.parse(await c.req.json());
  const packs = new PackRepository(db);
  const template = await packs.templateById(instance.pack_template_id);
  if (!template)
    throw new DomainError("not_found", "Culture Pack version not found");

  const preview = await previewMatchRun({
    db,
    instanceId,
    manifest: manifestFromTemplate(template),
    config,
    strategyKey: body.strategyKey,
    strategyVersion: body.strategyVersion,
    weightOverrides: body.weights,
    actorUserId: principal.userId,
  });

  return accepted(c, preview);
});

experienceRoutes.get("/instances/:id/match-runs/:runId", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { db } = context(c);
  const instanceId = c.req.param("id") as ExperienceInstanceId;

  const instance = await new InstanceRepository(db).requireById(instanceId);
  authorize(principal, "matchruns:read", {
    experienceId: instance.experience_id as ExperienceId,
  });

  const run = await new MatchRunRepository(db).findById(c.req.param("runId"));
  if (!run || run.instance_id !== instanceId)
    throw new DomainError("not_found", "Match run not found");

  return ok(c, {
    runId: run.id,
    state: run.state,
    diagnostics: parseJson<unknown>(run.diagnostics_json, null),
    fairness: parseJson<unknown>(run.fairness_json, null),
  });
});

experienceRoutes.post("/instances/:id/match-runs/:runId/publish", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { db } = context(c);
  const instanceId = c.req.param("id") as ExperienceInstanceId;

  const instance = await new InstanceRepository(db).requireById(instanceId);
  authorize(principal, "matchruns:publish", {
    experienceId: instance.experience_id as ExperienceId,
  });
  requireIdempotencyKey(c);

  const runs = new MatchRunRepository(db);
  const run = await runs.findById(c.req.param("runId"));
  if (!run || run.instance_id !== instanceId)
    throw new DomainError("not_found", "Match run not found");

  const diagnostics = parseJson<{ unmatched?: unknown[] }>(
    run.diagnostics_json,
    {},
  );
  const body = (await c.req.json().catch(() => ({}))) as {
    acknowledgedUnmatched?: boolean;
  };
  if (
    (diagnostics.unmatched?.length ?? 0) > 0 &&
    body.acknowledgedUnmatched !== true
  ) {
    // Unmatched participants require an explicit designer decision; they are
    // never silently dropped from the experience.
    throw new DomainError(
      "conflict",
      "Unmatched participants must be acknowledged before publishing",
      {
        unmatched: diagnostics.unmatched?.length ?? 0,
      },
    );
  }

  try {
    await runs.publish({
      runId: run.id,
      instanceId,
      actorUserId: principal.userId,
    });
  } catch (error) {
    mapConcurrencyError(error);
  }

  return ok(c, { runId: run.id, state: "published" });
});

experienceRoutes.get("/instances/:id/my-match", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { db } = context(c);
  const instanceId = c.req.param("id") as ExperienceInstanceId;
  authorize(principal, "instances:participate", {
    instanceId,
    participantOfInstance: true,
  });

  const instance = await new InstanceRepository(db).requireById(instanceId);
  const snapshot = snapshotOf(instance.snapshot_json);

  const participants = new ParticipantRepository(db);
  const participant = await participants.findForUser(
    instanceId,
    principal.userId,
  );
  if (!participant || participant.status !== "enrolled") {
    throw new DomainError(
      "not_found",
      "You are not an enrolled participant in this experience",
    );
  }

  const match = await new MatchRunRepository(db).publishedMatchForParticipant(
    instanceId,
    participant.id,
  );
  if (!match)
    return ok(c, {
      state: "not_published",
      groupKey: null,
      peers: [],
      missions: [],
    });

  const revealed =
    snapshot.privacyMode === "pseudonymous" ||
    snapshot.privacyMode === "anonymous"
      ? instance.state === "completed" && snapshot.revealEnabled
      : snapshot.privacyMode !== "never_reveal";

  // Peer identity is resolved server-side according to the snapshot's privacy
  // mode; an unrevealed peer never leaves the Worker as a name or identifier.
  const peers = [];
  for (const peerParticipantId of match.peerParticipantIds) {
    const peerRow = await db.first<{ display_name: string | null }>(
      `SELECT u.display_name AS display_name
         FROM participants p JOIN users u ON u.id = p.user_id
        WHERE p.id = ? AND p.organization_id = ?`,
      [peerParticipantId, db.organizationId],
    );
    const pseudonym = `member-${peerParticipantId.slice(-6)}`;
    peers.push({
      label: revealed ? (peerRow?.display_name ?? pseudonym) : pseudonym,
      pseudonym,
      revealed,
    });
  }

  return ok(c, {
    state: "published",
    groupKey: match.groupKey,
    peers,
    missions: activitiesOpen(instance.state as ExperienceInstanceState)
      ? []
      : [],
  });
});

/* ---------------------------------------------------------------- insights */

experienceRoutes.get("/instances/:id/insights", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { db, config } = context(c);
  const instanceId = c.req.param("id") as ExperienceInstanceId;

  const instance = await new InstanceRepository(db).requireById(instanceId);
  authorize(principal, "insights:read", {
    experienceId: instance.experience_id as ExperienceId,
  });

  const packs = new PackRepository(db);
  const template = await packs.templateById(instance.pack_template_id);
  const manifest = template ? manifestFromTemplate(template) : null;

  const report = await computeInsights(
    db,
    instanceId,
    manifest?.insights.metrics ?? [],
    Math.max(
      config.privacy.minimumCohortSize,
      manifest?.insights.minimumCohortSize ?? 0,
    ),
  );

  return ok(c, {
    metricVersion: report.metricVersion,
    periodStart: instance.start_at ?? new Date().toISOString(),
    periodEnd: instance.end_at ?? new Date().toISOString(),
    minimumCohortSize: report.minimumCohortSize,
    metrics: report.metrics,
    recommendations: report.recommendations,
  });
});
