import {
  DEFAULT_BRAND_THEME,
  INSTALLATION_CONFIG_SCHEMA_VERSION,
  installationConfigSchema,
  type InstallationConfig,
} from "@culture-shock/config";

/**
 * The configuration an installation runs on before an administrator publishes
 * one. Everything optional is off: no AI, no email, no magic links, no packs.
 */
export function defaultInstallationConfig(
  displayName: string,
  slug: string,
  locale: string,
): InstallationConfig {
  return installationConfigSchema.parse({
    schemaVersion: INSTALLATION_CONFIG_SCHEMA_VERSION,
    setupComplete: false,
    organization: {
      name: displayName,
      slug,
      defaultLocale: locale,
      supportedLocales: [locale],
      defaultTimeZone: "UTC",
    },
    branding: DEFAULT_BRAND_THEME,
    authentication: { providers: [], magicLink: { enabled: false } },
    ai: { enabled: false },
    privacy: { retention: {} },
    notifications: {},
    culturePacks: {},
  });
}
