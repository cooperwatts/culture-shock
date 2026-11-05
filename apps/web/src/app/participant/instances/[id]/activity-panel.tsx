"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, SelectField, TextAreaField } from "@culture-shock/ui";
import { apiMutate, describeProblem } from "@/lib/api-client";
import { activityLabel, localized } from "@/lib/format";
import type { ActivityOverview, PeerOption } from "@/lib/types";

export function ActivityPanel({
  instanceId,
  overview,
  peers,
  locale,
  open,
}: {
  instanceId: string;
  overview: ActivityOverview;
  peers: PeerOption[];
  locale: string;
  open: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [recipient, setRecipient] = useState(peers[0]?.participantId ?? "");
  const [message, setMessage] = useState("");

  const completedByType = new Map<string, number>();
  for (const activity of overview.completed) {
    completedByType.set(activity.type, (completedByType.get(activity.type) ?? 0) + 1);
  }

  const recognitionAvailable = overview.available.some((item) => item.type === "recognition");

  async function complete(type: string) {
    setError(null);
    setBusy(type);
    const result = await apiMutate(`/instances/${instanceId}/activities`, {
      method: "POST",
      body: { type },
    });
    setBusy(null);

    if (!result.ok) {
      setError(describeProblem(result.error));
      return;
    }
    router.refresh();
  }

  async function sendRecognition(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy("recognition-send");

    const result = await apiMutate(`/instances/${instanceId}/recognitions`, {
      method: "POST",
      body: { recipientParticipantId: recipient, message, visibility: "recipient_only" },
    });
    setBusy(null);

    if (!result.ok) {
      setError(describeProblem(result.error));
      return;
    }
    setMessage("");
    router.refresh();
  }

  if (overview.available.length === 0) {
    return <p className="text-sm text-muted-foreground">This experience has no optional activities.</p>;
  }

  return (
    <div className="space-y-5">
      {error ? <Alert tone="error" title="Could not record that">{error}</Alert> : null}

      {!open ? (
        <Alert tone="info" title="Activities are not open">
          You can record activities once the experience is running.
        </Alert>
      ) : null}

      <ul className="space-y-2">
        {overview.available
          .filter((item) => item.type !== "recognition")
          .map((item) => {
            const done = completedByType.get(item.type) ?? 0;
            const atLimit = done >= item.maxPerParticipant;
            return (
              <li
                key={item.key}
                className="flex flex-wrap items-center justify-between gap-3 rounded border border-border p-3"
              >
                <div>
                  <p className="font-medium">{localized(item.title, locale) || activityLabel(item.type)}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.optional ? "Optional" : "Required"} · {done} of {item.maxPerParticipant} recorded
                  </p>
                </div>
                <Button
                  busy={busy === item.type}
                  disabled={!open || atLimit}
                  onClick={() => complete(item.type)}
                >
                  {atLimit ? "Limit reached" : "Mark done"}
                </Button>
              </li>
            );
          })}
      </ul>

      {recognitionAvailable ? (
        <form onSubmit={sendRecognition} className="space-y-3 rounded border border-border p-4">
          <h3 className="font-heading font-semibold">Send recognition</h3>
          <p className="text-xs text-muted-foreground">
            Only the person you name can read this. It is encrypted at rest and is never used for
            analytics or sent to an AI provider.
          </p>

          {peers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No other participants are available yet.</p>
          ) : (
            <>
              <SelectField
                id="recognition-recipient"
                label="Who are you thanking?"
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                options={peers.map((peer) => ({ value: peer.participantId, label: peer.label }))}
              />
              <TextAreaField
                id="recognition-message"
                label="Message"
                required
                maxLength={1000}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                hint="Be specific about what they did. Keep it work-related."
              />
              <Button
                type="submit"
                variant="primary"
                busy={busy === "recognition-send"}
                disabled={!open || !recipient || message.trim().length === 0}
              >
                Send
              </Button>
            </>
          )}
        </form>
      ) : null}
    </div>
  );
}
