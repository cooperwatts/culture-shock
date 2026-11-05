import {
  AiOrchestrator,
  buildCopilotMessage,
  copilotInputSchema,
  copilotResponseSchema,
  fallbackRecommendation,
  redact,
  COPILOT_PROMPT_VERSION,
  type AiInteractionRecord,
  type AiInteractionSink,
  type CopilotResponse,
  type ProviderCredentials,
} from "@culture-shock/ai";
import type { InstallationConfig } from "@culture-shock/config";
import { newId, type UserId } from "@culture-shock/domain";
import { Database, nowIso } from "../db/database.js";
import type { Env } from "../env.js";
import { secret } from "../env.js";

/** Persists sanitized interaction metadata; raw prompts are never stored. */
class D1InteractionSink implements AiInteractionSink {
  constructor(
    private readonly db: Database,
    private readonly userId: UserId | null,
  ) {}

  async record(interaction: AiInteractionRecord): Promise<void> {
    await this.db.run(
      `INSERT INTO ai_interactions
         (id, organization_id, user_id, purpose, provider_key, model_id, prompt_version, redaction_level,
          input_tokens, output_tokens, cost_estimate_usd, status, error_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId("AiInteractionId"),
        this.db.organizationId,
        this.userId,
        interaction.purpose,
        interaction.providerKey,
        interaction.modelId,
        interaction.promptVersion,
        interaction.redactionLevel,
        interaction.inputTokens,
        interaction.outputTokens,
        interaction.costEstimateUsd,
        interaction.status,
        interaction.errorCode,
        nowIso(),
      ],
    );
  }
}

function credentialsFor(
  env: Env,
  config: InstallationConfig,
): Map<string, ProviderCredentials> {
  const credentials = new Map<string, ProviderCredentials>();
  for (const provider of config.ai.providers) {
    const key = provider.key.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    credentials.set(provider.key, {
      apiKey: secret(env, `AI_API_KEY_${key}`),
      workersAi: provider.kind === "cloudflare-ai" ? env.AI : undefined,
    });
  }
  return credentials;
}

export function createOrchestrator(
  env: Env,
  config: InstallationConfig,
  db: Database,
  userId: UserId | null,
): AiOrchestrator {
  // Second gate behind the publish check: a stored mock provider simply
  // disappears outside development, so the purpose degrades to the fallback.
  const safe =
    env.ENVIRONMENT === "development"
      ? config
      : {
          ...config,
          ai: {
            ...config.ai,
            providers: config.ai.providers.filter((p) => p.kind !== "mock"),
          },
        };

  return new AiOrchestrator(
    safe,
    credentialsFor(env, safe),
    new D1InteractionSink(db, userId),
  );
}

export interface CopilotOutcome {
  readonly response: CopilotResponse;
  readonly source: "ai" | "deterministic_fallback";
  readonly provenance: Record<string, unknown> | null;
  readonly uncertainty: readonly string[];
}

/**
 * Produces Culture Pack recommendations. AI is strictly optional: if it is
 * disabled, blocked by policy, or fails, the deterministic planner answers and
 * the caller is told which path produced the result.
 */
export async function recommend(input: {
  env: Env;
  config: InstallationConfig;
  db: Database;
  userId: UserId;
  availablePackIds: readonly string[];
  request: unknown;
}): Promise<CopilotOutcome> {
  const parsed = copilotInputSchema.parse({
    ...(input.request as object),
    availablePackIds: input.availablePackIds,
    locale: input.config.organization.defaultLocale,
  });

  const orchestrator = createOrchestrator(
    input.env,
    input.config,
    input.db,
    input.userId,
  );

  if (!orchestrator.isEnabled("copilot_recommendation")) {
    return {
      response: fallbackRecommendation(parsed),
      source: "deterministic_fallback",
      provenance: null,
      uncertainty: ["ai_disabled"],
    };
  }

  const message = redact(
    buildCopilotMessage(parsed, input.config.privacy.minimumCohortSize),
    "identifiers_removed",
  );

  try {
    const result = await orchestrator.run({
      purpose: "copilot_recommendation",
      schema: copilotResponseSchema,
      schemaName: "CopilotResponse",
      promptVersion: COPILOT_PROMPT_VERSION,
      messages: [{ role: "user", content: message.text }],
      classification: "internal",
      consentVersion: null,
    });

    // Recommendations must stay inside the enabled catalogue even if the model
    // invents a pack id.
    const permitted = new Set(input.availablePackIds);
    if (!permitted.has(result.data.primary.packId)) {
      return {
        response: fallbackRecommendation(parsed),
        source: "deterministic_fallback",
        provenance: null,
        uncertainty: ["model_recommended_unavailable_pack"],
      };
    }

    return {
      response: {
        primary: result.data.primary,
        alternatives: result.data.alternatives.filter((alternative) =>
          permitted.has(alternative.packId),
        ),
      },
      source: "ai",
      provenance: { ...result.provenance, redactedKinds: message.removedKinds },
      uncertainty: result.uncertainty,
    };
  } catch {
    return {
      response: fallbackRecommendation(parsed),
      source: "deterministic_fallback",
      provenance: null,
      uncertainty: ["ai_request_failed"],
    };
  }
}
