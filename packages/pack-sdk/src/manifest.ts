import { z } from "zod";
import { ruleSchema } from "@culture-shock/rules";
import {
  CAPABILITY_KEYS,
  MATCHING_STRATEGY_KEYS,
  METRIC_KEYS,
  WORKFLOW_ACTIONS,
} from "./capabilities.js";

export const PACK_SCHEMA_VERSION = "1.0.0";

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{2,59}$/);
const key = z.string().regex(/^[a-z][a-z0-9_-]{1,40}$/);
const semver = z.string().regex(/^\d+\.\d+\.\d+$/);
const localeCode = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/);

/** Localized plain text. Rendering escapes values; no HTML is accepted here. */
const localizedText = (max: number) =>
  z.record(localeCode, z.string().min(1).max(max)).refine((value) => Object.keys(value).length > 0, {
    message: "At least one locale is required",
  });

export const objectiveSchema = z.object({
  key,
  title: localizedText(120),
  description: localizedText(400),
  /** Metric used to evidence this objective; must be a registered metric. */
  metric: z.enum(METRIC_KEYS).optional(),
});

/**
 * Restricted configuration meta-schema. Packs declare typed fields; they cannot
 * ship JSON Schema, regular expressions, or any executable validation.
 */
export const configFieldSchema = z.discriminatedUnion("type", [
  z.object({
    key,
    type: z.literal("string"),
    label: localizedText(80),
    required: z.boolean().default(false),
    maxLength: z.number().int().min(1).max(500).default(200),
    default: z.string().max(500).optional(),
  }),
  z.object({
    key,
    type: z.literal("number"),
    label: localizedText(80),
    required: z.boolean().default(false),
    min: z.number().finite().default(0),
    max: z.number().finite().default(1000000),
    default: z.number().finite().optional(),
  }),
  z.object({
    key,
    type: z.literal("boolean"),
    label: localizedText(80),
    required: z.boolean().default(false),
    default: z.boolean().optional(),
  }),
  z.object({
    key,
    type: z.literal("enum"),
    label: localizedText(80),
    required: z.boolean().default(false),
    options: z.array(z.object({ value: key, label: localizedText(80) })).min(1).max(30),
    default: key.optional(),
  }),
  z.object({
    key,
    type: z.literal("stringList"),
    label: localizedText(80),
    required: z.boolean().default(false),
    maxItems: z.number().int().min(1).max(100).default(20),
    default: z.array(z.string().max(120)).max(100).optional(),
  }),
]);

export const workflowNodeSchema = z.object({
  key,
  action: z.enum(WORKFLOW_ACTIONS),
  /** Blocks the DAG until a designer explicitly approves. */
  humanGate: z.boolean().default(false),
  maxRetries: z.number().int().min(0).max(5).default(3),
  timeoutMinutes: z.number().int().min(1).max(10080).default(60),
  /** Optional template referenced when action is send_notification. */
  templateKey: key.optional(),
  next: z.array(key).max(5).default([]),
});

export const matchingSchema = z.object({
  strategyKey: z.enum(MATCHING_STRATEGY_KEYS),
  groupSize: z.number().int().min(2).max(8).default(2),
  allowTriadForOddCount: z.boolean().default(false),
  /** Bounded weights; the core clamps any value outside 0..1. */
  weights: z.record(key, z.number().min(0).max(1)).default({}),
  hardConstraints: z
    .array(
      z.enum([
        "no_self_match",
        "no_repeat_match",
        "different_department",
        "same_department",
        "different_team",
        "require_timezone_overlap",
        "respect_capacity",
      ]),
    )
    .max(10)
    .default(["no_self_match"]),
});

export const missionSchema = z.object({
  key,
  title: localizedText(120),
  description: localizedText(600),
  requiredForCompletion: z.boolean().default(false),
  /** Asynchronous alternative keeps remote and cross-timezone participants included. */
  asynchronousAlternative: localizedText(400).optional(),
  dueOffsetMinutes: z.number().int().min(0).max(525600).default(10080),
});

export const activitySchema = z.object({
  key,
  type: z.enum([
    "gift_exchange",
    "recognition",
    "conversation",
    "check_in",
    "milestone",
    "survey",
    "clue",
  ]),
  title: localizedText(120),
  optional: z.boolean().default(true),
  maxPerParticipant: z.number().int().min(1).max(50).default(5),
});

export const communicationSchema = z.object({
  key,
  channel: z.enum(["email", "in_app"]),
  trigger: z.enum([
    "enrollment_open",
    "enrollment_reminder",
    "enrollment_closed",
    "match_published",
    "mission_assigned",
    "mission_reminder",
    "feedback_request",
    "reveal",
    "completed",
  ]),
  subject: localizedText(150),
  body: localizedText(4000),
  /** Required plain-text equivalent for accessibility and plain-text clients. */
  plainTextBody: localizedText(4000),
});

export const aiAssistantSchema = z.object({
  key,
  purpose: z.enum([
    "communication_draft",
    "gift_suggestion",
    "insight_summary",
    "matching_weight_proposal",
  ]),
  /** Inert text template. Never a system instruction and never policy authority. */
  promptTemplate: z.string().min(1).max(2000),
  maxDataClassification: z.enum(["public", "internal"]).default("internal"),
  requiresHumanApproval: z.literal(true).default(true),
});

export const revealSchema = z.object({
  enabled: z.boolean().default(false),
  mode: z.enum(["anonymous", "pseudonymous", "reveal_at_end", "never_reveal"]).default("pseudonymous"),
  requiresDesignerApproval: z.boolean().default(true),
  offsetMinutesFromEnd: z.number().int().min(-20160).max(20160).default(0),
});

export const insightsSchema = z.object({
  metrics: z.array(z.enum(METRIC_KEYS)).max(METRIC_KEYS.length).default([]),
  minimumCohortSize: z.number().int().min(5).max(100).default(10),
});

export const provenanceSchema = z.object({
  origin: z.enum(["builtin", "imported", "generated"]),
  author: z.string().max(120).optional(),
  sourceUrl: z.string().url().optional(),
  generatedByModel: z.string().max(120).optional(),
});

export const packManifestSchema = z
  .object({
    id: slug,
    schemaVersion: z.literal(PACK_SCHEMA_VERSION),
    version: semver,
    name: localizedText(80),
    summary: localizedText(300),
    provenance: provenanceSchema,
    requiredCapabilities: z
      .array(z.enum(CAPABILITY_KEYS as [string, ...string[]]))
      .min(1)
      .max(20),
    configurationSchema: z.array(configFieldSchema).max(40).default([]),
    defaults: z.record(key, z.union([z.string().max(500), z.number(), z.boolean(), z.array(z.string().max(120)).max(100)])).default({}),
    objectives: z.array(objectiveSchema).min(1).max(10),
    eligibility: z.array(ruleSchema).max(50).default([]),
    rules: z.array(ruleSchema).max(150).default([]),
    workflow: z.object({
      entry: key,
      nodes: z.array(workflowNodeSchema).min(1).max(30),
    }),
    matching: matchingSchema,
    missions: z.array(missionSchema).max(30).default([]),
    activities: z.array(activitySchema).max(30).default([]),
    communications: z.array(communicationSchema).max(30).default([]),
    aiAssistants: z.array(aiAssistantSchema).max(10).default([]),
    reveal: revealSchema.default({}),
    insights: insightsSchema.default({}),
    /** Declares the strictest data the pack needs; validated against policy. */
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
      .max(10)
      .default([]),
  })
  // Unknown keys are rejected outright: an unrecognised field may be an attempt
  // to reach a capability the interpreter does not implement.
  .strict();

export type PackManifest = z.infer<typeof packManifestSchema>;
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type CommunicationTemplate = z.infer<typeof communicationSchema>;
export type PackObjective = z.infer<typeof objectiveSchema>;
export type ConfigField = z.infer<typeof configFieldSchema>;
