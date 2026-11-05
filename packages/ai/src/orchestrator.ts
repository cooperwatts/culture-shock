import type { AiPurpose, InstallationConfig } from "@culture-shock/config";
import { AiDisabledError, type AiProvider, type AiResult, type GenerateStructuredInput } from "./provider.js";
import { createProvider, type ProviderCredentials } from "./providers.js";

export interface AiInteractionRecord {
  readonly purpose: AiPurpose;
  readonly providerKey: string;
  readonly modelId: string;
  readonly promptVersion: string;
  readonly redactionLevel: string;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly costEstimateUsd: number | null;
  readonly status: "succeeded" | "failed" | "blocked";
  readonly errorCode: string | null;
}

export interface AiInteractionSink {
  record(interaction: AiInteractionRecord): Promise<void>;
}

/**
 * The AI control plane. It owns purpose gating, provider selection, budget
 * enforcement and interaction metadata. It never publishes anything: callers
 * receive a draft that a human must approve.
 */
export class AiOrchestrator {
  readonly #config: InstallationConfig;
  readonly #credentials: Map<string, ProviderCredentials>;
  readonly #sink: AiInteractionSink;
  readonly #providers = new Map<string, AiProvider>();

  constructor(
    config: InstallationConfig,
    credentials: Map<string, ProviderCredentials>,
    sink: AiInteractionSink,
  ) {
    this.#config = config;
    this.#credentials = credentials;
    this.#sink = sink;
  }

  isEnabled(purpose: AiPurpose): boolean {
    if (!this.#config.ai.enabled) return false;
    return this.#config.ai.purposes[purpose]?.enabled === true;
  }

  #provider(purpose: AiPurpose): AiProvider {
    const policy = this.#config.ai.purposes[purpose];
    if (!policy || !policy.enabled) throw new AiDisabledError(purpose);
    const cached = this.#providers.get(policy.providerKey);
    if (cached) return cached;

    const providerConfig = this.#config.ai.providers.find(
      (candidate) => candidate.key === policy.providerKey,
    );
    if (!providerConfig) throw new AiDisabledError(purpose);

    const provider = createProvider(providerConfig, this.#credentials.get(policy.providerKey) ?? {});
    this.#providers.set(policy.providerKey, provider);
    return provider;
  }

  /**
   * Executes a structured generation under the configured budget, recording
   * sanitized metadata whether the call succeeds, fails, or is blocked.
   */
  async run<T>(
    input: Omit<GenerateStructuredInput<T>, "budget" | "policy"> & {
      classification: "public" | "internal" | "confidential" | "participant_sensitive";
      consentVersion: string | null;
      locale?: string;
    },
  ): Promise<AiResult<T>> {
    const policy = this.#config.ai.purposes[input.purpose];
    if (!this.isEnabled(input.purpose) || !policy) {
      await this.#sink.record({
        purpose: input.purpose,
        providerKey: "none",
        modelId: "none",
        promptVersion: input.promptVersion,
        redactionLevel: "aggregate_only",
        inputTokens: null,
        outputTokens: null,
        costEstimateUsd: null,
        status: "blocked",
        errorCode: "ai_disabled",
      });
      throw new AiDisabledError(input.purpose);
    }

    const provider = this.#provider(input.purpose);
    const providerConfig = this.#config.ai.providers.find(
      (candidate) => candidate.key === policy.providerKey,
    );

    try {
      const result = await provider.generateStructured<T>({
        purpose: input.purpose,
        schema: input.schema,
        schemaName: input.schemaName,
        messages: input.messages,
        promptVersion: input.promptVersion,
        signal: input.signal,
        budget: {
          maxOutputTokens: policy.maxOutputTokens,
          maxCostUsd: policy.maxCostUsdPerRequest,
          timeoutMs: providerConfig?.requestTimeoutMs ?? 20000,
        },
        policy: {
          purpose: input.purpose,
          classification: input.classification,
          maxClassification: policy.maxClassification,
          consentVersion: input.consentVersion,
          locale: input.locale ?? this.#config.organization.defaultLocale,
        },
      });

      await this.#sink.record({
        purpose: input.purpose,
        providerKey: result.provenance.providerKey,
        modelId: result.provenance.modelId,
        promptVersion: result.provenance.promptVersion,
        redactionLevel: result.provenance.redactionLevel,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        costEstimateUsd: result.usage.costEstimateUsd,
        status: "succeeded",
        errorCode: null,
      });

      return result;
    } catch (cause) {
      const errorCode = cause instanceof Error ? cause.name : "unknown_error";
      await this.#sink.record({
        purpose: input.purpose,
        providerKey: policy.providerKey,
        modelId: policy.modelId,
        promptVersion: input.promptVersion,
        redactionLevel: "identifiers_removed",
        inputTokens: null,
        outputTokens: null,
        costEstimateUsd: null,
        status: "failed",
        errorCode,
      });
      throw cause;
    }
  }
}
