import { DomainError } from "@culture-shock/domain";
import type { InstanceSnapshot } from "@culture-shock/domain";
import type { PackManifest } from "@culture-shock/pack-sdk";

/**
 * Activity type to the capability that must be present in the launch snapshot.
 * A pack that did not declare the capability cannot produce the activity, even
 * if a client posts the type directly.
 */
const ACTIVITY_CAPABILITY: Readonly<Record<string, string>> = {
  gift_exchange: "activity.gift-exchange",
  recognition: "activity.recognition",
  conversation: "activity.conversation-prompt",
  check_in: "activity.check-in",
  milestone: "activity.milestone",
  survey: "activity.survey",
  clue: "clue.exchange",
};

export interface ActivityPermission {
  readonly activityKey: string;
  readonly maxPerParticipant: number;
  readonly optional: boolean;
}

/**
 * Resolves whether a participant may record an activity of this type. Checks
 * the frozen snapshot first, then the manifest's declared activities, so a pack
 * update cannot retroactively unlock an action in a running instance.
 */
export function resolveActivityPermission(
  manifest: PackManifest,
  snapshot: InstanceSnapshot,
  activityType: string,
): ActivityPermission {
  const capability = ACTIVITY_CAPABILITY[activityType];
  if (!capability) {
    throw new DomainError("validation_failed", "Unknown activity type", { activityType });
  }
  if (!snapshot.capabilities.includes(capability)) {
    throw new DomainError("capability_disabled", "This experience does not include that activity", {
      activityType,
    });
  }

  const declared = manifest.activities.find((activity) => activity.type === activityType);
  if (!declared) {
    throw new DomainError("capability_disabled", "This experience does not include that activity", {
      activityType,
    });
  }

  return {
    activityKey: declared.key,
    maxPerParticipant: declared.maxPerParticipant,
    optional: declared.optional,
  };
}

/** Recognition visibility is capped by installation privacy policy. */
export function resolveRecognitionVisibility(
  requested: string,
  allowPublicVisibility: boolean,
): "private" | "recipient_only" | "team" | "organization" {
  const permitted = allowPublicVisibility
    ? ["private", "recipient_only", "team", "organization"]
    : ["private", "recipient_only"];
  if (!permitted.includes(requested)) {
    throw new DomainError("policy_violation", "That visibility is not permitted by installation policy", {
      requested,
      permitted,
    });
  }
  return requested as "private" | "recipient_only" | "team" | "organization";
}
