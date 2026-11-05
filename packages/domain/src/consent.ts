import type { ConsentPurpose } from "./enums.js";

export interface ConsentRecord {
  readonly purpose: ConsentPurpose;
  readonly granted: boolean;
  readonly consentVersion: string;
  readonly grantedAt: string | null;
  readonly expiresAt: string | null;
}

export type ConsentRegistry = readonly ConsentRecord[];

/**
 * Consent is only effective when explicitly granted, matching the current
 * published consent version, and not expired. Missing records are denials.
 */
export function hasConsent(
  registry: ConsentRegistry,
  purpose: ConsentPurpose,
  currentVersion: string,
  now: Date = new Date(),
): boolean {
  const record = registry.find((entry) => entry.purpose === purpose);
  if (!record || !record.granted) return false;
  if (record.consentVersion !== currentVersion) return false;
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= now.getTime()) return false;
  return true;
}

export function grantedPurposes(
  registry: ConsentRegistry,
  currentVersion: string,
  now: Date = new Date(),
): ConsentPurpose[] {
  return registry
    .filter((record) => hasConsent(registry, record.purpose, currentVersion, now))
    .map((record) => record.purpose);
}
