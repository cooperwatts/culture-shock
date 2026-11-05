import { describe, expect, it } from "vitest";
import { buildExportBundle, pseudonym, type ExportInputRows } from "../src/privacy-export.js";

const SUBJECT_PARTICIPANT = "par_1111111111111111111111111111aaaa";
const PEER_PARTICIPANT = "par_2222222222222222222222222222bbbb";

const rows: ExportInputRows = {
  user: {
    id: "usr_33333333333333333333333333333333",
    display_name: "Sam Rivera",
    status: "active",
    created_at: "2026-01-02T00:00:00.000Z",
  },
  workEmail: "sam.rivera@example.com",
  identities: [
    { provider_kind: "entra-id", issuer: "https://login.example/v2.0", provider_subject: "sub-123" },
  ],
  roleGrants: [{ role: "participant", scope_type: "installation", scope_key: "", created_at: "2026-01-02T00:00:00.000Z" }],
  participations: [
    {
      participant_id: SUBJECT_PARTICIPANT,
      instance_id: "ins_44444444444444444444444444444444",
      instance_name: "Spring Connections",
      status: "enrolled",
      joined_at: "2026-02-01T00:00:00.000Z",
      withdrawn_at: null,
      preferences_json: '{"department":"technology","timeZone":"America/Toronto"}',
      consent_json: '{"messaging":true,"profile_derivation":true}',
      consent_version: "2026-01-01",
    },
  ],
  matchMemberships: [
    {
      instance_id: "ins_44444444444444444444444444444444",
      group_key: "group-0001",
      participant_id: SUBJECT_PARTICIPANT,
      peer_participant_id: PEER_PARTICIPANT,
      published_at: "2026-02-10T00:00:00.000Z",
    },
  ],
  activities: [
    {
      instance_id: "ins_44444444444444444444444444444444",
      type: "conversation",
      state: "completed",
      completed_at: "2026-02-12T00:00:00.000Z",
    },
  ],
  recognitions: [
    {
      instance_id: "ins_44444444444444444444444444444444",
      direction: "received",
      counterparty_participant_id: PEER_PARTICIPANT,
      message: "Thanks for walking me through the release process.",
      visibility: "recipient_only",
      created_at: "2026-02-14T00:00:00.000Z",
    },
  ],
  notifications: [
    {
      instance_id: "ins_44444444444444444444444444444444",
      template_key: "match_published",
      channel: "email",
      state: "delivered",
      scheduled_at: "2026-02-10T00:00:00.000Z",
      delivered_at: "2026-02-10T00:01:00.000Z",
    },
  ],
  aiInteractions: [
    {
      purpose: "copilot_recommendation",
      provider_key: "primary",
      model_id: "gpt-4o-mini",
      redaction_level: "identifiers_removed",
      status: "succeeded",
      created_at: "2026-02-05T00:00:00.000Z",
    },
  ],
  auditEvents: [
    {
      action: "participant.enrolled",
      resource_type: "participant",
      purpose: "participation",
      occurred_at: "2026-02-01T00:00:00.000Z",
    },
  ],
};

describe("privacy export bundle", () => {
  const bundle = buildExportBundle(rows, "2026-03-01T00:00:00.000Z");
  const serialized = JSON.stringify(bundle);

  it("includes the subject's own identity and contact details", () => {
    expect(bundle.subject.displayName).toBe("Sam Rivera");
    expect(bundle.subject.workEmail).toBe("sam.rivera@example.com");
    expect(bundle.identities[0]?.subject).toBe("sub-123");
  });

  it("includes what the subject shared and permitted", () => {
    const participation = bundle.participation[0] as Record<string, unknown>;
    expect(participation.preferencesYouShared).toEqual({
      department: "technology",
      timeZone: "America/Toronto",
    });
    expect(participation.permissionsYouGranted).toEqual({ messaging: true, profile_derivation: true });
  });

  it("reduces every third party to a pseudonym", () => {
    expect(serialized).not.toContain(PEER_PARTICIPANT);
    expect(bundle.connections[0]).toMatchObject({ peers: [pseudonym(PEER_PARTICIPANT)] });
    expect(bundle.recognitions[0]).toMatchObject({ counterparty: pseudonym(PEER_PARTICIPANT) });
  });

  it("keeps message content the subject can already read", () => {
    expect(bundle.recognitions[0]).toMatchObject({
      message: "Thanks for walking me through the release process.",
    });
  });

  it("reports AI usage as metadata, never as prompts or completions", () => {
    const interaction = bundle.aiInteractions[0] as Record<string, unknown>;
    expect(interaction).toMatchObject({ purpose: "copilot_recommendation", status: "succeeded" });
    expect(Object.keys(interaction)).not.toContain("prompt");
    expect(Object.keys(interaction)).not.toContain("content");
  });

  it("reports notification metadata without message bodies", () => {
    const notification = bundle.notifications[0] as Record<string, unknown>;
    expect(notification).toMatchObject({ template: "match_published", state: "delivered" });
    expect(Object.keys(notification)).not.toContain("body");
    expect(Object.keys(notification)).not.toContain("subject");
  });

  it("tolerates corrupt stored JSON instead of failing the whole export", () => {
    const corrupted = buildExportBundle(
      {
        ...rows,
        participations: [{ ...rows.participations[0]!, preferences_json: "{not json" }],
      },
      "2026-03-01T00:00:00.000Z",
    );
    expect((corrupted.participation[0] as Record<string, unknown>).preferencesYouShared).toBeNull();
  });

  it("groups multiple peers into a single connection entry", () => {
    const thirdParticipant = "par_5555555555555555555555555555cccc";
    const grouped = buildExportBundle(
      {
        ...rows,
        matchMemberships: [
          ...rows.matchMemberships,
          { ...rows.matchMemberships[0]!, peer_participant_id: thirdParticipant },
        ],
      },
      "2026-03-01T00:00:00.000Z",
    );
    expect(grouped.connections).toHaveLength(1);
    expect((grouped.connections[0] as { peers: string[] }).peers).toHaveLength(2);
  });

  it("carries a plain-language notice about third parties", () => {
    expect(bundle.notice).toContain("pseudonyms");
  });
});
