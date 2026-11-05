import { evaluateHealth, gatherOperationalSnapshot } from "@culture-shock/observability";
import { loggerFor } from "./log.js";
import type { JobsEnv } from "./outbox.js";

/**
 * Evaluates operational health and emits alerts an operator can route on.
 *
 * Breaches are emitted one alert per check rather than a single combined line,
 * so an alerting rule can match on `alert` without parsing a message body.
 */
export async function evaluateAndAlert(env: JobsEnv): Promise<void> {
  const logger = loggerFor(env, { component: "health" });

  const organization = await env.DB.prepare(
    `SELECT id FROM organizations WHERE status = 'active' LIMIT 1`,
  ).first<{ id: string }>();

  if (!organization) {
    logger.warn("health_skipped", { reason: "not_provisioned" });
    return;
  }

  const snapshot = await gatherOperationalSnapshot(
    {
      first: async (sql, params) =>
        env.DB.prepare(sql)
          .bind(...(params as never[]))
          .first(),
    },
    organization.id,
  );

  const report = evaluateHealth(snapshot);

  for (const check of report.checks) {
    if (check.status === "breached") {
      logger.alert(check.key, { observed: check.observed, threshold: check.threshold, action: check.action });
    } else if (check.status === "degraded") {
      logger.warn("slo_degraded", { check: check.key, observed: check.observed, threshold: check.threshold });
    }
  }

  logger.info("health_evaluated", {
    status: report.status,
    outboxUnpublished: snapshot.outboxUnpublished,
    outboxOldestSeconds: snapshot.outboxOldestUnpublishedSeconds,
    notificationsOverdue: snapshot.notificationsOverdue,
  });
}
