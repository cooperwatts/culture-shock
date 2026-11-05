import { Hono } from "hono";
import { DomainError, authorize } from "@culture-shock/domain";
import {
  installationConfigSchema,
  checkThemeContrast,
  brandThemeSchema,
} from "@culture-shock/config";
import type { AppBindings } from "../env.js";
import { Database } from "../db/database.js";
import { ConfigurationRepository } from "../db/repositories.js";
import { requirePrincipal, stepUpMaxAge } from "../auth/session.js";
import { mapConcurrencyError, ok, type AppContext } from "../http/responses.js";

export const adminRoutes = new Hono<AppBindings>();

function context(c: AppContext) {
  const organizationId = c.get("organizationId");
  const config = c.get("config");
  if (!organizationId || !config)
    throw new DomainError("dependency_unavailable", "Installation not loaded");
  return { organizationId, config, db: new Database(c.env.DB, organizationId) };
}

adminRoutes.get("/admin/config", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { config, db } = context(c);
  authorize(principal, "config:read", {
    now: Date.now(),
    stepUpMaxAgeSeconds: stepUpMaxAge(config),
  });

  const published = await new ConfigurationRepository(db).published();
  return ok(c, published?.config ?? config, {
    revision: published?.revision ?? 0,
  });
});

adminRoutes.put("/admin/config", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { config, db } = context(c);
  authorize(principal, "config:write", {
    now: Date.now(),
    stepUpMaxAgeSeconds: stepUpMaxAge(config),
  });

  const ifMatch = c.req.header("if-match");
  if (!ifMatch)
    throw new DomainError(
      "precondition_required",
      "If-Match revision header is required",
    );

  const parsed = installationConfigSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    throw new DomainError("validation_failed", "Configuration is invalid", {
      issues: parsed.error.issues.slice(0, 10).map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const contrastFindings = checkThemeContrast(parsed.data.branding);
  if (contrastFindings.length > 0) {
    // Accessibility is a publication gate, not a warning a designer can skip.
    throw new DomainError(
      "policy_violation",
      "Brand colours do not meet the minimum contrast ratio",
      {
        findings: contrastFindings,
      },
    );
  }

  if (
    c.env.ENVIRONMENT !== "development" &&
    parsed.data.ai.providers.some((p) => p.kind === "mock")
  ) {
    throw new DomainError(
      "policy_violation",
      "The mock AI provider is only available in development",
    );
  }

  try {
    const revision = await new ConfigurationRepository(db).publish({
      expectedRevision: Number(ifMatch),
      schemaVersion: parsed.data.schemaVersion,
      config: parsed.data,
      actorUserId: principal.userId,
    });
    return ok(c, { published: true }, { revision });
  } catch (error) {
    mapConcurrencyError(error);
  }
});

adminRoutes.get("/admin/branding", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { config } = context(c);
  authorize(principal, "branding:read");
  return ok(c, { branding: config.branding, terminology: config.terminology });
});

adminRoutes.put("/admin/branding", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { config, db } = context(c);
  authorize(principal, "branding:write", {
    now: Date.now(),
    stepUpMaxAgeSeconds: stepUpMaxAge(config),
  });

  const ifMatch = c.req.header("if-match");
  if (!ifMatch)
    throw new DomainError(
      "precondition_required",
      "If-Match revision header is required",
    );

  const theme = brandThemeSchema.safeParse(await c.req.json());
  if (!theme.success)
    throw new DomainError("validation_failed", "Brand theme is invalid");

  const findings = checkThemeContrast(theme.data);
  if (findings.length > 0) {
    throw new DomainError(
      "policy_violation",
      "Brand colours do not meet the minimum contrast ratio",
      {
        findings,
      },
    );
  }

  try {
    const revision = await new ConfigurationRepository(db).publish({
      expectedRevision: Number(ifMatch),
      schemaVersion: config.schemaVersion,
      config: { ...config, branding: theme.data },
      actorUserId: principal.userId,
    });
    return ok(c, { published: true }, { revision });
  } catch (error) {
    mapConcurrencyError(error);
  }
});

adminRoutes.get("/admin/audit", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const { config, db } = context(c);
  authorize(principal, "audit:read", {
    now: Date.now(),
    stepUpMaxAgeSeconds: stepUpMaxAge(config),
  });

  const limit = Math.min(Number(c.req.query("limit") ?? 50), 100);
  const cursor = c.req.query("cursor") ?? null;

  const rows = await db.all<{
    id: string;
    actor_kind: string;
    action: string;
    resource_type: string;
    resource_id: string | null;
    purpose: string;
    occurred_at: string;
  }>(
    cursor
      ? `SELECT id, actor_kind, action, resource_type, resource_id, purpose, occurred_at
           FROM audit_events WHERE organization_id = ? AND id < ? ORDER BY id DESC LIMIT ?`
      : `SELECT id, actor_kind, action, resource_type, resource_id, purpose, occurred_at
           FROM audit_events WHERE organization_id = ? ORDER BY id DESC LIMIT ?`,
    cursor ? [db.organizationId, cursor, limit] : [db.organizationId, limit],
  );

  // Reading the audit log is itself an auditable event.
  await db.commit([], {
    actorUserId: principal.userId,
    actorKind: "user",
    action: "audit.read",
    resourceType: "audit_event",
    resourceId: null,
    purpose: "administration",
    metadata: { returned: rows.length },
  });

  return ok(c, rows, { cursor: rows.at(-1)?.id ?? null });
});
