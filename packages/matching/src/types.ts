/**
 * Matching operates on an immutable, versioned input snapshot. Only non-sensitive
 * organizational metadata and consented preferences appear here; no names, no
 * emails, no free text, and never a protected characteristic.
 */

export type RoleLevel = "individual" | "lead" | "manager" | "executive" | "unspecified";

export interface CandidateParticipant {
  readonly participantId: string;
  readonly department: string | null;
  readonly team: string | null;
  readonly geography: string | null;
  readonly timeZone: string | null;
  readonly remotePreference: "remote" | "hybrid" | "onsite" | "unspecified";
  readonly tenureBand: "lt_3_months" | "lt_1_year" | "lt_3_years" | "gte_3_years" | "unspecified";
  readonly roleLevel: RoleLevel;
  readonly languages: readonly string[];
  readonly interests: readonly string[];
  /** Instance-local history; never cross-instance identity linkage. */
  readonly priorMatchParticipantIds: readonly string[];
  /** Maximum groups this participant may join, e.g. buddy load caps. */
  readonly capacity: number;
  readonly isNewHire: boolean;
}

export const HARD_CONSTRAINTS = [
  "no_self_match",
  "no_repeat_match",
  "different_department",
  "same_department",
  "different_team",
  "require_timezone_overlap",
  "respect_capacity",
] as const;

export type HardConstraint = (typeof HARD_CONSTRAINTS)[number];

export interface MatchingConstraints {
  readonly groupSize: number;
  readonly allowTriadForOddCount: boolean;
  readonly hardConstraints: readonly HardConstraint[];
  readonly minimumOverlapMinutes: number;
  /** Bounds candidate generation so 1,200 participants never materialize O(n^2) edges. */
  readonly maxCandidatesPerParticipant: number;
  readonly weights: Readonly<Record<string, number>>;
}

export const DEFAULT_CONSTRAINTS: MatchingConstraints = {
  groupSize: 2,
  allowTriadForOddCount: false,
  hardConstraints: ["no_self_match", "no_repeat_match"],
  minimumOverlapMinutes: 60,
  maxCandidatesPerParticipant: 60,
  weights: {},
};

export interface ScoreComponent {
  /** Stable code shown to designers; never a participant attribute value. */
  readonly code: string;
  readonly weight: number;
  readonly value: number;
}

export interface PairScore {
  readonly total: number;
  readonly components: readonly ScoreComponent[];
}

export interface EligibilityResult {
  readonly eligible: boolean;
  readonly violationCodes: readonly string[];
}

export interface StrategyContext {
  readonly constraints: MatchingConstraints;
  /** Reference instant used for DST-correct time-zone overlap. */
  readonly reference: Date;
}

export interface MatchingStrategy {
  readonly key: string;
  readonly version: string;
  readonly supportedGroupSizes: readonly number[];
  /** Weight keys a manifest or designer may tune, each clamped to 0..1. */
  readonly weightKeys: readonly string[];
  eligiblePair(a: CandidateParticipant, b: CandidateParticipant, context: StrategyContext): EligibilityResult;
  scorePair(a: CandidateParticipant, b: CandidateParticipant, context: StrategyContext): PairScore;
  explain(score: PairScore): readonly string[];
}

export interface ProposedMatch {
  readonly groupKey: string;
  readonly memberParticipantIds: readonly string[];
  readonly score: number;
  readonly rationaleCodes: readonly string[];
}

export interface UnmatchedParticipant {
  readonly participantId: string;
  readonly reasonCode: string;
}

export interface MatchRunDiagnostics {
  readonly strategyKey: string;
  readonly strategyVersion: string;
  readonly inputHash: string;
  readonly consideredParticipants: number;
  readonly consideredEdges: number;
  readonly matchedParticipants: number;
  readonly approximationUsed: boolean;
  readonly approximationReason: string | null;
  readonly constraintViolations: readonly string[];
  readonly durationMs: number;
}

export interface MatchRunResult {
  readonly matches: readonly ProposedMatch[];
  readonly unmatched: readonly UnmatchedParticipant[];
  readonly diagnostics: MatchRunDiagnostics;
}
