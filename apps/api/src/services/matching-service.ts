import {
  DomainError,
  enrollmentOpen,
  type ExperienceInstanceId,
  type ExperienceInstanceState,
  type UserId,
} from "@culture-shock/domain";
import {
  DEFAULT_CONSTRAINTS,
  buildFairnessReport,
  defaultStrategyRegistry,
  runMatching,
  type CandidateParticipant,
  type MatchingConstraints,
} from "@culture-shock/matching";
import type { PackManifest } from "@culture-shock/pack-sdk";
import type { InstallationConfig } from "@culture-shock/config";
import { Database, parseJson } from "../db/database.js";
import { MatchRunRepository } from "../db/match-runs.js";
import { InstanceRepository, ParticipantRepository } from "../db/repositories.js";
import { stableHash } from "@culture-shock/crypto";

interface StoredPreferences {
  timeZone?: string;
  remotePreference?: string;
  department?: string | null;
  team?: string | null;
  geography?: string | null;
  tenureBand?: string;
  interests?: string[];
  languages?: string[];
  roleLevel?: string;
}

interface StoredConsent {
  profile_derivation?: boolean;
}

/**
 * Builds the immutable matching snapshot. Only enrolled participants are
 * included, and optional attributes are only read when the participant granted
 * profile-derivation consent; otherwise they score neutrally.
 */
export async function buildCandidateSnapshot(
  db: Database,
  instanceId: ExperienceInstanceId,
): Promise<CandidateParticipant[]> {
  const participants = new ParticipantRepository(db);
  const enrolled = await participants.listEnrolled(instanceId);
  const priorPartners = await participants.priorMatchPartners(instanceId);

  const candidates: CandidateParticipant[] = [];
  for (const row of enrolled) {
    const profile = await participants.latestProfile(row.id as never);
    const consent = parseJson<StoredConsent>(profile?.consent_json, {});
    const preferences = consent.profile_derivation
      ? parseJson<StoredPreferences>(profile?.preferences_json, {})
      : {};

    candidates.push({
      participantId: row.id,
      department: preferences.department ?? null,
      team: preferences.team ?? null,
      geography: preferences.geography ?? null,
      timeZone: preferences.timeZone ?? null,
      remotePreference: (preferences.remotePreference as CandidateParticipant["remotePreference"]) ?? "unspecified",
      tenureBand: (preferences.tenureBand as CandidateParticipant["tenureBand"]) ?? "unspecified",
      roleLevel: (preferences.roleLevel as CandidateParticipant["roleLevel"]) ?? "unspecified",
      languages: preferences.languages ?? [],
      interests: preferences.interests ?? [],
      priorMatchParticipantIds: priorPartners.get(row.id) ?? [],
      capacity: 3,
      isNewHire: preferences.tenureBand === "lt_3_months",
    });
  }
  return candidates;
}

export function constraintsFromManifest(
  manifest: PackManifest,
  overrides: Record<string, number> = {},
): MatchingConstraints {
  return {
    ...DEFAULT_CONSTRAINTS,
    groupSize: manifest.matching.groupSize,
    allowTriadForOddCount: manifest.matching.allowTriadForOddCount,
    hardConstraints: manifest.matching.hardConstraints as MatchingConstraints["hardConstraints"],
    weights: { ...manifest.matching.weights, ...overrides },
  };
}

export interface PreviewResult {
  readonly runId: string;
  readonly state: string;
  readonly strategyKey: string;
  readonly strategyVersion: string;
  readonly diagnostics: unknown;
  readonly fairness: unknown;
}

/**
 * Produces a preview run. Matching never publishes: a designer must approve the
 * result, and re-running with the same snapshot reuses the stored run.
 */
export async function previewMatchRun(input: {
  db: Database;
  instanceId: ExperienceInstanceId;
  manifest: PackManifest;
  config: InstallationConfig;
  strategyKey: string;
  strategyVersion?: string;
  weightOverrides: Record<string, number>;
  actorUserId: UserId;
}): Promise<PreviewResult> {
  const instances = new InstanceRepository(input.db);
  const instance = await instances.requireById(input.instanceId);
  const state = instance.state as ExperienceInstanceState;

  if (enrollmentOpen(state)) {
    throw new DomainError(
      "invalid_state_transition",
      "Enrollment must close before matching can run",
    );
  }
  if (state !== "locked") {
    throw new DomainError("invalid_state_transition", "Matching can only run on a locked instance");
  }

  const strategy = defaultStrategyRegistry.resolve(input.strategyKey, input.strategyVersion);
  if (!strategy.supportedGroupSizes.includes(input.manifest.matching.groupSize)) {
    throw new DomainError("policy_violation", "Strategy does not support the configured group size", {
      strategyKey: strategy.key,
      groupSize: input.manifest.matching.groupSize,
    });
  }

  const candidates = await buildCandidateSnapshot(input.db, input.instanceId);
  if (candidates.length < 2) {
    throw new DomainError("conflict", "At least two enrolled participants are required");
  }

  const constraints = constraintsFromManifest(input.manifest, input.weightOverrides);
  const inputHash = await stableHash({
    participants: candidates.map((candidate) => ({
      id: candidate.participantId,
      department: candidate.department,
      team: candidate.team,
      timeZone: candidate.timeZone,
      remotePreference: candidate.remotePreference,
      tenureBand: candidate.tenureBand,
      prior: [...candidate.priorMatchParticipantIds].sort(),
    })),
    constraints,
    strategy: `${strategy.key}@${strategy.version}`,
  });

  const runs = new MatchRunRepository(input.db);
  const strategyId = await runs.ensureStrategy({
    instanceId: input.instanceId,
    strategyKey: strategy.key,
    strategyVersion: strategy.version,
    weights: constraints.weights,
    constraints,
  });

  const existing = await runs.findByInput(input.instanceId, strategyId, inputHash);
  if (existing) {
    return {
      runId: existing.id,
      state: existing.state,
      strategyKey: strategy.key,
      strategyVersion: strategy.version,
      diagnostics: parseJson<unknown>(existing.diagnostics_json, null),
      fairness: parseJson<unknown>(existing.fairness_json, null),
    };
  }

  const result = runMatching(
    candidates,
    strategy,
    { constraints, reference: new Date(instance.start_at ?? Date.now()), timeBudgetMs: 10_000 },
    inputHash,
  );
  const fairness = buildFairnessReport(candidates, result, input.config.privacy.minimumCohortSize);

  const runId = await runs.savePreview({
    instanceId: input.instanceId,
    strategyId,
    inputHash,
    result,
    fairness,
    actorUserId: input.actorUserId,
  });

  return {
    runId,
    state: "preview",
    strategyKey: strategy.key,
    strategyVersion: strategy.version,
    diagnostics: { ...result.diagnostics, unmatched: result.unmatched },
    fairness,
  };
}
