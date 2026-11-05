import { z } from "zod";
import {
  EXPERIENCE_INSTANCE_STATES,
  INSTALLATION_ROLES,
  PARTICIPATION_MODES,
  REMOTE_PREFERENCES,
  TENURE_BANDS,
} from "@culture-shock/domain";
import { MATCHING_STRATEGY_KEYS, METRIC_KEYS } from "@culture-shock/pack-sdk";
import {
  idSchema,
  isoDateTimeSchema,
  localeSchema,
  packSlugSchema,
  revisionSchema,
  semverSchema,
  timeZoneSchema,
} from "./envelope.js";

/* ---------------------------------------------------------------- identity */

export const meResponseSchema = z.object({
  userId: idSchema,
  displayName: z.string().max(120).nullable(),
  roles: z.array(z.enum(INSTALLATION_ROLES)),
  locale: localeSchema,
  timeZone: timeZoneSchema,
  /** Surfaces whether a step-up re-authentication is needed for admin actions. */
  authenticatedAt: isoDateTimeSchema,
});

export const magicLinkRequestSchema = z.object({
  email: z.string().email().max(254),
});

export const magicLinkConsumeSchema = z.object({
  token: z.string().min(32).max(200),
});

/* ------------------------------------------------------------------- packs */

export const packSummarySchema = z.object({
  id: idSchema,
  slug: packSlugSchema,
  origin: z.enum(["builtin", "imported", "generated"]),
  enabled: z.boolean(),
  status: z.enum(["active", "retired"]),
  latestVersion: semverSchema.nullable(),
  pinnedVersion: semverSchema.nullable(),
  name: z.string().max(80),
  summary: z.string().max(300),
});

export const packImportRequestSchema = z.object({
  manifest: z.record(z.unknown()),
  /** Import always lands as a draft; publication is a separate admin action. */
  dryRun: z.boolean().default(false),
});

export const packValidationResponseSchema = z.object({
  ok: z.boolean(),
  checksum: z.string().max(80).nullable(),
  issues: z.array(
    z.object({
      severity: z.enum(["error", "warning"]),
      code: z.string().max(60),
      message: z.string().max(400),
      path: z.string().max(200),
    }),
  ),
});

export const packDraftGenerateSchema = z.object({
  objective: z.string().min(10).max(600),
  audience: z.string().max(300).optional(),
  basePackId: packSlugSchema.optional(),
  locale: localeSchema.optional(),
});

/* ------------------------------------------------------------- experiences */

export const createExperienceSchema = z.object({
  name: z.string().min(1).max(120),
  packSlug: packSlugSchema,
  packVersion: semverSchema,
  description: z.string().max(600).optional(),
});

export const patchExperienceSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(600).optional(),
  rulesOverride: z.array(z.record(z.unknown())).max(50).optional(),
  packConfig: z.record(z.unknown()).optional(),
});

export const experienceResponseSchema = z.object({
  id: idSchema,
  name: z.string().max(120),
  packSlug: packSlugSchema,
  packVersion: semverSchema,
  state: z.enum(["draft", "validated", "ready", "archived"]),
  revision: revisionSchema,
  updatedAt: isoDateTimeSchema,
});

/* --------------------------------------------------------------- instances */

export const createInstanceSchema = z
  .object({
    name: z.string().min(1).max(120),
    startsAt: isoDateTimeSchema,
    endsAt: isoDateTimeSchema,
    timeZone: timeZoneSchema,
    enrollmentClosesAt: isoDateTimeSchema,
    participationMode: z.enum(PARTICIPATION_MODES).default("optional"),
    rulesOverride: z.array(z.record(z.unknown())).max(50).default([]),
    packConfig: z.record(z.unknown()).default({}),
  })
  .superRefine((value, ctx) => {
    if (new Date(value.endsAt) <= new Date(value.startsAt)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endsAt"], message: "endsAt must be after startsAt" });
    }
    if (new Date(value.enrollmentClosesAt) > new Date(value.startsAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["enrollmentClosesAt"],
        message: "Enrollment must close no later than the start",
      });
    }
  });

export const patchInstanceSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  startsAt: isoDateTimeSchema.optional(),
  endsAt: isoDateTimeSchema.optional(),
  enrollmentClosesAt: isoDateTimeSchema.optional(),
  state: z.enum(EXPERIENCE_INSTANCE_STATES).optional(),
});

export const instanceResponseSchema = z.object({
  id: idSchema,
  experienceId: idSchema,
  name: z.string().max(120),
  state: z.enum(EXPERIENCE_INSTANCE_STATES),
  timeZone: timeZoneSchema,
  startsAt: isoDateTimeSchema.nullable(),
  endsAt: isoDateTimeSchema.nullable(),
  enrollmentClosesAt: isoDateTimeSchema.nullable(),
  revision: revisionSchema,
});

/* ------------------------------------------------------------ participation */

export const participantPreferencesSchema = z.object({
  timeZone: timeZoneSchema,
  remotePreference: z.enum(REMOTE_PREFERENCES),
  department: z.string().max(80).nullable().default(null),
  team: z.string().max(80).nullable().default(null),
  geography: z.string().max(80).nullable().default(null),
  tenureBand: z.enum(TENURE_BANDS).default("unspecified"),
  interests: z.array(z.string().max(40)).max(20).default([]),
  languages: z.array(localeSchema).max(10).default([]),
  schedulingConstraints: z.array(z.string().max(80)).max(10).default([]),
  /** Explicit per-purpose consent; absence is a denial. */
  consent: z
    .object({
      profile_derivation: z.boolean().default(false),
      ai_processing: z.boolean().default(false),
      messaging: z.boolean().default(false),
      insights_survey: z.boolean().default(false),
    })
    .default({}),
});

export const myParticipationResponseSchema = z.object({
  participantId: idSchema,
  status: z.enum(["invited", "enrolled", "withdrawn", "excluded"]),
  joinedAt: isoDateTimeSchema.nullable(),
  preferences: participantPreferencesSchema.nullable(),
  consentVersion: z.string().max(40).nullable(),
});

export const myMatchResponseSchema = z.object({
  state: z.enum(["not_published", "published", "hidden_by_policy"]),
  groupKey: z.string().max(40).nullable(),
  /** Peer display depends on the instance privacy mode; raw profiles are never returned. */
  peers: z
    .array(
      z.object({
        label: z.string().max(120),
        pseudonym: z.string().max(40).nullable(),
        revealed: z.boolean(),
      }),
    )
    .default([]),
  missions: z
    .array(z.object({ key: z.string().max(40), title: z.string().max(120), dueAt: isoDateTimeSchema.nullable() }))
    .default([]),
});

/* ---------------------------------------------------------------- matching */

export const createMatchRunSchema = z.object({
  strategyKey: z.enum(MATCHING_STRATEGY_KEYS),
  strategyVersion: semverSchema.optional(),
  weights: z.record(z.string().max(60), z.number().min(0).max(1)).default({}),
  preview: z.literal(true).default(true),
});

export const matchRunResponseSchema = z.object({
  runId: idSchema,
  state: z.enum(["queued", "running", "preview", "published", "failed", "cancelled"]),
  strategyKey: z.string().max(60),
  strategyVersion: semverSchema,
  diagnostics: z
    .object({
      consideredParticipants: z.number().int().min(0),
      consideredEdges: z.number().int().min(0),
      matchedParticipants: z.number().int().min(0),
      unmatchedParticipants: z.number().int().min(0),
      approximationUsed: z.boolean(),
      approximationReason: z.string().max(80).nullable(),
      constraintViolations: z.array(z.string().max(60)),
      durationMs: z.number().int().min(0),
    })
    .nullable(),
  fairness: z.record(z.unknown()).nullable(),
});

export const publishMatchRunSchema = z.object({
  acknowledgedUnmatched: z.boolean().default(false),
  note: z.string().max(300).optional(),
});

/* -------------------------------------------------------------- activities */

export const createActivitySchema = z.object({
  type: z.enum(["gift_exchange", "recognition", "conversation", "check_in", "milestone", "survey", "clue"]),
  missionKey: z.string().max(40).optional(),
  payload: z.record(z.unknown()).default({}),
});

export const createRecognitionSchema = z.object({
  recipientParticipantId: idSchema,
  message: z.string().min(1).max(1000),
  visibility: z.enum(["private", "recipient_only", "team", "organization"]).default("recipient_only"),
});

/* ---------------------------------------------------------------- insights */

export const insightsResponseSchema = z.object({
  metricVersion: z.string().max(20),
  periodStart: isoDateTimeSchema,
  periodEnd: isoDateTimeSchema,
  minimumCohortSize: z.number().int().min(5),
  metrics: z.array(
    z.object({
      key: z.enum(METRIC_KEYS),
      value: z.number().nullable(),
      numerator: z.number().int().nullable(),
      denominator: z.number().int().nullable(),
      suppressed: z.boolean(),
      qualityFlags: z.array(z.string().max(60)).default([]),
    }),
  ),
  recommendations: z
    .array(
      z.object({
        code: z.string().max(60),
        summary: z.string().max(300),
        evidence: z.array(z.string().max(120)).max(5),
        sampleSize: z.number().int().min(0),
      }),
    )
    .default([]),
});

/* ----------------------------------------------------------------- copilot */

export const copilotRequestSchema = z.object({
  headcount: z.number().int().min(1).max(1_000_000),
  remoteSharePercent: z.number().int().min(0).max(100),
  countries: z.array(z.string().max(60)).max(30).default([]),
  departments: z.array(z.object({ label: z.string().max(60), count: z.number().int().min(0) })).max(60).default([]),
  timeZones: z.array(timeZoneSchema).max(40).default([]),
  objectives: z.array(z.string().max(200)).min(1).max(5),
  budgetPerParticipantUsd: z.number().min(0).max(1000).nullable().default(null),
});

export const communicationDraftRequestSchema = z.object({
  templateKey: z.string().max(40),
  locale: localeSchema,
  tone: z.enum(["warm", "neutral", "playful", "formal"]).default("neutral"),
  notes: z.string().max(400).optional(),
});

/* ------------------------------------------------------------------- admin */

export const privacyRequestSchema = z.object({
  userId: idSchema,
  /** Recorded verbatim in the audit trail as the stated lawful purpose. */
  reason: z.string().min(5).max(300),
});

export type CreateInstanceRequest = z.infer<typeof createInstanceSchema>;
export type ParticipantPreferencesRequest = z.infer<typeof participantPreferencesSchema>;
export type CreateMatchRunRequest = z.infer<typeof createMatchRunSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type InsightsResponse = z.infer<typeof insightsResponseSchema>;
