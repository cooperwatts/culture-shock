"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button } from "@culture-shock/ui";
import {
  apiMutate,
  describeProblem,
  newIdempotencyKey,
} from "@/lib/api-client";

interface Transition {
  readonly to: string;
  readonly label: string;
  readonly description: string;
  readonly destructive?: boolean;
}

/** Mirrors the server state machine so the UI never offers an invalid action. */
function availableTransitions(
  state: string,
  revealEnabled: boolean,
): Transition[] {
  switch (state) {
    case "draft":
      return [
        {
          to: "enrolling",
          label: "Open for sign-up",
          description: "Locks in the settings and lets people start joining.",
        },
        {
          to: "cancelled",
          label: "Cancel",
          description: "Call it off before anyone has joined.",
          destructive: true,
        },
      ];
    case "enrolling":
      return [
        {
          to: "locked",
          label: "Close sign-up",
          description: "You need to do this before you can match people.",
        },
        {
          to: "cancelled",
          label: "Cancel",
          description: "Everyone who joined will be told.",
          destructive: true,
        },
      ];
    case "locked":
      return [
        {
          to: "active",
          label: "Start it",
          description: "Available once you have published the matches.",
        },
        {
          to: "enrolling",
          label: "Reopen sign-up",
          description: "Any matches you have not published are discarded.",
        },
        {
          to: "cancelled",
          label: "Cancel",
          description: "Everyone who joined will be told.",
          destructive: true,
        },
      ];
    case "active":
      return [
        ...(revealEnabled
          ? [
              {
                to: "reveal_pending",
                label: "Start the reveal",
                description:
                  "Shows people who they were matched with, as far as the privacy setting allows.",
              },
            ]
          : []),
        {
          to: "completed",
          label: "Finish",
          description: "Closes things off and locks the results.",
        },
        {
          to: "cancelled",
          label: "Cancel",
          description: "Stops anything still running.",
          destructive: true,
        },
      ];
    case "reveal_pending":
      return [
        {
          to: "completed",
          label: "Finish",
          description: "Closes things off and locks the results.",
        },
      ];
    case "completed":
    case "cancelled":
      return [
        {
          to: "archived",
          label: "Archive",
          description: "Tidies it away out of your main list.",
        },
      ];
    default:
      return [];
  }
}

export function LifecycleControls({
  instanceId,
  state,
  revision,
  revealEnabled,
}: {
  instanceId: string;
  state: string;
  revision: number;
  revealEnabled: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const transitions = availableTransitions(state, revealEnabled);

  async function transition(to: string, destructive: boolean) {
    if (
      destructive &&
      !window.confirm(
        "This cancels the whole thing for everyone taking part. Are you sure?",
      )
    )
      return;

    setError(null);
    setPending(to);

    const launching = state === "draft" && to === "enrolling";
    const result = launching
      ? await apiMutate(`/instances/${instanceId}/launch`, {
          method: "POST",
          ifMatch: revision,
          idempotencyKey: newIdempotencyKey(),
        })
      : await apiMutate(`/instances/${instanceId}`, {
          method: "PATCH",
          ifMatch: revision,
          body: { state: to },
        });

    setPending(null);

    if (!result.ok) {
      setError(describeProblem(result.error));
      return;
    }
    router.refresh();
  }

  if (transitions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This one is finished. There is nothing left to do.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error ? (
        <Alert tone="error" title="That did not work">
          {error}
        </Alert>
      ) : null}
      <ul className="space-y-2">
        {transitions.map((item) => (
          <li
            key={item.to}
            className="flex flex-wrap items-center justify-between gap-3"
          >
            <span className="text-sm text-muted-foreground">
              {item.description}
            </span>
            <Button
              variant={item.destructive ? "danger" : "primary"}
              busy={pending === item.to}
              onClick={() => transition(item.to, item.destructive ?? false)}
            >
              {item.label}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
