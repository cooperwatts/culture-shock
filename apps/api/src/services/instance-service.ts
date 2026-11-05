import {
  DomainError,
  assertInstanceTransition,
  type ExperienceInstanceId,
  type ExperienceInstanceState,
  type InstanceSnapshot,
  type UserId,
} from "@culture-shock/domain";
import type { InstallationConfig } from "@culture-shock/config";
import { analyzeRuleSet, type Rule } from "@culture-shock/rules";
import { effectiveRuleSet, planWorkflow, resolvePackConfig, type PackManifest } from "@culture-shock/pack-sdk";
import { Database, parseJson } from "../db/database.js";
import { InstanceRepository } from "../db/repositories.js";

export interface LaunchValidation {
  readonly ok: boolean;
  readonly issues: ReadonlyArray<{ code: string; message: string }>;
  readonly snapshot: InstanceSnapshot | null;
}

/**
 * Builds the immutable launch snapshot. Pack version, rules, privacy mode,
 * consent version and configuration are frozen here so a later pack or config
 * change cannot alter a running experience.
 */
export function buildSnapshot(input: {
  manifest: PackManifest;
  templateId: string;
  packConfig: Record<string, unknown>;
  rulesOverride: readonly Rule[];
  config: InstallationConfig;
}): LaunchValidation {
  const issues: Array<{ code: string; message: string }> = [];

  const resolvedConfig = resolvePackConfig(input.manifest, input.packConfig);
  for (const issue of resolvedConfig.issues) {
    issues.push({ code: "pack_config_invalid", message: `${issue.key}: ${issue.message}` });
  }

  let rules;
  try {
    rules = effectiveRuleSet(input.manifest, input.rulesOverride);
  } catch (cause) {
    issues.push({
      code: "rules_invalid",
      message: cause instanceof Error ? cause.message : "Rule set could not be resolved",
    });
    return { ok: false, issues, snapshot: null };
  }

  const analysis = analyzeRuleSet(rules);
  for (const issue of analysis.issues) {
    if (issue.severity === "error") issues.push({ code: issue.code, message: issue.message });
  }

  try {
    planWorkflow(input.manifest);
  } catch (cause) {
    issues.push({
      code: "workflow_invalid",
      message: cause instanceof Error ? cause.message : "Workflow could not be planned",
    });
  }

  if (issues.length > 0) return { ok: false, issues, snapshot: null };

  const privacyRule = rules.find((rule) => rule.then.type === "setPrivacyMode");
  const privacyMode =
    privacyRule && privacyRule.then.type === "setPrivacyMode"
      ? privacyRule.then.mode
      : input.manifest.reveal.mode;

  return {
    ok: true,
    issues: [],
    snapshot: {
      packTemplateId: input.templateId as InstanceSnapshot["packTemplateId"],
      packVersion: input.manifest.version,
      schemaVersion: input.manifest.schemaVersion,
      capabilities: input.manifest.requiredCapabilities,
      privacyMode,
      revealEnabled: input.manifest.reveal.enabled && privacyMode !== "never_reveal",
      consentVersion: input.config.privacy.consentVersion,
      classification: "internal",
      packConfig: resolvedConfig.values,
    },
  };
}

export function snapshotOf(snapshotJson: string): InstanceSnapshot {
  const snapshot = parseJson<InstanceSnapshot | null>(snapshotJson, null);
  if (!snapshot) throw new DomainError("dependency_unavailable", "Instance snapshot is missing");
  return snapshot;
}

const TRANSITION_EVENTS: Readonly<Record<string, string>> = {
  enrolling: "instance.launched",
  locked: "instance.enrollment_closed",
  active: "instance.activated",
  reveal_pending: "instance.reveal_requested",
  completed: "instance.completed",
  cancelled: "instance.cancelled",
};

/**
 * Applies a lifecycle transition under the domain state machine and an
 * optimistic revision guard, emitting the matching domain event atomically.
 */
export async function transitionInstance(input: {
  db: Database;
  instanceId: ExperienceInstanceId;
  toState: ExperienceInstanceState;
  expectedRevision: number;
  actorUserId: UserId | null;
}): Promise<number> {
  const instances = new InstanceRepository(input.db);
  const instance = await instances.requireById(input.instanceId);
  const snapshot = snapshotOf(instance.snapshot_json);

  const published = await input.db.first<{ count: number }>(
    `SELECT COUNT(*) AS count FROM match_runs WHERE instance_id = ? AND organization_id = ? AND state = 'published'`,
    [input.instanceId, input.db.organizationId],
  );

  assertInstanceTransition(instance.state as ExperienceInstanceState, input.toState, {
    revealEnabled: snapshot.revealEnabled,
    matchesPublished: (published?.count ?? 0) > 0,
  });

  return instances.transition({
    instanceId: input.instanceId,
    fromState: instance.state,
    toState: input.toState,
    expectedRevision: input.expectedRevision,
    actorUserId: input.actorUserId,
    eventType: TRANSITION_EVENTS[input.toState] ?? "instance.launched",
  });
}
