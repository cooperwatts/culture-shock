import {
  differentOrNeutral,
  evaluateHardConstraints,
  jaccard,
  overlapScore,
  remoteCompatibility,
  repeatPenalty,
  roleLevelGap,
  sameOrNeutral,
  weightOf,
} from "./features.js";
import type {
  CandidateParticipant,
  EligibilityResult,
  MatchingStrategy,
  PairScore,
  ScoreComponent,
  StrategyContext,
} from "./types.js";

interface ComponentDefinition {
  readonly code: string;
  readonly defaultWeight: number;
  compute(a: CandidateParticipant, b: CandidateParticipant, context: StrategyContext): number;
}

interface StrategyDefinition {
  readonly key: string;
  readonly version: string;
  readonly supportedGroupSizes: readonly number[];
  readonly components: readonly ComponentDefinition[];
  additionalEligibility?(
    a: CandidateParticipant,
    b: CandidateParticipant,
    context: StrategyContext,
  ): readonly string[];
}

function createStrategy(definition: StrategyDefinition): MatchingStrategy {
  return {
    key: definition.key,
    version: definition.version,
    supportedGroupSizes: definition.supportedGroupSizes,
    weightKeys: definition.components.map((component) => component.code),

    eligiblePair(a, b, context): EligibilityResult {
      const violations = [
        ...evaluateHardConstraints(a, b, context),
        ...(definition.additionalEligibility?.(a, b, context) ?? []),
      ];
      return { eligible: violations.length === 0, violationCodes: violations };
    },

    scorePair(a, b, context): PairScore {
      const components: ScoreComponent[] = definition.components.map((component) => ({
        code: component.code,
        weight: weightOf(context.constraints, component.code, component.defaultWeight),
        value: component.compute(a, b, context),
      }));
      const weightSum = components.reduce((sum, component) => sum + component.weight, 0);
      const weighted = components.reduce(
        (sum, component) => sum + component.weight * component.value,
        0,
      );
      return { total: weightSum === 0 ? 0 : weighted / weightSum, components };
    },

    explain(score): readonly string[] {
      return [...score.components]
        .filter((component) => component.weight > 0)
        .sort((left, right) => right.weight * right.value - left.weight * left.value)
        .slice(0, 4)
        .map((component) => `${component.code}:${component.value >= 0.66 ? "high" : component.value >= 0.33 ? "medium" : "low"}`);
    },
  };
}

export const crossFunctionalStrategy = createStrategy({
  key: "cross-functional",
  version: "1.0.0",
  supportedGroupSizes: [2, 3, 4],
  components: [
    {
      code: "department_diversity",
      defaultWeight: 1,
      compute: (a, b) => differentOrNeutral(a.department, b.department),
    },
    { code: "team_diversity", defaultWeight: 0.6, compute: (a, b) => differentOrNeutral(a.team, b.team) },
    { code: "schedule_overlap", defaultWeight: 0.5, compute: overlapScore },
    { code: "shared_interests", defaultWeight: 0.3, compute: (a, b) => jaccard(a.interests, b.interests) },
    { code: "novel_connection", defaultWeight: 0.8, compute: (a, b) => 1 - repeatPenalty(a, b) },
  ],
});

export const diversityOptimizedStrategy = createStrategy({
  key: "diversity-optimized",
  version: "1.0.0",
  supportedGroupSizes: [2, 3, 4],
  components: [
    {
      code: "department_diversity",
      defaultWeight: 0.9,
      compute: (a, b) => differentOrNeutral(a.department, b.department),
    },
    {
      code: "geography_diversity",
      defaultWeight: 0.8,
      compute: (a, b) => differentOrNeutral(a.geography, b.geography),
    },
    {
      code: "tenure_diversity",
      defaultWeight: 0.6,
      compute: (a, b) => (a.tenureBand === "unspecified" || b.tenureBand === "unspecified" ? 0.5 : a.tenureBand === b.tenureBand ? 0 : 1),
    },
    { code: "schedule_overlap", defaultWeight: 0.6, compute: overlapScore },
    { code: "novel_connection", defaultWeight: 0.7, compute: (a, b) => 1 - repeatPenalty(a, b) },
  ],
});

export const remoteFirstStrategy = createStrategy({
  key: "remote-first",
  version: "1.0.0",
  supportedGroupSizes: [2, 3],
  components: [
    { code: "schedule_overlap", defaultWeight: 1, compute: overlapScore },
    { code: "remote_compatibility", defaultWeight: 0.9, compute: (a, b) => remoteCompatibility(a, b) },
    {
      code: "shared_language",
      defaultWeight: 0.5,
      compute: (a, b) => (jaccard(a.languages, b.languages) > 0 ? 1 : 0),
    },
    {
      code: "department_diversity",
      defaultWeight: 0.4,
      compute: (a, b) => differentOrNeutral(a.department, b.department),
    },
    { code: "novel_connection", defaultWeight: 0.6, compute: (a, b) => 1 - repeatPenalty(a, b) },
  ],
});

export const newHireFriendlyStrategy = createStrategy({
  key: "new-hire-friendly",
  version: "1.0.0",
  supportedGroupSizes: [2],
  components: [
    {
      code: "buddy_tenure",
      defaultWeight: 1,
      compute: (a, b) => {
        const buddy = a.isNewHire ? b : a;
        return buddy.tenureBand === "gte_3_years" ? 1 : buddy.tenureBand === "lt_3_years" ? 0.8 : 0.3;
      },
    },
    { code: "same_department", defaultWeight: 0.7, compute: (a, b) => sameOrNeutral(a.department, b.department) },
    { code: "schedule_overlap", defaultWeight: 0.8, compute: overlapScore },
    {
      code: "buddy_availability",
      defaultWeight: 0.6,
      compute: (a, b) => {
        const buddy = a.isNewHire ? b : a;
        return Math.min(1, buddy.capacity / 3);
      },
    },
  ],
  additionalEligibility(a, b) {
    const violations: string[] = [];
    // Exactly one new hire per buddy pair, and the buddy must not be brand new.
    if (a.isNewHire === b.isNewHire) violations.push("requires_one_new_hire");
    const buddy = a.isNewHire ? b : a;
    if (buddy.tenureBand === "lt_3_months") violations.push("buddy_tenure_insufficient");
    if (buddy.capacity < 1) violations.push("buddy_capacity_exhausted");
    return violations;
  },
});

export const leadershipMixStrategy = createStrategy({
  key: "leadership-mix",
  version: "1.0.0",
  supportedGroupSizes: [2, 3],
  components: [
    { code: "role_level_mix", defaultWeight: 1, compute: (a, b) => Math.min(1, roleLevelGap(a, b) / 2) },
    {
      code: "department_diversity",
      defaultWeight: 0.8,
      compute: (a, b) => differentOrNeutral(a.department, b.department),
    },
    { code: "schedule_overlap", defaultWeight: 0.6, compute: overlapScore },
    { code: "novel_connection", defaultWeight: 0.6, compute: (a, b) => 1 - repeatPenalty(a, b) },
  ],
  additionalEligibility(a, b) {
    const violations: string[] = [];
    // Power-dynamics safeguard: never pair across a large role gap inside the
    // same team, where a reporting relationship is likely.
    if (a.team !== null && a.team === b.team && roleLevelGap(a, b) >= 2) {
      violations.push("possible_reporting_relationship");
    }
    return violations;
  },
});

export const BUILT_IN_STRATEGIES: readonly MatchingStrategy[] = [
  crossFunctionalStrategy,
  diversityOptimizedStrategy,
  remoteFirstStrategy,
  newHireFriendlyStrategy,
  leadershipMixStrategy,
];
