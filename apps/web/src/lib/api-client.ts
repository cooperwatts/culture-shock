"use client";

import type { ApiProblem, ApiResult } from "./api-server";

// Local development serves over HTTP, where the __Host- prefix cannot be used.
const CSRF_COOKIE_NAMES = ["__Host-cs_csrf", "cs_csrf"];

function readCsrfToken(): string | null {
  for (const part of document.cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key && CSRF_COOKIE_NAMES.includes(key)) return rest.join("=");
  }
  return null;
}

export interface MutateOptions {
  readonly method: "POST" | "PUT" | "PATCH" | "DELETE";
  readonly body?: unknown;
  /** Required by the API on launch, match-run, publish and privacy routes. */
  readonly idempotencyKey?: string;
  readonly ifMatch?: number;
}

/**
 * Browser-side mutation. The CSRF token is read from a readable cookie and sent
 * as a header; the session cookie itself stays HttpOnly and is never touched by
 * script.
 */
export async function apiMutate<T>(
  path: string,
  options: MutateOptions,
): Promise<ApiResult<T>> {
  const csrf = readCsrfToken();
  if (!csrf) {
    return {
      ok: false,
      error: {
        code: "csrf_failed",
        message: "Your session has expired. Sign in again.",
        requestId: "none",
      },
    };
  }

  const requestHeaders: Record<string, string> = {
    "content-type": "application/json",
    "x-cs-csrf": csrf,
  };
  if (options.idempotencyKey)
    requestHeaders["idempotency-key"] = options.idempotencyKey;
  if (options.ifMatch !== undefined)
    requestHeaders["if-match"] = String(options.ifMatch);

  try {
    const response = await fetch(`/api/v1${path}`, {
      method: options.method,
      headers: requestHeaders,
      body: JSON.stringify(options.body ?? {}),
      credentials: "same-origin",
    });

    if (response.status === 204) return { ok: true, data: undefined as T };

    const payload = (await response.json().catch(() => null)) as
      | { data: T; meta: { revision?: number } }
      | { error: ApiProblem }
      | null;

    if (!response.ok || !payload || "error" in payload) {
      return {
        ok: false,
        error:
          payload && "error" in payload
            ? payload.error
            : {
                code: "internal_error",
                message: "Request failed",
                requestId: "none",
              },
      };
    }

    return { ok: true, data: payload.data, revision: payload.meta.revision };
  } catch {
    return {
      ok: false,
      error: {
        code: "dependency_unavailable",
        message: "The API is unreachable",
        requestId: "none",
      },
    };
  }
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

/**
 * Turns an API problem into something a participant can act on. Validation
 * details are summarised rather than dumped verbatim.
 */
export function describeProblem(error: ApiProblem): string {
  switch (error.code) {
    case "unauthenticated":
      return "Your session has expired. Sign in again to continue.";
    case "forbidden":
      return error.details?.reason === "step_up_required"
        ? "This action needs a recent sign-in. Sign in again and retry."
        : "You do not have permission to do that.";
    case "precondition_failed":
      return "Someone else changed this while you were working. Reload and try again.";
    case "conflict":
      return error.message;
    case "rate_limited":
      return "Too many attempts. Wait a moment and try again.";
    default:
      return error.message;
  }
}
