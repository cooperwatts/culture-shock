import {
  evaluate,
  participantFacts,
  type Facts,
  type Rule,
  type RuleSet,
} from "@culture-shock/rules";
import { effectiveRuleSet, planWorkflow } from "./interpreter.js";
import type { PackManifest } from "./manifest.js";
import { renderTemplate, type TemplateValues } from "./templates.js";

/**
 * Synthetic population used by the dry run. These are generated shapes, never
 * real participants: the sandbox must never read production data.
 */
export interface SampleParticipant {
  readonly id: string;
  readonly department: string;
  readonly team: string;
  readonly geography: string;
  readonly timeZone: string;
  readonly remotePreference: "remote" | "hybrid" | "onsite";
  readonly tenureBand: "lt_3_months" | "lt_1_year" | "lt_3_years" | "gte_3_years";
  readonly grantedPurposes: readonly string[];
  readonly priorMatchCount: number;
}

const DEPARTMENTS = ["technology", "marketing", "retail", "finance", "people"];
const ZONES = ["America/Toronto", "America/Vancouver", "Europe/London", "Asia/Singapore"];
const REMOTE: Array<SampleParticipant["remotePreference"]> = ["remote", "hybrid", "onsite"];
const TENURE: Array<SampleParticipant["tenureBand"]> = [
  "lt_3_months",
  "lt_1_year",
  "lt_3_years",
  "gte_3_years",
];

export function buildSampleScenario(size = 40): SampleParticipant[] {
  return Array.from({ length: size }, (_, index) => ({
    id: `sample-${String(index).padStart(3, "0")}`,
    department: DEPARTMENTS[index % DEPARTMENTS.length] as string,
    team: `team-${index % 9}`,
    geography: index % 2 === 0 ? "ca" : "us",
    timeZone: ZONES[index % ZONES.length] as string,
    remotePreference: REMOTE[index % REMOTE.length] as SampleParticipant["remotePreference"],
    tenureBand: TENURE[index % TENURE.length] as SampleParticipant["tenureBand"],
    // Two thirds grant profile derivation, so the run exercises both paths.
    grantedPurposes: index % 3 === 0 ? ["messaging"] : ["messaging", "profile_derivation"],
    priorMatchCount: index % 4,
  }));
}

export interface DryRunFinding {
  readonly severity: "error" | "warning" | "info";
  readonly code: string;
  readonly message: string;
}

export interface DryRunReport {
  readonly ok: boolean;
  readonly sampleSize: number;
  readonly eligibleCount: number;
  readonly deniedCount: number;
  readonly denialCodes: Readonly<Record<string, number>>;
  readonly approvalCodes: readonly string[];
  readonly privacyMode: string | null;
  readonly matchingConstraints: readonly string[];
  readonly activityCapabilities: Readonly<Record<string, boolean>>;
  readonly pools: readonly string[];
  readonly scheduledActions: ReadonlyArray<{ action: string; anchor: string; offsetMinutes: number }>;
  readonly workflowOrder: readonly string[];
  readonly renderedSamples: ReadonlyArray<{ templateKey: string; locale: string; subject: string; body: string }>;
  readonly findings: readonly DryRunFinding[];
}

const SAMPLE_TEMPLATE_VALUES: TemplateValues = {
  "organization.name": "Example Corp",
  "experience.name": "Sample Run",
  "experience.startsAt": "15 March 2026",
  "experience.endsAt": "29 March 2026",
  "experience.enrollmentClosesAt": "10 March 2026",
  "experience.timeZone": "America/Toronto",
  "participant.displayName": "Sample Participant",
  "participant.pseudonym": "member-01",
  "match.peerDisplayName": "Sample Peer",
  "match.peerPseudonym": "member-02",
  "terminology.platformName": "Culture Shock",
  "terminology.participantSingular": "Participant",
  "terminology.experienceSingular": "Experience",
  "terminology.matchSingular": "Connection",
  "links.experienceUrl": "https://example.invalid/e/sample",
  "links.supportUrl": "https://example.invalid/support",
};

function factsFor(participant: SampleParticipant, phase: string): Facts {
  return participantFacts(
    {
      team: participant.team,
      department: participant.department,
      geography: participant.geography,
      timeZone: participant.timeZone,
      remotePreference: participant.remotePreference,
      tenureBand: participant.tenureBand,
      languages: ["en"],
      state: "enrolled",
      grantedPurposes: participant.grantedPurposes,
      priorMatchCount: participant.priorMatchCount,
    },
    { phase, participationMode: "optional" },
  );
}

/**
 * Executes the manifest against a synthetic population without touching any
 * stored data. A draft must pass this before an administrator can publish it.
 */
export function dryRun(
  manifest: PackManifest,
  options: { scenario?: readonly SampleParticipant[]; locale?: string; overrides?: readonly Rule[] } = {},
): DryRunReport {
  const scenario = options.scenario ?? buildSampleScenario();
  const locale = options.locale ?? "en-CA";
  const findings: DryRunFinding[] = [];

  let rules: RuleSet;
  try {
    rules = effectiveRuleSet(manifest, options.overrides ?? []);
  } catch (cause) {
    return {
      ok: false,
      sampleSize: scenario.length,
      eligibleCount: 0,
      deniedCount: scenario.length,
      denialCodes: {},
      approvalCodes: [],
      privacyMode: null,
      matchingConstraints: [],
      activityCapabilities: {},
      pools: [],
      scheduledActions: [],
      workflowOrder: [],
      renderedSamples: [],
      findings: [
        {
          severity: "error",
          code: "rules_invalid",
          message: cause instanceof Error ? cause.message : "Rule set could not be resolved",
        },
      ],
    };
  }

  const denialCodes: Record<string, number> = {};
  const approvalCodes = new Set<string>();
  const pools = new Set<string>();
  let eligibleCount = 0;
  let privacyMode: string | null = null;
  let constraints: string[] = [];
  let capabilities: Record<string, boolean> = {};
  let scheduledActions: Array<{ action: string; anchor: string; offsetMinutes: number }> = [];

  for (const participant of scenario) {
    const decision = evaluate(rules, factsFor(participant, "enrolling"));
    if (decision.allowed) eligibleCount += 1;
    for (const denial of decision.denials) {
      denialCodes[denial.code] = (denialCodes[denial.code] ?? 0) + 1;
    }
    for (const approval of decision.approvalsRequired) approvalCodes.add(approval.code);
    for (const pool of decision.pools) pools.add(pool);

    privacyMode = decision.privacyMode ?? privacyMode;
    constraints = decision.matchingConstraints.map((constraint) => constraint.constraint);
    capabilities = decision.activityCapabilities;
    scheduledActions = decision.scheduledActions.map((action) => ({
      action: action.action,
      anchor: action.anchor,
      offsetMinutes: action.offsetMinutes,
    }));
  }

  const deniedCount = scenario.length - eligibleCount;

  if (eligibleCount === 0) {
    findings.push({
      severity: "error",
      code: "no_eligible_participants",
      message: "No sample participant is eligible. The eligibility rules exclude everyone.",
    });
  } else if (eligibleCount < manifest.matching.groupSize) {
    findings.push({
      severity: "error",
      code: "below_group_size",
      message: `Only ${eligibleCount} sample participants are eligible but groups need ${manifest.matching.groupSize}.`,
    });
  } else if (eligibleCount < scenario.length / 2) {
    findings.push({
      severity: "warning",
      code: "high_exclusion_rate",
      message: `${deniedCount} of ${scenario.length} sample participants were excluded. Check the eligibility rules.`,
    });
  }

  if (privacyMode === "never_reveal" && manifest.reveal.enabled) {
    findings.push({
      severity: "error",
      code: "reveal_conflicts_with_privacy",
      message: "Reveal is enabled but the effective privacy mode is never_reveal.",
    });
  }

  let workflowOrder: string[] = [];
  try {
    workflowOrder = planWorkflow(manifest).map((step) => step.key);
  } catch (cause) {
    findings.push({
      severity: "error",
      code: "workflow_invalid",
      message: cause instanceof Error ? cause.message : "Workflow could not be planned",
    });
  }

  if (!manifest.missions.some((mission) => mission.asynchronousAlternative)) {
    findings.push({
      severity: "warning",
      code: "no_asynchronous_alternative",
      message:
        "No mission offers an asynchronous alternative. Remote and cross-time-zone participants may be excluded in practice.",
    });
  }

  const renderedSamples = manifest.communications.map((template) => ({
    templateKey: template.key,
    locale,
    subject: renderTemplate(template.subject[locale] ?? template.subject["en-CA"] ?? "", SAMPLE_TEMPLATE_VALUES),
    body: renderTemplate(template.body[locale] ?? template.body["en-CA"] ?? "", SAMPLE_TEMPLATE_VALUES),
  }));

  for (const sample of renderedSamples) {
    if (sample.subject.trim().length === 0 || sample.body.trim().length === 0) {
      findings.push({
        severity: "error",
        code: "empty_rendered_template",
        message: `Template "${sample.templateKey}" renders empty for ${locale}.`,
      });
    }
  }

  return {
    ok: !findings.some((finding) => finding.severity === "error"),
    sampleSize: scenario.length,
    eligibleCount,
    deniedCount,
    denialCodes,
    approvalCodes: [...approvalCodes],
    privacyMode,
    matchingConstraints: constraints,
    activityCapabilities: capabilities,
    pools: [...pools],
    scheduledActions,
    workflowOrder,
    renderedSamples,
    findings,
  };
}
