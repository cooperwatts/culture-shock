import { Hono } from "hono";
import { DomainError, authorize } from "@culture-shock/domain";
import { copilotRequestSchema } from "@culture-shock/contracts";
import type { AppBindings } from "../env.js";
import { Database } from "../db/database.js";
import { PackRepository } from "../db/repositories.js";
import { requirePrincipal } from "../auth/session.js";
import { ok } from "../http/responses.js";
import { recommend } from "../services/copilot-service.js";

export const copilotRoutes = new Hono<AppBindings>();

/**
 * Returns recommendations only. Nothing here creates an experience, publishes a
 * pack, or sends a message; an Organizer must act on the draft.
 */
copilotRoutes.post("/copilot/recommendations", async (c) => {
  const principal = requirePrincipal(c.get("principal"));
  const organizationId = c.get("organizationId");
  const config = c.get("config");
  if (!organizationId || !config)
    throw new DomainError("dependency_unavailable", "Installation not loaded");
  authorize(principal, "ai:copilot");

  const db = new Database(c.env.DB, organizationId);
  const body = copilotRequestSchema.parse(await c.req.json());

  const packs = await new PackRepository(db).list();
  const available = packs
    .filter((pack) => pack.enabled === 1 && pack.status === "active")
    .map((pack) => pack.slug);
  if (available.length === 0) {
    throw new DomainError(
      "conflict",
      "No Culture Packs are enabled for this installation",
    );
  }

  const outcome = await recommend({
    env: c.env,
    config,
    db,
    userId: principal.userId,
    availablePackIds: available,
    request: body,
  });

  return ok(c, {
    source: outcome.source,
    provenance: outcome.provenance,
    uncertainty: outcome.uncertainty,
    recommendation: outcome.response.primary,
    alternatives: outcome.response.alternatives,
    requiresHumanApproval: true,
  });
});
