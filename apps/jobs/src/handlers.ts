import { newId, type DomainEventEnvelope } from "@culture-shock/domain";
import { claimReceipt, type JobsEnv } from "./outbox.js";
import { runErasure, runExport } from "./privacy.js";

export type HandlerResult = "completed" | "skipped" | "duplicate";

export interface Handler {
  readonly key: string;
  readonly events: readonly string[];
  run(env: JobsEnv, event: DomainEventEnvelope): Promise<HandlerResult>;
}

async function auditFromJob(
  env: JobsEnv,
  organizationId: string,
  action: string,
  resourceType: string,
  resourceId: string | null,
  metadata: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO audit_events
       (id, organization_id, actor_user_id, actor_kind, action, resource_type, resource_id, purpose, metadata_json, occurred_at)
     VALUES (?, ?, NULL, 'job', ?, ?, ?, 'background_job', ?, ?)`,
  )
    .bind(
      newId("AuditEventId"),
      organizationId,
      action,
      resourceType,
      resourceId,
      JSON.stringify(metadata),
      new Date().toISOString(),
    )
    .run();
}

/**
 * Queues messages for later delivery. The payload holds references only; the
 * body is rendered at send time from the instance's own pack snapshot, so a
 * dead-lettered queue message never contains participant-facing content.
 */
async function queueNotifications(
  env: JobsEnv,
  organizationId: string,
  instanceId: string,
  templateKey: string,
  recipients: ReadonlyArray<{ user_id: string }>,
): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.batch(
    recipients.map((recipient) =>
      env.DB.prepare(
        `INSERT INTO notifications
           (id, organization_id, instance_id, recipient_user_id, channel, template_key, locale, payload_json, state, scheduled_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'email', ?, 'en-CA', ?, 'scheduled', ?, ?, ?)`,
      ).bind(
        newId("NotificationId"),
        organizationId,
        instanceId,
        recipient.user_id,
        templateKey,
        JSON.stringify({ instanceId }),
        now,
        now,
        now,
      ),
    ),
  );
}

/**
 * Queues the opening invitation when a run is launched. Only people who are
 * already participants or who the designer invited are addressed; this handler
 * never broadcasts to the whole directory.
 */
const notifyEnrollmentOpen: Handler = {
  key: "notify_enrollment_open",
  events: ["instance.launched"],
  async run(env, event) {
    if (!(await claimReceipt(env, event.eventId, "notify_enrollment_open"))) return "duplicate";

    const instanceId = String(event.references.instanceId ?? event.aggregateId);
    const instance = await env.DB.prepare(
      `SELECT state FROM experience_instances WHERE id = ? AND organization_id = ?`,
    )
      .bind(instanceId, event.organizationId)
      .first<{ state: string }>();

    if (!instance || instance.state !== "enrolling") return "skipped";

    const recipients = await env.DB.prepare(
      `SELECT user_id FROM participants
        WHERE instance_id = ? AND organization_id = ? AND status IN ('invited', 'enrolled')`,
    )
      .bind(instanceId, event.organizationId)
      .all<{ user_id: string }>();

    const rows = recipients.results ?? [];
    if (rows.length === 0) return "skipped";

    await queueNotifications(env, event.organizationId, instanceId, "enrollment_open", rows);
    await auditFromJob(env, event.organizationId, "notifications.queued", "experience_instance", instanceId, {
      count: rows.length,
      template: "enrollment_open",
    });
    return "completed";
  },
};

/**
 * Queues the closing message so a run does not simply go quiet. Withdrawn
 * participants are excluded at queue time and again at send time.
 */
const notifyCompleted: Handler = {
  key: "notify_completed",
  events: ["instance.completed"],
  async run(env, event) {
    if (!(await claimReceipt(env, event.eventId, "notify_completed"))) return "duplicate";

    const instanceId = String(event.references.instanceId ?? event.aggregateId);
    const recipients = await env.DB.prepare(
      `SELECT user_id FROM participants
        WHERE instance_id = ? AND organization_id = ? AND status = 'enrolled'`,
    )
      .bind(instanceId, event.organizationId)
      .all<{ user_id: string }>();

    const rows = recipients.results ?? [];
    if (rows.length === 0) return "skipped";

    await queueNotifications(env, event.organizationId, instanceId, "completed", rows);
    return "completed";
  },
};

/**
 * Queues notifications for a published match run. Consent and participation are
 * re-checked here because the state may have changed between the domain event
 * and this job running.
 */
const notifyMatchPublished: Handler = {
  key: "notify_match_published",
  events: ["match_run.published"],
  async run(env, event) {
    if (!(await claimReceipt(env, event.eventId, "notify_match_published"))) return "duplicate";

    const instanceId = String(event.references.instanceId ?? "");
    if (!instanceId) return "skipped";

    const instance = await env.DB.prepare(
      `SELECT state, pack_template_id FROM experience_instances WHERE id = ? AND organization_id = ?`,
    )
      .bind(instanceId, event.organizationId)
      .first<{ state: string; pack_template_id: string }>();

    if (!instance || instance.state === "cancelled" || instance.state === "archived") return "skipped";

    const recipients = await env.DB.prepare(
      `SELECT p.user_id AS user_id
         FROM participants p
         JOIN match_members mm ON mm.participant_id = p.id
        WHERE p.instance_id = ? AND p.organization_id = ? AND p.status = 'enrolled'
        GROUP BY p.user_id`,
    )
      .bind(instanceId, event.organizationId)
      .all<{ user_id: string }>();

    const rows = recipients.results ?? [];
    if (rows.length === 0) return "skipped";

    await queueNotifications(env, event.organizationId, instanceId, "match_published", rows);

    await auditFromJob(env, event.organizationId, "notifications.queued", "experience_instance", instanceId, {
      count: rows.length,
      template: "match_published",
    });

    return "completed";
  },
};

/** Marks a refreshed analytics snapshot so insight reads stay cheap. */
const refreshAnalytics: Handler = {
  key: "refresh_analytics",
  events: ["match_run.published", "instance.completed", "analytics.refresh_requested"],
  async run(env, event) {
    if (!(await claimReceipt(env, event.eventId, "refresh_analytics"))) return "duplicate";

    const instanceId = String(event.references.instanceId ?? event.aggregateId);
    await env.DB.prepare(
      `INSERT INTO outbox_events
         (id, organization_id, aggregate_type, aggregate_id, event_type, payload_json, occurred_at, available_at, attempts)
       VALUES (?, ?, 'experience_instance', ?, 'analytics.refresh_requested', ?, ?, ?, 0)`,
    )
      .bind(
        newId("OutboxEventId"),
        event.organizationId,
        instanceId,
        JSON.stringify({ instanceId }),
        new Date().toISOString(),
        new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      )
      .run();

    return "completed";
  },
};

/**
 * Withdrawal remediation. A withdrawal after publication voids the affected
 * group and flags it for designer review; peers are never silently reassigned.
 */
const remediateWithdrawal: Handler = {
  key: "remediate_withdrawal",
  events: ["participant.withdrawn"],
  async run(env, event) {
    if (!(await claimReceipt(env, event.eventId, "remediate_withdrawal"))) return "duplicate";

    const participantId = String(event.references.participantId ?? event.aggregateId);
    const now = new Date().toISOString();

    const affected = await env.DB.prepare(
      `SELECT m.id AS match_id FROM matches m
         JOIN match_members mm ON mm.match_id = m.id
        WHERE mm.participant_id = ? AND m.organization_id = ? AND m.state = 'published'`,
    )
      .bind(participantId, event.organizationId)
      .all<{ match_id: string }>();

    const matches = affected.results ?? [];
    if (matches.length === 0) return "skipped";

    await env.DB.batch(
      matches.map((row) =>
        env.DB.prepare(`UPDATE matches SET state = 'remediated', updated_at = ? WHERE id = ?`).bind(
          now,
          row.match_id,
        ),
      ),
    );

    await auditFromJob(env, event.organizationId, "match.remediation_required", "participant", participantId, {
      matches: matches.length,
    });

    return "completed";
  },
};

const handlePrivacyExport: Handler = {
  key: "privacy_export",
  events: ["privacy.export_requested"],
  async run(env, event) {
    const requestId = String(event.references.requestId ?? "");
    const userId = String(event.references.userId ?? event.aggregateId);
    if (!requestId) return "skipped";
    const outcome = await runExport(env, event.organizationId, requestId, userId, event.eventId);
    return outcome === "duplicate" ? "duplicate" : outcome === "completed" ? "completed" : "skipped";
  },
};

const handlePrivacyErasure: Handler = {
  key: "privacy_erase",
  events: ["privacy.erase_requested"],
  async run(env, event) {
    const requestId = String(event.references.requestId ?? "");
    const userId = String(event.references.userId ?? event.aggregateId);
    if (!requestId) return "skipped";
    const outcome = await runErasure(env, event.organizationId, requestId, userId, event.eventId);
    return outcome === "duplicate" ? "duplicate" : outcome === "completed" ? "completed" : "skipped";
  },
};

export const HANDLERS: readonly Handler[] = [
  notifyEnrollmentOpen,
  notifyMatchPublished,
  notifyCompleted,
  refreshAnalytics,
  remediateWithdrawal,
  handlePrivacyExport,
  handlePrivacyErasure,
];

export function handlersFor(eventType: string): Handler[] {
  return HANDLERS.filter((handler) => handler.events.includes(eventType));
}
