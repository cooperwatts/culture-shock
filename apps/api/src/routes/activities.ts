import { Hono } from "hono";
import {
  DomainError,
  activitiesOpen,
  authorize,
  type ExperienceInstanceId,
  type ExperienceInstanceState,
  type ParticipantId,
} from "@culture-shock/domain";
import { createActivitySchema, createRecognitionSchema } from "@culture-shock/contracts";
import type { AppBindings } from "../env.js";
import { secret } from "../env.js";
import { Database, parseJson } from "../db/database.js";
import { ActivityRepository, RecognitionRepository } from "../db/activities.js";
import { InstanceRepository, PackRepository, ParticipantRepository } from "../db/repositories.js";
import { requirePrincipal } from "../auth/session.js";
import { created, ok, type AppContext } from "../http/responses.js";
import { manifestFromTemplate } from "../services/pack-service.js";
import { snapshotOf } from "../services/instance-service.js";
import { resolveActivityPermission, resolveRecognitionVisibility } from "../services/capability-service.js";
import { decryptField, encryptField } from "@culture-shock/crypto";

export const activityRoutes = new Hono<AppBindings>();

async function participantContext(c: AppContext, instanceId: ExperienceInstanceId) {
  const organizationId = c.get("organizationId");
  const config = c.get("config");
  if (!organizationId || !config) throw new DomainError("dependency_unavailable", "Installation not loaded");

  const principal = requirePrincipal(c.get("principal"));
  authorize(principal, "instances:participate", { instanceId, participantOfInstance: true });

  const db = new Database(c.env.DB, organizationId);
  const instance = await new InstanceRepository(db).requireById(instanceId);

  const participant = await new ParticipantRepository(db).findForUser(instanceId, principal.userId);
  if (!participant || participant.status !== "enrolled") {
    throw new DomainError("not_found", "You are not an enrolled participant in this experience");
  }

  const template = await new PackRepository(db).templateById(instance.pack_template_id);
  if (!template) throw new DomainError("not_found", "Culture Pack version not found");

  return {
    principal,
    config,
    db,
    instance,
    participantId: participant.id as ParticipantId,
    manifest: manifestFromTemplate(template),
    snapshot: snapshotOf(instance.snapshot_json),
  };
}

activityRoutes.get("/instances/:id/activities", async (c) => {
  const instanceId = c.req.param("id") as ExperienceInstanceId;
  const { db, participantId, manifest } = await participantContext(c, instanceId);

  const activities = await new ActivityRepository(db).listForParticipant(participantId);
  return ok(c, {
    available: manifest.activities.map((activity) => ({
      key: activity.key,
      type: activity.type,
      title: activity.title,
      optional: activity.optional,
      maxPerParticipant: activity.maxPerParticipant,
    })),
    completed: activities.map((activity) => ({
      id: activity.id,
      type: activity.type,
      state: activity.state,
      completedAt: activity.completed_at,
    })),
  });
});

activityRoutes.post("/instances/:id/activities", async (c) => {
  const instanceId = c.req.param("id") as ExperienceInstanceId;
  const { db, instance, participantId, manifest, snapshot, principal } = await participantContext(c, instanceId);

  if (!activitiesOpen(instance.state as ExperienceInstanceState)) {
    throw new DomainError("invalid_state_transition", "This experience is not accepting activity updates");
  }

  const body = createActivitySchema.parse(await c.req.json());
  const permission = resolveActivityPermission(manifest, snapshot, body.type);

  const activities = new ActivityRepository(db);
  const existing = await activities.countForParticipant(participantId, body.type);
  if (existing >= permission.maxPerParticipant) {
    throw new DomainError("conflict", "You have reached the limit for this activity", {
      maxPerParticipant: permission.maxPerParticipant,
    });
  }

  // Free text never enters an activity payload; packs record structured status only.
  const id = await activities.record({
    instanceId,
    participantId,
    type: body.type,
    payload: { missionKey: body.missionKey ?? null, activityKey: permission.activityKey },
    actorUserId: principal.userId,
  });

  return created(c, { id, type: body.type, state: "completed" });
});

activityRoutes.get("/instances/:id/recognitions", async (c) => {
  const instanceId = c.req.param("id") as ExperienceInstanceId;
  const { db, participantId, snapshot } = await participantContext(c, instanceId);

  if (!snapshot.capabilities.includes("activity.recognition")) {
    throw new DomainError("capability_disabled", "This experience does not include recognition");
  }

  const fieldKey = secret(c.env, "FIELD_ENCRYPTION_KEY");
  const rows = await new RecognitionRepository(db).listVisibleTo(instanceId, participantId);

  const recognitions = [];
  for (const row of rows) {
    const authored = row.author_participant_id === participantId;
    let message: string | null = null;
    if (fieldKey) {
      try {
        message = await decryptField(fieldKey, row.message_ciphertext);
      } catch {
        // A key rotation gap must not break the whole list.
        message = null;
      }
    }
    recognitions.push({
      id: row.id,
      direction: authored ? "sent" : "received",
      message,
      visibility: row.visibility,
      moderationState: row.moderation_state,
      createdAt: row.created_at,
    });
  }

  return ok(c, recognitions);
});

activityRoutes.post("/instances/:id/recognitions", async (c) => {
  const instanceId = c.req.param("id") as ExperienceInstanceId;
  const { db, instance, participantId, manifest, snapshot, config, principal } = await participantContext(
    c,
    instanceId,
  );

  if (!activitiesOpen(instance.state as ExperienceInstanceState)) {
    throw new DomainError("invalid_state_transition", "This experience is not accepting recognitions");
  }
  resolveActivityPermission(manifest, snapshot, "recognition");

  const body = createRecognitionSchema.parse(await c.req.json());
  if (body.recipientParticipantId === participantId) {
    throw new DomainError("policy_violation", "You cannot recognize yourself");
  }

  const recipient = await db.first<{ id: string; status: string }>(
    `SELECT id, status FROM participants WHERE id = ? AND instance_id = ? AND organization_id = ?`,
    [body.recipientParticipantId, instanceId, db.organizationId],
  );
  if (!recipient || recipient.status !== "enrolled") {
    throw new DomainError("not_found", "That participant is not enrolled in this experience");
  }

  const declared = manifest.activities.find((activity) => activity.type === "recognition");
  const recognitions = new RecognitionRepository(db);
  const authored = await recognitions.countAuthored(instanceId, participantId);
  if (authored >= (declared?.maxPerParticipant ?? 10)) {
    throw new DomainError("conflict", "You have reached the recognition limit for this experience");
  }

  const fieldKey = secret(c.env, "FIELD_ENCRYPTION_KEY");
  if (!fieldKey) {
    throw new DomainError("dependency_unavailable", "Message encryption is not configured");
  }

  const visibility = resolveRecognitionVisibility(
    body.visibility,
    config.privacy.allowRecognitionPublicVisibility,
  );
  const encrypted = await encryptField(fieldKey, 1, body.message);

  const id = await recognitions.create({
    instanceId,
    authorParticipantId: participantId,
    recipientParticipantId: body.recipientParticipantId as ParticipantId,
    messageCiphertext: encrypted.ciphertext,
    keyVersion: encrypted.keyVersion,
    visibility,
    // Anything beyond a private note is held for review before it is visible.
    moderationState: visibility === "recipient_only" || visibility === "private" ? "approved" : "pending",
    actorUserId: principal.userId,
  });

  await new ActivityRepository(db).record({
    instanceId,
    participantId,
    type: "recognition",
    payload: { recognitionId: id },
    actorUserId: principal.userId,
  });

  return created(c, { id, visibility });
});

activityRoutes.get("/instances/:id/peers", async (c) => {
  const instanceId = c.req.param("id") as ExperienceInstanceId;
  const { db, participantId, snapshot } = await participantContext(c, instanceId);

  if (snapshot.privacyMode === "anonymous") {
    throw new DomainError("capability_disabled", "Participant directory is disabled for this experience");
  }

  const rows = await db.all<{ id: string; display_name: string | null }>(
    `SELECT p.id AS id, u.display_name AS display_name
       FROM participants p JOIN users u ON u.id = p.user_id
      WHERE p.instance_id = ? AND p.organization_id = ? AND p.status = 'enrolled' AND p.id <> ?
      ORDER BY p.id LIMIT 500`,
    [instanceId, db.organizationId, participantId],
  );

  return ok(
    c,
    rows.map((row) => ({
      participantId: row.id,
      label: row.display_name ?? `member-${row.id.slice(-6)}`,
    })),
  );
});

activityRoutes.get("/me/instances", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const organizationId = c.get("organizationId");
  if (!organizationId) throw new DomainError("dependency_unavailable", "Installation not loaded");
  const db = new Database(c.env.DB, organizationId);

  const rows = await db.all<{
    id: string;
    name: string;
    state: string;
    start_at: string | null;
    end_at: string | null;
    enrollment_close_at: string | null;
    participant_status: string | null;
    snapshot_json: string;
  }>(
    `SELECT i.id, i.name, i.state, i.start_at, i.end_at, i.enrollment_close_at,
            p.status AS participant_status, i.snapshot_json
       FROM experience_instances i
       LEFT JOIN participants p ON p.instance_id = i.id AND p.user_id = ?
      WHERE i.organization_id = ?
        AND i.state IN ('enrolling', 'locked', 'active', 'reveal_pending', 'completed')
        AND (p.id IS NOT NULL OR i.state = 'enrolling')
      ORDER BY i.start_at DESC LIMIT 50`,
    [principal.userId, organizationId],
  );

  return ok(
    c,
    rows.map((row) => ({
      id: row.id,
      name: row.name,
      state: row.state,
      startsAt: row.start_at,
      endsAt: row.end_at,
      enrollmentClosesAt: row.enrollment_close_at,
      participantStatus: row.participant_status,
      privacyMode: parseJson<{ privacyMode?: string }>(row.snapshot_json, {}).privacyMode ?? null,
    })),
  );
});
