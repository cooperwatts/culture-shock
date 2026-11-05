"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button } from "@culture-shock/ui";
import { apiMutate, describeProblem } from "@/lib/api-client";

export function EnrollmentControls({
  instanceId,
  state,
  participantStatus,
}: {
  instanceId: string;
  state: string;
  participantStatus: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"enroll" | "withdraw" | null>(null);

  const enrolled = participantStatus === "enrolled";
  const enrollmentOpen = state === "enrolling";

  async function act(action: "enroll" | "withdraw") {
    if (action === "withdraw" && !window.confirm("Withdraw from this experience?")) return;

    setError(null);
    setBusy(action);
    const result = await apiMutate(`/instances/${instanceId}/${action}`, { method: "POST" });
    setBusy(null);

    if (!result.ok) {
      setError(describeProblem(result.error));
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {error ? <Alert tone="error" title="Could not update" >{error}</Alert> : null}

      {enrolled ? (
        <>
          <p className="text-sm text-muted-foreground">
            You are taking part. Withdrawing removes you from future matching and hides the details
            you shared. Your existing connections are flagged for the designer rather than silently
            reassigned.
          </p>
          <Button variant="danger" busy={busy === "withdraw"} onClick={() => act("withdraw")}>
            Withdraw
          </Button>
        </>
      ) : enrollmentOpen ? (
        <>
          <p className="text-sm text-muted-foreground">
            Joining shares your display name with the people you are matched with, subject to the
            privacy mode for this experience. Nothing else is shared unless you add it.
          </p>
          <Button variant="primary" busy={busy === "enroll"} onClick={() => act("enroll")}>
            Join
          </Button>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Sign-up is closed for this experience.</p>
      )}
    </div>
  );
}
