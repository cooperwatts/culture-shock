import type { AiProviderConfig } from "@culture-shock/config";
import { createMockProvider } from "./mock-provider.js";
import {
  AiError,
  assertClassificationPermitted,
  parseStructured,
  type AiProvider,
  type AiResult,
  type AiUsage,
  type GenerateStructuredInput,
} from "./provider.js";

export interface ProviderCredentials {
  readonly apiKey?: string;
  /** Workers AI binding, supplied only when the Cloudflare adapter is enabled. */
  readonly workersAi?: { run(model: string, input: unknown): Promise<unknown> };
}

const JSON_INSTRUCTION =
  "Respond with a single JSON object that matches the requested schema. Do not include commentary, markdown, or explanations.";

function withTimeout(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const forward = () => controller.abort();
  signal?.addEventListener("abort", forward, { once: true });
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", forward);
    },
  };
}

function classifyHttpError(status: number, body: string): AiError {
  const retryable = status === 408 || status === 429 || status >= 500;
  // Provider bodies can contain prompt echoes; only the status is surfaced.
  return new AiError(
    `AI provider request failed with status ${status}`,
    retryable,
    {
      status,
      bodyLength: body.length,
    },
  );
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
  maxRetries: number,
  signal?: AbortSignal,
): Promise<unknown> {
  let lastError: AiError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const { signal: timeoutSignal, dispose } = withTimeout(signal, timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: timeoutSignal,
      });
      if (!response.ok) {
        const text = await response.text();
        const error = classifyHttpError(response.status, text);
        if (!error.retryable || attempt === maxRetries) throw error;
        lastError = error;
      } else {
        return await response.json();
      }
    } catch (cause) {
      if (cause instanceof AiError) {
        if (!cause.retryable || attempt === maxRetries) throw cause;
        lastError = cause;
      } else {
        const error = new AiError(
          "AI provider request could not be completed",
          true,
        );
        if (attempt === maxRetries) throw error;
        lastError = error;
      }
    } finally {
      dispose();
    }

    // Exponential backoff with deterministic jitter bounded by the attempt.
    const backoff = Math.min(2000, 150 * 2 ** attempt) + attempt * 37;
    await new Promise((resolve) => setTimeout(resolve, backoff));
  }

  throw lastError ?? new AiError("AI provider request failed", false);
}

function usageFrom(input: unknown): AiUsage {
  const usage = (input as { usage?: Record<string, number> } | null)?.usage;
  return {
    inputTokens: usage?.prompt_tokens ?? usage?.input_tokens ?? null,
    outputTokens: usage?.completion_tokens ?? usage?.output_tokens ?? null,
    costEstimateUsd: null,
  };
}

function provenanceFor(
  config: AiProviderConfig,
  modelId: string,
  promptVersion: string,
) {
  return {
    providerKey: config.key,
    providerKind: config.kind,
    modelId,
    promptVersion,
    redactionLevel: "identifiers_removed",
    requestedAt: new Date().toISOString(),
  };
}

function buildMessages<T>(
  input: GenerateStructuredInput<T>,
): Array<{ role: string; content: string }> {
  return [
    { role: "system", content: JSON_INSTRUCTION },
    ...input.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ];
}

function openAiCompatibleProvider(
  config: AiProviderConfig,
  credentials: ProviderCredentials,
  buildUrl: (modelId: string) => string,
  buildHeaders: () => Record<string, string>,
): AiProvider {
  return {
    key: config.key,
    kind: config.kind,
    async generateStructured<T>(
      input: GenerateStructuredInput<T>,
    ): Promise<AiResult<T>> {
      assertClassificationPermitted(input.policy);
      const modelId = config.deployment ?? input.schemaName;
      const payload = await postJson(
        buildUrl(modelId),
        buildHeaders(),
        {
          model: config.deployment ?? modelId,
          messages: buildMessages(input),
          max_tokens: input.budget.maxOutputTokens,
          temperature: 0.2,
          response_format: { type: "json_object" },
        },
        config.requestTimeoutMs,
        config.maxRetries,
        input.signal,
      );

      const content = (
        payload as { choices?: Array<{ message?: { content?: string } }> }
      ).choices?.[0]?.message?.content;
      if (typeof content !== "string")
        throw new AiError("Provider returned an empty response", false);

      return {
        data: parseStructured(input.schema, content),
        usage: usageFrom(payload),
        provenance: provenanceFor(config, modelId, input.promptVersion),
        uncertainty: [],
      };
    },
  };
}

export function createOpenAiProvider(
  config: AiProviderConfig,
  credentials: ProviderCredentials,
): AiProvider {
  const baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
  return openAiCompatibleProvider(
    config,
    credentials,
    () => `${baseUrl}/chat/completions`,
    () => ({ authorization: `Bearer ${credentials.apiKey ?? ""}` }),
  );
}

export function createAzureOpenAiProvider(
  config: AiProviderConfig,
  credentials: ProviderCredentials,
): AiProvider {
  if (!config.baseUrl || !config.deployment || !config.apiVersion) {
    throw new AiError(
      "Azure OpenAI requires baseUrl, deployment and apiVersion",
      false,
    );
  }
  return openAiCompatibleProvider(
    config,
    credentials,
    (modelId) =>
      `${config.baseUrl}/openai/deployments/${encodeURIComponent(config.deployment ?? modelId)}/chat/completions?api-version=${encodeURIComponent(config.apiVersion ?? "")}`,
    () => ({ "api-key": credentials.apiKey ?? "" }),
  );
}

export function createAnthropicProvider(
  config: AiProviderConfig,
  credentials: ProviderCredentials,
): AiProvider {
  const baseUrl = config.baseUrl ?? "https://api.anthropic.com/v1";
  return {
    key: config.key,
    kind: config.kind,
    async generateStructured<T>(
      input: GenerateStructuredInput<T>,
    ): Promise<AiResult<T>> {
      assertClassificationPermitted(input.policy);
      const modelId = config.deployment ?? "claude-3-5-sonnet-latest";
      const payload = await postJson(
        `${baseUrl}/messages`,
        {
          "x-api-key": credentials.apiKey ?? "",
          "anthropic-version": config.apiVersion ?? "2023-06-01",
        },
        {
          model: modelId,
          max_tokens: input.budget.maxOutputTokens,
          temperature: 0.2,
          system: JSON_INSTRUCTION,
          messages: input.messages
            .filter((message) => message.role === "user")
            .map((message) => ({ role: "user", content: message.content })),
        },
        config.requestTimeoutMs,
        config.maxRetries,
        input.signal,
      );

      const content = (payload as { content?: Array<{ text?: string }> })
        .content?.[0]?.text;
      if (typeof content !== "string")
        throw new AiError("Provider returned an empty response", false);

      return {
        data: parseStructured(input.schema, content),
        usage: usageFrom(payload),
        provenance: provenanceFor(config, modelId, input.promptVersion),
        uncertainty: [],
      };
    },
  };
}

export function createWorkersAiProvider(
  config: AiProviderConfig,
  credentials: ProviderCredentials,
): AiProvider {
  const binding = credentials.workersAi;
  if (!binding)
    throw new AiError("Workers AI binding is not configured", false);
  return {
    key: config.key,
    kind: config.kind,
    async generateStructured<T>(
      input: GenerateStructuredInput<T>,
    ): Promise<AiResult<T>> {
      assertClassificationPermitted(input.policy);
      const modelId = config.deployment ?? "@cf/meta/llama-3.1-8b-instruct";
      const payload = await binding.run(modelId, {
        messages: buildMessages(input),
        max_tokens: input.budget.maxOutputTokens,
        temperature: 0.2,
      });
      const content = (payload as { response?: string }).response;
      if (typeof content !== "string")
        throw new AiError("Provider returned an empty response", false);
      return {
        data: parseStructured(input.schema, content),
        usage: { inputTokens: null, outputTokens: null, costEstimateUsd: null },
        provenance: provenanceFor(config, modelId, input.promptVersion),
        // Smaller local models follow structured output less reliably.
        uncertainty: ["local_model_structured_output"],
      };
    },
  };
}

export function createProvider(
  config: AiProviderConfig,
  credentials: ProviderCredentials,
): AiProvider {
  switch (config.kind) {
    case "openai":
      return createOpenAiProvider(config, credentials);
    case "azure-openai":
      return createAzureOpenAiProvider(config, credentials);
    case "anthropic":
      return createAnthropicProvider(config, credentials);
    case "cloudflare-ai":
      return createWorkersAiProvider(config, credentials);
    case "mock":
      return createMockProvider(config);
  }
}
