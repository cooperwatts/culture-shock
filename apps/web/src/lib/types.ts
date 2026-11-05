export interface MeResponse {
  userId: string;
  displayName: string | null;
  roles: string[];
  locale: string;
  timeZone: string;
  authenticatedAt: string;
}

export interface ExperienceSummary {
  id: string;
  name: string;
  revision: number;
  updatedAt: string;
  instanceCount: number;
  latestInstanceState: string | null;
  enrolledCount: number;
}

export interface ExperienceDetail {
  id: string;
  name: string;
  description: string | null;
  definition: {
    packSlug?: string;
    packVersion?: string;
    packConfig?: Record<string, unknown>;
  };
}

export interface InstanceSummary {
  id: string;
  name: string;
  state: string;
  timeZone: string;
  startsAt: string | null;
  endsAt: string | null;
  enrollmentClosesAt: string | null;
  revision: number;
}

export interface InstanceDetail extends InstanceSummary {
  experienceId: string;
  privacyMode: string;
  revealEnabled: boolean;
  packVersion: string;
  capabilities: string[];
  participantCounts: Record<string, number>;
}

export interface ParticipantInstance {
  id: string;
  name: string;
  state: string;
  startsAt: string | null;
  endsAt: string | null;
  enrollmentClosesAt: string | null;
  participantStatus: string | null;
  privacyMode: string | null;
}

export interface PackSummary {
  id: string;
  slug: string;
  origin: string;
  enabled: boolean;
  status: string;
  latestVersion: string | null;
  pinnedVersion: string | null;
  name: string;
  summary: string;
}

export interface MatchRunDiagnostics {
  consideredParticipants: number;
  consideredEdges: number;
  matchedParticipants: number;
  approximationUsed: boolean;
  approximationReason: string | null;
  constraintViolations: string[];
  durationMs: number;
  unmatched?: Array<{ participantId: string; reasonCode: string }>;
}

export interface FairnessReport {
  minimumCohortSize: number;
  totalParticipants: number;
  totalMatched: number;
  totalUnmatched: number;
  byDepartment: Array<{
    cohort: string;
    participants: number;
    matched: number;
    suppressed: boolean;
  }>;
  byRemotePreference: Array<{
    cohort: string;
    participants: number;
    matched: number;
    suppressed: boolean;
  }>;
  repeatExposureCount: number;
  scoreDistribution: { min: number; median: number; max: number };
  warnings: string[];
}

export interface MatchRunPreview {
  runId: string;
  state: string;
  strategyKey: string;
  strategyVersion: string;
  diagnostics: MatchRunDiagnostics | null;
  fairness: FairnessReport | null;
}

export interface MyMatch {
  state: "not_published" | "published" | "hidden_by_policy";
  groupKey: string | null;
  peers: Array<{ label: string; pseudonym: string | null; revealed: boolean }>;
  missions: Array<{ key: string; title: string; dueAt: string | null }>;
}

export interface MyParticipation {
  participantId: string;
  status: string;
  joinedAt: string | null;
  preferences: Record<string, unknown> | null;
  consentVersion: string | null;
}

export interface InsightsReport {
  metricVersion: string;
  periodStart: string;
  periodEnd: string;
  minimumCohortSize: number;
  metrics: Array<{
    key: string;
    value: number | null;
    numerator: number | null;
    denominator: number | null;
    suppressed: boolean;
    qualityFlags: string[];
  }>;
  recommendations: Array<{
    code: string;
    summary: string;
    evidence: string[];
    sampleSize: number;
  }>;
}

export interface ActivityOverview {
  available: Array<{
    key: string;
    type: string;
    title: Record<string, string>;
    optional: boolean;
    maxPerParticipant: number;
  }>;
  completed: Array<{
    id: string;
    type: string;
    state: string;
    completedAt: string | null;
  }>;
}

export interface PeerOption {
  participantId: string;
  label: string;
}

export interface Recognition {
  id: string;
  direction: "sent" | "received";
  message: string | null;
  visibility: string;
  moderationState: string;
  createdAt: string;
}
