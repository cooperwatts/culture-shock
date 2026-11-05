import { invalidTransition } from "./errors.js";
import type { ExperienceInstanceState, ParticipantState } from "./enums.js";

/**
 * Experience instance lifecycle. `reveal_pending` is only reachable when the
 * launched snapshot enabled a reveal capability; `cancelled` and `archived` are
 * terminal for participant-visible actions but never imply deletion.
 */
const INSTANCE_TRANSITIONS: Readonly<Record<ExperienceInstanceState, readonly ExperienceInstanceState[]>> = {
  draft: ["enrolling", "cancelled"],
  enrolling: ["locked", "cancelled"],
  locked: ["active", "enrolling", "cancelled"],
  active: ["reveal_pending", "completed", "cancelled"],
  reveal_pending: ["completed", "cancelled"],
  completed: ["archived"],
  cancelled: ["archived"],
  archived: [],
};

export interface InstanceTransitionContext {
  /** True when the launched snapshot enabled a reveal capability. */
  readonly revealEnabled: boolean;
  /** True when a match run has been published for the instance. */
  readonly matchesPublished: boolean;
}

export function canTransitionInstance(
  from: ExperienceInstanceState,
  to: ExperienceInstanceState,
): boolean {
  return INSTANCE_TRANSITIONS[from].includes(to);
}

export function assertInstanceTransition(
  from: ExperienceInstanceState,
  to: ExperienceInstanceState,
  context: InstanceTransitionContext,
): void {
  if (!canTransitionInstance(from, to)) {
    throw invalidTransition(`Cannot move instance from ${from} to ${to}`, { from, to });
  }
  if (to === "active" && !context.matchesPublished) {
    throw invalidTransition("Matches must be published before an instance becomes active", {
      from,
      to,
    });
  }
  if (to === "reveal_pending" && !context.revealEnabled) {
    throw invalidTransition("Reveal is not enabled for this instance snapshot", { from, to });
  }
}

/** Instance states during which enrollment changes are still permitted. */
export function enrollmentOpen(state: ExperienceInstanceState): boolean {
  return state === "enrolling";
}

/** Instance states during which participants may still perform pack activities. */
export function activitiesOpen(state: ExperienceInstanceState): boolean {
  return state === "active" || state === "reveal_pending";
}

const PARTICIPANT_TRANSITIONS: Readonly<Record<ParticipantState, readonly ParticipantState[]>> = {
  invited: ["enrolled", "withdrawn", "excluded"],
  enrolled: ["withdrawn", "excluded"],
  withdrawn: ["enrolled"],
  excluded: ["invited"],
};

export function assertParticipantTransition(from: ParticipantState, to: ParticipantState): void {
  if (from === to) return; // enrollment and withdrawal are idempotent
  if (!PARTICIPANT_TRANSITIONS[from].includes(to)) {
    throw invalidTransition(`Cannot move participant from ${from} to ${to}`, { from, to });
  }
}
