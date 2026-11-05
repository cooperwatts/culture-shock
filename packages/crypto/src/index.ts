/**
 * Cryptographic helpers built on Web Crypto, which is available in Workers.
 * Keys are supplied as base64url Worker secrets and are never persisted.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Backed by a concrete ArrayBuffer so the result satisfies BufferSource under
// both the DOM and Workers type definitions.
export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function randomToken(byteLength = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toBase64Url(new Uint8Array(digest));
}

/**
 * Constant-time comparison. Token lookups still go through the hashed index,
 * but any in-memory comparison must not leak position through timing.
 */
export function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function importHmacKey(keyMaterial: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    fromBase64Url(keyMaterial),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/**
 * Keyed lookup HMAC for work email. The HMAC key is distinct from the field
 * encryption key, so compromising one does not enable the other.
 */
export async function lookupHmac(
  keyMaterial: string,
  value: string,
): Promise<string> {
  const key = await importHmacKey(keyMaterial);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(value.trim().toLowerCase()),
  );
  return toBase64Url(new Uint8Array(signature));
}

export interface EncryptedField {
  readonly keyVersion: number;
  readonly ciphertext: string;
}

async function importAesKey(keyMaterial: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    fromBase64Url(keyMaterial),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

/** AES-GCM with a random 96-bit IV prefixed to the ciphertext. */
export async function encryptField(
  keyMaterial: string,
  keyVersion: number,
  plaintext: string,
): Promise<EncryptedField> {
  const key = await importAesKey(keyMaterial);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext),
  );
  const payload = new Uint8Array(iv.length + encrypted.byteLength);
  payload.set(iv, 0);
  payload.set(new Uint8Array(encrypted), iv.length);
  return { keyVersion, ciphertext: toBase64Url(payload) };
}

export async function decryptField(
  keyMaterial: string,
  ciphertext: string,
): Promise<string> {
  const key = await importAesKey(keyMaterial);
  const payload = fromBase64Url(ciphertext);
  const iv = payload.slice(0, 12);
  const body = payload.slice(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    body,
  );
  return decoder.decode(decrypted);
}

/** PKCE S256 challenge for the OIDC authorization code flow. */
export async function pkceChallenge(verifier: string): Promise<string> {
  return sha256Base64Url(verifier);
}

export async function stableHash(value: unknown): Promise<string> {
  const canonical =
    value === null || typeof value !== "object"
      ? JSON.stringify(value)
      : JSON.stringify(
          value,
          Object.keys(value as Record<string, unknown>).sort(),
        );
  return sha256Base64Url(canonical ?? "null");
}
