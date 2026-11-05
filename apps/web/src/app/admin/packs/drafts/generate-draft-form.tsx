"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, TextAreaField, TextField } from "@culture-shock/ui";
import { apiMutate, describeProblem } from "@/lib/api-client";

interface GenerateResponse {
  draftId: string;
  source: "ai" | "deterministic_fallback";
  rationale: string;
  ready: boolean;
  blockingReasons: string[];
}

export function GenerateDraftForm({ aiEnabled }: { aiEnabled: boolean }) {
  const router = useRouter();
  const [objective, setObjective] = useState("");
  const [audience, setAudience] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    const result = await apiMutate<GenerateResponse>("/packs/drafts:generate", {
      method: "POST",
      body: { objective, audience: audience || undefined },
    });
    setBusy(false);

    if (!result.ok) {
      setError(describeProblem(result.error));
      return;
    }
    router.push(`/admin/packs/drafts/${result.data.draftId}`);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error ? <Alert tone="error" title="Could not create a draft">{error}</Alert> : null}

      {!aiEnabled ? (
        <Alert tone="info" title="AI is disabled">
          Drafts will be produced by the deterministic planner. The result is usable but generic, and
          is labelled as such.
        </Alert>
      ) : null}

      <TextAreaField
        id="draft-objective"
        label="What should this achieve?"
        required
        minLength={10}
        maxLength={600}
        value={objective}
        onChange={(event) => setObjective(event.target.value)}
        hint="For example: improve relationships between digital technology and retail store teams."
      />

      <TextField
        id="draft-audience"
        label="Who is it for?"
        maxLength={300}
        value={audience}
        onChange={(event) => setAudience(event.target.value)}
        hint="Optional. Describe the audience in general terms; do not name individuals."
      />

      <Button type="submit" variant="primary" busy={busy} disabled={objective.trim().length < 10}>
        Create draft
      </Button>
    </form>
  );
}
