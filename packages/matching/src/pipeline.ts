import type {
  CandidateParticipant,
  MatchRunResult,
  MatchingConstraints,
  MatchingStrategy,
  ProposedMatch,
  StrategyContext,
  UnmatchedParticipant,
} from "./types.js";

export interface MatchingRunOptions {
  readonly constraints: MatchingConstraints;
  readonly reference?: Date;
  /** Soft wall-clock budget; exceeding it degrades to the greedy solution. */
  readonly timeBudgetMs?: number;
  readonly now?: () => number;
}

interface Edge {
  readonly a: number;
  readonly b: number;
  readonly score: number;
  readonly codes: readonly string[];
}

function stableSortEdges(edges: Edge[], ids: readonly string[]): Edge[] {
  return edges.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    // Deterministic tie-break on identifiers; ties never reintroduce randomness.
    const leftKey = `${ids[left.a]}:${ids[left.b]}`;
    const rightKey = `${ids[right.a]}:${ids[right.b]}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

/**
 * Deterministic bounded candidate generation. For small pools every pair is
 * considered; above the budget each participant gets a fixed number of
 * neighbours chosen by rotation and stride so candidates still span the whole
 * population instead of clustering by sort order.
 */
function candidatePairs(count: number, constraints: MatchingConstraints): Array<[number, number]> {
  const exhaustiveEdges = (count * (count - 1)) / 2;
  const budget = Math.max(1, Math.floor((count * constraints.maxCandidatesPerParticipant) / 2));
  const pairs: Array<[number, number]> = [];

  if (exhaustiveEdges <= budget) {
    for (let a = 0; a < count; a += 1) {
      for (let b = a + 1; b < count; b += 1) pairs.push([a, b]);
    }
    return pairs;
  }

  const perParticipant = constraints.maxCandidatesPerParticipant;
  const half = Math.max(1, Math.floor(perParticipant / 2));
  const stride = Math.max(1, Math.floor(count / half));
  const seen = new Set<number>();

  for (let a = 0; a < count; a += 1) {
    const offsets: number[] = [];
    for (let step = 1; step <= half; step += 1) offsets.push(step);
    for (let step = 1; step <= half; step += 1) offsets.push(step * stride);
    for (const offset of offsets) {
      const b = (a + offset) % count;
      if (b === a) continue;
      const low = Math.min(a, b);
      const high = Math.max(a, b);
      const key = low * count + high;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([low, high]);
    }
  }
  return pairs;
}

function greedyPairing(edges: readonly Edge[], count: number): Array<Edge> {
  const taken = new Uint8Array(count);
  const chosen: Edge[] = [];
  for (const edge of edges) {
    if (taken[edge.a] === 1 || taken[edge.b] === 1) continue;
    taken[edge.a] = 1;
    taken[edge.b] = 1;
    chosen.push(edge);
  }
  return chosen;
}

/**
 * Bounded 2-opt improvement over the greedy solution. Greedy maximum-weight
 * matching is a documented approximation (no blossom implementation); this pass
 * recovers most of the gap deterministically while respecting hard constraints.
 * Comparisons are limited to a sliding window so the pass stays linear in the
 * number of pairs rather than quadratic.
 */
const TWO_OPT_WINDOW = 24;

function improvePairing(
  chosen: Edge[],
  participants: readonly CandidateParticipant[],
  strategy: MatchingStrategy,
  context: StrategyContext,
  deadline: number,
  now: () => number,
): { pairs: Edge[]; improved: boolean } {
  let improved = false;
  const pairs = [...chosen];

  for (let i = 0; i < pairs.length; i += 1) {
    if (now() > deadline) break;
    const limit = Math.min(pairs.length, i + 1 + TWO_OPT_WINDOW);
    for (let j = i + 1; j < limit; j += 1) {
      const left = pairs[i];
      const right = pairs[j];
      if (!left || !right) continue;

      const combos: Array<[number, number, number, number]> = [
        [left.a, right.a, left.b, right.b],
        [left.a, right.b, left.b, right.a],
      ];

      for (const [w, x, y, z] of combos) {
        const first = participants[w];
        const second = participants[x];
        const third = participants[y];
        const fourth = participants[z];
        if (!first || !second || !third || !fourth) continue;
        if (!strategy.eligiblePair(first, second, context).eligible) continue;
        if (!strategy.eligiblePair(third, fourth, context).eligible) continue;

        const candidateOne = strategy.scorePair(first, second, context);
        const candidateTwo = strategy.scorePair(third, fourth, context);
        const gain = candidateOne.total + candidateTwo.total - (left.score + right.score);
        if (gain > 1e-9) {
          pairs[i] = {
            a: Math.min(w, x),
            b: Math.max(w, x),
            score: candidateOne.total,
            codes: strategy.explain(candidateOne),
          };
          pairs[j] = {
            a: Math.min(y, z),
            b: Math.max(y, z),
            score: candidateTwo.total,
            codes: strategy.explain(candidateTwo),
          };
          improved = true;
          break;
        }
      }
    }
  }

  return { pairs, improved };
}

function groupKey(index: number): string {
  return `group-${String(index + 1).padStart(4, "0")}`;
}

/**
 * Builds groups larger than a pair by deterministic greedy set packing: seed
 * with the best remaining pair, then repeatedly add the member with the highest
 * mean score against the current group.
 */
function buildGroups(
  edges: readonly Edge[],
  participants: readonly CandidateParticipant[],
  strategy: MatchingStrategy,
  context: StrategyContext,
): { groups: number[][]; scores: number[]; codes: string[][] } {
  const size = context.constraints.groupSize;
  const used = new Set<number>();
  const groups: number[][] = [];
  const scores: number[] = [];
  const codes: string[][] = [];

  for (const seed of edges) {
    if (used.has(seed.a) || used.has(seed.b)) continue;
    const group = [seed.a, seed.b];
    used.add(seed.a);
    used.add(seed.b);
    let total = seed.score;
    let pairCount = 1;
    const rationale = new Set<string>(seed.codes);

    while (group.length < size) {
      let best: { index: number; mean: number; codes: readonly string[] } | null = null;
      for (let candidate = 0; candidate < participants.length; candidate += 1) {
        if (used.has(candidate)) continue;
        const member = participants[candidate];
        if (!member) continue;
        let sum = 0;
        let eligible = true;
        for (const existing of group) {
          const other = participants[existing];
          if (!other || !strategy.eligiblePair(member, other, context).eligible) {
            eligible = false;
            break;
          }
          sum += strategy.scorePair(member, other, context).total;
        }
        if (!eligible) continue;
        const mean = sum / group.length;
        const bestScore = best?.mean ?? Number.NEGATIVE_INFINITY;
        const tieBreak =
          best !== null &&
          Math.abs(mean - bestScore) < 1e-9 &&
          (participants[candidate]?.participantId ?? "") < (participants[best.index]?.participantId ?? "");
        if (mean > bestScore + 1e-9 || tieBreak) {
          const first = participants[group[0] as number];
          best = {
            index: candidate,
            mean,
            codes: first ? strategy.explain(strategy.scorePair(member, first, context)) : [],
          };
        }
      }
      if (!best) break;
      used.add(best.index);
      group.push(best.index);
      total += best.mean;
      pairCount += 1;
      for (const code of best.codes) rationale.add(code);
    }

    if (group.length >= Math.min(size, 2)) {
      groups.push(group);
      scores.push(total / pairCount);
      codes.push([...rationale]);
    }
  }

  return { groups, scores, codes };
}

/**
 * Runs a full matching pass over an immutable snapshot. The same input always
 * produces the same output, so a retried job reuses the stored input hash and
 * cannot publish a different result.
 */
export function runMatching(
  participants: readonly CandidateParticipant[],
  strategy: MatchingStrategy,
  options: MatchingRunOptions,
  inputHash: string,
): MatchRunResult {
  const now = options.now ?? (() => Date.now());
  const startedAt = now();
  const deadline = startedAt + (options.timeBudgetMs ?? 5000);
  const context: StrategyContext = {
    constraints: options.constraints,
    reference: options.reference ?? new Date(),
  };

  const ordered = [...participants].sort((a, b) =>
    a.participantId < b.participantId ? -1 : a.participantId > b.participantId ? 1 : 0,
  );
  const ids = ordered.map((participant) => participant.participantId);
  const violations = new Set<string>();
  const edges: Edge[] = [];

  for (const [a, b] of candidatePairs(ordered.length, options.constraints)) {
    const left = ordered[a];
    const right = ordered[b];
    if (!left || !right) continue;
    const eligibility = strategy.eligiblePair(left, right, context);
    if (!eligibility.eligible) {
      for (const code of eligibility.violationCodes) violations.add(code);
      continue;
    }
    const score = strategy.scorePair(left, right, context);
    edges.push({ a, b, score: score.total, codes: strategy.explain(score) });
  }

  stableSortEdges(edges, ids);

  const matches: ProposedMatch[] = [];
  const matched = new Set<number>();
  let approximationUsed = false;
  let approximationReason: string | null = null;

  if (options.constraints.groupSize <= 2) {
    const greedy = greedyPairing(edges, ordered.length);
    const timedOut = now() > deadline;
    const { pairs, improved } = timedOut
      ? { pairs: greedy, improved: false }
      : improvePairing(greedy, ordered, strategy, context, deadline, now);

    approximationUsed = true;
    approximationReason = timedOut
      ? "time_budget_exceeded_greedy_only"
      : improved
        ? "greedy_with_two_opt_improvement"
        : "greedy_locally_optimal";

    pairs.forEach((edge, index) => {
      matched.add(edge.a);
      matched.add(edge.b);
      matches.push({
        groupKey: groupKey(index),
        memberParticipantIds: [ids[edge.a] as string, ids[edge.b] as string],
        score: Number(edge.score.toFixed(6)),
        rationaleCodes: edge.codes,
      });
    });
  } else {
    const { groups, scores, codes } = buildGroups(edges, ordered, strategy, context);
    approximationUsed = true;
    approximationReason = "greedy_set_packing";
    groups.forEach((group, index) => {
      for (const member of group) matched.add(member);
      matches.push({
        groupKey: groupKey(index),
        memberParticipantIds: group.map((member) => ids[member] as string),
        score: Number((scores[index] ?? 0).toFixed(6)),
        rationaleCodes: codes[index] ?? [],
      });
    });
  }

  const leftovers = ordered
    .map((participant, index) => ({ participant, index }))
    .filter(({ index }) => !matched.has(index));

  const unmatched: UnmatchedParticipant[] = [];

  if (leftovers.length === 1 && options.constraints.allowTriadForOddCount && matches.length > 0) {
    // A single leftover joins the pair it scores best with rather than being dropped.
    const leftover = leftovers[0];
    if (leftover) {
      let bestIndex = -1;
      let bestScore = Number.NEGATIVE_INFINITY;
      matches.forEach((match, index) => {
        const members = match.memberParticipantIds
          .map((id) => ordered.find((participant) => participant.participantId === id))
          .filter((participant): participant is CandidateParticipant => participant !== undefined);
        if (members.length === 0) return;
        let sum = 0;
        for (const member of members) {
          if (!strategy.eligiblePair(leftover.participant, member, context).eligible) return;
          sum += strategy.scorePair(leftover.participant, member, context).total;
        }
        const mean = sum / members.length;
        if (mean > bestScore + 1e-9) {
          bestScore = mean;
          bestIndex = index;
        }
      });

      const target = bestIndex >= 0 ? matches[bestIndex] : undefined;
      if (target) {
        matches[bestIndex] = {
          ...target,
          memberParticipantIds: [...target.memberParticipantIds, leftover.participant.participantId],
          score: Number(((target.score + bestScore) / 2).toFixed(6)),
          rationaleCodes: [...target.rationaleCodes, "triad_for_odd_count"],
        };
        matched.add(leftover.index);
      } else {
        unmatched.push({
          participantId: leftover.participant.participantId,
          reasonCode: "no_eligible_triad",
        });
      }
    }
  }

  for (const { participant, index } of leftovers) {
    if (matched.has(index)) continue;
    unmatched.push({
      participantId: participant.participantId,
      reasonCode: edges.some((edge) => edge.a === index || edge.b === index)
        ? "no_remaining_eligible_partner"
        : "no_eligible_candidates",
    });
  }

  return {
    matches,
    unmatched,
    diagnostics: {
      strategyKey: strategy.key,
      strategyVersion: strategy.version,
      inputHash,
      consideredParticipants: ordered.length,
      consideredEdges: edges.length,
      matchedParticipants: matched.size,
      approximationUsed,
      approximationReason,
      constraintViolations: [...violations].sort(),
      durationMs: now() - startedAt,
    },
  };
}
