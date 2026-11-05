import { DomainError, type UserId } from "@culture-shock/domain";
import type { InstallationConfig } from "@culture-shock/config";
import {
  CAPABILITY_KEYS,
  manifestChecksum,
  packManifestSchema,
  validateManifest,
  type PackManifest,
  type ValidationPolicy,
  type ValidationResult,
} from "@culture-shock/pack-sdk";
import { Database, parseJson } from "../db/database.js";
import { PackRepository, type PackTemplateRow } from "../db/repositories.js";

/**
 * Capabilities this core release implements. A manifest requiring anything not
 * listed here fails import: new mechanics need a reviewed core change.
 */
export const SUPPORTED_CAPABILITIES = CAPABILITY_KEYS;

export function validationPolicyFor(config: InstallationConfig): ValidationPolicy {
  return {
    supportedCapabilities: SUPPORTED_CAPABILITIES,
    defaultLocale: config.organization.defaultLocale,
    permittedDataRequirements: [
      "department",
      "team",
      "geography",
      "time_zone",
      "remote_preference",
      "tenure_band",
      "languages",
      "interests",
    ],
    allowAiAssistants: config.ai.enabled,
    minimumCohortSize: config.privacy.minimumCohortSize,
  };
}

export function validate(manifest: unknown, config: InstallationConfig): ValidationResult {
  return validateManifest(manifest, validationPolicyFor(config));
}

export function manifestFromTemplate(row: PackTemplateRow): PackManifest {
  const parsed = packManifestSchema.safeParse(parseJson<unknown>(row.manifest_json, null));
  if (!parsed.success) {
    // A stored template that no longer parses means the core schema moved
    // without a migration; refuse to interpret it rather than guessing.
    throw new DomainError("dependency_unavailable", "Stored pack manifest is no longer valid");
  }
  return parsed.data;
}

export interface ResolvedPackTemplate {
  readonly packId: string;
  readonly templateId: string;
  readonly version: string;
  readonly manifest: PackManifest;
}

/** Resolves the version a designer may actually use, honouring version pinning. */
export async function resolveEnabledPack(
  db: Database,
  config: InstallationConfig,
  slug: string,
  requestedVersion?: string,
): Promise<ResolvedPackTemplate> {
  const packs = new PackRepository(db);
  const pack = await packs.findBySlug(slug);
  if (!pack) throw new DomainError("not_found", "Culture Pack not found");
  if (pack.status !== "active" || pack.enabled !== 1) {
    throw new DomainError("capability_disabled", "Culture Pack is not enabled for this installation");
  }

  const pinned = pack.pinned_version ?? config.culturePacks.pinnedVersions[slug];
  const version = requestedVersion ?? pinned;
  if (pinned && requestedVersion && requestedVersion !== pinned) {
    throw new DomainError("policy_violation", "This Culture Pack is pinned to a different version", {
      pinnedVersion: pinned,
    });
  }

  const template = version
    ? await packs.templateByVersion(pack.id, version)
    : await packs.latestPublishedTemplate(pack.id);

  if (!template || template.state !== "published") {
    throw new DomainError("not_found", "No published version of this Culture Pack is available");
  }

  return {
    packId: pack.id,
    templateId: template.id,
    version: template.version,
    manifest: manifestFromTemplate(template),
  };
}

export interface SeedResult {
  readonly slug: string;
  readonly version: string;
  readonly status: "published" | "already_present" | "rejected";
  readonly issues: ValidationResult["issues"];
}

/**
 * Installs a first-party manifest. First-party packs go through exactly the
 * same validation as an imported manifest, including checksum recording.
 */
export async function seedPack(
  db: Database,
  config: InstallationConfig,
  manifest: unknown,
  actorUserId: UserId | null,
): Promise<SeedResult> {
  const result = validate(manifest, config);
  if (!result.ok || !result.manifest) {
    const parsed = (manifest as { id?: string; version?: string }) ?? {};
    return {
      slug: parsed.id ?? "unknown",
      version: parsed.version ?? "0.0.0",
      status: "rejected",
      issues: result.issues,
    };
  }

  const packs = new PackRepository(db);
  const packId = await packs.upsertPack({ slug: result.manifest.id, origin: "builtin" });
  const existing = await packs.templateByVersion(packId, result.manifest.version);
  if (existing) {
    return {
      slug: result.manifest.id,
      version: result.manifest.version,
      status: "already_present",
      issues: result.issues,
    };
  }

  await packs.publishTemplate({
    packId,
    version: result.manifest.version,
    schemaVersion: result.manifest.schemaVersion,
    manifest: result.manifest,
    checksum: await manifestChecksum(result.manifest),
    provenance: result.manifest.provenance,
    actorUserId,
  });

  return {
    slug: result.manifest.id,
    version: result.manifest.version,
    status: "published",
    issues: result.issues,
  };
}
