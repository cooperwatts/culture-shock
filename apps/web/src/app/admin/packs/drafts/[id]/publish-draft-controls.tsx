"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, CheckboxField, TextField } from "@culture-shock/ui";
import { apiMutate, describeProblem } from "@/lib/api-client";

export function PublishDraftControls({
  draftId,
  canPublish,
}: {
  draftId: string;
  canPublish: boolean;
}) {
  const router = useRouter();
  const [version, setVersion] = useState("1.0.0");
  const [reviewNote, setReviewNote] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function revalidate() {
    setError(null);
    setBusy("validate");
    const result = await apiMutate(`/packs/drafts/${draftId}/validate`, { method: "POST" });
    setBusy(null);
    if (!result.ok) {
      setError(describeProblem(result.error));
      return;
    }
    router.refresh();
  }

  async function publish() {
    setError(null);
    setBusy("publish");
    const result = await apiMutate<{ slug: string }>(`/packs/drafts/${draftId}/publish`, {
      method: "POST",
      body: { version, acknowledgedReview: true, reviewNote: reviewNote || undefined },
    });
    setBusy(null);

    if (!result.ok) {
      setError(describeProblem(result.error));
      return;
    }
    router.push("/admin");
  }

  async function discard() {
    if (!window.confirm("Discard this draft?")) return;
    setError(null);
    setBusy("discard");
    const result = await apiMutate(`/packs/drafts/${draftId}`, { method: "DELETE" });
    setBusy(null);

    if (!result.ok) {
      setError(describeProblem(result.error));
      return;
    }
    router.push("/admin/packs/drafts");
  }

  return (
    <div className="space-y-4">
      {error ? <Alert tone="error" title="Action failed">{error}</Alert> : null}

      <Alert tone="info" title="Publishing creates an immutable version">
        The draft is re-validated on publish, so a stale review cannot slip through. The pack is
        published <strong>disabled</strong>; enabling it is a separate, separately audited decision.
      </Alert>

      <TextField
        id="draft-version"
        label="Version"
        required
        pattern="\d+\.\d+\.\d+"
        value={version}
        onChange={(event) => setVersion(event.target.value)}
        hint="Semantic version. A published version can never be overwritten."
      />

      <TextField
        id="draft-note"
        label="Review note"
        maxLength={300}
        value={reviewNote}
        onChange={(event) => setReviewNote(event.target.value)}
        hint="Recorded in the audit trail alongside your approval."
      />

      <CheckboxField
        id="draft-acknowledge"
        label="I have read this draft in full and accept responsibility for publishing it"
        checked={acknowledged}
        onChange={(event) => setAcknowledged(event.target.checked)}
      />

      <div className="flex flex-wrap gap-3">
        <Button variant="primary" busy={busy === "publish"} disabled={!canPublish || !acknowledged} onClick={publish}>
          Publish
        </Button>
        <Button busy={busy === "validate"} onClick={revalidate}>
          Re-run checks
        </Button>
        <Button variant="danger" busy={busy === "discard"} onClick={discard}>
          Discard
        </Button>
      </div>

      {!canPublish ? (
        <p className="text-sm text-muted-foreground">
          Publishing is unavailable until every check passes.
        </p>
      ) : null}
    </div>
  );
}
