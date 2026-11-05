import { DomainError } from "@culture-shock/domain";
import type { AiPurpose } from "@culture-shock/config";
import type { z } from "zod";

export type DataClassification = "public" | "internal" | "confidential" | "participant_sensitive";

export const CLASSIFICATION_ORDER: Readonly<Record<DataClassification, number>> = {
  public: 0,
  internal: 1,
  confidential: 2,
  participant_sensitive: 3,
};

export interface AiMessage {
  readonly role: "system" | "user";
  readonly content: string;
}

export interface AiRequestPolicy {
  readonly purpose: AiPurpose;
  readonly classification: DataClassification;
  readonly maxClassification: DataClassification;
  readonly consentVersion: string | null;
  readonly locale: string;
}

export interface AiBudget {
  readonly maxOutputTokens: number;
  readonly maxCostUsd: number;
  readonly timeoutMs: number;
}

export interface AiUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly costEstimateUsd: number | null;
}

export interface AiProvenance {
  readonly providerKey: string;
  readonly providerKind: string;
  readonly modelId: string;
  readonly promptVersion: string;
  readonly redactionLevel: string;
  readonly requestedAt: string;
}

export interface AiResult<T> {
  readonly data: T;
  readonly usage: AiUsage;
  readonly provenance: AiProvenance;
  /** Set when the model's confidence or the validator's checks were weak. */
  readonly uncertainty: readonly string[];
}

export interface GenerateStructuredInput<T> {
  readonly purpose: AiPurpose;
  /** Typed as unknown input so `T` always resolves to the schema's output. */
  readonly schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  readonly schemaName: string;
  readonly messages: readonly AiMessage[];
  readonly policy: AiRequestPolicy;
  readonly budget: AiBudget;
  readonly promptVersion: string;
  readonly signal?: AbortSignal;
}

export interface AiProvider {
  readonly key: string;
  readonly kind: string;
  generateStructured<T>(input: GenerateStructuredInput<T>): Promise<AiResult<T>>;
}

export class AiError extends DomainError {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean, details?: Record<string, unknown>) {
    super("ai_provider_error", message, details);
    this.name = "AiError";
    this.retryable = retryable;
  }
}

export class AiDisabledError extends DomainError {
  constructor(purpose: string) {
    super("ai_disabled", "AI is not enabled for this workflow", { purpose });
    this.name = "AiDisabledError";
  }
}

/**
 * Parses and validates a provider response. Generated JSON is never trusted:
 * it must satisfy the caller's schema or the call fails closed.
 */
export function parseStructured<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, raw: string): T {
  let candidate: unknown;
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const body = fenced?.[1] ?? trimmed;
  try {
    candidate = JSON.parse(body);
  } catch {
    throw new AiError("Provider returned output that is not valid JSON", false);
  }
  const result = schema.safeParse(candidate);
  if (!result.success) {
    throw new AiError("Provider output failed schema validation", false, {
      issues: result.error.issues.slice(0, 5).map((issue) => issue.path.join(".")),
    });
  }
  return result.data;
}

/** Blocks a request whose data classification exceeds the configured ceiling. */
export function assertClassificationPermitted(policy: AiRequestPolicy): void {
  if (CLASSIFICATION_ORDER[policy.classification] > CLASSIFICATION_ORDER[policy.maxClassification]) {
    throw new DomainError("policy_violation", "Data classification exceeds the configured AI egress policy", {
      purpose: policy.purpose,
      classification: policy.classification,
      maxClassification: policy.maxClassification,
    });
  }
}
