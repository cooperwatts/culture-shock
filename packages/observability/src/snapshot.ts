import type { OperationalSnapshot } from "./health.js";

/** Minimal read surface so this module stays free of runtime-specific types. */
export interface SqlReader {
  first<T>(sql: string, params: readonly unknown[]): Promise<T | null>;
}

function count(row: { count: number } | null): number {
  return row?.count ?? 0;
}

/**
 * Collects operational counters for one organization. Every query returns a
 * count or an age, so the snapshot can be logged and shown to an operator who
 * has no access to participant data.
 */
export async function gatherOperationalSnapshot(
  reader: SqlReader,
  organizationId: string,
  now: Date = new Date(),
): Promise<OperationalSnapshot> {
  const nowIso = now.toISOString();
  const oneHourAgo = new Date(now.getTime() - 3600 * 1000).toISOString();
  const oneDayAgo = new Date(now.getTime() - 86400 * 1000).toISOString();
  const maxAttempts = 8;

  const [
    unpublished,
    oldest,
    exhausted,
    overdue,
    delivered,
    failed,
    stuckRuns,
    aiCalls,
    aiFailures,
    authFailures,
    expiredExports,
  ] = await Promise.all([
    reader.first<{ count: number }>(
      `SELECT COUNT(*) AS count FROM outbox_events
        WHERE organization_id = ? AND published_at IS NULL AND attempts < ?`,
      [organizationId, maxAttempts],
    ),
    reader.first<{ oldest: string | null }>(
      `SELECT MIN(occurred_at) AS oldest FROM outbox_events
        WHERE organization_id = ? AND published_at IS NULL AND attempts < ?`,
      [organizationId, maxAttempts],
    ),
    reader.first<{ count: number }>(
      `SELECT COUNT(*) AS count FROM outbox_events
        WHERE organization_id = ? AND published_at IS NULL AND attempts >= ?`,
      [organizationId, maxAttempts],
    ),
    reader.first<{ count: number }>(
      `SELECT COUNT(*) AS count FROM notifications
        WHERE organization_id = ? AND state = 'scheduled' AND scheduled_at < ?`,
      [organizationId, oneHourAgo],
    ),
    reader.first<{ count: number }>(
      `SELECT COUNT(*) AS count FROM notifications
        WHERE organization_id = ? AND state = 'delivered' AND delivered_at > ?`,
      [organizationId, oneDayAgo],
    ),
    reader.first<{ count: number }>(
      `SELECT COUNT(*) AS count FROM notifications
        WHERE organization_id = ? AND state = 'failed' AND updated_at > ?`,
      [organizationId, oneDayAgo],
    ),
    reader.first<{ count: number }>(
      `SELECT COUNT(*) AS count FROM match_runs
        WHERE organization_id = ? AND state IN ('queued', 'running') AND created_at < ?`,
      [organizationId, oneHourAgo],
    ),
    reader.first<{ count: number }>(
      `SELECT COUNT(*) AS count FROM ai_interactions WHERE organization_id = ? AND created_at > ?`,
      [organizationId, oneDayAgo],
    ),
    reader.first<{ count: number }>(
      `SELECT COUNT(*) AS count FROM ai_interactions
        WHERE organization_id = ? AND created_at > ? AND status = 'failed'`,
      [organizationId, oneDayAgo],
    ),
    // Unconsumed challenges are the closest proxy for failed sign-in attempts.
    reader.first<{ count: number }>(
      `SELECT COUNT(*) AS count FROM auth_challenges
        WHERE organization_id = ? AND created_at > ? AND consumed_at IS NULL`,
      [organizationId, oneHourAgo],
    ),
    reader.first<{ count: number }>(
      `SELECT COUNT(*) AS count FROM r2_objects
        WHERE organization_id = ? AND expires_at IS NOT NULL AND expires_at < ?`,
      [organizationId, nowIso],
    ),
  ]);

  const oldestAt = oldest?.oldest ? new Date(oldest.oldest).getTime() : null;

  return {
    outboxUnpublished: count(unpublished),
    outboxOldestUnpublishedSeconds: oldestAt === null ? 0 : Math.max(0, Math.round((now.getTime() - oldestAt) / 1000)),
    outboxExhausted: count(exhausted),
    notificationsOverdue: count(overdue),
    notificationsDelivered24h: count(delivered),
    notificationsFailed24h: count(failed),
    matchRunsStuck: count(stuckRuns),
    aiCalls24h: count(aiCalls),
    aiFailures24h: count(aiFailures),
    authFailures1h: count(authFailures),
    expiredExportsPending: count(expiredExports),
  };
}
