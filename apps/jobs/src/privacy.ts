import { newId } from "@culture-shock/domain";
import { decryptField } from "@culture-shock/crypto";
import { buildExportBundle, type ExportInputRows } from "./privacy-export.js";
import { claimReceipt, type JobsEnv } from "./outbox.js";

const EXPORT_RETENTION_DAYS = 7;

async function activeHold(env: JobsEnv, userId: string): Promise<{ reason: string } | null> {
  return env.DB.prepare(
    `SELECT reason FROM legal_holds WHERE user_id = ? AND released_at IS NULL LIMIT 1`,
  )
    .bind(userId)
    .first<{ reason: string }>();
}

async function setRequestState(
  env: JobsEnv,
  requestId: string,
  state: string,
  fields: { result?: unknown; objectKey?: string | null; blockedReason?: string | null } = {},
): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE privacy_requests
        SET state = ?, result_json = COALESCE(?, result_json), object_key = COALESCE(?, object_key),
            blocked_reason = ?, completed_at = ?, updated_at = ?
      WHERE id = ?`,
  )
    .bind(
      state,
      fields.result === undefined ? null : JSON.stringify(fields.result),
      fields.objectKey ?? null,
      fields.blockedReason ?? null,
      state === "completed" || state === "blocked" || state === "failed" ? now : null,
      now,
      requestId,
    )
    .run();
}

async function audit(
  env: JobsEnv,
  organizationId: string,
  action: string,
  resourceId: string | null,
  metadata: Record<string, string | number | boolean | null>,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO audit_events
       (id, organization_id, actor_user_id, actor_kind, action, resource_type, resource_id, purpose, metadata_json, occurred_at)
     VALUES (?, ?, NULL, 'job', ?, 'user', ?, 'privacy_request', ?, ?)`,
  )
    .bind(
      newId("AuditEventId"),
      organizationId,
      action,
      resourceId,
      JSON.stringify(metadata),
      new Date().toISOString(),
    )
    .run();
}

async function gatherExportRows(
  env: JobsEnv,
  organizationId: string,
  userId: string,
): Promise<ExportInputRows | null> {
  const user = await env.DB.prepare(
    `SELECT id, display_name, status, created_at, work_email_ciphertext
       FROM users WHERE id = ? AND organization_id = ?`,
  )
    .bind(userId, organizationId)
    .first<{
      id: string;
      display_name: string | null;
      status: string;
      created_at: string;
      work_email_ciphertext: string | null;
    }>();

  if (!user) return null;

  let workEmail: string | null = null;
  if (user.work_email_ciphertext && env.FIELD_ENCRYPTION_KEY) {
    try {
      workEmail = await decryptField(env.FIELD_ENCRYPTION_KEY, user.work_email_ciphertext);
    } catch {
      workEmail = null;
    }
  }

  const all = async <T>(sql: string, params: unknown[]): Promise<T[]> => {
    const result = await env.DB.prepare(sql)
      .bind(...(params as never[]))
      .all<T>();
    return result.results ?? [];
  };

  return {
    user: {
      id: user.id,
      display_name: user.display_name,
      status: user.status,
      created_at: user.created_at,
    },
    workEmail,
    identities: await all(
      `SELECT ip.kind AS provider_kind, ip.issuer AS issuer, i.provider_subject AS provider_subject
         FROM identities i JOIN identity_providers ip ON ip.id = i.provider_id
        WHERE i.user_id = ? AND i.organization_id = ?`,
      [userId, organizationId],
    ),
    roleGrants: await all(
      `SELECT role, scope_type, scope_key, created_at FROM role_grants
        WHERE user_id = ? AND organization_id = ?`,
      [userId, organizationId],
    ),
    participations: await all(
      `SELECT p.id AS participant_id, p.instance_id, i.name AS instance_name, p.status,
              p.joined_at, p.withdrawn_at, pr.preferences_json, pr.consent_json, pr.consent_version
         FROM participants p
         JOIN experience_instances i ON i.id = p.instance_id
         LEFT JOIN participant_profiles pr ON pr.participant_id = p.id
        WHERE p.user_id = ? AND p.organization_id = ?`,
      [userId, organizationId],
    ),
    matchMemberships: await all(
      `SELECT m.instance_id, m.group_key, mine.participant_id, peer.participant_id AS peer_participant_id,
              r.published_at
         FROM match_members mine
         JOIN matches m ON m.id = mine.match_id
         JOIN match_runs r ON r.id = m.run_id
         JOIN match_members peer ON peer.match_id = m.id AND peer.participant_id <> mine.participant_id
         JOIN participants p ON p.id = mine.participant_id
        WHERE p.user_id = ? AND m.organization_id = ?`,
      [userId, organizationId],
    ),
    activities: await all(
      `SELECT a.instance_id, a.type, a.state, a.completed_at
         FROM activities a JOIN participants p ON p.id = a.participant_id
        WHERE p.user_id = ? AND a.organization_id = ?`,
      [userId, organizationId],
    ),
    recognitions: await gatherRecognitions(env, organizationId, userId),
    notifications: await all(
      `SELECT instance_id, template_key, channel, state, scheduled_at, delivered_at
         FROM notifications WHERE recipient_user_id = ? AND organization_id = ?`,
      [userId, organizationId],
    ),
    aiInteractions: await all(
      `SELECT purpose, provider_key, model_id, redaction_level, status, created_at
         FROM ai_interactions WHERE user_id = ? AND organization_id = ?`,
      [userId, organizationId],
    ),
    auditEvents: await all(
      `SELECT action, resource_type, purpose, occurred_at
         FROM audit_events WHERE actor_user_id = ? AND organization_id = ?
        ORDER BY occurred_at DESC LIMIT 500`,
      [userId, organizationId],
    ),
  };
}

async function gatherRecognitions(
  env: JobsEnv,
  organizationId: string,
  userId: string,
): Promise<ExportInputRows["recognitions"]> {
  const rows = await env.DB.prepare(
    `SELECT r.instance_id,
            CASE WHEN author.user_id = ? THEN 'sent' ELSE 'received' END AS direction,
            CASE WHEN author.user_id = ? THEN r.recipient_participant_id ELSE r.author_participant_id END AS counterparty_participant_id,
            r.message_ciphertext, r.visibility, r.created_at
       FROM recognitions r
       JOIN participants author ON author.id = r.author_participant_id
       JOIN participants recipient ON recipient.id = r.recipient_participant_id
      WHERE r.organization_id = ? AND (author.user_id = ? OR recipient.user_id = ?)`,
  )
    .bind(userId, userId, organizationId, userId, userId)
    .all<{
      instance_id: string;
      direction: "sent" | "received";
      counterparty_participant_id: string;
      message_ciphertext: string;
      visibility: string;
      created_at: string;
    }>();

  const decrypted = [];
  for (const row of rows.results ?? []) {
    let message: string | null = null;
    if (env.FIELD_ENCRYPTION_KEY) {
      try {
        message = await decryptField(env.FIELD_ENCRYPTION_KEY, row.message_ciphertext);
      } catch {
        message = null;
      }
    }
    decrypted.push({
      instance_id: row.instance_id,
      direction: row.direction,
      counterparty_participant_id: row.counterparty_participant_id,
      message,
      visibility: row.visibility,
      created_at: row.created_at,
    });
  }
  return decrypted;
}

/**
 * Produces a verified export into the private bucket. The object expires, its
 * key is recorded in `r2_objects` for the retention sweep, and the download is
 * authorized and audited separately by the API.
 */
export async function runExport(
  env: JobsEnv,
  organizationId: string,
  requestId: string,
  userId: string,
  eventId: string,
): Promise<"completed" | "blocked" | "failed" | "duplicate"> {
  if (!(await claimReceipt(env, eventId, "privacy_export"))) return "duplicate";
  await setRequestState(env, requestId, "running");

  const rows = await gatherExportRows(env, organizationId, userId);
  if (!rows) {
    await setRequestState(env, requestId, "failed", { blockedReason: "subject_not_found" });
    return "failed";
  }

  const bundle = buildExportBundle(rows);
  const body = JSON.stringify(bundle, null, 2);
  const objectKey = `privacy-exports/${organizationId}/${requestId}.json`;
  const expiresAt = new Date(Date.now() + EXPORT_RETENTION_DAYS * 86400 * 1000).toISOString();

  await env.ASSETS.put(objectKey, body, {
    httpMetadata: { contentType: "application/json", cacheControl: "no-store" },
  });

  const checksumBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  const checksum = [...new Uint8Array(checksumBuffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  await env.DB.prepare(
    `INSERT INTO r2_objects
       (id, organization_id, owner_type, owner_id, object_key, content_type, byte_size, checksum, classification, expires_at, created_at)
     VALUES (?, ?, 'privacy_export', ?, ?, 'application/json', ?, ?, 'participant_sensitive', ?, ?)`,
  )
    .bind(
      newId("R2ObjectId"),
      organizationId,
      userId,
      objectKey,
      body.length,
      `sha256:${checksum}`,
      expiresAt,
      new Date().toISOString(),
    )
    .run();

  await setRequestState(env, requestId, "completed", {
    objectKey,
    result: {
      participationCount: bundle.participation.length,
      connectionCount: bundle.connections.length,
      recognitionCount: bundle.recognitions.length,
      byteSize: body.length,
      expiresAt,
    },
  });

  await audit(env, organizationId, "privacy.export_completed", userId, {
    requestId,
    byteSize: body.length,
    expiresAt,
  });

  return "completed";
}

/**
 * Erases a data subject.
 *
 * Optional content is deleted outright. Membership rows are removed, which
 * leaves published groups short a member, so every affected match is flagged
 * `remediated` for a designer rather than quietly rewritten. Audit rows are
 * kept but stripped of the actor link: the fact that an action happened is
 * retained, the identity behind it is not.
 */
export async function runErasure(
  env: JobsEnv,
  organizationId: string,
  requestId: string,
  userId: string,
  eventId: string,
): Promise<"completed" | "blocked" | "failed" | "duplicate"> {
  if (!(await claimReceipt(env, eventId, "privacy_erase"))) return "duplicate";
  await setRequestState(env, requestId, "running");

  const hold = await activeHold(env, userId);
  if (hold) {
    await setRequestState(env, requestId, "blocked", { blockedReason: "legal_hold" });
    await audit(env, organizationId, "privacy.erase_blocked", userId, { requestId, reason: "legal_hold" });
    return "blocked";
  }

  const participantRows = await env.DB.prepare(
    `SELECT id FROM participants WHERE user_id = ? AND organization_id = ?`,
  )
    .bind(userId, organizationId)
    .all<{ id: string }>();
  const participantIds = (participantRows.results ?? []).map((row) => row.id);

  const now = new Date().toISOString();

  if (participantIds.length > 0) {
    const placeholders = participantIds.map(() => "?").join(",");
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE matches SET state = 'remediated', updated_at = ?
          WHERE organization_id = ? AND state = 'published' AND id IN (
            SELECT match_id FROM match_members WHERE participant_id IN (${placeholders})
          )`,
      ).bind(now, organizationId, ...participantIds),
      env.DB.prepare(
        `DELETE FROM recognitions WHERE organization_id = ?
          AND (author_participant_id IN (${placeholders}) OR recipient_participant_id IN (${placeholders}))`,
      ).bind(organizationId, ...participantIds, ...participantIds),
      env.DB.prepare(
        `DELETE FROM clues WHERE organization_id = ?
          AND (author_participant_id IN (${placeholders}) OR recipient_participant_id IN (${placeholders}))`,
      ).bind(organizationId, ...participantIds, ...participantIds),
      env.DB.prepare(
        `DELETE FROM conversation_messages WHERE organization_id = ? AND sender_participant_id IN (${placeholders})`,
      ).bind(organizationId, ...participantIds),
    ]);
  }

  const objects = await env.DB.prepare(
    `SELECT object_key FROM r2_objects WHERE organization_id = ? AND owner_id = ?`,
  )
    .bind(organizationId, userId)
    .all<{ object_key: string }>();

  for (const object of objects.results ?? []) {
    await env.ASSETS.delete(object.object_key);
  }

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM r2_objects WHERE organization_id = ? AND owner_id = ?`).bind(
      organizationId,
      userId,
    ),
    // Cascades remove profiles, match memberships and activities.
    env.DB.prepare(`DELETE FROM participants WHERE user_id = ? AND organization_id = ?`).bind(
      userId,
      organizationId,
    ),
    env.DB.prepare(`DELETE FROM notifications WHERE recipient_user_id = ? AND organization_id = ?`).bind(
      userId,
      organizationId,
    ),
    env.DB.prepare(`DELETE FROM identities WHERE user_id = ? AND organization_id = ?`).bind(
      userId,
      organizationId,
    ),
    env.DB.prepare(`DELETE FROM sessions WHERE user_id = ? AND organization_id = ?`).bind(
      userId,
      organizationId,
    ),
    env.DB.prepare(`DELETE FROM role_grants WHERE user_id = ? AND organization_id = ?`).bind(
      userId,
      organizationId,
    ),
    env.DB.prepare(`UPDATE ai_interactions SET user_id = NULL WHERE user_id = ? AND organization_id = ?`).bind(
      userId,
      organizationId,
    ),
    // The action is retained for accountability; the actor link is severed.
    env.DB.prepare(
      `UPDATE audit_events SET actor_user_id = NULL WHERE actor_user_id = ? AND organization_id = ?`,
    ).bind(userId, organizationId),
    env.DB.prepare(
      `UPDATE users
          SET status = 'deleted', deleted_at = ?, display_name = NULL,
              work_email_ciphertext = NULL, work_email_lookup_hmac = NULL, key_version = NULL, updated_at = ?
        WHERE id = ? AND organization_id = ?`,
    ).bind(now, now, userId, organizationId),
  ]);

  await setRequestState(env, requestId, "completed", {
    result: {
      participantRecords: participantIds.length,
      objectsDeleted: (objects.results ?? []).length,
    },
  });

  // Recorded against the opaque user id, which no longer resolves to a person.
  await audit(env, organizationId, "privacy.erase_completed", userId, {
    requestId,
    participantRecords: participantIds.length,
  });

  return "completed";
}
