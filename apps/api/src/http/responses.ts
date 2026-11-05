import type { Context } from "hono";
import { DomainError, isDomainError } from "@culture-shock/domain";
import { createLogger, type LogLevel } from "@culture-shock/observability";
import type { AppBindings } from "../env.js";

export type AppContext = Context<AppBindings>;

export function ok<T>(c: AppContext, data: T, extra: { revision?: number; cursor?: string | null } = {}) {
  return c.json(
    {
      data,
      meta: {
        requestId: c.get("requestContext").requestId,
        ...(extra.revision !== undefined ? { revision: extra.revision } : {}),
        ...(extra.cursor !== undefined ? { cursor: extra.cursor } : {}),
      },
    },
    200,
  );
}

export function created<T>(c: AppContext, data: T, revision?: number) {
  return c.json(
    {
      data,
      meta: {
        requestId: c.get("requestContext").requestId,
        ...(revision !== undefined ? { revision } : {}),
      },
    },
    201,
  );
}

export function accepted<T>(c: AppContext, data: T) {
  return c.json({ data, meta: { requestId: c.get("requestContext").requestId } }, 202);
}

export function noContent(c: AppContext) {
  return c.body(null, 204);
}

/**
 * Error envelope. Messages are stable and non-diagnostic; internal causes are
 * logged with the request id but never returned to the caller.
 */
export function problem(c: AppContext, error: unknown) {
  const requestId = c.get("requestContext")?.requestId ?? "unknown";

  if (isDomainError(error)) {
    return c.json(
      {
        error: {
          code: error.code,
          message: error.message,
          requestId,
          ...(error.details ? { details: error.details } : {}),
        },
      },
      error.status as 400,
    );
  }

  createLogger({
    level: (c.env.LOG_LEVEL as LogLevel) ?? "info",
    service: "api",
    environment: c.env.ENVIRONMENT,
  }).error("unhandled_error", {
    requestId,
    route: `${c.req.method} ${new URL(c.req.url).pathname}`,
    error: error instanceof Error ? error.name : "unknown",
    detail: error instanceof Error ? error.message : undefined,
  });

  return c.json(
    { error: { code: "internal_error", message: "An unexpected error occurred", requestId } },
    500,
  );
}

/** Maps a repository optimistic-concurrency failure onto a stable API error. */
export function mapConcurrencyError(error: unknown): never {
  if (error instanceof Error && error.message === "revision_mismatch") {
    throw new DomainError("precondition_failed", "The resource changed since it was read");
  }
  if (error instanceof Error && error.message === "version_exists") {
    throw new DomainError("conflict", "That version has already been published");
  }
  if (error instanceof Error && error.message === "not_publishable") {
    throw new DomainError("conflict", "The match run is not in a publishable state");
  }
  throw error;
}
