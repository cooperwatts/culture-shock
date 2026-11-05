import { describe, expect, it } from "vitest";
import { analyzeRuleSet, evaluate, participantFacts, type RuleSet } from "../src/index.js";

const facts = participantFacts(
  {
    team: "payments",
    department: "technology",
    geography: "ca-on",
    timeZone: "America/Toronto",
    remotePreference: "remote",
    tenureBand: "lt_1_year",
    languages: ["en", "fr"],
    state: "enrolled",
    grantedPurposes: ["messaging"],
    priorMatchCount: 2,
  },
  { phase: "enrolling", participationMode: "optional" },
);

describe("rule evaluation", () => {
  it("denies when a higher-authority rule denies, regardless of priority", () => {
    const rules: RuleSet = [
      {
        id: "activity.allow-everything",
        category: "activity",
        priority: 1,
        then: { type: "allow", code: "activity_ok" },
      },
      {
        id: "privacy.block-unconsented",
        category: "privacy",
        priority: 999,
        when: { field: "consent.scope", op: "contains", value: "ai_processing" },
        then: { type: "deny", code: "no_ai_consent" },
      },
    ];

    const withConsent = evaluate(rules, { ...facts, "consent.scope": ["ai_processing"] });
    expect(withConsent.allowed).toBe(false);
    expect(withConsent.denials[0]?.code).toBe("no_ai_consent");

    const withoutConsent = evaluate(rules, facts);
    expect(withoutConsent.allowed).toBe(true);
  });

  it("does not let a lower-authority allow override a higher-authority deny", () => {
    const rules: RuleSet = [
      { id: "installation_safety.deny", category: "installation_safety", priority: 1, then: { type: "deny", code: "blocked" } },
      { id: "matching.allow", category: "matching", priority: 1, then: { type: "allow", code: "ok" } },
    ];
    expect(evaluate(rules, facts).allowed).toBe(false);
  });

  it("keeps a high-authority capability disabled when a lower rule re-enables it", () => {
    const rules: RuleSet = [
      {
        id: "installation_safety.no-address",
        category: "installation_safety",
        priority: 1,
        then: { type: "setActivityCapability", capability: "address-collection", enabled: false },
      },
      {
        id: "activity.enable-address",
        category: "activity",
        priority: 1,
        then: { type: "setActivityCapability", capability: "address-collection", enabled: true },
      },
    ];
    expect(evaluate(rules, facts).activityCapabilities["address-collection"]).toBe(false);
  });

  it("treats a missing optional fact as unmatched rather than a default match", () => {
    const rules: RuleSet = [
      {
        id: "eligibility.requires-department",
        category: "eligibility",
        priority: 1,
        when: { field: "participant.department", op: "eq", value: "technology" },
        then: { type: "deny", code: "department_excluded" },
      },
    ];
    expect(evaluate(rules, { ...facts, "participant.department": undefined }).allowed).toBe(true);
  });

  it("evaluates nested boolean predicates", () => {
    const rules: RuleSet = [
      {
        id: "inclusion.async-pool",
        category: "inclusion",
        priority: 1,
        when: {
          all: [
            { field: "participant.remotePreference", op: "eq", value: "remote" },
            { not: { field: "participant.tenureBand", op: "eq", value: "gte_3_years" } },
          ],
        },
        then: { type: "setPool", pool: "asynchronous" },
      },
    ];
    expect(evaluate(rules, facts).pools).toEqual(["asynchronous"]);
  });
});

describe("rule set analysis", () => {
  it("reports contradictory matching constraints", () => {
    const result = analyzeRuleSet([
      { id: "matching.same", category: "matching", priority: 1, then: { type: "setMatchingConstraint", constraint: "same_department" } },
      { id: "matching.diff", category: "matching", priority: 1, then: { type: "setMatchingConstraint", constraint: "different_department" } },
    ]);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === "contradictory_matching_constraint")).toBe(true);
  });

  it("rejects a reveal scheduled under never_reveal", () => {
    const result = analyzeRuleSet([
      { id: "privacy.never", category: "privacy", priority: 1, then: { type: "setPrivacyMode", mode: "never_reveal" } },
      {
        id: "schedule.reveal",
        category: "schedule",
        priority: 1,
        then: { type: "scheduleRelativeAction", action: "reveal", anchor: "instance_end", offsetMinutes: 0 },
      },
    ]);
    expect(result.issues.some((issue) => issue.code === "reveal_conflicts_with_privacy")).toBe(true);
  });

  it("rejects a predicate nested beyond the depth limit", () => {
    const deep = {
      id: "matching.deep",
      category: "matching",
      priority: 1,
      when: {
        all: [{ all: [{ all: [{ all: [{ all: [{ field: "participant.team", op: "eq", value: "x" }] }] }] }] }],
      },
      then: { type: "allow" },
    };
    expect(analyzeRuleSet([deep]).ok).toBe(false);
  });

  it("rejects an unknown fact field", () => {
    const result = analyzeRuleSet([
      {
        id: "matching.unknown-field",
        category: "matching",
        priority: 1,
        when: { field: "participant.salary", op: "gte", value: 1 },
        then: { type: "allow" },
      },
    ]);
    expect(result.ok).toBe(false);
  });
});
