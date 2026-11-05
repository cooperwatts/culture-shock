import { Hono } from "hono";
import { DomainError, authorize, newId } from "@culture-shock/domain";
import { z } from "zod";
import type { AppBindings } from "../env.js";
import { Database, nowIso, parseJson } from "../db/database.js";
import { requirePrincipal, stepUpMaxAge } from "../auth/session.js";
import { accepted, ok, type AppContext } from "../http/responses.js";

export const privacyRoutes = new Hono<AppBindings>();

const requestSchema = z.object({
  userId: z.string().regex(/^usr_[0-9a-f]{32}$/),
  reason: z.string().min(5).max(300),
});

const holdSchema = z.object({
  userId: z.string().regex(/^usr_[0-9a-f]{32}$/),
  reason: z.string().min(5).max(300),
});

function context(c: AppContext) {
  const organizationId = c.get("organizationId");
  const config = c.get("config");
  if (!organizationId || !config) throw new DomainError("dependency_unavailable", "Installation not loaded");
  return { config, db: new Database(c.env.DB, organizationId) };
}

/**
 * Queues a privacy request. The work runs asynchronously in the jobs Worker;
 * this route only records the request, the stated purpose, and the requester.
 */
async function queueRequest(
  c: AppContext,
  kind: "export" | "erase",
  eventType: "privacy.export_requested" | "privacy.erase_requested",
) {
  const principal = requirePrincipal(c.get("principal"));
  const { config, db } = context(c);
  authorize(principal, kind === "export" ? "privacy:export" : "privacy:erase", {
    now: Date.now(),
    stepUpMaxAgeSeconds: stepUpMaxAge(config),
  });

  const body = requestSchema.parse(await c.req.json());

  const subject = await db.first<{ id: string; status: string }>(
    `SELECT id, status FROM users WHERE id = ? AND organization_id = ?`,
    [body.userId, db.organizationId],
  );
  if (!subject) throw new DomainError("not_found", "No such person in this organization");
  if (kind === "erase" && subject.status === "deleted") {
    throw new DomainError("conflict", "That person has already been erased");
  }

  const inFlight = await db.first<{ id: string }>(
    `SELECT id FROM privacy_requests
      WHERE organization_id = ? AND subject_user_id = ? AND kind = ? AND state IN ('queued', 'running')`,
    [db.organizationId, body.userId, kind],
  );
  if (inFlight) {
    throw new DomainError("conflict", "A request of this kind is already in progress", {
      requestId: inFlight.id,
    });
  }

  const requestId = newId("AuditEventId");
  const timestamp = nowIso();

  await db.commit(
    [
      db.statement(
        `INSERT INTO privacy_requests
           (id, organization_id, subject_user_id, kind, state, requested_by, reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
        [requestId, db.organizationId, body.userId, kind, principal.userId, body.reason, timestamp, timestamp],
      ),
    ],
    {
      actorUserId: principal.userId,
      actorKind: "user",
      action: `privacy.${kind}_requested`,
      resourceType: "user",
      resourceId: body.userId,
      purpose: "privacy_request",
      metadata: { requestId, reason: body.reason.slice(0, 200) },
    },
    {
      aggregateType: "user",
      aggregateId: body.userId,
      eventType,
      references: { userId: body.userId, requestId },
    },
  );

  return accepted(c, { requestId, kind, state: "queued" });
}

privacyRoutes.post("/admin/privacy/export", (c) => queueRequest(c, "export", "privacy.export_requested"));
privacyRoutes.post("/admin/privacy/erase", (c) => queueRequest(c, "erase", "privacy.erase_requested"));

privacyRoutes.get("/admin/privacy/requests", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { config, db } = context(c);
  authorize(principal, "privacy:export", { now: Date.now(), stepUpMaxAgeSeconds: stepUpMaxAge(config) });

  const rows = await db.all<{
    id: string;
    subject_user_id: string;
    kind: string;
    state: string;
    reason: string;
    result_json: string;
    object_key: string | null;
    blocked_reason: string | null;
    created_at: string;
    completed_at: string | null;
  }>(
    `SELECT id, subject_user_id, kind, state, reason, result_json, object_key, blocked_reason, created_at, completed_at
       FROM privacy_requests WHERE organization_id = ? ORDER BY created_at DESC LIMIT 100`,
    [db.organizationId],
  );

  return ok(
    c,
    rows.map((row) => ({
      id: row.id,
      subjectUserId: row.subject_user_id,
      kind: row.kind,
      state: row.state,
      reason: row.reason,
      result: parseJson<unknown>(row.result_json, {}),
      downloadAvailable: row.object_key !== null,
      blockedReason: row.blocked_reason,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    })),
  );
});

/**
 * Streams a completed export. The object is never public: access requires the
 * privacy permission plus a recent sign-in, and each download is audited.
 */
privacyRoutes.get("/admin/privacy/requests/:id/download", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { config, db } = context(c);
  authorize(principal, "privacy:export", { now: Date.now(), stepUpMaxAgeSeconds: stepUpMaxAge(config) });

  const request = await db.first<{ object_key: string | null; subject_user_id: string; state: string }>(
    `SELECT object_key, subject_user_id, state FROM privacy_requests WHERE id = ? AND organization_id = ?`,
    [c.req.param("id"), db.organizationId],
  );
  if (!request || !request.object_key || request.state !== "completed") {
    throw new DomainError("not_found", "No export is available for that request");
  }

  const expiry = await db.first<{ expires_at: string | null }>(
    `SELECT expires_at FROM r2_objects WHERE object_key = ? AND organization_id = ?`,
    [request.object_key, db.organizationId],
  );
  if (expiry?.expires_at && new Date(expiry.expires_at).getTime() <= Date.now()) {
    throw new DomainError("not_found", "That export has expired");
  }

  const object = await c.env.ASSETS.get(request.object_key);
  if (!object) throw new DomainError("not_found", "That export is no longer stored");

  await db.commit([], {
    actorUserId: principal.userId,
    actorKind: "user",
    action: "privacy.export_downloaded",
    resourceType: "user",
    resourceId: request.subject_user_id,
    purpose: "privacy_request",
    metadata: { requestId: c.req.param("id") },
  });

  return new Response(object.body, {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="export-${c.req.param("id")}.json"`,
      "cache-control": "no-store",
    },
  });
});

privacyRoutes.get("/admin/privacy/holds", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { config, db } = context(c);
  authorize(principal, "privacy:erase", { now: Date.now(), stepUpMaxAgeSeconds: stepUpMaxAge(config) });

  const rows = await db.all<{ id: string; user_id: string; reason: string; created_at: string }>(
    `SELECT id, user_id, reason, created_at FROM legal_holds
      WHERE organization_id = ? AND released_at IS NULL ORDER BY created_at DESC`,
    [db.organizationId],
  );
  return ok(c, rows);
});

privacyRoutes.post("/admin/privacy/holds", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { config, db } = context(c);
  authorize(principal, "privacy:erase", { now: Date.now(), stepUpMaxAgeSeconds: stepUpMaxAge(config) });

  const body = holdSchema.parse(await c.req.json());
  const id = newId("AuditEventId");
  const timestamp = nowIso();

  try {
    await db.commit(
      [
        db.statement(
          `INSERT INTO legal_holds (id, organization_id, user_id, reason, placed_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, db.organizationId, body.userId, body.reason, principal.userId, timestamp, timestamp],
        ),
      ],
      {
        actorUserId: principal.userId,
        actorKind: "user",
        action: "privacy.hold_placed",
        resourceType: "user",
        resourceId: body.userId,
        purpose: "legal_hold",
        metadata: { holdId: id, reason: body.reason.slice(0, 200) },
      },
    );
  } catch {
    throw new DomainError("conflict", "An active hold already exists for that person");
  }

  return ok(c, { id, userId: body.userId });
});

privacyRoutes.delete("/admin/privacy/holds/:id", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { config, db } = context(c);
  authorize(principal, "privacy:erase", { now: Date.now(), stepUpMaxAgeSeconds: stepUpMaxAge(config) });

  const timestamp = nowIso();
  const result = await db.run(
    `UPDATE legal_holds SET released_at = ?, released_by = ?, updated_at = ?
      WHERE id = ? AND organization_id = ? AND released_at IS NULL`,
    [timestamp, principal.userId, timestamp, c.req.param("id"), db.organizationId],
  );
  if ((result.meta.changes ?? 0) === 0) throw new DomainError("not_found", "No active hold with that id");

  await db.commit([], {
    actorUserId: principal.userId,
    actorKind: "user",
    action: "privacy.hold_released",
    resourceType: "legal_hold",
    resourceId: c.req.param("id"),
    purpose: "legal_hold",
  });

  return c.body(null, 204);
});
