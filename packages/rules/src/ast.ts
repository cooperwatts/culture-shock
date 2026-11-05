import { z } from "zod";

/**
 * Allowlisted fact fields. A rule can never reference an arbitrary path, so a
 * manifest cannot reach participant free text, identifiers, or protected
 * characteristics even if an author tries.
 */
export const FACT_FIELDS = {
  "participant.team": "string",
  "participant.department": "string",
  "participant.geography": "string",
  "participant.timeZone": "string",
  "participant.remotePreference": "enum",
  "participant.tenureBand": "enum",
  "participant.languages": "stringSet",
  "participant.state": "enum",
  "instance.phase": "enum",
  "instance.participationMode": "enum",
  "consent.scope": "stringSet",
  "priorMatch.count": "number",
  "match.sameDepartment": "boolean",
  "match.sameTeam": "boolean",
  "match.timeZoneOverlapMinutes": "number",
} as const;

export type FactField = keyof typeof FACT_FIELDS;
export type FactFieldType = (typeof FACT_FIELDS)[FactField];

export const factFieldSchema = z.enum(
  Object.keys(FACT_FIELDS) as [FactField, ...FactField[]],
);

const scalar = z.union([z.string().max(120), z.number().finite(), z.boolean()]);

export const comparisonSchema = z.discriminatedUnion("op", [
  z.object({ field: factFieldSchema, op: z.literal("eq"), value: scalar }),
  z.object({ field: factFieldSchema, op: z.literal("neq"), value: scalar }),
  z.object({ field: factFieldSchema, op: z.literal("in"), value: z.array(scalar).min(1).max(100) }),
  z.object({ field: factFieldSchema, op: z.literal("nin"), value: z.array(scalar).min(1).max(100) }),
  z.object({ field: factFieldSchema, op: z.literal("gte"), value: z.number().finite() }),
  z.object({ field: factFieldSchema, op: z.literal("lte"), value: z.number().finite() }),
  z.object({
    field: factFieldSchema,
    op: z.literal("between"),
    value: z.tuple([z.number().finite(), z.number().finite()]),
  }),
  z.object({ field: factFieldSchema, op: z.literal("contains"), value: z.string().max(120) }),
  z.object({ field: factFieldSchema, op: z.literal("isSet"), value: z.boolean() }),
]);

export type Comparison = z.infer<typeof comparisonSchema>;

export const MAX_PREDICATE_DEPTH = 5;
export const MAX_PREDICATE_NODES = 100;

export type Predicate =
  | Comparison
  | { readonly all: readonly Predicate[] }
  | { readonly any: readonly Predicate[] }
  | { readonly not: Predicate };

export const predicateSchema: z.ZodType<Predicate> = z.lazy(() =>
  z.union([
    comparisonSchema,
    z.object({ all: z.array(predicateSchema).min(1).max(20) }),
    z.object({ any: z.array(predicateSchema).min(1).max(20) }),
    z.object({ not: predicateSchema }),
  ]),
);

export const RULE_CATEGORIES = [
  "installation_safety",
  "privacy",
  "consent",
  "participation",
  "eligibility",
  "matching",
  "activity",
  "inclusion",
  "schedule",
] as const;

export type RuleCategory = (typeof RULE_CATEGORIES)[number];

/**
 * Authority ordering. A lower number is higher authority; rules at a lower
 * authority can never weaken a decision already made at a higher authority.
 */
export const CATEGORY_AUTHORITY: Readonly<Record<RuleCategory, number>> = {
  installation_safety: 0,
  privacy: 1,
  consent: 1,
  eligibility: 2,
  participation: 2,
  matching: 3,
  inclusion: 3,
  schedule: 3,
  activity: 4,
};

export const effectSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("allow"), code: z.string().max(60).optional() }),
  z.object({ type: z.literal("deny"), code: z.string().max(60) }),
  z.object({ type: z.literal("requireApproval"), code: z.string().max(60) }),
  z.object({
    type: z.literal("setPrivacyMode"),
    mode: z.enum(["anonymous", "pseudonymous", "reveal_at_end", "never_reveal"]),
  }),
  z.object({
    type: z.literal("setMatchingConstraint"),
    constraint: z.enum([
      "different_department",
      "same_department",
      "different_team",
      "same_team",
      "different_geography",
      "require_timezone_overlap",
      "no_repeat_match",
      "max_group_size",
      "min_group_size",
      "max_buddy_load",
    ]),
    value: z.number().int().min(0).max(1000).optional(),
  }),
  z.object({
    type: z.literal("setActivityCapability"),
    capability: z.string().regex(/^[a-z][a-z0-9-]{2,40}$/),
    enabled: z.boolean(),
  }),
  z.object({ type: z.literal("setPool"), pool: z.string().regex(/^[a-z][a-z0-9_-]{1,40}$/) }),
  z.object({
    type: z.literal("scheduleRelativeAction"),
    action: z.enum([
      "close_enrollment",
      "run_matching",
      "publish_matches",
      "send_reminder",
      "collect_feedback",
      "reveal",
      "finish",
    ]),
    anchor: z.enum(["instance_start", "instance_end", "enrollment_close", "match_publish"]),
    offsetMinutes: z.number().int().min(-20160).max(20160),
  }),
]);

export type Effect = z.infer<typeof effectSchema>;

export const ruleSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9._-]{2,60}$/),
  category: z.enum(RULE_CATEGORIES),
  priority: z.number().int().min(0).max(1000).default(100),
  description: z.string().max(200).optional(),
  when: predicateSchema.optional(),
  then: effectSchema,
});

export type Rule = z.infer<typeof ruleSchema>;

export const ruleSetSchema = z.array(ruleSchema).max(200);
export type RuleSet = z.infer<typeof ruleSetSchema>;

export function predicateDepth(predicate: Predicate, depth = 1): number {
  if ("all" in predicate) return Math.max(...predicate.all.map((p) => predicateDepth(p, depth + 1)));
  if ("any" in predicate) return Math.max(...predicate.any.map((p) => predicateDepth(p, depth + 1)));
  if ("not" in predicate) return predicateDepth(predicate.not, depth + 1);
  return depth;
}

export function predicateNodeCount(predicate: Predicate): number {
  if ("all" in predicate) return 1 + predicate.all.reduce((sum, p) => sum + predicateNodeCount(p), 0);
  if ("any" in predicate) return 1 + predicate.any.reduce((sum, p) => sum + predicateNodeCount(p), 0);
  if ("not" in predicate) return 1 + predicateNodeCount(predicate.not);
  return 1;
}

export function collectFields(predicate: Predicate, into: Set<FactField> = new Set()): Set<FactField> {
  if ("all" in predicate) predicate.all.forEach((p) => collectFields(p, into));
  else if ("any" in predicate) predicate.any.forEach((p) => collectFields(p, into));
  else if ("not" in predicate) collectFields(predicate.not, into);
  else into.add(predicate.field);
  return into;
}
