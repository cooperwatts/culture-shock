import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONSTRAINTS,
  buildFairnessReport,
  defaultStrategyRegistry,
  runMatching,
  type CandidateParticipant,
} from "../src/index.js";

const DEPARTMENTS = ["technology", "marketing", "retail", "finance", "people"];
const ZONES = ["America/Toronto", "America/Vancouver", "Europe/London", "Asia/Singapore"];

function participant(index: number, overrides: Partial<CandidateParticipant> = {}): CandidateParticipant {
  return {
    participantId: `par_${index.toString(16).padStart(32, "0")}`,
    department: DEPARTMENTS[index % DEPARTMENTS.length] ?? null,
    team: `team-${index % 17}`,
    geography: index % 2 === 0 ? "ca" : "us",
    timeZone: ZONES[index % ZONES.length] ?? null,
    remotePreference: index % 3 === 0 ? "remote" : index % 3 === 1 ? "hybrid" : "onsite",
    tenureBand: index % 4 === 0 ? "lt_3_months" : "gte_3_years",
    roleLevel: index % 11 === 0 ? "manager" : "individual",
    languages: ["en"],
    interests: [`topic-${index % 7}`, `topic-${index % 5}`],
    priorMatchParticipantIds: [],
    capacity: 3,
    isNewHire: index % 4 === 0,
    ...overrides,
  };
}

const reference = new Date("2026-03-10T12:00:00.000Z");

describe("matching pipeline", () => {
  const strategy = defaultStrategyRegistry.resolve("cross-functional");

  it("never matches a participant with themselves and never repeats a member", () => {
    const people = Array.from({ length: 40 }, (_, index) => participant(index));
    const result = runMatching(people, strategy, { constraints: DEFAULT_CONSTRAINTS, reference }, "hash-1");

    const seen = new Set<string>();
    for (const match of result.matches) {
      expect(new Set(match.memberParticipantIds).size).toBe(match.memberParticipantIds.length);
      for (const id of match.memberParticipantIds) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
  });

  it("is deterministic for the same input", () => {
    const people = Array.from({ length: 30 }, (_, index) => participant(index));
    const first = runMatching(people, strategy, { constraints: DEFAULT_CONSTRAINTS, reference }, "hash-2");
    const second = runMatching([...people].reverse(), strategy, { constraints: DEFAULT_CONSTRAINTS, reference }, "hash-2");
    expect(first.matches).toEqual(second.matches);
  });

  it("honours a prohibited repeat as a hard constraint", () => {
    const a = participant(1);
    const b = participant(2, { priorMatchParticipantIds: [a.participantId] });
    const c = participant(3);
    const result = runMatching([a, b, { ...c }], strategy, { constraints: DEFAULT_CONSTRAINTS, reference }, "hash-3");
    const pairedTogether = result.matches.some(
      (match) =>
        match.memberParticipantIds.includes(a.participantId) &&
        match.memberParticipantIds.includes(b.participantId),
    );
    expect(pairedTogether).toBe(false);
  });

  it("reports an unpaired participant rather than silently dropping them", () => {
    const people = Array.from({ length: 11 }, (_, index) => participant(index));
    const result = runMatching(people, strategy, { constraints: DEFAULT_CONSTRAINTS, reference }, "hash-4");
    expect(result.matches.length * 2 + result.unmatched.length).toBe(11);
    expect(result.unmatched).toHaveLength(1);
    expect(result.unmatched[0]?.reasonCode).toBeTruthy();
  });

  it("forms a triad for an odd count when the pack allows it", () => {
    const people = Array.from({ length: 11 }, (_, index) => participant(index));
    const result = runMatching(
      people,
      strategy,
      { constraints: { ...DEFAULT_CONSTRAINTS, allowTriadForOddCount: true }, reference },
      "hash-5",
    );
    expect(result.unmatched).toHaveLength(0);
    expect(result.matches.some((match) => match.memberParticipantIds.length === 3)).toBe(true);
  });

  it("enforces different-department as a hard constraint", () => {
    const people = Array.from({ length: 20 }, (_, index) => participant(index));
    const result = runMatching(
      people,
      strategy,
      {
        constraints: { ...DEFAULT_CONSTRAINTS, hardConstraints: ["no_self_match", "different_department"] },
        reference,
      },
      "hash-6",
    );
    const byId = new Map(people.map((person) => [person.participantId, person]));
    for (const match of result.matches) {
      const departments = match.memberParticipantIds.map((id) => byId.get(id)?.department);
      expect(new Set(departments).size).toBe(departments.length);
    }
  });

  it("bounds candidate generation for a large population", () => {
    const people = Array.from({ length: 1200 }, (_, index) => participant(index));
    const result = runMatching(people, strategy, { constraints: DEFAULT_CONSTRAINTS, reference }, "hash-7");
    // Exhaustive enumeration would be 719,400 edges.
    expect(result.diagnostics.consideredEdges).toBeLessThan(1200 * DEFAULT_CONSTRAINTS.maxCandidatesPerParticipant);
    expect(result.diagnostics.matchedParticipants).toBeGreaterThan(1000);
  });

  it("requires exactly one new hire for the buddy strategy", () => {
    const buddyStrategy = defaultStrategyRegistry.resolve("new-hire-friendly");
    const people = Array.from({ length: 20 }, (_, index) => participant(index));
    const result = runMatching(people, buddyStrategy, { constraints: DEFAULT_CONSTRAINTS, reference }, "hash-8");
    const byId = new Map(people.map((person) => [person.participantId, person]));
    for (const match of result.matches) {
      const newHires = match.memberParticipantIds.filter((id) => byId.get(id)?.isNewHire);
      expect(newHires).toHaveLength(1);
    }
  });
});

describe("fairness report", () => {
  it("suppresses cohorts below the minimum size", () => {
    const people = Array.from({ length: 24 }, (_, index) => participant(index));
    const strategy = defaultStrategyRegistry.resolve("cross-functional");
    const result = runMatching(people, strategy, { constraints: DEFAULT_CONSTRAINTS, reference }, "hash-9");
    const report = buildFairnessReport(people, result, 10);

    for (const row of report.byDepartment) {
      // Each department bucket holds about five people, so all must be suppressed.
      expect(row.suppressed).toBe(true);
      expect(row.participants).toBe(0);
    }
    expect(report.totalParticipants).toBe(24);
  });
});
