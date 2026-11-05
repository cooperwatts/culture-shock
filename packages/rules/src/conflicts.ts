import {
  CATEGORY_AUTHORITY,
  MAX_PREDICATE_DEPTH,
  MAX_PREDICATE_NODES,
  predicateDepth,
  predicateNodeCount,
  ruleSetSchema,
  type Rule,
  type RuleSet,
} from "./ast.js";

export type IssueSeverity = "error" | "warning";

export interface RuleIssue {
  readonly severity: IssueSeverity;
  readonly code: string;
  readonly message: string;
  readonly ruleIds: readonly string[];
}

const CONTRADICTORY_CONSTRAINTS: ReadonlyArray<readonly [string, string]> = [
  ["same_department", "different_department"],
  ["same_team", "different_team"],
];

function unconditional(rule: Rule): boolean {
  return rule.when === undefined;
}

/**
 * Static analysis run before a rule set may be published or launched. Returns
 * every issue rather than throwing on the first, so a designer sees the whole
 * dry-run report at once.
 */
export function analyzeRuleSet(input: unknown): {
  ok: boolean;
  ruleSet: RuleSet | null;
  issues: RuleIssue[];
} {
  const parsed = ruleSetSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      ruleSet: null,
      issues: parsed.error.issues.map((issue) => ({
        severity: "error" as const,
        code: "schema_invalid",
        message: `${issue.path.join(".")}: ${issue.message}`,
        ruleIds: [],
      })),
    };
  }

  const ruleSet = parsed.data;
  const issues: RuleIssue[] = [];

  const seen = new Map<string, number>();
  for (const rule of ruleSet) {
    seen.set(rule.id, (seen.get(rule.id) ?? 0) + 1);
  }
  for (const [id, count] of seen) {
    if (count > 1) {
      issues.push({
        severity: "error",
        code: "duplicate_rule_id",
        message: `Rule id "${id}" is declared ${count} times`,
        ruleIds: [id],
      });
    }
  }

  for (const rule of ruleSet) {
    if (!rule.when) continue;
    if (predicateDepth(rule.when) > MAX_PREDICATE_DEPTH) {
      issues.push({
        severity: "error",
        code: "predicate_too_deep",
        message: `Rule "${rule.id}" exceeds the maximum nesting depth of ${MAX_PREDICATE_DEPTH}`,
        ruleIds: [rule.id],
      });
    }
    if (predicateNodeCount(rule.when) > MAX_PREDICATE_NODES) {
      issues.push({
        severity: "error",
        code: "predicate_too_large",
        message: `Rule "${rule.id}" exceeds the maximum of ${MAX_PREDICATE_NODES} condition nodes`,
        ruleIds: [rule.id],
      });
    }
  }

  const unconditionalConstraints = new Map<string, Rule>();
  const unconditionalPrivacy: Rule[] = [];
  const unconditionalCapabilities = new Map<string, Map<boolean, Rule>>();
  let revealScheduled: Rule | null = null;

  for (const rule of ruleSet) {
    if (!unconditional(rule)) continue;
    const effect = rule.then;
    if (effect.type === "setMatchingConstraint") unconditionalConstraints.set(effect.constraint, rule);
    if (effect.type === "setPrivacyMode") unconditionalPrivacy.push(rule);
    if (effect.type === "setActivityCapability") {
      const byValue = unconditionalCapabilities.get(effect.capability) ?? new Map<boolean, Rule>();
      byValue.set(effect.enabled, rule);
      unconditionalCapabilities.set(effect.capability, byValue);
    }
    if (effect.type === "scheduleRelativeAction" && effect.action === "reveal") revealScheduled = rule;
  }

  for (const [left, right] of CONTRADICTORY_CONSTRAINTS) {
    const a = unconditionalConstraints.get(left);
    const b = unconditionalConstraints.get(right);
    if (a && b) {
      issues.push({
        severity: "error",
        code: "contradictory_matching_constraint",
        message: `Constraints "${left}" and "${right}" cannot both apply unconditionally`,
        ruleIds: [a.id, b.id],
      });
    }
  }

  const minGroup = unconditionalConstraints.get("min_group_size");
  const maxGroup = unconditionalConstraints.get("max_group_size");
  if (minGroup && maxGroup) {
    const min = minGroup.then.type === "setMatchingConstraint" ? minGroup.then.value ?? 0 : 0;
    const max = maxGroup.then.type === "setMatchingConstraint" ? maxGroup.then.value ?? 0 : 0;
    if (min > max) {
      issues.push({
        severity: "error",
        code: "unsatisfiable_group_size",
        message: `Minimum group size ${min} exceeds maximum group size ${max}`,
        ruleIds: [minGroup.id, maxGroup.id],
      });
    }
  }

  const privacyModes = new Set(
    unconditionalPrivacy
      .filter((rule) => rule.then.type === "setPrivacyMode")
      .map((rule) => (rule.then.type === "setPrivacyMode" ? rule.then.mode : "")),
  );
  if (privacyModes.size > 1) {
    const sameAuthority = new Set(unconditionalPrivacy.map((rule) => CATEGORY_AUTHORITY[rule.category]));
    issues.push({
      severity: sameAuthority.size === 1 ? "error" : "warning",
      code: "conflicting_privacy_mode",
      message: `Multiple unconditional privacy modes declared: ${[...privacyModes].join(", ")}`,
      ruleIds: unconditionalPrivacy.map((rule) => rule.id),
    });
  }

  if (revealScheduled && privacyModes.has("never_reveal")) {
    issues.push({
      severity: "error",
      code: "reveal_conflicts_with_privacy",
      message: "A reveal action cannot be scheduled while privacy mode is never_reveal",
      ruleIds: [revealScheduled.id],
    });
  }

  for (const [capability, byValue] of unconditionalCapabilities) {
    if (byValue.size > 1) {
      issues.push({
        severity: "error",
        code: "conflicting_activity_capability",
        message: `Capability "${capability}" is unconditionally both enabled and disabled`,
        ruleIds: [...byValue.values()].map((rule) => rule.id),
      });
    }
  }

  const blanketDeny = ruleSet.find(
    (rule) => unconditional(rule) && rule.then.type === "deny" && rule.category === "eligibility",
  );
  if (blanketDeny) {
    issues.push({
      severity: "warning",
      code: "unsatisfiable_enrollment",
      message: `Rule "${blanketDeny.id}" denies eligibility for every participant`,
      ruleIds: [blanketDeny.id],
    });
  }

  return { ok: !issues.some((issue) => issue.severity === "error"), ruleSet, issues };
}
