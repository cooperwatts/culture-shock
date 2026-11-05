/**
 * Stable, client-safe error codes. Messages must never carry diagnostics,
 * participant data, or provider internals.
 */
export const ERROR_CODES = {
  unauthenticated: 401,
  csrf_failed: 403,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  conflict: 409,
  precondition_required: 428,
  precondition_failed: 412,
  validation_failed: 422,
  policy_violation: 422,
  invalid_state_transition: 409,
  consent_required: 422,
  capability_disabled: 422,
  rate_limited: 429,
  payload_too_large: 413,
  unsupported_media_type: 415,
  ai_disabled: 422,
  ai_provider_error: 502,
  dependency_unavailable: 503,
  internal_error: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.status = ERROR_CODES[code];
    this.details = details;
  }
}

export const unauthenticated = (message = "Authentication required") =>
  new DomainError("unauthenticated", message);

export const forbidden = (message = "Not permitted", details?: Record<string, unknown>) =>
  new DomainError("forbidden", message, details);

export const notFound = (message = "Resource not found") => new DomainError("not_found", message);

export const conflict = (message: string, details?: Record<string, unknown>) =>
  new DomainError("conflict", message, details);

export const validationFailed = (message: string, details?: Record<string, unknown>) =>
  new DomainError("validation_failed", message, details);

export const policyViolation = (message: string, details?: Record<string, unknown>) =>
  new DomainError("policy_violation", message, details);

export const invalidTransition = (message: string, details?: Record<string, unknown>) =>
  new DomainError("invalid_state_transition", message, details);

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}
