import { Hono } from "hono";
import { DomainError, authorize, newId } from "@culture-shock/domain";
import type { AppBindings } from "../env.js";
import { Database, nowIso } from "../db/database.js";
import { requirePrincipal, stepUpMaxAge } from "../auth/session.js";
import { created, ok, type AppContext } from "../http/responses.js";

export const assetRoutes = new Hono<AppBindings>();

const MAX_IMAGE_BYTES = 512 * 1024;
const MAX_FONT_BYTES = 1024 * 1024;

/**
 * Raster and SVG only for images. SVG is accepted because logos need it, but it
 * is served with a restrictive CSP and scanned for script before storage.
 * Fonts are WOFF2 only: it is the one format every supported browser reads, and
 * narrowing the parser surface is worth more than legacy coverage.
 */
const ALLOWED_TYPES: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "font/woff2": "woff2",
};

const ASSET_SLOTS = [
  "logoLight",
  "logoDark",
  "favicon",
  "emailHeader",
  "bodyFontFile",
  "headingFontFile",
] as const;
type AssetSlot = (typeof ASSET_SLOTS)[number];

const FONT_SLOTS: ReadonlySet<string> = new Set([
  "bodyFontFile",
  "headingFontFile",
]);

function context(c: AppContext) {
  const organizationId = c.get("organizationId");
  const config = c.get("config");
  if (!organizationId || !config)
    throw new DomainError("dependency_unavailable", "Installation not loaded");
  return { config, db: new Database(c.env.DB, organizationId) };
}

/** Magic-byte check, so a renamed file cannot pass as an image. */
function sniff(bytes: Uint8Array, declared: string): boolean {
  const starts = (...signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);

  switch (declared) {
    case "image/png":
      return starts(0x89, 0x50, 0x4e, 0x47);
    case "image/jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "image/webp":
      return starts(0x52, 0x49, 0x46, 0x46) && starts(0x57, 0x45, 0x42, 0x50);
    case "image/x-icon":
    case "image/vnd.microsoft.icon":
      return starts(0x00, 0x00, 0x01, 0x00);
    case "image/svg+xml": {
      const head = new TextDecoder()
        .decode(bytes.slice(0, 512))
        .trimStart()
        .toLowerCase();
      return head.startsWith("<?xml") || head.startsWith("<svg");
    }
    case "font/woff2":
      // 'wOF2'
      return starts(0x77, 0x4f, 0x46, 0x32);
    default:
      return false;
  }
}

/** Rejects SVGs carrying script or external references. */
function svgIsSafe(bytes: Uint8Array): boolean {
  const text = new TextDecoder().decode(bytes).toLowerCase();
  return !/<script|javascript:|<foreignobject|xlink:href\s*=\s*["']\s*http|<!entity/.test(
    text,
  );
}

assetRoutes.post("/admin/branding/assets/:slot", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { config, db } = context(c);
  authorize(principal, "branding:write", {
    now: Date.now(),
    stepUpMaxAgeSeconds: stepUpMaxAge(config),
  });

  const slot = c.req.param("slot") as AssetSlot;
  if (!ASSET_SLOTS.includes(slot))
    throw new DomainError("not_found", "Unknown asset slot");

  const contentType =
    (c.req.header("content-type") ?? "").split(";")[0]?.trim() ?? "";
  const extension = ALLOWED_TYPES[contentType];
  const expectsFont = FONT_SLOTS.has(slot);

  if (!extension) {
    throw new DomainError(
      "unsupported_media_type",
      "Upload a PNG, JPEG, WebP, SVG, ICO or WOFF2 file",
    );
  }
  if (expectsFont !== (contentType === "font/woff2")) {
    throw new DomainError(
      "validation_failed",
      expectsFont
        ? "Font slots take a WOFF2 file"
        : "Image slots do not take a font file",
    );
  }

  const body = new Uint8Array(await c.req.arrayBuffer());
  const limit = expectsFont ? MAX_FONT_BYTES : MAX_IMAGE_BYTES;

  if (body.byteLength === 0)
    throw new DomainError("validation_failed", "The file is empty");
  if (body.byteLength > limit) {
    throw new DomainError(
      "payload_too_large",
      expectsFont
        ? "Fonts are limited to 1 MB"
        : "Brand images are limited to 512 KB",
    );
  }
  if (!sniff(body, contentType)) {
    throw new DomainError(
      "validation_failed",
      "File contents do not match the declared type",
    );
  }
  if (contentType === "image/svg+xml" && !svgIsSafe(body)) {
    throw new DomainError(
      "policy_violation",
      "The SVG contains script or external references",
    );
  }

  const digest = await crypto.subtle.digest("SHA-256", body);
  const checksum = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const objectKey = `branding/${db.organizationId}/${slot}-${checksum.slice(0, 16)}.${extension}`;

  await c.env.ASSETS.put(objectKey, body, {
    httpMetadata: { contentType, cacheControl: "private, max-age=300" },
  });
  const timestamp = nowIso();
  await db.commit(
    [
      db.statement(
        `INSERT INTO r2_objects
           (id, organization_id, owner_type, owner_id, object_key, content_type, byte_size, checksum, classification, created_at)
         VALUES (?, ?, 'brand_asset', ?, ?, ?, ?, ?, 'internal', ?)
         ON CONFLICT (object_key) DO NOTHING`,
        [
          newId("R2ObjectId"),
          db.organizationId,
          slot,
          objectKey,
          contentType,
          body.byteLength,
          `sha256:${checksum}`,
          timestamp,
        ],
      ),
    ],
    {
      actorUserId: principal.userId,
      actorKind: "user",
      action: "branding.asset_uploaded",
      resourceType: "r2_object",
      resourceId: objectKey,
      purpose: "administration",
      metadata: { slot, contentType, byteSize: body.byteLength },
    },
  );

  return created(c, { slot, objectKey, byteSize: body.byteLength });
});

/**
 * Serves a brand asset to a signed-in user. Assets are not public: the bucket
 * has no public access and this is the only way out of it.
 */
assetRoutes.get("/branding/assets/:slot", async (c) => {
  requirePrincipal(c.get("principal"));
  const { config } = context(c);

  const slot = c.req.param("slot") as AssetSlot;
  if (!ASSET_SLOTS.includes(slot))
    throw new DomainError("not_found", "Unknown asset slot");

  const objectKey = config.branding.assets[slot];
  if (!objectKey)
    throw new DomainError("not_found", "No asset is configured for that slot");

  const object = await c.env.ASSETS.get(objectKey);
  if (!object)
    throw new DomainError("not_found", "That asset is no longer stored");

  const contentType =
    object.httpMetadata?.contentType ?? "application/octet-stream";

  return new Response(object.body, {
    headers: {
      "content-type": contentType,
      "cache-control": "private, max-age=300",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "x-content-type-options": "nosniff",
    },
  });
});

assetRoutes.get("/admin/branding/assets", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { db } = context(c);
  authorize(principal, "branding:read");

  const rows = await db.all<{
    owner_id: string;
    object_key: string;
    byte_size: number;
    created_at: string;
  }>(
    `SELECT owner_id, object_key, byte_size, created_at FROM r2_objects
      WHERE organization_id = ? AND owner_type = 'brand_asset' ORDER BY created_at DESC LIMIT 40`,
    [db.organizationId],
  );

  return ok(
    c,
    rows.map((row) => ({
      slot: row.owner_id,
      objectKey: row.object_key,
      byteSize: row.byte_size,
      uploadedAt: row.created_at,
    })),
  );
});
