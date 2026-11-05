import { z } from "zod";
import type { CapabilityKey } from "./capabilities.js";
import { packManifestSchema, PACK_SCHEMA_VERSION, type PackManifest } from "./manifest.js";

/**
 * A blueprint is the only thing a generator may produce. The platform builds
 * the workflow, rules and capability list from it, so a generated pack can
 * never express a mechanic the core does not already implement.
 */
export const PACK_MECHANICS = ["pair_match", "group_match", "buddy_match", "recognition_only"] as const;
export type PackMechanic = (typeof PACK_MECHANICS)[number];

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{2,59}$/);
const key = z.string().regex(/^[a-z][a-z0-9_-]{1,40}$/);

export const packBlueprintSchema = z.object({
  slug,
  name: z.string().min(1).max(80),
  summary: z.string().min(1).max(300),
  mechanic: z.enum(PACK_MECHANICS),
  matchingStrategyKey: z.enum([
    "cross-functional",
    "diversity-optimized",
    "remote-first",
    "new-hire-friendly",
    "leadership-mix",
  ]),
  groupSize: z.number().int().min(2).max(4).default(2),
  privacyMode: z.enum(["anonymous", "pseudonymous", "reveal_at_end", "never_reveal"]).default("pseudonymous"),
  revealEnabled: z.boolean().default(false),
  crossDepartment: z.boolean().default(false),
  objectives: z
    .array(
      z.object({
        key,
        title: z.string().min(1).max(120),
        description: z.string().min(1).max(400),
        metric: z
          .enum([
            "participation_rate",
            "engagement_rate",
            "connection_score",
            "department_bridge_score",
            "organizational_reach",
            "remote_inclusion_score",
            "experience_completion_rate",
          ])
          .optional(),
      }),
    )
    .min(1)
    .max(4),
  missions: z
    .array(
      z.object({
        key,
        title: z.string().min(1).max(120),
        description: z.string().min(1).max(600),
        requiredForCompletion: z.boolean().default(false),
        asynchronousAlternative: z.string().min(1).max(400),
        dueOffsetMinutes: z.number().int().min(60).max(525600).default(10080),
      }),
    )
    .min(1)
    .max(6),
  activities: z
    .array(
      z.object({
        key,
        type: z.enum(["conversation", "check_in", "milestone", "survey", "recognition", "gift_exchange", "clue"]),
        title: z.string().min(1).max(120),
        optional: z.boolean().default(true),
        maxPerParticipant: z.number().int().min(1).max(20).default(3),
      }),
    )
    .min(1)
    .max(8),
  communications: z
    .array(
      z.object({
        key,
        trigger: z.enum([
          "enrollment_open",
          "enrollment_reminder",
          "match_published",
          "mission_reminder",
          "completed",
        ]),
        subject: z.string().min(1).max(150),
        body: z.string().min(1).max(2000),
      }),
    )
    .min(1)
    .max(6),
  insightMetrics: z
    .array(
      z.enum([
        "participation_rate",
        "engagement_rate",
        "connection_score",
        "department_bridge_score",
        "organizational_reach",
        "remote_inclusion_score",
        "experience_completion_rate",
      ]),
    )
    .min(1)
    .max(7),
  dataRequirements: z
    .array(
      z.enum([
        "department",
        "team",
        "geography",
        "time_zone",
        "remote_preference",
        "tenure_band",
        "languages",
        "interests",
      ]),
    )
    .max(8)
    .default([]),
  risks: z.array(z.string().max(300)).max(5).default([]),
});

export type PackBlueprint = z.infer<typeof packBlueprintSchema>;

const ACTIVITY_CAPABILITY: Readonly<Record<string, CapabilityKey>> = {
  conversation: "activity.conversation-prompt",
  check_in: "activity.check-in",
  milestone: "activity.milestone",
  survey: "activity.survey",
  recognition: "activity.recognition",
  gift_exchange: "activity.gift-exchange",
  clue: "clue.exchange",
};

const MECHANIC_CAPABILITY: Readonly<Record<PackMechanic, CapabilityKey | null>> = {
  pair_match: "matching.pair",
  group_match: "matching.group",
  buddy_match: "matching.buddy",
  recognition_only: null,
};

interface WorkflowNodeInput {
  key: string;
  action: string;
  next: string[];
  humanGate?: boolean;
  templateKey?: string;
  timeoutMinutes?: number;
}

function buildWorkflow(blueprint: PackBlueprint, templateKeys: Set<string>): {
  entry: string;
  nodes: WorkflowNodeInput[];
} {
  const template = (trigger: string): string | undefined =>
    templateKeys.has(trigger) ? trigger : undefined;

  const nodes: WorkflowNodeInput[] = [{ key: "open", action: "open_enrollment", next: [] }];
  let tail = "open";

  const append = (node: WorkflowNodeInput) => {
    const previous = nodes.find((candidate) => candidate.key === tail);
    if (previous) previous.next = [node.key];
    nodes.push(node);
    tail = node.key;
  };

  const invite = template("enrollment_open");
  if (invite) append({ key: "invite", action: "send_notification", templateKey: invite, next: [] });

  const remind = template("enrollment_reminder");
  if (remind) append({ key: "remind", action: "send_notification", templateKey: remind, next: [] });

  if (blueprint.mechanic !== "recognition_only") {
    append({ key: "close", action: "close_enrollment", next: [] });
    append({ key: "match", action: "run_matching", timeoutMinutes: 120, next: [] });
    // Publication always carries a human gate; matching never self-publishes.
    append({ key: "approve", action: "publish_matches", humanGate: true, next: [] });
    const announce = template("match_published");
    if (announce) append({ key: "announce", action: "send_notification", templateKey: announce, next: [] });
  }

  append({ key: "missions", action: "assign_missions", next: [] });

  const nudge = template("mission_reminder");
  if (nudge) append({ key: "nudge", action: "send_notification", templateKey: nudge, next: [] });

  if (blueprint.activities.some((activity) => activity.type === "survey")) {
    append({ key: "feedback", action: "collect_feedback", next: [] });
  }

  if (blueprint.revealEnabled && blueprint.privacyMode !== "never_reveal") {
    append({ key: "reveal", action: "reveal", humanGate: true, next: [] });
  }

  const wrap = template("completed");
  if (wrap) append({ key: "wrap", action: "send_notification", templateKey: wrap, next: [] });

  append({ key: "done", action: "finish", next: [] });

  return { entry: "open", nodes };
}

function buildRules(blueprint: PackBlueprint) {
  const rules: Array<Record<string, unknown>> = [
    {
      id: "privacy.mode",
      category: "privacy",
      priority: 10,
      then: { type: "setPrivacyMode", mode: blueprint.privacyMode },
    },
    {
      id: "schedule.close-enrollment",
      category: "schedule",
      priority: 30,
      then: {
        type: "scheduleRelativeAction",
        action: "close_enrollment",
        anchor: "enrollment_close",
        offsetMinutes: 0,
      },
    },
  ];

  if (blueprint.mechanic !== "recognition_only") {
    rules.push({
      id: "matching.no-repeat",
      category: "matching",
      priority: 20,
      then: { type: "setMatchingConstraint", constraint: "no_repeat_match" },
    });
    if (blueprint.crossDepartment) {
      rules.push({
        id: "matching.different-department",
        category: "matching",
        priority: 21,
        then: { type: "setMatchingConstraint", constraint: "different_department" },
      });
    }
  }

  if (blueprint.revealEnabled && blueprint.privacyMode !== "never_reveal") {
    rules.push({
      id: "schedule.reveal",
      category: "schedule",
      priority: 40,
      then: { type: "scheduleRelativeAction", action: "reveal", anchor: "instance_end", offsetMinutes: 0 },
    });
  }

  return rules;
}

export interface AssembleOptions {
  readonly locale: string;
  readonly version?: string;
  readonly origin?: "generated" | "imported";
  readonly generatedByModel?: string;
  readonly minimumCohortSize: number;
}

export interface AssembleResult {
  readonly ok: boolean;
  readonly manifest: PackManifest | null;
  readonly issues: ReadonlyArray<{ code: string; message: string }>;
}

/**
 * Builds a candidate manifest from a blueprint. Structure is produced here,
 * never by the generator, and the result still has to pass `validateManifest`
 * before an administrator can publish it.
 */
export function assembleManifest(blueprint: PackBlueprint, options: AssembleOptions): AssembleResult {
  const issues: Array<{ code: string; message: string }> = [];
  const locale = options.locale;
  const localize = (text: string) => ({ [locale]: text });

  const templateKeys = new Set(blueprint.communications.map((template) => template.trigger));
  if (blueprint.communications.length !== templateKeys.size) {
    issues.push({
      code: "duplicate_trigger",
      message: "Each communication trigger may appear only once.",
    });
  }

  const capabilities = new Set<CapabilityKey>(["enrollment.self-serve", "insights.aggregate"]);
  const mechanicCapability = MECHANIC_CAPABILITY[blueprint.mechanic];
  if (mechanicCapability) capabilities.add(mechanicCapability);
  if (blueprint.communications.length > 0) capabilities.add("communications.templated");
  if (blueprint.revealEnabled && blueprint.privacyMode !== "never_reveal") capabilities.add("reveal.gated");

  for (const activity of blueprint.activities) {
    const capability = ACTIVITY_CAPABILITY[activity.type];
    if (!capability) {
      issues.push({
        code: "unsupported_activity",
        message: `Activity type "${activity.type}" has no implemented capability. A reviewed core release is required.`,
      });
      continue;
    }
    capabilities.add(capability);
  }

  if (blueprint.mechanic === "recognition_only" && !blueprint.activities.some((a) => a.type === "recognition")) {
    issues.push({
      code: "mechanic_activity_mismatch",
      message: "A recognition-only pack must include at least one recognition activity.",
    });
  }

  if (issues.length > 0) return { ok: false, manifest: null, issues };

  const candidate = {
    id: blueprint.slug,
    schemaVersion: PACK_SCHEMA_VERSION,
    version: options.version ?? "0.1.0",
    name: localize(blueprint.name),
    summary: localize(blueprint.summary),
    provenance: {
      origin: options.origin ?? "generated",
      ...(options.generatedByModel ? { generatedByModel: options.generatedByModel } : {}),
    },
    requiredCapabilities: [...capabilities].sort(),
    configurationSchema: [],
    defaults: {},
    objectives: blueprint.objectives.map((objective) => ({
      key: objective.key,
      title: localize(objective.title),
      description: localize(objective.description),
      ...(objective.metric ? { metric: objective.metric } : {}),
    })),
    eligibility: [
      {
        id: "eligibility.enrolled-only",
        category: "eligibility",
        priority: 10,
        when: { field: "participant.state", op: "neq", value: "enrolled" },
        then: { type: "deny", code: "not_enrolled" },
      },
    ],
    rules: buildRules(blueprint),
    workflow: buildWorkflow(blueprint, templateKeys),
    matching: {
      strategyKey: blueprint.matchingStrategyKey,
      groupSize: blueprint.mechanic === "group_match" ? blueprint.groupSize : 2,
      allowTriadForOddCount: blueprint.mechanic === "group_match",
      weights: {},
      hardConstraints: blueprint.crossDepartment
        ? ["no_self_match", "no_repeat_match", "different_department"]
        : ["no_self_match", "no_repeat_match"],
    },
    missions: blueprint.missions.map((mission) => ({
      key: mission.key,
      title: localize(mission.title),
      description: localize(mission.description),
      requiredForCompletion: mission.requiredForCompletion,
      asynchronousAlternative: localize(mission.asynchronousAlternative),
      dueOffsetMinutes: mission.dueOffsetMinutes,
    })),
    activities: blueprint.activities.map((activity) => ({
      key: activity.key,
      type: activity.type,
      title: localize(activity.title),
      optional: activity.optional,
      maxPerParticipant: activity.maxPerParticipant,
    })),
    communications: blueprint.communications.map((template) => ({
      key: template.trigger,
      channel: "email",
      trigger: template.trigger,
      subject: localize(template.subject),
      body: localize(template.body),
      // Generated packs always ship a plain-text equivalent for accessibility.
      plainTextBody: localize(template.body.replace(/\n{2,}/g, "\n")),
    })),
    aiAssistants: [],
    reveal: {
      enabled: blueprint.revealEnabled && blueprint.privacyMode !== "never_reveal",
      mode: blueprint.privacyMode,
      requiresDesignerApproval: true,
      offsetMinutesFromEnd: 0,
    },
    insights: {
      metrics: blueprint.insightMetrics,
      minimumCohortSize: options.minimumCohortSize,
    },
    dataRequirements: blueprint.dataRequirements,
  };

  const parsed = packManifestSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      manifest: null,
      issues: parsed.error.issues.slice(0, 10).map((issue) => ({
        code: "assembled_manifest_invalid",
        message: `${issue.path.join(".")}: ${issue.message}`,
      })),
    };
  }

  return { ok: true, manifest: parsed.data, issues: [] };
}
