import type { CandidateParticipant, MatchRunResult } from "./types.js";

export interface CohortRow {
  readonly cohort: string;
  readonly participants: number;
  readonly matched: number;
  readonly unmatched: number;
  /** True when the cell was suppressed because the cohort is too small. */
  readonly suppressed: boolean;
}

export interface FairnessReport {
  readonly minimumCohortSize: number;
  readonly totalParticipants: number;
  readonly totalMatched: number;
  readonly totalUnmatched: number;
  readonly byDepartment: readonly CohortRow[];
  readonly byRemotePreference: readonly CohortRow[];
  readonly repeatExposureCount: number;
  readonly scoreDistribution: {
    readonly min: number;
    readonly median: number;
    readonly max: number;
  };
  readonly loadBalance: {
    readonly minGroupSize: number;
    readonly maxGroupSize: number;
  };
  readonly warnings: readonly string[];
}

function cohortRows(
  participants: readonly CandidateParticipant[],
  matchedIds: ReadonlySet<string>,
  select: (participant: CandidateParticipant) => string | null,
  minimumCohortSize: number,
): CohortRow[] {
  const buckets = new Map<string, { participants: number; matched: number }>();
  for (const participant of participants) {
    const cohort = select(participant) ?? "unspecified";
    const bucket = buckets.get(cohort) ?? { participants: 0, matched: 0 };
    bucket.participants += 1;
    if (matchedIds.has(participant.participantId)) bucket.matched += 1;
    buckets.set(cohort, bucket);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([cohort, bucket]) => {
      // Small cells are suppressed; complementary totals are suppressed too by
      // reporting zeros rather than a residual that could be back-calculated.
      const suppressed = bucket.participants < minimumCohortSize;
      return {
        cohort,
        participants: suppressed ? 0 : bucket.participants,
        matched: suppressed ? 0 : bucket.matched,
        unmatched: suppressed ? 0 : bucket.participants - bucket.matched,
        suppressed,
      };
    });
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return (((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
}

/**
 * Fairness report shown to a designer before publication. It never displays or
 * infers protected characteristics, and suppresses any cohort below threshold.
 */
export function buildFairnessReport(
  participants: readonly CandidateParticipant[],
  result: MatchRunResult,
  minimumCohortSize = 10,
): FairnessReport {
  const matchedIds = new Set(result.matches.flatMap((match) => match.memberParticipantIds));
  const byId = new Map(participants.map((participant) => [participant.participantId, participant]));

  let repeatExposureCount = 0;
  for (const match of result.matches) {
    for (let i = 0; i < match.memberParticipantIds.length; i += 1) {
      for (let j = i + 1; j < match.memberParticipantIds.length; j += 1) {
        const left = byId.get(match.memberParticipantIds[i] as string);
        const right = match.memberParticipantIds[j] as string;
        if (left?.priorMatchParticipantIds.includes(right)) repeatExposureCount += 1;
      }
    }
  }

  const scores = result.matches.map((match) => match.score);
  const groupSizes = result.matches.map((match) => match.memberParticipantIds.length);
  const warnings: string[] = [];

  if (result.unmatched.length > 0) {
    warnings.push(`unmatched_participants:${result.unmatched.length}`);
  }
  if (repeatExposureCount > 0) warnings.push(`repeat_exposure:${repeatExposureCount}`);
  if (result.diagnostics.approximationUsed) {
    warnings.push(`approximation:${result.diagnostics.approximationReason ?? "unknown"}`);
  }

  return {
    minimumCohortSize,
    totalParticipants: participants.length,
    totalMatched: matchedIds.size,
    totalUnmatched: result.unmatched.length,
    byDepartment: cohortRows(participants, matchedIds, (p) => p.department, minimumCohortSize),
    byRemotePreference: cohortRows(participants, matchedIds, (p) => p.remotePreference, minimumCohortSize),
    repeatExposureCount,
    scoreDistribution: {
      min: scores.length > 0 ? Math.min(...scores) : 0,
      median: Number(median(scores).toFixed(6)),
      max: scores.length > 0 ? Math.max(...scores) : 0,
    },
    loadBalance: {
      minGroupSize: groupSizes.length > 0 ? Math.min(...groupSizes) : 0,
      maxGroupSize: groupSizes.length > 0 ? Math.max(...groupSizes) : 0,
    },
    warnings,
  };
}
