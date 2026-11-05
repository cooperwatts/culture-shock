import type { InstallationConfig } from "@culture-shock/config";
import type { OrganizationId, Principal } from "@culture-shock/domain";

export interface Env {
  readonly DB: D1Database;
  readonly ASSETS: R2Bucket;
  readonly JOBS: Queue<unknown>;
  readonly AI?: { run(model: string, input: unknown): Promise<unknown> };

  readonly ENVIRONMENT: "development" | "staging" | "production";
  readonly PUBLIC_BASE_URL: string;
  readonly LOG_LEVEL: "debug" | "info" | "warn" | "error";

  /** Worker secrets. Absent in local dev until `.dev.vars` is populated. */
  readonly SESSION_COOKIE_KEY?: string;
  readonly FIELD_ENCRYPTION_KEY?: string;
  readonly EMAIL_LOOKUP_HMAC_KEY?: string;
  readonly EMAIL_PROVIDER_API_KEY?: string;
  readonly [key: string]: unknown;
}

export interface RequestContext {
  readonly requestId: string;
  readonly startedAt: number;
}

export interface AppVariables {
  requestContext: RequestContext;
  principal: Principal | null;
  organizationId: OrganizationId | null;
  config: InstallationConfig | null;
}

export type AppBindings = { Bindings: Env; Variables: AppVariables };

/** Reads a per-provider secret such as `OIDC_CLIENT_SECRET_ENTRA`. */
export function secret(env: Env, name: string): string | undefined {
  const value = env[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function requireSecret(env: Env, name: string): string {
  const value = secret(env, name);
  if (!value) {
    // Surfaced as a 503 so a misconfigured installation fails loudly rather
    // than silently falling back to a weaker code path.
    throw new Error(`Missing required secret: ${name}`);
  }
  return value;
}
