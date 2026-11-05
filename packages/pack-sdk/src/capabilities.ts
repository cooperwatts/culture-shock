/**
 * Capability registry. A manifest names capabilities; the core maps each name
 * to a versioned handler. Packs never reference handler implementations and the
 * core never branches on pack id.
 */
export const CAPABILITIES = {
  "enrollment.self-serve": { version: 1, dataClassification: "internal" },
  "enrollment.invite-only": { version: 1, dataClassification: "internal" },
  "matching.pair": { version: 1, dataClassification: "internal" },
  "matching.group": { version: 1, dataClassification: "internal" },
  "matching.buddy": { version: 1, dataClassification: "internal" },
  "activity.gift-exchange": { version: 1, dataClassification: "internal" },
  "activity.recognition": { version: 1, dataClassification: "participant_sensitive" },
  "activity.conversation-prompt": { version: 1, dataClassification: "internal" },
  "activity.check-in": { version: 1, dataClassification: "internal" },
  "activity.milestone": { version: 1, dataClassification: "internal" },
  "activity.survey": { version: 1, dataClassification: "participant_sensitive" },
  "clue.exchange": { version: 1, dataClassification: "participant_sensitive" },
  "reveal.gated": { version: 1, dataClassification: "internal" },
  "suggestion.gift": { version: 1, dataClassification: "internal" },
  "communications.templated": { version: 1, dataClassification: "internal" },
  "insights.aggregate": { version: 1, dataClassification: "internal" },
  "ai.assistant": { version: 1, dataClassification: "internal" },
} as const;

export type CapabilityKey = keyof typeof CAPABILITIES;

export const CAPABILITY_KEYS = Object.keys(CAPABILITIES) as CapabilityKey[];

export function isCapabilityKey(value: string): value is CapabilityKey {
  return value in CAPABILITIES;
}

/** Workflow node types the core knows how to execute. */
export const WORKFLOW_ACTIONS = [
  "open_enrollment",
  "close_enrollment",
  "run_matching",
  "publish_matches",
  "assign_missions",
  "send_notification",
  "collect_feedback",
  "reveal",
  "finish",
] as const;

export type WorkflowAction = (typeof WORKFLOW_ACTIONS)[number];

/** Capabilities a workflow action requires before it may appear in a manifest. */
export const ACTION_REQUIRED_CAPABILITIES: Readonly<
  Partial<Record<WorkflowAction, readonly CapabilityKey[]>>
> = {
  run_matching: ["matching.pair", "matching.group", "matching.buddy"],
  publish_matches: ["matching.pair", "matching.group", "matching.buddy"],
  reveal: ["reveal.gated"],
  send_notification: ["communications.templated"],
  collect_feedback: ["activity.survey"],
};

/** Metric keys the insight engine can compute; packs select, never define SQL. */
export const METRIC_KEYS = [
  "participation_rate",
  "engagement_rate",
  "connection_score",
  "department_bridge_score",
  "organizational_reach",
  "remote_inclusion_score",
  "experience_completion_rate",
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

export const MATCHING_STRATEGY_KEYS = [
  "cross-functional",
  "diversity-optimized",
  "remote-first",
  "new-hire-friendly",
  "leadership-mix",
] as const;

export type MatchingStrategyKey = (typeof MATCHING_STRATEGY_KEYS)[number];
