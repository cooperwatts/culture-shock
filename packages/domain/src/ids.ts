/**
 * Opaque, prefixed identifiers. Identifiers are never derived from email or any
 * other participant attribute, so they leak nothing when logged or exported.
 */

declare const brand: unique symbol;

type Branded<T, B extends string> = T & { readonly [brand]: B };

export type OrganizationId = Branded<string, "OrganizationId">;
export type UserId = Branded<string, "UserId">;
export type IdentityProviderId = Branded<string, "IdentityProviderId">;
export type IdentityId = Branded<string, "IdentityId">;
export type SessionId = Branded<string, "SessionId">;
export type RoleGrantId = Branded<string, "RoleGrantId">;
export type BrandThemeId = Branded<string, "BrandThemeId">;
export type ConfigurationId = Branded<string, "ConfigurationId">;
export type CulturePackId = Branded<string, "CulturePackId">;
export type CulturePackTemplateId = Branded<string, "CulturePackTemplateId">;
export type PackDraftId = Branded<string, "PackDraftId">;
export type ExperienceId = Branded<string, "ExperienceId">;
export type ExperienceInstanceId = Branded<string, "ExperienceInstanceId">;
export type ParticipantId = Branded<string, "ParticipantId">;
export type ParticipantProfileId = Branded<string, "ParticipantProfileId">;
export type CultureProfileId = Branded<string, "CultureProfileId">;
export type RuleSetId = Branded<string, "RuleSetId">;
export type MatchingStrategyId = Branded<string, "MatchingStrategyId">;
export type MatchRunId = Branded<string, "MatchRunId">;
export type MatchId = Branded<string, "MatchId">;
export type MissionId = Branded<string, "MissionId">;
export type ActivityId = Branded<string, "ActivityId">;
export type ConversationId = Branded<string, "ConversationId">;
export type ClueId = Branded<string, "ClueId">;
export type RecognitionId = Branded<string, "RecognitionId">;
export type RevealId = Branded<string, "RevealId">;
export type NotificationId = Branded<string, "NotificationId">;
export type AnalyticsSnapshotId = Branded<string, "AnalyticsSnapshotId">;
export type AiInteractionId = Branded<string, "AiInteractionId">;
export type AuditEventId = Branded<string, "AuditEventId">;
export type OutboxEventId = Branded<string, "OutboxEventId">;
export type R2ObjectId = Branded<string, "R2ObjectId">;

export const ID_PREFIXES = {
  OrganizationId: "org",
  UserId: "usr",
  IdentityProviderId: "idp",
  IdentityId: "idn",
  SessionId: "ses",
  RoleGrantId: "rgr",
  BrandThemeId: "thm",
  ConfigurationId: "cfg",
  CulturePackId: "pak",
  CulturePackTemplateId: "ptl",
  PackDraftId: "pdr",
  ExperienceId: "exp",
  ExperienceInstanceId: "ins",
  ParticipantId: "par",
  ParticipantProfileId: "ppr",
  CultureProfileId: "cpr",
  RuleSetId: "rst",
  MatchingStrategyId: "mst",
  MatchRunId: "mrn",
  MatchId: "mat",
  MissionId: "msn",
  ActivityId: "act",
  ConversationId: "cnv",
  ClueId: "clu",
  RecognitionId: "rec",
  RevealId: "rvl",
  NotificationId: "ntf",
  AnalyticsSnapshotId: "ans",
  AiInteractionId: "aii",
  AuditEventId: "aud",
  OutboxEventId: "obx",
  R2ObjectId: "obj",
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

const ID_BODY = /^[0-9a-f]{32}$/;

/** Generates a collision-resistant opaque id: `<prefix>_<32 hex chars>`. */
export function newId<K extends IdKind>(kind: K): Branded<string, K> {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let body = "";
  for (const byte of bytes) body += byte.toString(16).padStart(2, "0");
  return `${ID_PREFIXES[kind]}_${body}` as Branded<string, K>;
}

export function isId<K extends IdKind>(kind: K, value: unknown): value is Branded<string, K> {
  if (typeof value !== "string") return false;
  const prefix = ID_PREFIXES[kind];
  return value.startsWith(`${prefix}_`) && ID_BODY.test(value.slice(prefix.length + 1));
}

/**
 * Asserts and narrows an untrusted string into a branded id. Repository and
 * route boundaries must call this instead of casting.
 */
export function assertId<K extends IdKind>(kind: K, value: unknown): Branded<string, K> {
  if (!isId(kind, value)) {
    throw new TypeError(`Expected ${kind} identifier`);
  }
  return value;
}
