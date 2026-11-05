import { Hono } from "hono";
import { DomainError } from "@culture-shock/domain";
import { brandingResponseSchema } from "@culture-shock/config";
import type { AppBindings } from "../env.js";
import { requirePrincipal } from "../auth/session.js";
import { ok } from "../http/responses.js";

export const brandingRoutes = new Hono<AppBindings>();

/**
 * Presentation-only branding for the app shell. Deliberately not behind the
 * `branding:read` permission, which governs the editor: every signed-in user
 * has to render the theme, and reading `/admin/config` instead meant only
 * administrators ever saw it. Nothing here is not already on screen.
 */
brandingRoutes.get("/branding", async (c) => {
  requirePrincipal(c.get("principal"));
  const config = c.get("config");
  if (!config)
    throw new DomainError("dependency_unavailable", "Installation not loaded");

  return ok(
    c,
    brandingResponseSchema.parse({
      branding: config.branding,
      terminology: config.terminology,
      organizationName: config.organization.name,
    }),
  );
});
