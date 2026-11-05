import { DomainError, type UserId } from "@culture-shock/domain";
import type { InstallationConfig } from "@culture-shock/config";
import {
  assembleManifest,
  buildSampleScenario,
  dryRun,
  type DryRunReport,
  type PackBlueprint,
  type PackManifest,
  type SampleParticipant,
  type ValidationIssue,
} from "@culture-shock/pack-sdk";
import {
  DEFAULT_CONSTRAINTS,
  defaultStrategyRegistry,
  runMatching,
  type CandidateParticipant,
} from "@culture-shock/matching";
import {
  PACK_BUILDER_PROMPT_VERSION,
  buildPackBuilderMessage,
  fallbackBlueprint,
  packBuilderInputSchema,
  packBuilderResponseSchema,
  redact,
} from "@culture-shock/ai";
import type { Env } from "../env.js";
import { Database } from "../db/database.js";
import { createOrchestrator } from "./copilot-service.js";
import { validate } from "./pack-service.js";

export interface MatchingFeasibility {
  readonly ok: boolean;
  readonly matched: number;
  readonly unmatched: number;
  readonly violationCodes: readonly string[];
  readonly note: string;
}

function toCandidate(sample: SampleParticipant): CandidateParticipant {
  return {
    participantId: sample.id,
    department: sample.department,
    team: sample.team,
    geography: sample.geography,
    timeZone: sample.timeZone,
    remotePreference: sample.remotePreference,
    tenureBand: sample.tenureBand,
    roleLevel: "unspecified",
    languages: ["en"],
    interests: [],
    priorMatchParticipantIds: [],
    capacity: 3,
    isNewHire: sample.tenureBand === "lt_3_months",
  };
}

/**
 * Confirms the manifest's constraints can actually produce groups. A pack whose
 * hard constraints leave most people unmatched is a design error, not something
 * to discover after launch.
 */
export function checkMatchingFeasibility(
  manifest: PackManifest,
  scenario: readonly SampleParticipant[],
): MatchingFeasibility {
  if (!manifest.requiredCapabilities.some((capability) => capability.startsWith("matching."))) {
    return { ok: true, matched: 0, unmatched: 0, violationCodes: [], note: "Pack does not use matching." };
  }

  const strategy = defaultStrategyRegistry.resolve(manifest.matching.strategyKey);
  const result = runMatching(
    scenario.map(toCandidate),
    strategy,
    {
      constraints: {
        ...DEFAULT_CONSTRAINTS,
        groupSize: manifest.matching.groupSize,
        allowTriadForOddCount: manifest.matching.allowTriadForOddCount,
        hardConstraints: manifest.matching.hardConstraints as typeof DEFAULT_CONSTRAINTS.hardConstraints,
      },
      reference: new Date("2026-03-10T12:00:00.000Z"),
      timeBudgetMs: 3000,
    },
    "dry-run",
  );

  const matched = result.diagnostics.matchedParticipants;
  const coverage = scenario.length === 0 ? 0 : matched / scenario.length;

  return {
    ok: coverage >= 0.6,
    matched,
    unmatched: result.unmatched.length,
    violationCodes: result.diagnostics.constraintViolations,
    note:
      coverage >= 0.6
        ? `${matched} of ${scenario.length} sample participants were matched.`
        : `Only ${matched} of ${scenario.length} sample participants could be matched. The hard constraints are probably too strict.`,
  };
}

export interface DraftReview {
  readonly ok: boolean;
  readonly manifest: PackManifest | null;
  readonly validationIssues: readonly ValidationIssue[];
  readonly dryRun: DryRunReport | null;
  readonly matching: MatchingFeasibility | null;
  readonly blockingReasons: readonly string[];
}

/**
 * The single review gate every draft must clear. Schema and capability checks,
 * the sandbox dry run, and matching feasibility all have to pass before an
 * administrator is offered the publish action.
 */
export function reviewDraft(manifest: unknown, config: InstallationConfig): DraftReview {
  const validation = validate(manifest, config);
  if (!validation.ok || !validation.manifest) {
    return {
      ok: false,
      manifest: validation.manifest,
      validationIssues: validation.issues,
      dryRun: null,
      matching: null,
      blockingReasons: ["Manifest failed schema, capability, template or privacy validation."],
    };
  }

  const scenario = buildSampleScenario();
  const simulation = dryRun(validation.manifest, {
    scenario,
    locale: config.organization.defaultLocale,
  });
  const matching = checkMatchingFeasibility(validation.manifest, scenario);

  const blockingReasons: string[] = [];
  if (!simulation.ok) blockingReasons.push("The sandbox dry run reported errors.");
  if (!matching.ok) blockingReasons.push(matching.note);

  return {
    ok: blockingReasons.length === 0,
    manifest: validation.manifest,
    validationIssues: validation.issues,
    dryRun: simulation,
    matching,
    blockingReasons,
  };
}

export interface GeneratedDraft {
  readonly source: "ai" | "deterministic_fallback";
  readonly blueprint: PackBlueprint;
  readonly rationale: string;
  readonly review: DraftReview;
  readonly provenance: Record<string, unknown> | null;
}

/**
 * Generates a draft blueprint, assembles it into a manifest, and reviews it.
 * The generator never produces structure directly and nothing is published.
 */
export async function generateDraft(input: {
  env: Env;
  config: InstallationConfig;
  db: Database;
  userId: UserId;
  existingSlugs: readonly string[];
  request: unknown;
}): Promise<GeneratedDraft> {
  if (!input.config.culturePacks.allowAiGeneratedPacks) {
    throw new DomainError("capability_disabled", "Generated Culture Packs are disabled for this installation");
  }

  const parsed = packBuilderInputSchema.parse({
    ...(input.request as object),
    existingSlugs: input.existingSlugs,
    locale: input.config.organization.defaultLocale,
  });

  const orchestrator = createOrchestrator(input.env, input.config, input.db, input.userId);
  let source: GeneratedDraft["source"] = "deterministic_fallback";
  let provenance: Record<string, unknown> | null = null;
  let result = fallbackBlueprint(parsed);
  let generatedByModel: string | undefined;

  if (orchestrator.isEnabled("pack_draft")) {
    const message = redact(buildPackBuilderMessage(parsed), "identifiers_removed");
    try {
      const generated = await orchestrator.run({
        purpose: "pack_draft",
        schema: packBuilderResponseSchema,
        schemaName: "PackBuilderResponse",
        promptVersion: PACK_BUILDER_PROMPT_VERSION,
        messages: [{ role: "user", content: message.text }],
        classification: "internal",
        consentVersion: null,
      });
      result = generated.data;
      source = "ai";
      generatedByModel = generated.provenance.modelId;
      provenance = { ...generated.provenance, redactedKinds: message.removedKinds };
    } catch {
      // A provider failure degrades to the deterministic planner rather than
      // blocking the administrator.
      source = "deterministic_fallback";
    }
  }

  if (input.existingSlugs.includes(result.blueprint.slug)) {
    throw new DomainError("conflict", "The generated pack slug is already in use", {
      slug: result.blueprint.slug,
    });
  }

  const assembled = assembleManifest(result.blueprint, {
    locale: parsed.locale,
    origin: "generated",
    minimumCohortSize: input.config.privacy.minimumCohortSize,
    ...(generatedByModel ? { generatedByModel } : {}),
  });

  if (!assembled.ok || !assembled.manifest) {
    return {
      source,
      blueprint: result.blueprint,
      rationale: result.rationale,
      provenance,
      review: {
        ok: false,
        manifest: null,
        validationIssues: assembled.issues.map((issue) => ({
          severity: "error" as const,
          code: issue.code,
          message: issue.message,
          path: "blueprint",
        })),
        dryRun: null,
        matching: null,
        blockingReasons: ["The blueprint could not be assembled into a valid manifest."],
      },
    };
  }

  return {
    source,
    blueprint: result.blueprint,
    rationale: result.rationale,
    provenance,
    review: reviewDraft(assembled.manifest, input.config),
  };
}
