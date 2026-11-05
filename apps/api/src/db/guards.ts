import { DomainError, newId, type UserId } from "@culture-shock/domain";
import { Database, nowIso } from "./database.js";

/**
 * Replay protection for non-idempotent writes. A repeated key with the same
 * request body returns the stored outcome; a repeated key with a different body
 * is a conflict rather than a silent second execution.
 */
export class IdempotencyStore {
  constructor(private readonly db: Database) {}

  async claim(input: {
    key: string;
    actorUserId: UserId;
    route: string;
    requestHash: string;
    ttlSeconds: number;
  }): Promise<{ status: "claimed" } | { status: "replayed"; responseRef: string | null; statusCode: number | null }> {
    const existing = await this.db.first<{ request_hash: string; response_ref: string | null; status_code: number | null }>(
      `SELECT request_hash, response_ref, status_code FROM idempotency_keys
        WHERE id = ? AND organization_id = ? AND actor_user_id = ? AND route = ? AND expires_at > ?`,
      [input.key, this.db.organizationId, input.actorUserId, input.route, nowIso()],
    );

    if (existing) {
      if (existing.request_hash !== input.requestHash) {
        throw new DomainError("conflict", "Idempotency-Key was reused with a different request body");
      }
      return { status: "replayed", responseRef: existing.response_ref, statusCode: existing.status_code };
    }

    await this.db.run(
      `INSERT INTO idempotency_keys
         (id, organization_id, actor_user_id, route, request_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.key,
        this.db.organizationId,
        input.actorUserId,
        input.route,
        input.requestHash,
        new Date(Date.now() + input.ttlSeconds * 1000).toISOString(),
        nowIso(),
      ],
    );
    return { status: "claimed" };
  }

  async complete(key: string, responseRef: string, statusCode: number): Promise<void> {
    await this.db.run(
      `UPDATE idempotency_keys SET response_ref = ?, status_code = ? WHERE id = ? AND organization_id = ?`,
      [responseRef, statusCode, key, this.db.organizationId],
    );
  }
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

/**
 * Fixed-window counter backed by D1. This is an application-level control that
 * complements, and does not replace, Cloudflare WAF/Rate Limiting at the edge.
 */
export class RateLimiter {
  constructor(private readonly db: D1Database) {}

  async consume(bucketKey: string, limit: number, windowSeconds: number): Promise<RateLimitDecision> {
    const now = Date.now();
    const windowStart = new Date(Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000).toISOString();
    const expiresAt = new Date(Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000 + windowSeconds * 1000);

    await this.db
      .prepare(
        `INSERT INTO rate_limit_counters (id, bucket_key, window_start, count, expires_at)
         VALUES (?, ?, ?, 1, ?)
         ON CONFLICT (bucket_key, window_start) DO UPDATE SET count = count + 1`,
      )
      .bind(newId("AuditEventId"), bucketKey, windowStart, expiresAt.toISOString())
      .run();

    const row = await this.db
      .prepare(`SELECT count FROM rate_limit_counters WHERE bucket_key = ? AND window_start = ?`)
      .bind(bucketKey, windowStart)
      .first<{ count: number }>();

    const count = row?.count ?? 1;
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: Math.ceil((expiresAt.getTime() - now) / 1000),
    };
  }
}
