import { forbidden, unauthenticated } from "./errors.js";
import type { ExperienceRole, InstallationRole } from "./enums.js";
import type { ExperienceId, ExperienceInstanceId, OrganizationId, SessionId, UserId } from "./ids.js";

export const PERMISSIONS = [
  "config:read",
  "config:write",
  "branding:read",
  "branding:write",
  "packs:read",
  "packs:import",
  "packs:draft",
  "packs:publish",
  "packs:enable",
  "packs:retire",
  "experiences:read",
  "experiences:write",
  "instances:read",
  "instances:write",
  "instances:launch",
  "instances:participate",
  "matchruns:read",
  "matchruns:create",
  "matchruns:publish",
  "reveal:execute",
  "insights:read",
  "audit:read",
  "privacy:export",
  "privacy:erase",
  "ai:copilot",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const DESIGNER_PERMISSIONS: readonly Permission[] = [
  "branding:read",
  "config:read",
  "packs:read",
  "packs:draft",
  "experiences:read",
  "experiences:write",
  "instances:read",
  "instances:write",
  "instances:launch",
  "instances:participate",
  "matchruns:read",
  "matchruns:create",
  "matchruns:publish",
  "reveal:execute",
  "insights:read",
  "ai:copilot",
];

const ROLE_PERMISSIONS: Readonly<Record<InstallationRole, readonly Permission[]>> = {
  admin: PERMISSIONS,
  designer: DESIGNER_PERMISSIONS,
  participant: ["branding:read", "instances:participate"],
  support_readonly: ["instances:read", "experiences:read", "packs:read"],
};

/** Admin actions that additionally require a recently authenticated session. */
const STEP_UP_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  "config:write",
  "packs:publish",
  "packs:enable",
  "packs:retire",
  "privacy:export",
  "privacy:erase",
  "audit:read",
]);

export const DEFAULT_STEP_UP_MAX_AGE_SECONDS = 15 * 60;

export interface ExperienceGrant {
  readonly experienceId: ExperienceId;
  readonly role: ExperienceRole;
}

export interface Principal {
  readonly userId: UserId;
  readonly organizationId: OrganizationId;
  readonly sessionId: SessionId;
  readonly roles: readonly InstallationRole[];
  readonly experienceGrants: readonly ExperienceGrant[];
  /** Epoch milliseconds at which the credential backing this session was issued. */
  readonly authenticatedAt: number;
}

export interface AuthorizationContext {
  readonly organizationId?: OrganizationId;
  readonly experienceId?: ExperienceId;
  readonly instanceId?: ExperienceInstanceId;
  /** Set when the principal is an enrolled participant of `instanceId`. */
  readonly participantOfInstance?: boolean;
  readonly now?: number;
  readonly stepUpMaxAgeSeconds?: number;
}

export function hasPermission(principal: Principal, permission: Permission): boolean {
  return principal.roles.some((role) => ROLE_PERMISSIONS[role].includes(permission));
}

function experienceRoleSatisfies(role: ExperienceRole, permission: Permission): boolean {
  if (role === "experience_owner") return true;
  if (role === "experience_editor") return permission !== "packs:publish";
  return permission.endsWith(":read");
}

/**
 * Single authorization entry point: installation RBAC, then experience-scoped
 * grants, then attribute checks. Organization scope is always required because
 * every repository query is organization-scoped.
 */
export function authorize(
  principal: Principal | null,
  permission: Permission,
  context: AuthorizationContext = {},
): void {
  if (!principal) throw unauthenticated();

  if (context.organizationId && context.organizationId !== principal.organizationId) {
    // Treated as "not found" at the route layer; never confirm cross-org existence.
    throw forbidden("Resource is outside the current organization");
  }

  const grant = context.experienceId
    ? principal.experienceGrants.find((g) => g.experienceId === context.experienceId)
    : undefined;

  const permitted =
    hasPermission(principal, permission) ||
    (grant !== undefined && experienceRoleSatisfies(grant.role, permission)) ||
    (permission === "instances:participate" && context.participantOfInstance === true);

  if (!permitted) {
    throw forbidden("Not permitted", { permission });
  }

  if (STEP_UP_PERMISSIONS.has(permission)) {
    const now = context.now ?? Date.now();
    const maxAge = (context.stepUpMaxAgeSeconds ?? DEFAULT_STEP_UP_MAX_AGE_SECONDS) * 1000;
    if (now - principal.authenticatedAt > maxAge) {
      throw forbidden("Recent authentication required", { permission, reason: "step_up_required" });
    }
  }
}
