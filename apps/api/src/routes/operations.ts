import { Hono } from "hono";
import { DomainError, authorize } from "@culture-shock/domain";
import { evaluateHealth, gatherOperationalSnapshot } from "@culture-shock/observability";
import type { AppBindings } from "../env.js";
import { Database } from "../db/database.js";
import { requirePrincipal } from "../auth/session.js";
import { ok } from "../http/responses.js";

export const operationsRoutes = new Hono<AppBindings>();

/**
 * Operational health for the installation owner. Counts and ages only, so the
 * `support_readonly` role can see delivery and job health without any access to
 * participant data.
 */
operationsRoutes.get("/admin/operations", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const organizationId = c.get("organizationId");
  if (!organizationId) throw new DomainError("dependency_unavailable", "Installation not loaded");

  // Deliberately not a step-up action: an operator should be able to check
  // health during an incident without re-authenticating.
  authorize(principal, "instances:read");

  const db = new Database(c.env.DB, organizationId);
  const snapshot = await gatherOperationalSnapshot(
    { first: (sql, params) => db.first(sql, params as never[]) },
    organizationId,
  );
  const report = evaluateHealth(snapshot);

  return ok(c, { status: report.status, evaluatedAt: report.evaluatedAt, checks: report.checks, snapshot });
});
