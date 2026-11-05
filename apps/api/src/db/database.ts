import { newId, type OrganizationId } from "@culture-shock/domain";

export type SqlValue = string | number | null;

export interface AuditFact {
  readonly actorUserId: string | null;
  readonly actorKind: "user" | "system" | "job" | "ai";
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly purpose?: string;
  /** Sanitized key/value metadata; never participant content. */
  readonly metadata?: Record<string, string | number | boolean | null>;
}

export interface OutboxFact {
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  /** References only; the queue body never carries participant data. */
  readonly references?: Record<string, string | number | boolean | null>;
  readonly availableAt?: string;
}

/**
 * Thin D1 wrapper. All SQL lives behind repositories; routes never see a raw
 * statement, and every tenant-owned query is organization-scoped.
 */
export class Database {
  readonly #db: D1Database;
  readonly organizationId: OrganizationId;

  constructor(db: D1Database, organizationId: OrganizationId) {
    this.#db = db;
    this.organizationId = organizationId;
  }

  get raw(): D1Database {
    return this.#db;
  }

  async first<T>(sql: string, params: SqlValue[] = []): Promise<T | null> {
    return this.#db
      .prepare(sql)
      .bind(...params)
      .first<T>();
  }

  async all<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    const result = await this.#db
      .prepare(sql)
      .bind(...params)
      .all<T>();
    return result.results ?? [];
  }

  async run(sql: string, params: SqlValue[] = []): Promise<D1Result> {
    return this.#db
      .prepare(sql)
      .bind(...params)
      .run();
  }

  statement(sql: string, params: SqlValue[] = []): D1PreparedStatement {
    return this.#db.prepare(sql).bind(...params);
  }

  /**
   * Commits a state change together with its audit fact and outbox rows in one
   * D1 batch, so an event can never exist without the state change that caused
   * it. Queue publication happens separately via the outbox dispatcher.
   */
  async commit(
    statements: D1PreparedStatement[],
    audit: AuditFact | AuditFact[] = [],
    outbox: OutboxFact | OutboxFact[] = [],
  ): Promise<void> {
    const now = new Date().toISOString();
    const auditFacts = Array.isArray(audit) ? audit : [audit];
    const outboxFacts = Array.isArray(outbox) ? outbox : [outbox];
    const batch = [...statements];

    for (const fact of auditFacts) {
      batch.push(
        this.statement(
          `INSERT INTO audit_events
             (id, organization_id, actor_user_id, actor_kind, action, resource_type, resource_id, purpose, metadata_json, occurred_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            newId("AuditEventId"),
            this.organizationId,
            fact.actorUserId,
            fact.actorKind,
            fact.action,
            fact.resourceType,
            fact.resourceId,
            fact.purpose ?? "operation",
            JSON.stringify(fact.metadata ?? {}),
            now,
          ],
        ),
      );
    }

    for (const fact of outboxFacts) {
      batch.push(
        this.statement(
          `INSERT INTO outbox_events
             (id, organization_id, aggregate_type, aggregate_id, event_type, payload_json, occurred_at, available_at, attempts)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
          [
            newId("OutboxEventId"),
            this.organizationId,
            fact.aggregateType,
            fact.aggregateId,
            fact.eventType,
            JSON.stringify(fact.references ?? {}),
            now,
            fact.availableAt ?? now,
          ],
        ),
      );
    }

    await this.#db.batch(batch);
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function boolToInt(value: boolean): number {
  return value ? 1 : 0;
}

export function intToBool(value: number | null | undefined): boolean {
  return value === 1;
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
