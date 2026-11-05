import type { Facts } from "./evaluator.js";

export interface ParticipantFactInput {
  readonly team: string | null;
  readonly department: string | null;
  readonly geography: string | null;
  readonly timeZone: string | null;
  readonly remotePreference: string;
  readonly tenureBand: string;
  readonly languages: readonly string[];
  readonly state: string;
  readonly grantedPurposes: readonly string[];
  readonly priorMatchCount: number;
}

export interface InstanceFactInput {
  readonly phase: string;
  readonly participationMode: string;
}

/**
 * Builds the bounded fact object a rule may inspect. Anything not listed here
 * is unreachable from a pack manifest by construction.
 */
export function participantFacts(
  participant: ParticipantFactInput,
  instance: InstanceFactInput,
): Facts {
  return {
    "participant.team": participant.team ?? undefined,
    "participant.department": participant.department ?? undefined,
    "participant.geography": participant.geography ?? undefined,
    "participant.timeZone": participant.timeZone ?? undefined,
    "participant.remotePreference": participant.remotePreference,
    "participant.tenureBand": participant.tenureBand,
    "participant.languages": participant.languages,
    "participant.state": participant.state,
    "consent.scope": participant.grantedPurposes,
    "priorMatch.count": participant.priorMatchCount,
    "instance.phase": instance.phase,
    "instance.participationMode": instance.participationMode,
  };
}

export interface PairFactInput {
  readonly sameDepartment: boolean;
  readonly sameTeam: boolean;
  readonly timeZoneOverlapMinutes: number;
}

export function pairFacts(base: Facts, pair: PairFactInput): Facts {
  return {
    ...base,
    "match.sameDepartment": pair.sameDepartment,
    "match.sameTeam": pair.sameTeam,
    "match.timeZoneOverlapMinutes": pair.timeZoneOverlapMinutes,
  };
}
