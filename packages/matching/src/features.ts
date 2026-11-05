import { overlapMinutes } from "@culture-shock/domain";
import type { CandidateParticipant, HardConstraint, MatchingConstraints, StrategyContext } from "./types.js";

/** Clamps a tunable weight into the bounded range the core will honour. */
export function clampWeight(value: number | undefined, fallback: number): number {
  if (value === undefined || Number.isNaN(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

export function weightOf(constraints: MatchingConstraints, key: string, fallback: number): number {
  return clampWeight(constraints.weights[key], fallback);
}

/**
 * Missing optional metadata yields a neutral 0.5 rather than excluding anyone,
 * so a participant who declined optional fields is never penalized out of the pool.
 */
const NEUTRAL = 0.5;

export function differentOrNeutral(a: string | null, b: string | null): number {
  if (a === null || b === null) return NEUTRAL;
  return a === b ? 0 : 1;
}

export function sameOrNeutral(a: string | null, b: string | null): number {
  if (a === null || b === null) return NEUTRAL;
  return a === b ? 1 : 0;
}

export function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return NEUTRAL;
  const left = new Set(a);
  const right = new Set(b);
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  const union = left.size + right.size - intersection;
  return union === 0 ? NEUTRAL : intersection / union;
}

export function overlapScore(
  a: CandidateParticipant,
  b: CandidateParticipant,
  context: StrategyContext,
): number {
  if (!a.timeZone || !b.timeZone) return NEUTRAL;
  const minutes = overlapMinutes(a.timeZone, b.timeZone, context.reference);
  // Eight hours of shared working time is treated as a full score.
  return Math.min(1, minutes / 480);
}

export function timeZoneOverlapMinutes(
  a: CandidateParticipant,
  b: CandidateParticipant,
  context: StrategyContext,
): number {
  if (!a.timeZone || !b.timeZone) return 0;
  return overlapMinutes(a.timeZone, b.timeZone, context.reference);
}

export function remoteCompatibility(a: CandidateParticipant, b: CandidateParticipant): number {
  if (a.remotePreference === "unspecified" || b.remotePreference === "unspecified") return NEUTRAL;
  if (a.remotePreference === b.remotePreference) return 1;
  // Hybrid bridges remote and onsite; remote/onsite pairs need an async format.
  if (a.remotePreference === "hybrid" || b.remotePreference === "hybrid") return 0.75;
  return 0.4;
}

/** Prior-match history is checked in both directions; one record is enough. */
export function repeatPenalty(a: CandidateParticipant, b: CandidateParticipant): number {
  const repeated =
    a.priorMatchParticipantIds.includes(b.participantId) ||
    b.priorMatchParticipantIds.includes(a.participantId);
  return repeated ? 1 : 0;
}

const ROLE_DISTANCE: Readonly<Record<string, number>> = {
  individual: 0,
  lead: 1,
  manager: 2,
  executive: 3,
  unspecified: 1,
};

export function roleLevelGap(a: CandidateParticipant, b: CandidateParticipant): number {
  const left = ROLE_DISTANCE[a.roleLevel] ?? 1;
  const right = ROLE_DISTANCE[b.roleLevel] ?? 1;
  return Math.abs(left - right);
}

/**
 * Shared hard-constraint evaluation. Hard constraints are resolved before any
 * weight is applied and can never be relaxed by scoring or by a designer.
 */
export function evaluateHardConstraints(
  a: CandidateParticipant,
  b: CandidateParticipant,
  context: StrategyContext,
): string[] {
  const violations: string[] = [];
  const applies = (constraint: HardConstraint): boolean =>
    context.constraints.hardConstraints.includes(constraint);

  if (a.participantId === b.participantId) violations.push("self_match");
  if (applies("no_repeat_match") && repeatPenalty(a, b) === 1) violations.push("repeat_match");
  if (applies("different_department") && a.department !== null && a.department === b.department) {
    violations.push("same_department_not_allowed");
  }
  if (applies("same_department") && a.department !== null && b.department !== null && a.department !== b.department) {
    violations.push("different_department_not_allowed");
  }
  if (applies("different_team") && a.team !== null && a.team === b.team) {
    violations.push("same_team_not_allowed");
  }
  if (applies("require_timezone_overlap")) {
    const minutes = timeZoneOverlapMinutes(a, b, context);
    if (minutes < context.constraints.minimumOverlapMinutes) violations.push("insufficient_timezone_overlap");
  }
  if (applies("respect_capacity") && (a.capacity < 1 || b.capacity < 1)) {
    violations.push("capacity_exhausted");
  }
  return violations;
}
