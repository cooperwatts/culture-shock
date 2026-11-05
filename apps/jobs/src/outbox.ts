import { isDomainEventType, newId, type DomainEventEnvelope } from "@culture-shock/domain";

export interface JobsEnv {
  readonly DB: D1Database;
  readonly ASSETS: R2Bucket;
  readonly JOBS: Queue<DomainEventEnvelope>;
  readonly ENVIRONMENT: string;
  readonly PUBLIC_BASE_URL: string;
  readonly LOG_LEVEL?: string;
  readonly OUTBOX_BATCH_SIZE?: string;

  /** Worker secrets; absent until the deployer sets them. */
  readonly FIELD_ENCRYPTION_KEY?: string;
  readonly EMAIL_PROVIDER_API_KEY?: string;
  readonly EMAIL_RELAY_URL?: string;
}

const LEASE_SECONDS = 60;
const MAX_ATTEMPTS = 8;

interface OutboxRow {
  id: string;
  organization_id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload_json: string;
  occurred_at: string;
  attempts: number;
}

/**
 * Leases unpublished outbox rows and publishes reference-only envelopes.
 *
 * Queue publication is not atomic with the D1 write that produced the row, so a
 * crash between `send` and `mark published` can duplicate a message. Consumers
 * deduplicate on `job_receipts`; this is at-least-once by design, not
 * exactly-once.
 */
export async function dispatchOutbox(env: JobsEnv): Promise<{ published: number; failed: number }> {
  const batchSize = Math.min(Number(env.OUTBOX_BATCH_SIZE ?? "50"), 100);
  const now = new Date().toISOString();
  const leaseUntil = new Date(Date.now() + LEASE_SECONDS * 1000).toISOString();

  const candidates = await env.DB.prepare(
    `SELECT id, organization_id, aggregate_type, aggregate_id, event_type, payload_json, occurred_at, attempts
       FROM outbox_events
      WHERE published_at IS NULL
        AND available_at <= ?
        AND (lease_until IS NULL OR lease_until < ?)
        AND attempts < ?
      ORDER BY occurred_at
      LIMIT ?`,
  )
    .bind(now, now, MAX_ATTEMPTS, batchSize)
    .all<OutboxRow>();

  const rows = candidates.results ?? [];
  if (rows.length === 0) return { published: 0, failed: 0 };

  // Claim the lease first so a concurrent dispatcher invocation skips these rows.
  await env.DB.batch(
    rows.map((row) =>
      env.DB.prepare(
        `UPDATE outbox_events SET lease_until = ?, attempts = attempts + 1 WHERE id = ? AND published_at IS NULL`,
      ).bind(leaseUntil, row.id),
    ),
  );

  let published = 0;
  let failed = 0;

  for (const row of rows) {
    const envelope: DomainEventEnvelope = {
      eventId: row.id,
      eventType: isDomainEventType(row.event_type) ? row.event_type : "analytics.refresh_requested",
      organizationId: row.organization_id as DomainEventEnvelope["organizationId"],
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      occurredAt: row.occurred_at,
      attempt: row.attempts + 1,
      references: JSON.parse(row.payload_json) as DomainEventEnvelope["references"],
    };

    try {
      await env.JOBS.send(envelope);
      await env.DB.prepare(`UPDATE outbox_events SET published_at = ?, lease_until = NULL WHERE id = ?`)
        .bind(new Date().toISOString(), row.id)
        .run();
      published += 1;
    } catch (cause) {
      failed += 1;
      await env.DB.prepare(`UPDATE outbox_events SET lease_until = NULL, last_error = ? WHERE id = ?`)
        .bind(cause instanceof Error ? cause.name : "send_failed", row.id)
        .run();
    }
  }

  return { published, failed };
}

/**
 * Records a handler receipt. Returns false when this event was already handled,
 * which is how at-least-once delivery becomes effectively-once processing.
 */
export async function claimReceipt(env: JobsEnv, eventId: string, handlerKey: string): Promise<boolean> {
  try {
    await env.DB.prepare(
      `INSERT INTO job_receipts (id, event_id, handler_key, completed_at) VALUES (?, ?, ?, ?)`,
    )
      .bind(newId("AuditEventId"), eventId, handlerKey, new Date().toISOString())
      .run();
    return true;
  } catch {
    return false;
  }
}
