import { describe, expect, it } from "vitest";
import { DEFAULT_BRAND_THEME, terminologySchema } from "@culture-shock/config";
import type { CommunicationTemplate } from "@culture-shock/pack-sdk";
import {
  buildTemplateValues,
  createEmailProvider,
  createNullProvider,
  renderNotification,
  type RenderContext,
} from "../src/index.js";

const context: RenderContext = {
  locale: "en-CA",
  defaultLocale: "en-CA",
  terminology: terminologySchema.parse({}),
  theme: DEFAULT_BRAND_THEME,
  organizationName: "Example Corp",
  supportUrl: "mailto:support@example.com",
  unsubscribeUrl: null,
};

const template: CommunicationTemplate = {
  key: "match_published",
  channel: "email",
  trigger: "match_published",
  subject: { "en-CA": "Your {{terminology.matchSingular}} for {{experience.name}}" },
  body: {
    "en-CA": "Hello {{participant.displayName}},\n\nYou were matched with {{match.peerDisplayName}}.\n\n{{links.experienceUrl}}",
  },
  plainTextBody: { "en-CA": "You were matched with {{match.peerDisplayName}}. {{links.experienceUrl}}" },
};

const references = {
  organizationName: "Example Corp",
  experienceName: "Spring Connections",
  startsAt: "2026-03-10T13:00:00.000Z",
  endsAt: "2026-03-24T13:00:00.000Z",
  enrollmentClosesAt: "2026-03-08T13:00:00.000Z",
  timeZone: "America/Toronto",
  participantDisplayName: "Sam Rivera",
  participantPseudonym: "member-abc123",
  peerDisplayName: "Jo Chen",
  peerPseudonym: "member-def456",
  experienceUrl: "https://example.invalid/participant/instances/ins_1",
  supportUrl: "support@example.com",
};

describe("notification rendering", () => {
  it("renders subject, html and plain text together", () => {
    const values = buildTemplateValues(references, context);
    const message = renderNotification(template, values, context);

    expect(message.subject).toBe("Your Connection for Spring Connections");
    expect(message.html).toContain("You were matched with Jo Chen.");
    expect(message.text).toContain("You were matched with Jo Chen.");
    expect(message.text).not.toContain("<");
  });

  it("escapes participant-supplied values in the HTML surface", () => {
    const values = buildTemplateValues(
      { ...references, peerDisplayName: '<img src=x onerror="alert(1)">' },
      context,
    );
    const message = renderNotification(template, values, context);

    expect(message.html).not.toContain("<img");
    expect(message.html).toContain("&lt;img");
  });

  it("renders unknown variables as empty rather than leaking the placeholder", () => {
    const leaky: CommunicationTemplate = {
      ...template,
      body: { "en-CA": "Hello {{participant.homeAddress}} and {{participant.displayName}}" },
    };
    const message = renderNotification(leaky, buildTemplateValues(references, context), context);

    expect(message.html).not.toContain("homeAddress");
    expect(message.html).not.toContain("{{");
    expect(message.html).toContain("Sam Rivera");
  });

  it("falls back to the default locale when the requested one is missing", () => {
    const message = renderNotification(template, buildTemplateValues(references, context), {
      ...context,
      locale: "fr-CA",
    });
    expect(message.subject).toContain("Spring Connections");
  });

  it("formats instants in the run's time zone, not UTC", () => {
    const values = buildTemplateValues(references, context);
    // 13:00 UTC on 10 March is 09:00 in Toronto (EDT).
    expect(values["experience.startsAt"]).toContain("9:00");
    expect(values["experience.startsAt"]).toContain("EDT");
  });

  it("omits peer identity when the caller did not resolve it", () => {
    const values = buildTemplateValues(
      { ...references, peerDisplayName: null, peerPseudonym: null },
      context,
    );
    expect(values["match.peerDisplayName"]).toBe("");
  });

  it("references no external stylesheet, font or image", () => {
    const message = renderNotification(template, buildTemplateValues(references, context), context);
    expect(message.html).not.toContain("<link");
    expect(message.html).not.toContain("<img");
    expect(message.html).not.toContain("@import");
  });
});

describe("email providers", () => {
  it("fails closed when delivery is disabled", async () => {
    const outcome = await createNullProvider().send({
      to: { address: "person@example.com", displayName: null },
      from: "noreply@example.com",
      replyTo: null,
      subject: "Subject",
      html: "<p>Body</p>",
      text: "Body",
      idempotencyKey: "n_1",
    });
    expect(outcome).toEqual({ status: "failed", retryable: false, errorCode: "email_disabled" });
  });

  it("falls back to the null provider for an unknown kind", () => {
    expect(createEmailProvider("carrier-pigeon", {}).kind).toBe("none");
  });

  it("declares honestly whether a provider deduplicates", () => {
    expect(createEmailProvider("resend", { apiKey: "k" }).supportsIdempotency).toBe(true);
    expect(createEmailProvider("sendgrid", { apiKey: "k" }).supportsIdempotency).toBe(false);
    expect(createEmailProvider("mailchannels", {}).supportsIdempotency).toBe(false);
  });

  it("refuses to send without a credential instead of silently succeeding", async () => {
    const outcome = await createEmailProvider("resend", {}).send({
      to: { address: "person@example.com", displayName: null },
      from: "noreply@example.com",
      replyTo: null,
      subject: "Subject",
      html: "<p>Body</p>",
      text: "Body",
      idempotencyKey: "n_1",
    });
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") expect(outcome.errorCode).toBe("missing_credential");
  });
});
