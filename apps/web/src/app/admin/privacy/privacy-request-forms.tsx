"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, SelectField, TextField } from "@culture-shock/ui";
import { apiMutate, describeProblem, newIdempotencyKey } from "@/lib/api-client";

const ACTIONS = [
  { value: "export", label: "Export everything we hold about them" },
  { value: "erase", label: "Erase them" },
  { value: "hold", label: "Place a legal hold (blocks erasure)" },
];

export function PrivacyRequestForms() {
  const router = useRouter();
  const [action, setAction] = useState("export");
  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const erasing = action === "erase";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (erasing && !window.confirm("Erasure cannot be undone. Continue?")) return;

    setBusy(true);
    const path =
      action === "hold" ? "/admin/privacy/holds" : `/admin/privacy/${action}`;
    const result = await apiMutate(path, {
      method: "POST",
      body: { userId, reason },
      ...(action === "hold" ? {} : { idempotencyKey: newIdempotencyKey() }),
    });
    setBusy(false);

    if (!result.ok) {
      setError(describeProblem(result.error));
      return;
    }

    setNotice(
      action === "hold"
        ? "Hold placed. Erasure for this person will now be blocked."
        : "Request queued. It runs in the background; refresh to see the outcome.",
    );
    setUserId("");
    setReason("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error ? <Alert tone="error" title="Could not raise the request">{error}</Alert> : null}
      {notice ? <Alert tone="success" title="Done">{notice}</Alert> : null}

      {erasing ? (
        <Alert tone="warning" title="Erasure is irreversible">
          Optional content is deleted and the account is anonymised. Published groups that included
          this person are flagged for a designer rather than silently rewritten. Audit entries are
          kept but lose the link to them.
        </Alert>
      ) : null}

      <SelectField
        id="privacy-action"
        label="Action"
        value={action}
        onChange={(event) => setAction(event.target.value)}
        options={ACTIONS}
      />

      <TextField
        id="privacy-user"
        label="Person"
        required
        pattern="usr_[0-9a-f]{32}"
        value={userId}
        onChange={(event) => setUserId(event.target.value)}
        hint="Their opaque user id, for example usr_0123... Find it in the audit log."
      />

      <TextField
        id="privacy-reason"
        label="Reason"
        required
        minLength={5}
        maxLength={300}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        hint="Recorded verbatim in the audit trail as the stated lawful purpose."
      />

      <Button
        type="submit"
        variant={erasing ? "danger" : "primary"}
        busy={busy}
        disabled={userId.length === 0 || reason.trim().length < 5}
      >
        {erasing ? "Erase" : action === "hold" ? "Place hold" : "Request export"}
      </Button>
    </form>
  );
}
