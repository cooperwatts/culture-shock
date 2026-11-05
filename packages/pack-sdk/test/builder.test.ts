import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_KEYS,
  assembleManifest,
  buildSampleScenario,
  dryRun,
  packManifestSchema,
  validateManifest,
  type PackBlueprint,
  type PackManifest,
  type ValidationPolicy,
} from "../src/index.js";

const policy: ValidationPolicy = {
  supportedCapabilities: CAPABILITY_KEYS,
  defaultLocale: "en-CA",
  permittedDataRequirements: [
    "department",
    "team",
    "geography",
    "time_zone",
    "remote_preference",
    "tenure_band",
    "languages",
    "interests",
  ],
  allowAiAssistants: true,
  minimumCohortSize: 10,
};

function loadManifest(slug: string): PackManifest {
  const path = fileURLToPath(new URL(`../../../packs/${slug}/manifest.json`, import.meta.url));
  return packManifestSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

const blueprint: PackBlueprint = {
  slug: "retail-tech-bridge",
  name: "Retail and Technology Bridge",
  summary: "Connects store teams with the people who build the tools they use.",
  mechanic: "pair_match",
  matchingStrategyKey: "cross-functional",
  groupSize: 2,
  privacyMode: "pseudonymous",
  revealEnabled: false,
  crossDepartment: true,
  objectives: [
    {
      key: "shared_context",
      title: "Shared context",
      description: "Give each side a direct line to the other.",
      metric: "department_bridge_score",
    },
  ],
  missions: [
    {
      key: "first_call",
      title: "Compare a daily workflow",
      description: "Walk through one task each of you does every day.",
      requiredForCompletion: true,
      asynchronousAlternative: "Record a short screen walkthrough instead of meeting live.",
      dueOffsetMinutes: 20160,
    },
  ],
  activities: [
    { key: "conversation", type: "conversation", title: "Workflow conversation", optional: false, maxPerParticipant: 2 },
    { key: "survey", type: "survey", title: "Closing survey", optional: true, maxPerParticipant: 1 },
  ],
  communications: [
    {
      key: "enrollment_open",
      trigger: "enrollment_open",
      subject: "{{experience.name}} is open",
      body: "Hello {{participant.displayName}}, sign up before {{experience.enrollmentClosesAt}}. {{links.experienceUrl}}",
    },
  ],
  insightMetrics: ["participation_rate", "department_bridge_score"],
  dataRequirements: ["department", "time_zone"],
  risks: [],
};

describe("blueprint assembly", () => {
  it("produces a manifest that passes the normal validator", () => {
    const assembled = assembleManifest(blueprint, { locale: "en-CA", minimumCohortSize: 10 });
    expect(assembled.issues).toEqual([]);
    expect(assembled.ok).toBe(true);

    const validation = validateManifest(assembled.manifest, policy);
    const errors = validation.issues.filter((issue) => issue.severity === "error");
    expect(errors, JSON.stringify(errors)).toHaveLength(0);
  });

  it("derives capabilities from the blueprint rather than trusting it", () => {
    const assembled = assembleManifest(blueprint, { locale: "en-CA", minimumCohortSize: 10 });
    expect(assembled.manifest?.requiredCapabilities).toContain("matching.pair");
    expect(assembled.manifest?.requiredCapabilities).toContain("activity.conversation-prompt");
    expect(assembled.manifest?.requiredCapabilities).not.toContain("activity.gift-exchange");
  });

  it("always places a human gate on match publication", () => {
    const assembled = assembleManifest(blueprint, { locale: "en-CA", minimumCohortSize: 10 });
    const approve = assembled.manifest?.workflow.nodes.find((node) => node.action === "publish_matches");
    expect(approve?.humanGate).toBe(true);
  });

  it("never emits AI assistants in a generated pack", () => {
    const assembled = assembleManifest(blueprint, { locale: "en-CA", minimumCohortSize: 10 });
    expect(assembled.manifest?.aiAssistants).toEqual([]);
  });

  it("enforces the installation cohort floor regardless of the blueprint", () => {
    const assembled = assembleManifest(blueprint, { locale: "en-CA", minimumCohortSize: 25 });
    expect(assembled.manifest?.insights.minimumCohortSize).toBe(25);
  });

  it("rejects a mechanic and activity set that contradict each other", () => {
    const mismatched: PackBlueprint = { ...blueprint, mechanic: "recognition_only" };
    const assembled = assembleManifest(mismatched, { locale: "en-CA", minimumCohortSize: 10 });
    expect(assembled.ok).toBe(false);
    expect(assembled.issues.some((issue) => issue.code === "mechanic_activity_mismatch")).toBe(true);
  });

  it("omits reveal when the privacy mode forbids it", () => {
    const assembled = assembleManifest(
      { ...blueprint, privacyMode: "never_reveal", revealEnabled: true },
      { locale: "en-CA", minimumCohortSize: 10 },
    );
    expect(assembled.manifest?.reveal.enabled).toBe(false);
    expect(assembled.manifest?.workflow.nodes.some((node) => node.action === "reveal")).toBe(false);
  });
});

describe("dry run", () => {
  it("passes for every first-party pack", () => {
    for (const slug of ["secret-santa", "appreciation-week", "coffee-roulette", "new-hire-buddy", "cross-team-connector"]) {
      const report = dryRun(loadManifest(slug));
      const errors = report.findings.filter((finding) => finding.severity === "error");
      expect(errors, `${slug}: ${JSON.stringify(errors)}`).toHaveLength(0);
      expect(report.eligibleCount).toBeGreaterThan(0);
    }
  });

  it("reports an unsatisfiable eligibility rule instead of failing at launch", () => {
    const manifest = loadManifest("coffee-roulette");
    const broken: PackManifest = {
      ...manifest,
      eligibility: [
        {
          id: "eligibility.block-all",
          category: "eligibility",
          priority: 1,
          then: { type: "deny", code: "blocked" },
        },
      ],
    };
    const report = dryRun(broken);
    expect(report.ok).toBe(false);
    expect(report.eligibleCount).toBe(0);
    expect(report.findings.some((finding) => finding.code === "no_eligible_participants")).toBe(true);
  });

  it("renders sample messages with no unresolved placeholders", () => {
    const report = dryRun(loadManifest("secret-santa"));
    for (const sample of report.renderedSamples) {
      expect(sample.subject).not.toContain("{{");
      expect(sample.body).not.toContain("{{");
      expect(sample.body.length).toBeGreaterThan(0);
    }
  });

  it("warns when no mission offers an asynchronous alternative", () => {
    const manifest = loadManifest("coffee-roulette");
    const noAsync: PackManifest = {
      ...manifest,
      missions: manifest.missions.map(({ asynchronousAlternative: _ignored, ...rest }) => rest),
    };
    const report = dryRun(noAsync);
    expect(report.findings.some((finding) => finding.code === "no_asynchronous_alternative")).toBe(true);
  });

  it("uses a deterministic synthetic population", () => {
    expect(buildSampleScenario(10)).toEqual(buildSampleScenario(10));
    expect(buildSampleScenario(10)[0]?.id).toBe("sample-000");
  });
});
