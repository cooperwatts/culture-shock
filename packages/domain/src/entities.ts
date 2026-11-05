import type {
  ActorKind,
  ConsentPurpose,
  DataClassification,
  ExperienceInstanceState,
  IdentityProviderKind,
  InstallationRole,
  MatchRunState,
  PackOrigin,
  PackTemplateState,
  ParticipantState,
  PrivacyMode,
  RemotePreference,
  ScopeType,
  TenureBand,
} from "./enums.js";
import type {
  ActivityId,
  AuditEventId,
  CulturePackId,
  CulturePackTemplateId,
  ExperienceId,
  ExperienceInstanceId,
  IdentityProviderId,
  MatchId,
  MatchRunId,
  OrganizationId,
  OutboxEventId,
  ParticipantId,
  ParticipantProfileId,
  RoleGrantId,
  SessionId,
  UserId,
} from "./ids.js";

export interface Timestamps {
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OrganizationScoped {
  readonly organizationId: OrganizationId;
}

export interface Organization extends Timestamps {
  readonly id: OrganizationId;
  readonly slug: string;
  readonly displayName: string;
  readonly locale: string;
  readonly status: "active" | "suspended";
}

export interface User extends OrganizationScoped, Timestamps {
  readonly id: UserId;
  readonly status: "active" | "disabled" | "deleted";
  readonly displayName: string | null;
  /** Work email is stored encrypted; only the HMAC is indexed for lookup. */
  readonly hasWorkEmail: boolean;
  readonly deletedAt: string | null;
}

export interface IdentityProvider extends OrganizationScoped, Timestamps {
  readonly id: IdentityProviderId;
  readonly kind: IdentityProviderKind;
  readonly issuer: string | null;
  readonly clientId: string | null;
  readonly enabled: boolean;
  readonly configVersion: number;
  /** Corporate tenant/domain allowlist; email domain alone is never identity. */
  readonly allowedDomains: readonly string[];
}

export interface RoleGrant extends OrganizationScoped, Timestamps {
  readonly id: RoleGrantId;
  readonly userId: UserId;
  readonly role: InstallationRole | string;
  readonly scopeType: ScopeType;
  readonly scopeId: string | null;
}

export interface Session extends OrganizationScoped {
  readonly id: SessionId;
  readonly userId: UserId;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  readonly lastSeenAt: string;
  readonly authenticatedAt: string;
}

export interface CulturePack extends OrganizationScoped, Timestamps {
  readonly id: CulturePackId;
  readonly slug: string;
  readonly origin: PackOrigin;
  readonly status: "active" | "retired";
  readonly enabled: boolean;
  readonly pinnedVersion: string | null;
}

export interface CulturePackTemplate extends OrganizationScoped, Timestamps {
  readonly id: CulturePackTemplateId;
  readonly packId: CulturePackId;
  readonly version: string;
  readonly schemaVersion: string;
  readonly checksum: string;
  readonly state: PackTemplateState;
  readonly provenance: PackProvenance;
}

export interface PackProvenance {
  readonly origin: PackOrigin;
  readonly authorUserId: UserId | null;
  readonly generatedBy: string | null;
  readonly approvedByUserId: UserId | null;
  readonly approvedAt: string | null;
}

export interface Experience extends OrganizationScoped, Timestamps {
  readonly id: ExperienceId;
  readonly designerUserId: UserId;
  readonly name: string;
  readonly currentRevision: number;
  readonly state: "draft" | "validated" | "ready" | "archived";
}

export interface ExperienceInstance extends OrganizationScoped, Timestamps {
  readonly id: ExperienceInstanceId;
  readonly experienceId: ExperienceId;
  readonly packTemplateId: CulturePackTemplateId;
  readonly name: string;
  readonly state: ExperienceInstanceState;
  readonly timeZone: string;
  readonly enrollmentClosesAt: string | null;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly publishedAt: string | null;
  readonly revision: number;
}

export interface Participant extends OrganizationScoped, Timestamps {
  readonly id: ParticipantId;
  readonly instanceId: ExperienceInstanceId;
  readonly userId: UserId;
  readonly status: ParticipantState;
  readonly joinedAt: string | null;
  readonly withdrawnAt: string | null;
}

export interface ParticipantPreferences {
  readonly timeZone: string;
  readonly remotePreference: RemotePreference;
  readonly department: string | null;
  readonly team: string | null;
  readonly geography: string | null;
  readonly tenureBand: TenureBand;
  readonly interests: readonly string[];
  readonly languages: readonly string[];
  /** Scheduling/format constraints only; never the underlying accommodation. */
  readonly schedulingConstraints: readonly string[];
}

export interface ParticipantProfile extends OrganizationScoped, Timestamps {
  readonly id: ParticipantProfileId;
  readonly participantId: ParticipantId;
  readonly revision: number;
  readonly preferences: ParticipantPreferences;
  readonly consentVersion: string;
  readonly grantedPurposes: readonly ConsentPurpose[];
  readonly expiresAt: string | null;
}

export interface MatchRun extends OrganizationScoped, Timestamps {
  readonly id: MatchRunId;
  readonly instanceId: ExperienceInstanceId;
  readonly strategyKey: string;
  readonly strategyVersion: string;
  readonly inputHash: string;
  readonly state: MatchRunState;
  readonly approvedByUserId: UserId | null;
  readonly publishedAt: string | null;
}

export interface Match extends OrganizationScoped {
  readonly id: MatchId;
  readonly runId: MatchRunId;
  readonly instanceId: ExperienceInstanceId;
  readonly groupKey: string;
  readonly state: "proposed" | "published" | "remediated" | "void";
  readonly score: number;
  /** Stable codes only; never participant attributes or free text. */
  readonly rationaleCodes: readonly string[];
  readonly memberParticipantIds: readonly ParticipantId[];
}

export interface Activity extends OrganizationScoped, Timestamps {
  readonly id: ActivityId;
  readonly instanceId: ExperienceInstanceId;
  readonly participantId: ParticipantId | null;
  readonly type: string;
  readonly state: "pending" | "completed" | "skipped" | "expired";
  readonly completedAt: string | null;
}

export interface AuditEvent extends OrganizationScoped {
  readonly id: AuditEventId;
  readonly actorUserId: UserId | null;
  readonly actorKind: ActorKind;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly purpose: string;
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
  readonly occurredAt: string;
}

export interface OutboxEvent extends OrganizationScoped {
  readonly id: OutboxEventId;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  /** References only; participant data never travels through the queue body. */
  readonly payload: Readonly<Record<string, string | number | boolean | null>>;
  readonly occurredAt: string;
  readonly availableAt: string;
  readonly publishedAt: string | null;
  readonly attempts: number;
  readonly leaseUntil: string | null;
}

export interface InstanceSnapshot {
  readonly packTemplateId: CulturePackTemplateId;
  readonly packVersion: string;
  readonly schemaVersion: string;
  readonly capabilities: readonly string[];
  readonly privacyMode: PrivacyMode;
  readonly revealEnabled: boolean;
  readonly consentVersion: string;
  readonly classification: DataClassification;
  readonly packConfig: Readonly<Record<string, unknown>>;
}
