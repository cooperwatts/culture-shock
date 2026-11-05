import type { MiddlewareHandler } from "hono";
import { DomainError } from "@culture-shock/domain";
import {
  installationConfigSchema,
  type InstallationConfig,
} from "@culture-shock/config";
import { MAX_REQUEST_BYTES } from "@culture-shock/contracts";
import type { OrganizationId } from "@culture-shock/domain";
import type { AppBindings } from "../env.js";
import { Database } from "../db/database.js";
import {
  ConfigurationRepository,
  findActiveOrganization,
} from "../db/repositories.js";
import {
  CSRF_HEADER,
  SESSION_COOKIE,
  sessionCookieName,
  newRequestId,
  readCookie,
  resolveSession,
  verifyCsrf,
} from "../auth/session.js";
import { defaultInstallationConfig } from "../services/defaults.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const requestContext: MiddlewareHandler<AppBindings> = async (
  c,
  next,
) => {
  const requestId = c.req.header("cf-ray") ?? newRequestId();
  c.set("requestContext", { requestId, startedAt: Date.now() });
  await next();
  c.header("x-request-id", requestId);
};

/**
 * API responses are private by default. The strict CSP here applies to API
 * responses only; the web Worker sets its own nonce-based policy for documents.
 */
export const securityHeaders: MiddlewareHandler<AppBindings> = async (
  c,
  next,
) => {
  await next();
  c.header("cache-control", "no-store");
  c.header(
    "content-security-policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  );
  c.header("x-content-type-options", "nosniff");
  c.header("referrer-policy", "no-referrer");
  c.header("cross-origin-resource-policy", "same-origin");
  c.header("permissions-policy", "geolocation=(), camera=(), microphone=()");
  if (c.env.ENVIRONMENT !== "development") {
    c.header(
      "strict-transport-security",
      "max-age=31536000; includeSubDomains",
    );
  }
};

export const requestLimits: MiddlewareHandler<AppBindings> = async (
  c,
  next,
) => {
  if (!SAFE_METHODS.has(c.req.method)) {
    const contentType = c.req.header("content-type") ?? "";
    // Brand asset uploads are the one binary route; they enforce their own
    // type, magic-byte and size checks.
    const isAssetUpload = new URL(c.req.url).pathname.includes(
      "/admin/branding/assets/",
    );
    const limit = isAssetUpload ? 1024 * 1024 : MAX_REQUEST_BYTES;

    if (!isAssetUpload && !contentType.startsWith("application/json")) {
      throw new DomainError(
        "unsupported_media_type",
        "Request body must be application/json",
      );
    }
    if (
      isAssetUpload &&
      !contentType.startsWith("image/") &&
      !contentType.startsWith("font/")
    ) {
      throw new DomainError(
        "unsupported_media_type",
        "Brand assets must be an image or a font",
      );
    }

    const declaredLength = Number(c.req.header("content-length") ?? "0");
    if (declaredLength > limit) {
      throw new DomainError("payload_too_large", "Request body is too large");
    }
  }
  await next();
};

/**
 * Loads the single active organization and its published configuration. When no
 * configuration has been published yet, a locked-down default is used so the
 * installation can still reach the bootstrap flow.
 */
export const loadInstallation: MiddlewareHandler<AppBindings> = async (
  c,
  next,
) => {
  const organization = await findActiveOrganization(c.env.DB);
  if (!organization) {
    throw new DomainError(
      "dependency_unavailable",
      "Installation has not been provisioned",
    );
  }

  const organizationId = organization.id as OrganizationId;
  const db = new Database(c.env.DB, organizationId);
  const published = await new ConfigurationRepository(db).published();

  let config: InstallationConfig;
  if (published) {
    const parsed = installationConfigSchema.safeParse(published.config);
    if (!parsed.success) {
      // A stored configuration that no longer validates is a deployment fault,
      // not a request fault; fail closed rather than running on partial settings.
      throw new DomainError(
        "dependency_unavailable",
        "Stored installation configuration is invalid",
      );
    }
    config = parsed.data;
  } else {
    config = defaultInstallationConfig(
      organization.display_name,
      organization.slug,
      organization.locale,
    );
  }

  c.set("organizationId", organizationId);
  c.set("config", config);
  await next();
};

/**
 * Resolves the session, then enforces Origin and CSRF on unsafe methods. Both
 * checks run even when the route later rejects on authorization, so a CSRF
 * probe cannot be used to enumerate permissions.
 */
export const authenticate: MiddlewareHandler<AppBindings> = async (c, next) => {
  const organizationId = c.get("organizationId");
  const config = c.get("config");
  if (!organizationId || !config)
    throw new DomainError("dependency_unavailable", "Installation not loaded");

  const token = readCookie(
    c.req.header("cookie"),
    sessionCookieName(c.env.ENVIRONMENT !== "development"),
  );
  const db = new Database(c.env.DB, organizationId);
  const resolved = token
    ? await resolveSession(db, organizationId, token, config)
    : null;

  c.set("principal", resolved?.principal ?? null);

  if (!SAFE_METHODS.has(c.req.method)) {
    const origin = c.req.header("origin");
    if (origin && origin !== new URL(c.env.PUBLIC_BASE_URL).origin) {
      throw new DomainError("csrf_failed", "Request origin is not allowed");
    }
    if (resolved) {
      const valid = await verifyCsrf(
        c.req.header(CSRF_HEADER) ?? null,
        resolved.csrfTokenHash,
      );
      if (!valid)
        throw new DomainError("csrf_failed", "Missing or invalid CSRF token");
    }
  }

  await next();
};
