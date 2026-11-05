import {
  CATEGORY_AUTHORITY,
  FACT_FIELDS,
  type Comparison,
  type Effect,
  type FactField,
  type Predicate,
  type Rule,
  type RuleSet,
} from "./ast.js";

export type FactValue = string | number | boolean | readonly string[] | null | undefined;
export type Facts = Partial<Record<FactField, FactValue>>;

function compare(comparison: Comparison, facts: Facts): boolean {
  const actual = facts[comparison.field];
  const fieldType = FACT_FIELDS[comparison.field];

  if (comparison.op === "isSet") {
    const present = actual !== undefined && actual !== null && actual !== "";
    return present === comparison.value;
  }

  // An absent optional fact never satisfies a condition; it yields a neutral
  // outcome instead of accidentally matching a default.
  if (actual === undefined || actual === null) return false;

  if (fieldType === "stringSet") {
    const set = Array.isArray(actual) ? (actual as readonly string[]) : [String(actual)];
    switch (comparison.op) {
      case "contains":
        return set.includes(comparison.value);
      case "in":
        return set.some((entry) => (comparison.value as readonly unknown[]).includes(entry));
      case "nin":
        return !set.some((entry) => (comparison.value as readonly unknown[]).includes(entry));
      case "eq":
        return set.length === 1 && set[0] === comparison.value;
      case "neq":
        return !(set.length === 1 && set[0] === comparison.value);
      default:
        return false;
    }
  }

  switch (comparison.op) {
    case "eq":
      return actual === comparison.value;
    case "neq":
      return actual !== comparison.value;
    case "in":
      return (comparison.value as readonly unknown[]).includes(actual as never);
    case "nin":
      return !(comparison.value as readonly unknown[]).includes(actual as never);
    case "gte":
      return typeof actual === "number" && actual >= comparison.value;
    case "lte":
      return typeof actual === "number" && actual <= comparison.value;
    case "between":
      return (
        typeof actual === "number" &&
        actual >= comparison.value[0] &&
        actual <= comparison.value[1]
      );
    case "contains":
      return typeof actual === "string" && actual.includes(comparison.value);
    default:
      return false;
  }
}

export function evaluatePredicate(predicate: Predicate, facts: Facts): boolean {
  if ("all" in predicate) return predicate.all.every((child) => evaluatePredicate(child, facts));
  if ("any" in predicate) return predicate.any.some((child) => evaluatePredicate(child, facts));
  if ("not" in predicate) return !evaluatePredicate(predicate.not, facts);
  return compare(predicate, facts);
}

export interface MatchingConstraint {
  readonly constraint: string;
  readonly value: number | null;
  readonly ruleId: string;
}

export interface ScheduledAction {
  readonly action: string;
  readonly anchor: string;
  readonly offsetMinutes: number;
  readonly ruleId: string;
}

export interface Decision {
  readonly allowed: boolean;
  /** Stable codes for logging; never participant attributes. */
  readonly decisionCodes: readonly string[];
  readonly firedRuleIds: readonly string[];
  readonly denials: ReadonlyArray<{ ruleId: string; code: string }>;
  readonly approvalsRequired: ReadonlyArray<{ ruleId: string; code: string }>;
  readonly privacyMode: string | null;
  readonly matchingConstraints: readonly MatchingConstraint[];
  readonly activityCapabilities: Readonly<Record<string, boolean>>;
  readonly pools: readonly string[];
  readonly scheduledActions: readonly ScheduledAction[];
}

interface MutableDecision {
  allowed: boolean;
  accessAuthority: number;
  privacyMode: string | null;
  privacyAuthority: number;
  decisionCodes: string[];
  firedRuleIds: string[];
  denials: Array<{ ruleId: string; code: string }>;
  approvalsRequired: Array<{ ruleId: string; code: string }>;
  matchingConstraints: Map<string, MatchingConstraint & { authority: number }>;
  activityCapabilities: Map<string, { enabled: boolean; authority: number }>;
  pools: string[];
  scheduledActions: ScheduledAction[];
}

const LOWEST_AUTHORITY = Number.POSITIVE_INFINITY;

function applyEffect(state: MutableDecision, rule: Rule, effect: Effect, authority: number): void {
  switch (effect.type) {
    case "deny":
      // Deny wins at equal authority; only a strictly higher authority allow can clear it.
      if (authority <= state.accessAuthority) {
        state.allowed = false;
        state.accessAuthority = authority;
        state.denials.push({ ruleId: rule.id, code: effect.code });
        state.decisionCodes.push(effect.code);
      }
      break;
    case "allow":
      // Rules are visited in authority order, so this only records the highest
      // authority that has spoken; it can never clear a higher-authority deny.
      if (authority < state.accessAuthority) {
        state.allowed = true;
        state.accessAuthority = authority;
        if (effect.code) state.decisionCodes.push(effect.code);
      }
      break;
    case "requireApproval":
      state.approvalsRequired.push({ ruleId: rule.id, code: effect.code });
      state.decisionCodes.push(effect.code);
      break;
    case "setPrivacyMode":
      if (authority <= state.privacyAuthority) {
        state.privacyMode = effect.mode;
        state.privacyAuthority = authority;
      }
      break;
    case "setMatchingConstraint": {
      const existing = state.matchingConstraints.get(effect.constraint);
      if (!existing || authority <= existing.authority) {
        state.matchingConstraints.set(effect.constraint, {
          constraint: effect.constraint,
          value: effect.value ?? null,
          ruleId: rule.id,
          authority,
        });
      }
      break;
    }
    case "setActivityCapability": {
      const existing = state.activityCapabilities.get(effect.capability);
      // A higher-authority disable cannot be re-enabled lower down.
      if (!existing || authority < existing.authority || (authority === existing.authority && !effect.enabled)) {
        state.activityCapabilities.set(effect.capability, { enabled: effect.enabled, authority });
      }
      break;
    }
    case "setPool":
      if (!state.pools.includes(effect.pool)) state.pools.push(effect.pool);
      break;
    case "scheduleRelativeAction":
      state.scheduledActions.push({
        action: effect.action,
        anchor: effect.anchor,
        offsetMinutes: effect.offsetMinutes,
        ruleId: rule.id,
      });
      break;
  }
}

/**
 * Evaluates a rule set against facts in authority order. Evaluation is pure and
 * bounded: no loops, no provider calls, no data access beyond `facts`.
 */
export function evaluate(ruleSet: RuleSet, facts: Facts): Decision {
  const state: MutableDecision = {
    allowed: true,
    accessAuthority: LOWEST_AUTHORITY,
    privacyMode: null,
    privacyAuthority: LOWEST_AUTHORITY,
    decisionCodes: [],
    firedRuleIds: [],
    denials: [],
    approvalsRequired: [],
    matchingConstraints: new Map(),
    activityCapabilities: new Map(),
    pools: [],
    scheduledActions: [],
  };

  const ordered = [...ruleSet].sort((a, b) => {
    const authorityDelta = CATEGORY_AUTHORITY[a.category] - CATEGORY_AUTHORITY[b.category];
    if (authorityDelta !== 0) return authorityDelta;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.id.localeCompare(b.id);
  });

  for (const rule of ordered) {
    if (rule.when && !evaluatePredicate(rule.when, facts)) continue;
    state.firedRuleIds.push(rule.id);
    applyEffect(state, rule, rule.then, CATEGORY_AUTHORITY[rule.category]);
  }

  const capabilities: Record<string, boolean> = {};
  for (const [capability, value] of state.activityCapabilities) capabilities[capability] = value.enabled;

  return {
    allowed: state.allowed,
    decisionCodes: state.decisionCodes,
    firedRuleIds: state.firedRuleIds,
    denials: state.denials,
    approvalsRequired: state.approvalsRequired,
    privacyMode: state.privacyMode,
    matchingConstraints: [...state.matchingConstraints.values()].map(
      ({ constraint, value, ruleId }) => ({ constraint, value, ruleId }),
    ),
    activityCapabilities: capabilities,
    pools: state.pools,
    scheduledActions: state.scheduledActions,
  };
}
