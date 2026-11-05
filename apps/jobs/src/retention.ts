import type { JobsEnv } from "./outbox.js";

/**
 * Retention sweep. Values come from the installation's published privacy
 * configuration; these defaults only apply before one is published.
 */
export interface RetentionPolicy {
  readonly cultureProfileDaysAfterCompletion: number;
  readonly conversationDaysAfterCompletion: number;
  readonly auditEventDays: number;
  readonly magicLinkTokenSeconds: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  cultureProfileDaysAfterCompletion: 90,
  conversationDaysAfterCompletion: 30,
  auditEventDays: 365,
  magicLinkTokenSeconds: 900,
};

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86400 * 1000).toISOString();
}

export async function sweepRetention(
  env: JobsEnv,
  policy: RetentionPolicy = DEFAULT_RETENTION,
): Promise<Record<string, number>> {
  const now = new Date().toISOString();
  const results: Record<string, number> = {};

  const statements: Array<[string, D1PreparedStatement]> = [
    ["auth_challenges", env.DB.prepare(`DELETE FROM auth_challenges WHERE expires_at < ?`).bind(now)],
    ["sessions", env.DB.prepare(`DELETE FROM sessions WHERE absolute_expires_at < ?`).bind(now)],
    ["idempotency_keys", env.DB.prepare(`DELETE FROM idempotency_keys WHERE expires_at < ?`).bind(now)],
    ["rate_limit_counters", env.DB.prepare(`DELETE FROM rate_limit_counters WHERE expires_at < ?`).bind(now)],
    [
      "culture_profiles",
      env.DB.prepare(
        `DELETE FROM culture_profiles WHERE expires_at < ? OR revoked_at IS NOT NULL AND revoked_at < ?`,
      ).bind(now, daysAgo(7)),
    ],
    [
      "conversation_messages",
      env.DB.prepare(
        `DELETE FROM conversation_messages WHERE conversation_id IN
           (SELECT id FROM conversations WHERE retention_until < ?)`,
      ).bind(now),
    ],
    [
      "audit_events",
      env.DB.prepare(`DELETE FROM audit_events WHERE occurred_at < ?`).bind(
        daysAgo(policy.auditEventDays),
      ),
    ],
    [
      "job_receipts",
      env.DB.prepare(`DELETE FROM job_receipts WHERE completed_at < ?`).bind(daysAgo(30)),
    ],
  ];

  for (const [name, statement] of statements) {
    const result = await statement.run();
    results[name] = result.meta.changes ?? 0;
  }

  // Expired private objects are removed from R2 as well as from the index.
  const expiredObjects = await env.DB.prepare(
    `SELECT object_key FROM r2_objects WHERE expires_at IS NOT NULL AND expires_at < ? LIMIT 100`,
  )
    .bind(now)
    .all<{ object_key: string }>();

  for (const row of expiredObjects.results ?? []) {
    await env.ASSETS.delete(row.object_key);
  }
  await env.DB.prepare(`DELETE FROM r2_objects WHERE expires_at IS NOT NULL AND expires_at < ?`)
    .bind(now)
    .run();
  results.r2_objects = (expiredObjects.results ?? []).length;

  return results;
}
