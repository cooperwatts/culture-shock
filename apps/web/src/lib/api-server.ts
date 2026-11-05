import { headers } from "next/headers";

export interface ApiEnvelope<T> {
  readonly data: T;
  readonly meta: { requestId: string; revision?: number; cursor?: string | null };
}

export interface ApiProblem {
  readonly code: string;
  readonly message: string;
  readonly requestId: string;
  readonly details?: Record<string, unknown>;
}

export type ApiResult<T> =
  | { readonly ok: true; readonly data: T; readonly revision?: number }
  | { readonly ok: false; readonly error: ApiProblem };

async function originFromRequest(): Promise<string | null> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host");
  if (!host) return null;
  const insecure = host.startsWith("localhost") || host.startsWith("127.");
  return `${insecure ? "http" : "https"}://${host}`;
}

/**
 * Server-side read against the same-origin API Worker. The session cookie is
 * forwarded from the incoming request; the web app itself holds no credentials
 * and performs no authorization of its own.
 */
export async function apiGet<T>(path: string): Promise<ApiResult<T>> {
  const origin = await originFromRequest();
  if (!origin) {
    return {
      ok: false,
      error: { code: "dependency_unavailable", message: "Request origin is unknown", requestId: "none" },
    };
  }

  const requestHeaders = await headers();
  try {
    const response = await fetch(`${origin}/api/v1${path}`, {
      headers: { cookie: requestHeaders.get("cookie") ?? "", accept: "application/json" },
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => null)) as
      | ApiEnvelope<T>
      | { error: ApiProblem }
      | null;

    if (!response.ok || !payload || "error" in payload) {
      return {
        ok: false,
        error:
          payload && "error" in payload
            ? payload.error
            : { code: "internal_error", message: "Request failed", requestId: "none" },
      };
    }

    return { ok: true, data: payload.data, revision: payload.meta.revision };
  } catch {
    return {
      ok: false,
      error: { code: "dependency_unavailable", message: "The API is unreachable", requestId: "none" },
    };
  }
}

export function isUnauthenticated(result: ApiResult<unknown>): boolean {
  return !result.ok && result.error.code === "unauthenticated";
}
