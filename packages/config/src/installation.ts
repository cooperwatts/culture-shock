import { z } from "zod";
import { brandThemeSchema } from "./theme.js";

export const INSTALLATION_CONFIG_SCHEMA_VERSION = "1.0.0";

const localeCode = z
  .string()
  .regex(/^[a-z]{2}(-[A-Z]{2})?$/, "Expected a BCP-47 locale such as en-CA");
const timeZone = z.string().min(1).max(64);
const domain = z
  .string()
  .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "Expected a DNS domain");
const httpsUrl = z
  .string()
  .url()
  .refine((value) => value.startsWith("https://"), {
    message: "Only https endpoints are permitted",
  });

/**
 * Terminology is fully organization-controlled. Keys are fixed so templates can
 * reference them; values are plain text and escaped at render time.
 */
export const terminologySchema = z.object({
  platformName: z.string().min(1).max(60).default("Culture Shock"),
  // "Organizer" rather than "Designer": this person schedules a programme and
  // reviews matches. Designing the pack itself is a separate job.
  designerSingular: z.string().min(1).max(40).default("Organizer"),
  designerPlural: z.string().min(1).max(40).default("Organizers"),
  participantSingular: z.string().min(1).max(40).default("Participant"),
  participantPlural: z.string().min(1).max(40).default("Participants"),
  experienceSingular: z.string().min(1).max(40).default("Programme"),
  experiencePlural: z.string().min(1).max(40).default("Programmes"),
  packSingular: z.string().min(1).max(40).default("Culture Pack"),
  packPlural: z.string().min(1).max(40).default("Culture Packs"),
  matchSingular: z.string().min(1).max(40).default("Connection"),
});

export const oidcProviderSchema = z.object({
  kind: z.enum(["entra-id", "google-workspace"]),
  enabled: z.boolean().default(false),
  /** Non-secret. Client secrets live only in Worker secrets. */
  issuer: httpsUrl,
  clientId: z.string().min(1).max(200),
  /** Corporate tenant/domain allowlist; an email domain alone is never identity. */
  allowedDomains: z.array(domain).max(50).default([]),
  allowedTenantIds: z.array(z.string().min(1).max(100)).max(20).default([]),
  scopes: z
    .array(z.string().min(1).max(40))
    .max(10)
    .default(["openid", "profile", "email"]),
});

export const magicLinkSchema = z.object({
  enabled: z.boolean().default(false),
  allowedDomains: z.array(domain).max(50).default([]),
  tokenTtlSeconds: z.number().int().min(60).max(900).default(900),
  requestsPerHourPerEmail: z.number().int().min(1).max(10).default(3),
});

export const authenticationSchema = z.object({
  providers: z.array(oidcProviderSchema).max(4).default([]),
  magicLink: magicLinkSchema.default({}),
  sessionTtlSeconds: z.number().int().min(300).max(86400).default(28800),
  sessionAbsoluteTtlSeconds: z
    .number()
    .int()
    .min(900)
    .max(604800)
    .default(86400),
  stepUpMaxAgeSeconds: z.number().int().min(60).max(3600).default(900),
  /** Exact same-origin redirect targets permitted after login. */
  allowedRedirectPaths: z
    .array(z.string().regex(/^\/[A-Za-z0-9\-._~/]*$/))
    .max(20)
    .default(["/"]),
});

export const AI_PURPOSES = [
  "copilot_recommendation",
  "pack_draft",
  "communication_draft",
  "gift_suggestion",
  "insight_summary",
  "matching_weight_proposal",
] as const;

export const aiPurposePolicySchema = z.object({
  enabled: z.boolean().default(false),
  providerKey: z.string().min(1).max(40),
  modelId: z.string().min(1).max(120),
  maxOutputTokens: z.number().int().min(64).max(8192).default(1024),
  /** Hard ceiling enforced per request before the provider is called. */
  maxCostUsdPerRequest: z.number().min(0).max(5).default(0.1),
  /** Highest data classification permitted to leave the installation. */
  maxClassification: z
    .enum(["public", "internal", "confidential", "participant_sensitive"])
    .default("internal"),
});

export const aiProviderSchema = z.object({
  key: z.string().min(1).max(40),
  /** `mock` answers locally without a network call and is development-only. */
  kind: z.enum([
    "openai",
    "azure-openai",
    "anthropic",
    "cloudflare-ai",
    "mock",
  ]),
  /** Non-secret endpoint metadata only; credentials come from Worker secrets. */
  baseUrl: httpsUrl.optional(),
  apiVersion: z.string().max(40).optional(),
  deployment: z.string().max(120).optional(),
  region: z.string().max(40).optional(),
  requestTimeoutMs: z.number().int().min(1000).max(60000).default(20000),
  maxRetries: z.number().int().min(0).max(3).default(2),
});

export const aiSchema = z.object({
  /** Master switch: when false every purpose falls back to manual workflows. */
  enabled: z.boolean().default(false),
  providers: z.array(aiProviderSchema).max(8).default([]),
  purposes: z.record(z.enum(AI_PURPOSES), aiPurposePolicySchema).default({}),
  /** Required acknowledgement that provider retention/DPA terms were reviewed. */
  egressReviewedBy: z.string().max(120).nullable().default(null),
  egressReviewedAt: z.string().datetime().nullable().default(null),
});

export const privacySchema = z.object({
  consentVersion: z.string().min(1).max(40).default("2026-01-01"),
  /** Minimum cohort size before any aggregate is shown. */
  minimumCohortSize: z.number().int().min(5).max(100).default(10),
  retention: z.object({
    magicLinkTokenSeconds: z.number().int().min(60).max(900).default(900),
    sessionSeconds: z.number().int().min(300).max(86400).default(86400),
    cultureProfileDaysAfterCompletion: z
      .number()
      .int()
      .min(0)
      .max(365)
      .default(90),
    conversationDaysAfterCompletion: z
      .number()
      .int()
      .min(0)
      .max(365)
      .default(30),
    auditEventDays: z.number().int().min(30).max(2555).default(365),
    aiRawContentDays: z.number().int().min(0).max(30).default(0),
  }),
  allowConversationHosting: z.boolean().default(false),
  allowRecognitionPublicVisibility: z.boolean().default(false),
});

export const notificationsSchema = z.object({
  emailEnabled: z.boolean().default(false),
  provider: z
    .enum(["none", "resend", "sendgrid", "smtp-relay", "mailchannels"])
    .default("none"),
  fromAddress: z.string().email().nullable().default(null),
  replyToAddress: z.string().email().nullable().default(null),
  maxPerParticipantPerDay: z.number().int().min(1).max(20).default(5),
  queueBatchSize: z.number().int().min(1).max(100).default(25),
  maxDeliveryAttempts: z.number().int().min(1).max(10).default(5),
});

export const culturePacksSchema = z.object({
  enabled: z
    .array(z.string().regex(/^[a-z0-9-]{3,60}$/))
    .max(50)
    .default([]),
  /** Pins a pack slug to an exact published version. */
  pinnedVersions: z.record(z.string(), z.string().max(20)).default({}),
  allowImportedPacks: z.boolean().default(false),
  allowAiGeneratedPacks: z.boolean().default(false),
  requireSignedManifests: z.boolean().default(false),
});

export const organizationSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().regex(/^[a-z0-9-]{2,60}$/),
  defaultLocale: localeCode.default("en-CA"),
  supportedLocales: z.array(localeCode).min(1).max(20).default(["en-CA"]),
  defaultTimeZone: timeZone.default("UTC"),
  supportContact: z.string().email().nullable().default(null),
});

export const installationConfigSchema = z
  .object({
    schemaVersion: z.literal(INSTALLATION_CONFIG_SCHEMA_VERSION),
    /**
     * False only during first-run bootstrap. While false the installation
     * serves the setup flow and refuses ordinary participant traffic.
     */
    setupComplete: z.boolean().default(false),
    organization: organizationSchema,
    branding: brandThemeSchema,
    terminology: terminologySchema.default({}),
    authentication: authenticationSchema,
    ai: aiSchema.default({}),
    privacy: privacySchema.default({ retention: {} }),
    notifications: notificationsSchema.default({}),
    culturePacks: culturePacksSchema.default({}),
  })
  .superRefine((config, ctx) => {
    const hasAuthMethod =
      config.authentication.providers.some((provider) => provider.enabled) ||
      config.authentication.magicLink.enabled;
    if (config.setupComplete && !hasAuthMethod) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["authentication", "providers"],
        message: "At least one authentication method must be enabled",
      });
    }
    if (
      !config.organization.supportedLocales.includes(
        config.organization.defaultLocale,
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["organization", "defaultLocale"],
        message: "Default locale must be listed in supportedLocales",
      });
    }
    if (config.ai.enabled) {
      if (!config.ai.egressReviewedBy) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ai", "egressReviewedBy"],
          message: "AI cannot be enabled before a recorded data-egress review",
        });
      }
      const providerKeys = new Set(
        config.ai.providers.map((provider) => provider.key),
      );
      for (const [purpose, policy] of Object.entries(config.ai.purposes)) {
        if (policy.enabled && !providerKeys.has(policy.providerKey)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["ai", "purposes", purpose, "providerKey"],
            message: "Purpose references an unconfigured provider",
          });
        }
      }
    }
    if (
      config.notifications.emailEnabled &&
      config.notifications.provider === "none"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["notifications", "provider"],
        message: "Email delivery requires a configured transactional provider",
      });
    }
    if (
      config.authentication.magicLink.enabled &&
      !config.notifications.emailEnabled
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["authentication", "magicLink", "enabled"],
        message: "Magic links require email delivery to be configured",
      });
    }
  });

export type InstallationConfig = z.infer<typeof installationConfigSchema>;
export type AiPurpose = (typeof AI_PURPOSES)[number];
export type AiProviderConfig = z.infer<typeof aiProviderSchema>;
export type AiPurposePolicy = z.infer<typeof aiPurposePolicySchema>;
export type Terminology = z.infer<typeof terminologySchema>;

/**
 * What `GET /branding` returns: presentation only. The shell needs this on
 * every render, so it must not be carved out of the administrator-only
 * installation config.
 */
export const brandingResponseSchema = z.object({
  branding: brandThemeSchema,
  terminology: terminologySchema,
  organizationName: z.string().max(120),
});

export type BrandingResponse = z.infer<typeof brandingResponseSchema>;

export interface ConfigValidationResult {
  readonly ok: boolean;
  readonly config: InstallationConfig | null;
  readonly issues: ReadonlyArray<{ path: string; message: string }>;
}

export function validateInstallationConfig(
  input: unknown,
): ConfigValidationResult {
  const result = installationConfigSchema.safeParse(input);
  if (result.success) {
    return { ok: true, config: result.data, issues: [] };
  }
  return {
    ok: false,
    config: null,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}
