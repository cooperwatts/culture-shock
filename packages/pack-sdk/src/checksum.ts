/**
 * Canonical serialization and checksum. Two manifests with identical semantics
 * produce identical checksums regardless of key order, so provenance and
 * integrity checks are stable across import paths.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([entryKey, entryValue]) => `${JSON.stringify(entryKey)}:${canonicalize(entryValue)}`);
  return `{${entries.join(",")}}`;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function manifestChecksum(manifest: unknown): Promise<string> {
  return `sha256:${await sha256Hex(canonicalize(manifest))}`;
}
