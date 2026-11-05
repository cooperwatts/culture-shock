export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type LogValue = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogValue>;

/**
 * Field names that must never be logged, even if a caller passes them. This is
 * a backstop: callers are expected to log identifiers and codes, not content.
 */
const FORBIDDEN_KEYS = new Set([
  "email",
  "emailaddress",
  "workemail",
  "password",
  "secret",
  "token",
  "apikey",
  "authorization",
  "cookie",
  "message",
  "body",
  "subject",
  "prompt",
  "completion",
  "displayname",
  "name",
  "preferences",
  "address",
]);

const PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "[email]"],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "[token]"],
  [/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, "[phone]"],
];

export function redactValue(value: LogValue): LogValue {
  if (typeof value !== "string") return value;
  let output = value;
  for (const [pattern, replacement] of PATTERNS) output = output.replace(pattern, replacement);
  return output.length > 300 ? `${output.slice(0, 300)}…` : output;
}

/** Drops forbidden keys outright and scrubs recognisable identifiers from the rest. */
export function redactFields(fields: LogFields): LogFields {
  const output: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (FORBIDDEN_KEYS.has(key.toLowerCase().replace(/[^a-z]/g, ""))) {
      output[key] = "[redacted]";
      continue;
    }
    output[key] = redactValue(value);
  }
  return output;
}

export interface LoggerOptions {
  readonly level: LogLevel;
  readonly service: string;
  readonly environment: string;
  readonly base?: LogFields;
  /** Injected for tests; defaults to the console. */
  readonly sink?: (line: string) => void;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Emits a machine-readable alert an operator can route on. */
  alert(code: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export function createLogger(options: LoggerOptions): Logger {
  const sink = options.sink ?? ((line: string) => console.log(line));
  const threshold = LEVEL_ORDER[options.level];

  const emit = (level: LogLevel, message: string, fields: LogFields = {}): void => {
    if (LEVEL_ORDER[level] < threshold) return;
    sink(
      JSON.stringify({
        level,
        message,
        service: options.service,
        environment: options.environment,
        at: new Date().toISOString(),
        ...redactFields({ ...options.base, ...fields }),
      }),
    );
  };

  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
    alert: (code, fields) => emit("error", "alert", { ...fields, alert: code }),
    child: (fields) => createLogger({ ...options, base: { ...options.base, ...fields }, sink }),
  };
}
