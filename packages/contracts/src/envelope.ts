import { z } from "zod";
import { ERROR_CODES } from "@culture-shock/domain";

export const API_VERSION = "v1";
export const API_BASE_PATH = "/api/v1";

/** Maximum JSON body accepted on any write route. */
export const MAX_REQUEST_BYTES = 64 * 1024;

export const metaSchema = z.object({
  requestId: z.string().min(1).max(64),
  revision: z.number().int().min(0).optional(),
  cursor: z.string().max(200).nullable().optional(),
});

export function successSchema<T extends z.ZodTypeAny>(data: T) {
  return z.object({ data, meta: metaSchema });
}

export const errorSchema = z.object({
  error: z.object({
    code: z.enum(Object.keys(ERROR_CODES) as [string, ...string[]]),
    message: z.string(),
    requestId: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});

export type ApiError = z.infer<typeof errorSchema>;

export const paginationSchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const idSchema = z.string().regex(/^[a-z]{3}_[0-9a-f]{32}$/);
export const isoDateTimeSchema = z.string().datetime({ offset: false });
export const timeZoneSchema = z.string().min(1).max(64);
export const localeSchema = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/);
export const revisionSchema = z.number().int().min(0);
export const packSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{2,59}$/);
export const semverSchema = z.string().regex(/^\d+\.\d+\.\d+$/);

/** Routes that require an `Idempotency-Key` header. */
export const IDEMPOTENT_ROUTES: readonly string[] = [
  "POST /packs/import",
  "POST /packs/:id/versions",
  "POST /packs/drafts/:id/publish",
  "POST /experiences/:id/instances",
  "POST /instances/:id/launch",
  "POST /instances/:id/match-runs",
  "POST /instances/:id/match-runs/:runId/publish",
  "POST /instances/:id/reveal",
  "POST /admin/privacy/export",
  "POST /admin/privacy/erase",
];

/** Routes that require an `If-Match` revision header. */
export const IF_MATCH_ROUTES: readonly string[] = [
  "PUT /admin/config",
  "PUT /admin/branding",
  "PATCH /experiences/:id",
  "PATCH /instances/:id",
  "POST /instances/:id/launch",
];
