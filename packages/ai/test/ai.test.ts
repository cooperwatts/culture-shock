import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AiOrchestrator,
  assertClassificationPermitted,
  buildCopilotMessage,
  coarsePercentage,
  copilotInputSchema,
  copilotResponseSchema,
  fallbackRecommendation,
  parseStructured,
  redact,
  sizeBand,
  toAggregateBands,
  type AiInteractionRecord,
} from "../src/index.js";
import {
  DEFAULT_BRAND_THEME,
  INSTALLATION_CONFIG_SCHEMA_VERSION,
  installationConfigSchema,
} from "@culture-shock/config";

const config = installationConfigSchema.parse({
  schemaVersion: INSTALLATION_CONFIG_SCHEMA_VERSION,
  setupComplete: true,
  organization: {
    name: "Example",
    slug: "example",
    defaultLocale: "en-CA",
    supportedLocales: ["en-CA"],
  },
  branding: DEFAULT_BRAND_THEME,
  authentication: {
    providers: [
      {
        kind: "google-workspace",
        enabled: true,
        issuer: "https://accounts.google.com",
        clientId: "client",
      },
    ],
  },
});

describe("redaction", () => {
  it("removes direct identifiers before anything can leave the installation", () => {
    const outcome = redact(
      "Contact alex@example.com or par_0123456789abcdef0123456789abcdef at https://intranet.example.com",
    );
    expect(outcome.text).not.toContain("alex@example.com");
    expect(outcome.text).not.toContain("par_0123456789abcdef0123456789abcdef");
    expect(outcome.text).not.toContain("https://intranet.example.com");
    expect(outcome.removedKinds).toEqual(["email", "id", "url"]);
  });

  it("bands headcounts instead of exposing exact numbers", () => {
    expect(sizeBand(7)).toBe("under_10");
    expect(sizeBand(1200)).toBe("1000_to_4999");
  });

  it("rounds percentages to the nearest five", () => {
    expect(coarsePercentage(37, 100)).toBe(35);
    expect(coarsePercentage(1, 0)).toBeNull();
  });

  it("drops cohorts below the installation minimum", () => {
    const bands = toAggregateBands(
      [
        { label: "technology", count: 120 },
        { label: "legal", count: 4 },
      ],
      10,
    );
    expect(bands).toEqual([{ label: "technology", band: "50_to_199" }]);
  });
});

describe("structured output handling", () => {
  const schema = z.object({ answer: z.string().max(10) });

  it("accepts a fenced JSON response", () => {
    expect(parseStructured(schema, '```json\n{"answer":"yes"}\n```')).toEqual({
      answer: "yes",
    });
  });

  it("rejects output that is not valid JSON", () => {
    expect(() => parseStructured(schema, "sure thing!")).toThrowError();
  });

  it("rejects output that does not satisfy the schema", () => {
    expect(() =>
      parseStructured(schema, '{"answer":"a much longer answer"}'),
    ).toThrowError();
  });
});

describe("egress policy", () => {
  it("blocks data above the configured classification ceiling", () => {
    expect(() =>
      assertClassificationPermitted({
        purpose: "copilot_recommendation",
        classification: "participant_sensitive",
        maxClassification: "internal",
        consentVersion: null,
        locale: "en-CA",
      }),
    ).toThrowError();
  });
});

describe("copilot", () => {
  const input = copilotInputSchema.parse({
    headcount: 1200,
    remoteSharePercent: 70,
    countries: ["CA", "US"],
    departments: [
      { label: "technology", count: 300 },
      { label: "legal", count: 3 },
    ],
    timeZones: ["America/Toronto", "America/Vancouver"],
    objectives: ["We want stronger cross-functional relationships"],
    availablePackIds: [
      "cross-team-connector",
      "coffee-roulette",
      "secret-santa",
    ],
  });

  it("sends only bands and objectives to the provider", () => {
    const message = buildCopilotMessage(input, 10);
    expect(message).toContain("1000_to_4999");
    expect(message).not.toContain("1200");
    // The three-person department is below the cohort threshold and is dropped.
    expect(message).not.toContain("legal");
  });

  it("produces a deterministic recommendation when AI is unavailable", () => {
    const first = fallbackRecommendation(input);
    const second = fallbackRecommendation(input);
    expect(first).toEqual(second);
    expect(first.primary.packId).toBe("cross-team-connector");
    expect(first.primary.metricPlan).toContain("department_bridge_score");
  });

  it("runs the full provider path through the mock and logs the interaction", async () => {
    const records: AiInteractionRecord[] = [];
    const withMock = installationConfigSchema.parse({
      ...config,
      ai: {
        enabled: true,
        egressReviewedBy: "test",
        egressReviewedAt: new Date().toISOString(),
        providers: [{ key: "local", kind: "mock" }],
        purposes: {
          copilot_recommendation: {
            enabled: true,
            providerKey: "local",
            modelId: "mock",
          },
        },
      },
    });

    const orchestrator = new AiOrchestrator(withMock, new Map(), {
      async record(interaction) {
        records.push(interaction);
      },
    });

    expect(orchestrator.isEnabled("copilot_recommendation")).toBe(true);

    const result = await orchestrator.run({
      purpose: "copilot_recommendation",
      schema: copilotResponseSchema,
      schemaName: "CopilotResponse",
      promptVersion: "test",
      messages: [{ role: "user", content: buildCopilotMessage(input, 10) }],
      classification: "internal",
      consentVersion: null,
    });

    // The mock answers from availablePackIds, so the catalogue check passes.
    expect(result.data.primary.packId).toBe("cross-team-connector");
    expect(result.provenance.providerKind).toBe("mock");
    expect(records).toHaveLength(1);
    expect(records[0]?.status).toBe("succeeded");
  });

  it("refuses to call a provider when the purpose is disabled", async () => {
    const records: AiInteractionRecord[] = [];
    const orchestrator = new AiOrchestrator(config, new Map(), {
      async record(interaction) {
        records.push(interaction);
      },
    });

    expect(orchestrator.isEnabled("copilot_recommendation")).toBe(false);
    await expect(
      orchestrator.run({
        purpose: "copilot_recommendation",
        schema: z.object({ ok: z.boolean() }),
        schemaName: "Probe",
        promptVersion: "test/1.0.0",
        messages: [{ role: "user", content: "hello" }],
        classification: "internal",
        consentVersion: null,
      }),
    ).rejects.toThrowError();

    expect(records[0]?.status).toBe("blocked");
    expect(records[0]?.errorCode).toBe("ai_disabled");
  });
});
