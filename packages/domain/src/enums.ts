export const INSTALLATION_ROLES = ["admin", "designer", "participant", "support_readonly"] as const;
export type InstallationRole = (typeof INSTALLATION_ROLES)[number];

export const EXPERIENCE_ROLES = ["experience_owner", "experience_editor", "experience_viewer"] as const;
export type ExperienceRole = (typeof EXPERIENCE_ROLES)[number];

export const SCOPE_TYPES = ["installation", "experience", "instance"] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

export const IDENTITY_PROVIDER_KINDS = ["entra-id", "google-workspace", "magic-link"] as const;
export type IdentityProviderKind = (typeof IDENTITY_PROVIDER_KINDS)[number];

export const EXPERIENCE_INSTANCE_STATES = [
  "draft",
  "enrolling",
  "locked",
  "active",
  "reveal_pending",
  "completed",
  "cancelled",
  "archived",
] as const;
export type ExperienceInstanceState = (typeof EXPERIENCE_INSTANCE_STATES)[number];

export const PARTICIPANT_STATES = ["invited", "enrolled", "withdrawn", "excluded"] as const;
export type ParticipantState = (typeof PARTICIPANT_STATES)[number];

export const PARTICIPATION_MODES = ["mandatory", "optional", "invite_only"] as const;
export type ParticipationMode = (typeof PARTICIPATION_MODES)[number];

export const PRIVACY_MODES = ["anonymous", "pseudonymous", "reveal_at_end", "never_reveal"] as const;
export type PrivacyMode = (typeof PRIVACY_MODES)[number];

export const REMOTE_PREFERENCES = ["remote", "hybrid", "onsite", "unspecified"] as const;
export type RemotePreference = (typeof REMOTE_PREFERENCES)[number];

export const TENURE_BANDS = ["lt_3_months", "lt_1_year", "lt_3_years", "gte_3_years", "unspecified"] as const;
export type TenureBand = (typeof TENURE_BANDS)[number];

export const PACK_ORIGINS = ["builtin", "imported", "generated"] as const;
export type PackOrigin = (typeof PACK_ORIGINS)[number];

export const PACK_TEMPLATE_STATES = ["draft", "published", "retired"] as const;
export type PackTemplateState = (typeof PACK_TEMPLATE_STATES)[number];

export const MATCH_RUN_STATES = ["queued", "running", "preview", "published", "failed", "cancelled"] as const;
export type MatchRunState = (typeof MATCH_RUN_STATES)[number];

export const CONSENT_PURPOSES = [
  "profile_derivation",
  "ai_processing",
  "messaging",
  "insights_survey",
] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export const DATA_CLASSIFICATIONS = ["public", "internal", "confidential", "participant_sensitive"] as const;
export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];

export const NOTIFICATION_CHANNELS = ["email", "in_app"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const ACTOR_KINDS = ["user", "system", "job", "ai"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];
