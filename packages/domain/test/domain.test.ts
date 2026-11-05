import { describe, expect, it } from "vitest";
import {
  DEFAULT_STEP_UP_MAX_AGE_SECONDS,
  assertInstanceTransition,
  assertParticipantTransition,
  authorize,
  canTransitionInstance,
  hasConsent,
  isDomainError,
  newId,
  overlapMinutes,
  type ExperienceId,
  type OrganizationId,
  type Principal,
  type SessionId,
  type UserId,
} from "../src/index.js";

function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    userId: newId("UserId") as UserId,
    organizationId: newId("OrganizationId") as OrganizationId,
    sessionId: newId("SessionId") as SessionId,
    roles: ["participant"],
    experienceGrants: [],
    authenticatedAt: Date.now(),
    ...overrides,
  };
}

describe("authorization", () => {
  it("rejects an anonymous caller", () => {
    expect(() => authorize(null, "experiences:read")).toThrowError();
  });

  it("denies a participant access to designer capabilities", () => {
    expect(() => authorize(principal(), "matchruns:publish")).toThrowError();
  });

  it("allows an experience-scoped grant without an installation role", () => {
    const experienceId = newId("ExperienceId") as ExperienceId;
    const actor = principal({
      roles: ["participant"],
      experienceGrants: [{ experienceId, role: "experience_owner" }],
    });
    expect(() => authorize(actor, "matchruns:publish", { experienceId })).not.toThrow();
    // The grant must not leak to a different experience.
    expect(() =>
      authorize(actor, "matchruns:publish", { experienceId: newId("ExperienceId") as ExperienceId }),
    ).toThrowError();
  });

  it("refuses cross-organization access", () => {
    const actor = principal({ roles: ["admin"] });
    expect(() =>
      authorize(actor, "experiences:read", { organizationId: newId("OrganizationId") as OrganizationId }),
    ).toThrowError();
  });

  it("requires recent authentication for sensitive admin actions", () => {
    const stale = principal({
      roles: ["admin"],
      authenticatedAt: Date.now() - (DEFAULT_STEP_UP_MAX_AGE_SECONDS + 60) * 1000,
    });
    try {
      authorize(stale, "privacy:erase");
      throw new Error("expected a step-up failure");
    } catch (error) {
      expect(isDomainError(error)).toBe(true);
      if (isDomainError(error)) expect(error.details?.reason).toBe("step_up_required");
    }
    expect(() => authorize(stale, "instances:read")).not.toThrow();
  });

  it("lets an enrolled participant act on their own instance", () => {
    const actor = principal();
    expect(() =>
      authorize(actor, "instances:participate", { participantOfInstance: true }),
    ).not.toThrow();
  });
});

describe("instance lifecycle", () => {
  const context = { revealEnabled: true, matchesPublished: true };

  it("permits only declared transitions", () => {
    expect(canTransitionInstance("draft", "enrolling")).toBe(true);
    expect(canTransitionInstance("draft", "active")).toBe(false);
    expect(canTransitionInstance("archived", "draft")).toBe(false);
  });

  it("blocks activation before matches are published", () => {
    expect(() =>
      assertInstanceTransition("locked", "active", { ...context, matchesPublished: false }),
    ).toThrowError();
  });

  it("blocks reveal when the snapshot disabled it", () => {
    expect(() =>
      assertInstanceTransition("active", "reveal_pending", { ...context, revealEnabled: false }),
    ).toThrowError();
  });

  it("treats repeated enrollment and withdrawal as idempotent", () => {
    expect(() => assertParticipantTransition("enrolled", "enrolled")).not.toThrow();
    expect(() => assertParticipantTransition("withdrawn", "withdrawn")).not.toThrow();
    expect(() => assertParticipantTransition("withdrawn", "excluded")).toThrowError();
  });
});

describe("consent", () => {
  const registry = [
    {
      purpose: "ai_processing" as const,
      granted: true,
      consentVersion: "2026-01-01",
      grantedAt: "2026-01-02T00:00:00.000Z",
      expiresAt: null,
    },
    {
      purpose: "messaging" as const,
      granted: true,
      consentVersion: "2025-01-01",
      grantedAt: "2025-01-02T00:00:00.000Z",
      expiresAt: null,
    },
  ];

  it("honours a current grant", () => {
    expect(hasConsent(registry, "ai_processing", "2026-01-01")).toBe(true);
  });

  it("treats a stale consent version as a denial", () => {
    expect(hasConsent(registry, "messaging", "2026-01-01")).toBe(false);
  });

  it("treats a missing record as a denial", () => {
    expect(hasConsent(registry, "insights_survey", "2026-01-01")).toBe(false);
  });
});

describe("time zone overlap", () => {
  it("finds overlap between nearby zones", () => {
    const minutes = overlapMinutes("America/Toronto", "America/New_York", new Date("2026-03-10T12:00:00Z"));
    expect(minutes).toBe(480);
  });

  it("returns zero rather than failing for distant zones", () => {
    const minutes = overlapMinutes("America/Vancouver", "Asia/Singapore", new Date("2026-03-10T12:00:00Z"));
    expect(minutes).toBe(0);
  });

  it("accounts for daylight saving transitions", () => {
    const winter = overlapMinutes("America/Toronto", "Europe/London", new Date("2026-01-15T12:00:00Z"));
    const summer = overlapMinutes("America/Toronto", "Europe/London", new Date("2026-07-15T12:00:00Z"));
    expect(winter).toBe(summer);
  });
});
