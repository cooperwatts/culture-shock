import { z } from "zod";
import { MATCHING_STRATEGY_KEYS, METRIC_KEYS } from "@culture-shock/pack-sdk";
import { sizeBand, toAggregateBands } from "./redaction.js";

export const COPILOT_PROMPT_VERSION = "copilot.recommendation/1.0.0";

/**
 * Copilot input is deliberately coarse: bands and counts, never participant
 * records, names, or free text.
 */
export const copilotInputSchema = z.object({
  headcount: z.number().int().min(1).max(1_000_000),
  remoteSharePercent: z.number().int().min(0).max(100),
  countries: z.array(z.string().max(60)).max(30).default([]),
  departments: z
    .array(
      z.object({ label: z.string().max(60), count: z.number().int().min(0) }),
    )
    .max(60)
    .default([]),
  timeZones: z.array(z.string().max(60)).max(40).default([]),
  objectives: z.array(z.string().max(200)).min(1).max(5),
  budgetPerParticipantUsd: z.number().min(0).max(1000).nullable().default(null),
  availablePackIds: z.array(z.string().max(60)).min(1).max(50),
  locale: z.string().max(10).default("en-CA"),
});

export type CopilotInput = z.infer<typeof copilotInputSchema>;

export const copilotRecommendationSchema = z.object({
  packId: z.string().max(60),
  fitReasons: z.array(z.string().max(300)).min(1).max(5),
  matchingStrategy: z.object({
    key: z.enum(MATCHING_STRATEGY_KEYS),
    rationale: z.string().max(400),
    suggestedWeights: z
      .record(z.string().max(60), z.number().min(0).max(1))
      .default({}),
  }),
  communicationPlan: z
    .array(
      z.object({
        trigger: z.string().max(60),
        timing: z.string().max(120),
        summary: z.string().max(300),
      }),
    )
    .max(8),
  participationPlan: z.object({
    mode: z.enum(["mandatory", "optional", "invite_only"]),
    expectedParticipationPercent: z.number().int().min(0).max(100),
    inclusionNotes: z.array(z.string().max(200)).max(5).default([]),
  }),
  revealPlan: z
    .object({
      mode: z.enum([
        "anonymous",
        "pseudonymous",
        "reveal_at_end",
        "never_reveal",
      ]),
      rationale: z.string().max(300),
    })
    .nullable()
    .default(null),
  metricPlan: z.array(z.enum(METRIC_KEYS)).min(1).max(METRIC_KEYS.length),
  risks: z.array(z.string().max(300)).max(6).default([]),
  assumptions: z.array(z.string().max(300)).max(6).default([]),
});

export type CopilotRecommendation = z.infer<typeof copilotRecommendationSchema>;

export const copilotResponseSchema = z.object({
  primary: copilotRecommendationSchema,
  /** Meaningful alternatives so a designer is never shown a single option. */
  alternatives: z.array(copilotRecommendationSchema).max(3).default([]),
});

export type CopilotResponse = z.infer<typeof copilotResponseSchema>;

/**
 * Builds the user message. Everything interpolated here is already a band, a
 * count, or an organization-authored objective string.
 */
export function buildCopilotMessage(
  input: CopilotInput,
  minimumCohortSize: number,
): string {
  const departments = toAggregateBands(
    input.departments.map((entry) => ({
      label: entry.label,
      count: entry.count,
    })),
    minimumCohortSize,
  );

  const facts = {
    organizationSizeBand: sizeBand(input.headcount),
    remoteSharePercent: input.remoteSharePercent,
    countryCount: input.countries.length,
    timeZoneCount: input.timeZones.length,
    departmentBands: departments,
    objectives: input.objectives,
    budgetPerParticipantUsd: input.budgetPerParticipantUsd,
    availablePackIds: input.availablePackIds,
    locale: input.locale,
  };

  return [
    "You are assisting an Organizer in selecting a culture experience.",
    "Use only the aggregate facts provided. Do not infer protected characteristics.",
    "Recommend only packs listed in availablePackIds.",
    "Facts:",
    JSON.stringify(facts),
  ].join("\n");
}

interface FallbackRule {
  readonly packId: string;
  readonly strategy: (typeof MATCHING_STRATEGY_KEYS)[number];
  readonly keywords: readonly string[];
  readonly metrics: ReadonlyArray<(typeof METRIC_KEYS)[number]>;
}

const FALLBACK_RULES: readonly FallbackRule[] = [
  {
    packId: "cross-team-connector",
    strategy: "cross-functional",
    keywords: ["cross", "silo", "department", "functional", "collaborat"],
    metrics: [
      "department_bridge_score",
      "organizational_reach",
      "participation_rate",
    ],
  },
  {
    packId: "new-hire-buddy",
    strategy: "new-hire-friendly",
    keywords: ["onboard", "new hire", "ramp", "integrat"],
    metrics: ["experience_completion_rate", "participation_rate"],
  },
  {
    packId: "coffee-roulette",
    strategy: "remote-first",
    keywords: ["network", "remote", "connect", "informal", "random"],
    metrics: [
      "connection_score",
      "remote_inclusion_score",
      "participation_rate",
    ],
  },
  {
    packId: "appreciation-week",
    strategy: "diversity-optimized",
    keywords: ["recogni", "apprecia", "gratitude", "morale"],
    metrics: ["engagement_rate", "participation_rate"],
  },
  {
    packId: "secret-santa",
    strategy: "cross-functional",
    keywords: ["holiday", "gift", "festive", "season"],
    metrics: ["participation_rate", "engagement_rate"],
  },
];

/**
 * Deterministic recommendation used whenever AI is disabled, blocked, or fails.
 * The product remains fully usable with every provider turned off.
 */
export function fallbackRecommendation(input: CopilotInput): CopilotResponse {
  const text = input.objectives.join(" ").toLowerCase();
  const scored = FALLBACK_RULES.filter((rule) =>
    input.availablePackIds.includes(rule.packId),
  )
    .map((rule) => ({
      rule,
      score: rule.keywords.reduce(
        (sum, keyword) => sum + (text.includes(keyword) ? 1 : 0),
        0,
      ),
    }))
    .sort(
      (a, b) => b.score - a.score || a.rule.packId.localeCompare(b.rule.packId),
    );

  const chosen = scored[0]?.rule ?? {
    packId: input.availablePackIds[0] ?? "coffee-roulette",
    strategy: "cross-functional" as const,
    keywords: [],
    metrics: ["participation_rate"] as const,
  };

  const remoteHeavy = input.remoteSharePercent >= 50;

  const toRecommendation = (
    rule: FallbackRule | typeof chosen,
  ): CopilotRecommendation => ({
    packId: rule.packId,
    fitReasons: [
      "Selected deterministically from stated objectives because AI assistance is unavailable.",
      remoteHeavy
        ? "Remote-majority population favours asynchronous-friendly formats."
        : "Mixed-location population supports both synchronous and asynchronous formats.",
    ],
    matchingStrategy: {
      key:
        remoteHeavy && rule.strategy === "cross-functional"
          ? "remote-first"
          : rule.strategy,
      rationale:
        "Default strategy registered for this pack; adjust weights before publishing.",
      suggestedWeights: {},
    },
    communicationPlan: [
      {
        trigger: "enrollment_open",
        timing: "At launch",
        summary: "Invite eligible participants and explain opt-out.",
      },
      {
        trigger: "enrollment_reminder",
        timing: "48 hours before close",
        summary: "Remind participants who have not responded.",
      },
      {
        trigger: "match_published",
        timing: "Immediately after designer approval",
        summary: "Share connections and first mission.",
      },
    ],
    participationPlan: {
      mode: "optional",
      expectedParticipationPercent: 35,
      inclusionNotes: [
        "Provide an asynchronous alternative for every mission.",
        "Schedule using participant time zones rather than headquarters time.",
      ],
    },
    revealPlan: null,
    metricPlan: [...rule.metrics],
    risks: [
      "Deterministic fallback does not consider nuance in free-text objectives.",
      "Participation estimate is a generic default, not a prediction for this organization.",
    ],
    assumptions: [
      "Objectives supplied by the designer are accurate and complete.",
    ],
  });

  return {
    primary: toRecommendation(chosen),
    alternatives: scored
      .slice(1, 3)
      .map((entry) => toRecommendation(entry.rule)),
  };
}
