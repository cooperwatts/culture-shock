export const SLO_STATUSES = ["ok", "degraded", "breached"] as const;
export type SloStatus = (typeof SLO_STATUSES)[number];

/**
 * Raw operational signals. Everything here is a count or an age: nothing in a
 * health snapshot identifies a person, so it is safe to log and to surface to
 * an operator who has no access to participant data.
 */
export interface OperationalSnapshot {
  readonly outboxUnpublished: number;
  readonly outboxOldestUnpublishedSeconds: number;
  readonly outboxExhausted: number;
  readonly notificationsOverdue: number;
  readonly notificationsDelivered24h: number;
  readonly notificationsFailed24h: number;
  readonly matchRunsStuck: number;
  readonly aiCalls24h: number;
  readonly aiFailures24h: number;
  readonly authFailures1h: number;
  readonly expiredExportsPending: number;
}

export interface SloThresholds {
  readonly outboxAgeSecondsDegraded: number;
  readonly outboxAgeSecondsBreached: number;
  readonly outboxExhaustedBreached: number;
  readonly notificationsOverdueDegraded: number;
  readonly notificationFailureRateDegraded: number;
  readonly notificationFailureRateBreached: number;
  readonly matchRunsStuckBreached: number;
  readonly aiFailureRateDegraded: number;
  readonly authFailures1hDegraded: number;
  readonly expiredExportsBreached: number;
}

/**
 * Starting targets. These are defaults for a single installation, not a
 * universal SLO: tune them against your own traffic before alerting on them.
 */
export const DEFAULT_THRESHOLDS: SloThresholds = {
  outboxAgeSecondsDegraded: 300,
  outboxAgeSecondsBreached: 900,
  outboxExhaustedBreached: 1,
  notificationsOverdueDegraded: 50,
  notificationFailureRateDegraded: 0.05,
  notificationFailureRateBreached: 0.2,
  matchRunsStuckBreached: 1,
  aiFailureRateDegraded: 0.25,
  authFailures1hDegraded: 100,
  expiredExportsBreached: 1,
};

export interface SloCheck {
  readonly key: string;
  readonly title: string;
  readonly status: SloStatus;
  readonly observed: number;
  readonly threshold: number | null;
  /** What an operator should actually do; empty when the check is healthy. */
  readonly action: string;
}

export interface HealthReport {
  readonly status: SloStatus;
  readonly evaluatedAt: string;
  readonly checks: readonly SloCheck[];
  readonly alerts: readonly string[];
}

function worst(statuses: readonly SloStatus[]): SloStatus {
  if (statuses.includes("breached")) return "breached";
  if (statuses.includes("degraded")) return "degraded";
  return "ok";
}

function rate(numerator: number, denominator: number): number {
  return denominator <= 0 ? 0 : numerator / denominator;
}

function check(
  key: string,
  title: string,
  observed: number,
  degradedAt: number | null,
  breachedAt: number | null,
  action: string,
): SloCheck {
  let status: SloStatus = "ok";
  if (breachedAt !== null && observed >= breachedAt) status = "breached";
  else if (degradedAt !== null && observed >= degradedAt) status = "degraded";

  return {
    key,
    title,
    status,
    observed: Number(observed.toFixed(4)),
    threshold: status === "breached" ? breachedAt : status === "degraded" ? degradedAt : (degradedAt ?? breachedAt),
    action: status === "ok" ? "" : action,
  };
}

/**
 * Evaluates the snapshot against thresholds. Pure, so the alerting rules can be
 * tested without a database and reused by both the API and the jobs Worker.
 */
export function evaluateHealth(
  snapshot: OperationalSnapshot,
  thresholds: SloThresholds = DEFAULT_THRESHOLDS,
  evaluatedAt: string = new Date().toISOString(),
): HealthReport {
  const notificationFailureRate = rate(
    snapshot.notificationsFailed24h,
    snapshot.notificationsFailed24h + snapshot.notificationsDelivered24h,
  );
  const aiFailureRate = rate(snapshot.aiFailures24h, snapshot.aiCalls24h);

  const checks: SloCheck[] = [
    check(
      "outbox_age",
      "Outbox dispatch lag",
      snapshot.outboxOldestUnpublishedSeconds,
      thresholds.outboxAgeSecondsDegraded,
      thresholds.outboxAgeSecondsBreached,
      "The scheduled dispatcher is not keeping up or is not running. Check the jobs Worker cron and queue bindings.",
    ),
    check(
      "outbox_exhausted",
      "Events past the retry ceiling",
      snapshot.outboxExhausted,
      null,
      thresholds.outboxExhaustedBreached,
      "These events will never publish on their own. Inspect `outbox_events.last_error` and replay deliberately.",
    ),
    check(
      "notifications_overdue",
      "Notifications past their send time",
      snapshot.notificationsOverdue,
      thresholds.notificationsOverdueDegraded,
      null,
      "Delivery is lagging. Check the email provider credential and the per-recipient daily cap.",
    ),
    check(
      "notification_failure_rate",
      "Notification failure rate (24h)",
      notificationFailureRate,
      thresholds.notificationFailureRateDegraded,
      thresholds.notificationFailureRateBreached,
      "Check the provider status and the from-address domain authentication.",
    ),
    check(
      "match_runs_stuck",
      "Match runs stuck in progress",
      snapshot.matchRunsStuck,
      null,
      thresholds.matchRunsStuckBreached,
      "A matching job stopped mid-run. The run is idempotent, so it is safe to re-request the same preview.",
    ),
    check(
      "ai_failure_rate",
      "AI failure rate (24h)",
      aiFailureRate,
      thresholds.aiFailureRateDegraded,
      null,
      "Deterministic fallbacks are covering for the provider, so nothing is broken for users. Check credentials and budget.",
    ),
    check(
      "auth_failures",
      "Failed sign-ins (1h)",
      snapshot.authFailures1h,
      thresholds.authFailures1hDegraded,
      null,
      "Could be a misconfigured provider or credential stuffing. Compare against your WAF rate-limiting.",
    ),
    check(
      "expired_exports",
      "Expired exports still stored",
      snapshot.expiredExportsPending,
      null,
      thresholds.expiredExportsBreached,
      "Privacy exports outlived their retention. Confirm the nightly retention sweep is running.",
    ),
  ];

  return {
    status: worst(checks.map((entry) => entry.status)),
    evaluatedAt,
    checks,
    alerts: checks.filter((entry) => entry.status === "breached").map((entry) => entry.key),
  };
}
