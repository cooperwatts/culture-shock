import type { AiProviderConfig } from "@culture-shock/config";
import {
  parseStructured,
  type AiProvider,
  type AiResult,
  type GenerateStructuredInput,
} from "./provider.js";

/**
 * A provider that answers from the prompt instead of calling anything. It
 * exists so the orchestrator, redaction, budget and approval paths can be
 * exercised without a paid API key or network egress.
 *
 * Callers must keep this out of deployed installations; the API refuses to
 * publish a configuration using it outside development, and strips it if one
 * somehow survives.
 */
export function createMockProvider(config: AiProviderConfig): AiProvider {
  return {
    key: config.key,
    kind: "mock",
    async generateStructured<T>(
      input: GenerateStructuredInput<T>,
    ): Promise<AiResult<T>> {
      const prompt = input.messages
        .map((message) => message.content)
        .join("\n");
      const body = buildResponse(input.schemaName, prompt);

      return {
        // Parsed through the real validator, so a malformed stub fails the
        // same way a malformed model response would.
        data: parseStructured(input.schema, JSON.stringify(body)),
        usage: {
          inputTokens: prompt.length,
          outputTokens: JSON.stringify(body).length,
          costEstimateUsd: 0,
        },
        provenance: {
          providerKey: config.key,
          providerKind: "mock",
          modelId: "mock",
          promptVersion: input.promptVersion,
          redactionLevel: input.policy.classification,
          requestedAt: new Date().toISOString(),
        },
        uncertainty: ["mock_provider"],
      };
    },
  };
}

/** Pulls the first allowed pack out of the prompt so the reply is valid. */
function firstAvailablePackId(prompt: string): string {
  const match = /"availablePackIds":\s*\[\s*"([^"]+)"/.exec(prompt);
  return match?.[1] ?? "coffee-roulette";
}

/** Avoids colliding with slugs the prompt says are already installed. */
function freeSlug(prompt: string): string {
  const taken = new Set(
    Array.from(prompt.matchAll(/"([a-z0-9][a-z0-9-]{2,59})"/g), (m) => m[1]),
  );
  for (let suffix = 1; suffix < 100; suffix += 1) {
    const candidate = `mock-draft-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `mock-draft-${Date.now()}`;
}

function buildResponse(schemaName: string, prompt: string): unknown {
  if (schemaName === "CopilotResponse") {
    return {
      primary: {
        packId: firstAvailablePackId(prompt),
        fitReasons: ["Stub answer from the mock AI provider."],
        matchingStrategy: {
          key: "cross-functional",
          rationale:
            "Fixed choice; the mock provider does not reason about the request.",
        },
        communicationPlan: [
          {
            trigger: "enrollment_open",
            timing: "On launch",
            summary: "Invite people to join.",
          },
        ],
        participationPlan: {
          mode: "optional",
          expectedParticipationPercent: 45,
          inclusionNotes: ["No real model was called."],
        },
        revealPlan: null,
        metricPlan: ["participation_rate"],
        risks: ["Do not read anything into this recommendation."],
        assumptions: ["Generated locally without a provider."],
      },
      alternatives: [],
    };
  }

  if (schemaName === "PackBuilderResponse") {
    return {
      rationale:
        "Stub blueprint from the mock AI provider. No real model was called.",
      blueprint: {
        slug: freeSlug(prompt),
        name: "Mock Draft Programme",
        summary:
          "A placeholder programme produced by the mock AI provider for local testing.",
        mechanic: "pair_match",
        matchingStrategyKey: "cross-functional",
        groupSize: 2,
        privacyMode: "pseudonymous",
        crossDepartment: true,
        objectives: [
          {
            key: "meet-someone-new",
            title: "Meet someone new",
            description: "Pair people who do not normally work together.",
            metric: "participation_rate",
          },
        ],
        missions: [
          {
            key: "first-conversation",
            title: "Have a first conversation",
            description:
              "Arrange a short call or coffee with the person you were matched with.",
            asynchronousAlternative:
              "Exchange a few messages instead if you cannot find a time.",
          },
        ],
        activities: [
          {
            key: "conversation-prompt",
            type: "conversation",
            title: "Conversation starter",
          },
        ],
        communications: [
          {
            key: "welcome",
            trigger: "match_published",
            subject: "You have been matched",
            body: "Say hello to the person you have been matched with and find a time that suits you both.",
          },
        ],
        insightMetrics: ["participation_rate"],
        dataRequirements: ["department", "time_zone"],
        risks: ["Generated by a stub; review before publishing."],
      },
    };
  }

  throw new Error(`Mock provider has no canned response for ${schemaName}`);
}
