import { describe, expect, it } from "vitest";
import {
  DEFAULT_THRESHOLDS,
  createLogger,
  evaluateHealth,
  redactFields,
  type OperationalSnapshot,
} from "../src/index.js";

const healthy: OperationalSnapshot = {
  outboxUnpublished: 3,
  outboxOldestUnpublishedSeconds: 12,
  outboxExhausted: 0,
  notificationsOverdue: 0,
  notificationsDelivered24h: 400,
  notificationsFailed24h: 2,
  matchRunsStuck: 0,
  aiCalls24h: 20,
  aiFailures24h: 1,
  authFailures1h: 4,
  expiredExportsPending: 0,
};

function statusOf(report: ReturnType<typeof evaluateHealth>, key: string): string {
  return report.checks.find((check) => check.key === key)?.status ?? "missing";
}

describe("health evaluation", () => {
  it("reports ok for a healthy installation", () => {
    const report = evaluateHealth(healthy);
    expect(report.status).toBe("ok");
    expect(report.alerts).toEqual([]);
  });

  it("escalates outbox lag from degraded to breached", () => {
    const degraded = evaluateHealth({ ...healthy, outboxOldestUnpublishedSeconds: 400 });
    expect(statusOf(degraded, "outbox_age")).toBe("degraded");
    expect(degraded.status).toBe("degraded");

    const breached = evaluateHealth({ ...healthy, outboxOldestUnpublishedSeconds: 1200 });
    expect(statusOf(breached, "outbox_age")).toBe("breached");
    expect(breached.alerts).toContain("outbox_age");
  });

  it("treats a single event past the retry ceiling as a breach", () => {
    const report = evaluateHealth({ ...healthy, outboxExhausted: 1 });
    expect(statusOf(report, "outbox_exhausted")).toBe("breached");
  });

  it("computes the notification failure rate from the delivered plus failed total", () => {
    const report = evaluateHealth({
      ...healthy,
      notificationsDelivered24h: 50,
      notificationsFailed24h: 50,
    });
    expect(statusOf(report, "notification_failure_rate")).toBe("breached");
  });

  it("does not divide by zero when nothing has been sent", () => {
    const report = evaluateHealth({
      ...healthy,
      notificationsDelivered24h: 0,
      notificationsFailed24h: 0,
      aiCalls24h: 0,
      aiFailures24h: 0,
    });
    expect(statusOf(report, "notification_failure_rate")).toBe("ok");
    expect(statusOf(report, "ai_failure_rate")).toBe("ok");
  });

  it("treats AI failures as degraded, never breached, because fallbacks cover them", () => {
    const report = evaluateHealth({ ...healthy, aiCalls24h: 10, aiFailures24h: 10 });
    expect(statusOf(report, "ai_failure_rate")).toBe("degraded");
    expect(report.alerts).not.toContain("ai_failure_rate");
  });

  it("breaches when expired exports are still stored", () => {
    const report = evaluateHealth({ ...healthy, expiredExportsPending: 2 });
    expect(statusOf(report, "expired_exports")).toBe("breached");
  });

  it("gives an operator an action for every unhealthy check", () => {
    const report = evaluateHealth({
      ...healthy,
      outboxOldestUnpublishedSeconds: 1200,
      matchRunsStuck: 3,
    });
    for (const check of report.checks) {
      if (check.status === "ok") expect(check.action).toBe("");
      else expect(check.action.length).toBeGreaterThan(20);
    }
  });

  it("honours overridden thresholds", () => {
    const report = evaluateHealth(
      { ...healthy, outboxOldestUnpublishedSeconds: 60 },
      { ...DEFAULT_THRESHOLDS, outboxAgeSecondsDegraded: 30, outboxAgeSecondsBreached: 45 },
    );
    expect(statusOf(report, "outbox_age")).toBe("breached");
  });
});

describe("log redaction", () => {
  it("drops forbidden field names outright", () => {
    const fields = redactFields({ email: "sam@example.com", displayName: "Sam", participantId: "par_1" });
    expect(fields.email).toBe("[redacted]");
    expect(fields.displayName).toBe("[redacted]");
    expect(fields.participantId).toBe("par_1");
  });

  it("scrubs identifiers that appear inside permitted fields", () => {
    const fields = redactFields({ detail: "failed for sam@example.com" });
    expect(fields.detail).toBe("failed for [email]");
  });

  it("strips bearer tokens", () => {
    const fields = redactFields({ detail: "Authorization: Bearer abc.def-ghi" });
    expect(String(fields.detail)).toContain("[token]");
    expect(String(fields.detail)).not.toContain("abc.def-ghi");
  });

  it("truncates long values so one log line cannot carry a payload", () => {
    const fields = redactFields({ detail: "x".repeat(1000) });
    expect(String(fields.detail).length).toBeLessThan(320);
  });

  it("respects the configured level", () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: "warn",
      service: "test",
      environment: "test",
      sink: (line) => lines.push(line),
    });

    logger.info("ignored");
    logger.warn("kept");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toMatchObject({ level: "warn", message: "kept" });
  });

  it("emits alerts with a machine-matchable code", () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: "info",
      service: "test",
      environment: "test",
      sink: (line) => lines.push(line),
    });

    logger.alert("outbox_age", { observed: 1200 });
    expect(JSON.parse(lines[0] as string)).toMatchObject({
      level: "error",
      message: "alert",
      alert: "outbox_age",
      observed: 1200,
    });
  });

  it("carries child fields into every line", () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: "info",
      service: "test",
      environment: "test",
      sink: (line) => lines.push(line),
    }).child({ component: "delivery" });

    logger.info("sent", { count: 3 });
    expect(JSON.parse(lines[0] as string)).toMatchObject({ component: "delivery", count: 3 });
  });
});
