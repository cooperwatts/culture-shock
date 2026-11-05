import { createLogger, type LogLevel, type Logger } from "@culture-shock/observability";
import type { JobsEnv } from "./outbox.js";

export function loggerFor(env: JobsEnv, fields: Record<string, string> = {}): Logger {
  return createLogger({
    level: (env.LOG_LEVEL as LogLevel) ?? "info",
    service: "jobs",
    environment: env.ENVIRONMENT,
    base: fields,
  });
}
