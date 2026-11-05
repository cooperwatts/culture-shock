import type { OrganizationId } from "./ids.js";

/**
 * Domain events are reference-only: handlers re-read authoritative state from
 * D1 and re-check consent before acting, so payloads never carry participant
 * data even if a queue message is retained or dead-lettered.
 */
export const DOMAIN_EVENT_TYPES = [
  "instance.launched",
  "instance.enrollment_closed",
  "instance.activated",
  "instance.reveal_requested",
  "instance.completed",
  "instance.cancelled",
  "participant.enrolled",
  "participant.withdrawn",
  "match_run.requested",
  "match_run.completed",
  "match_run.published",
  "notification.queued",
  "analytics.refresh_requested",
  "ai.draft_requested",
  "privacy.export_requested",
  "privacy.erase_requested",
  "retention.sweep_requested",
] as const;

export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

export type EventReferences = Readonly<Record<string, string | number | boolean | null>>;

export interface DomainEventEnvelope {
  readonly eventId: string;
  readonly eventType: DomainEventType;
  readonly organizationId: OrganizationId;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly occurredAt: string;
  readonly attempt: number;
  readonly references: EventReferences;
}

export function isDomainEventType(value: unknown): value is DomainEventType {
  return typeof value === "string" && (DOMAIN_EVENT_TYPES as readonly string[]).includes(value);
}
