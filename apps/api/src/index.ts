import { Hono } from "hono";
import { DomainError, isDomainError } from "@culture-shock/domain";
import { API_BASE_PATH } from "@culture-shock/contracts";
import { ZodError } from "zod";
import type { AppBindings } from "./env.js";
import {
  authenticate,
  loadInstallation,
  requestContext,
  requestLimits,
  securityHeaders,
} from "./http/middleware.js";
import { problem } from "./http/responses.js";
import { authRoutes } from "./routes/auth.js";
import { devAuthRoutes } from "./routes/dev-auth.js";
import { adminRoutes } from "./routes/admin.js";
import { assetRoutes } from "./routes/assets.js";
import { brandingRoutes } from "./routes/branding.js";
import { bootstrapRoutes } from "./routes/bootstrap.js";
import { packRoutes } from "./routes/packs.js";
import { packDraftRoutes } from "./routes/pack-drafts.js";
import { privacyRoutes } from "./routes/privacy.js";
import { operationsRoutes } from "./routes/operations.js";
import { experienceRoutes } from "./routes/experiences.js";
import { activityRoutes } from "./routes/activities.js";
import { copilotRoutes } from "./routes/copilot.js";

const app = new Hono<AppBindings>();

app.use("*", requestContext);
app.use("*", securityHeaders);

/** Coarse health only: never configuration, versions, or binding details. */
app.get(`${API_BASE_PATH}/health`, (c) =>
  c.json({ data: { status: "ok" } }, 200),
);

// Bootstrap runs before an organization exists, so it sits outside the
// installation-loading and session middleware and uses its own setup token.
app.use(`${API_BASE_PATH}/admin/bootstrap`, requestLimits);
app.route(API_BASE_PATH, bootstrapRoutes);

const api = new Hono<AppBindings>();
api.use("*", requestLimits);
api.use("*", loadInstallation);
api.use("*", authenticate);
api.route("/", authRoutes);
api.route("/", devAuthRoutes);
api.route("/", adminRoutes);
api.route("/", brandingRoutes);
api.route("/", assetRoutes);
api.route("/", privacyRoutes);
api.route("/", operationsRoutes);
api.route("/", packDraftRoutes);
api.route("/", packRoutes);
api.route("/", experienceRoutes);
api.route("/", activityRoutes);
api.route("/", copilotRoutes);

app.route(API_BASE_PATH, api);

app.notFound((c) =>
  problem(c, new DomainError("not_found", "Resource not found")),
);

app.onError((error, c) => {
  if (error instanceof ZodError) {
    return problem(
      c,
      new DomainError("validation_failed", "Request body failed validation", {
        issues: error.issues.slice(0, 10).map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      }),
    );
  }
  if (isDomainError(error)) return problem(c, error);
  if (
    error instanceof Error &&
    error.message.startsWith("Missing required secret")
  ) {
    return problem(
      c,
      new DomainError(
        "dependency_unavailable",
        "Installation is not fully configured",
      ),
    );
  }
  return problem(c, error);
});

export default app;
