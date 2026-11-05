import {
  DEFAULT_BRAND_THEME,
  INSTALLATION_CONFIG_SCHEMA_VERSION,
  installationConfigSchema,
  type InstallationConfig,
} from "@culture-shock/config";
import type { JobsEnv } from "./outbox.js";
import { loggerFor } from "./log.js";

export interface Installation {
  readonly organizationId: string;
  readonly config: InstallationConfig;
}

/**
 * Jobs read the same published configuration the API serves. A missing or
 * invalid configuration means the installation is not ready, so background work
 * is skipped rather than run against assumed defaults.
 */
export async function loadInstallation(env: JobsEnv): Promise<Installation | null> {
  const organization = await env.DB.prepare(
    `SELECT id, slug, display_name, locale FROM organizations WHERE status = 'active' LIMIT 1`,
  ).first<{ id: string; slug: string; display_name: string; locale: string }>();

  if (!organization) return null;

  const row = await env.DB.prepare(
    `SELECT config_json FROM configurations
      WHERE organization_id = ? AND scope = 'installation' AND status = 'published'
      ORDER BY revision DESC LIMIT 1`,
  )
    .bind(organization.id)
    .first<{ config_json: string }>();

  if (!row) return null;

  const parsed = installationConfigSchema.safeParse(JSON.parse(row.config_json));
  if (!parsed.success) {
    loggerFor(env, { component: "installation" }).error("installation_config_invalid", {
      organizationId: organization.id,
    });
    return null;
  }

  return { organizationId: organization.id, config: parsed.data };
}

/** Fallback used only by tests and by the first-run bootstrap path. */
export function minimalConfig(name: string, slug: string, locale: string): InstallationConfig {
  return installationConfigSchema.parse({
    schemaVersion: INSTALLATION_CONFIG_SCHEMA_VERSION,
    organization: { name, slug, defaultLocale: locale, supportedLocales: [locale] },
    branding: DEFAULT_BRAND_THEME,
    authentication: { providers: [] },
  });
}
