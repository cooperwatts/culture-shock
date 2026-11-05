"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Alert,
  Button,
  CheckboxField,
  DataTable,
  SelectField,
} from "@culture-shock/ui";
import {
  apiMutate,
  describeProblem,
  newIdempotencyKey,
} from "@/lib/api-client";
import type { MatchRunPreview } from "@/lib/types";

const STRATEGIES = [
  {
    value: "cross-functional",
    label: "Cross-functional — reward different departments",
  },
  {
    value: "diversity-optimized",
    label: "Diversity optimized — maximise organizational exposure",
  },
  {
    value: "remote-first",
    label: "Remote first — prioritise schedule overlap and format",
  },
  {
    value: "new-hire-friendly",
    label: "New hire friendly — pair a new colleague with a buddy",
  },
  {
    value: "leadership-mix",
    label: "Leadership mix — mix role levels with safeguards",
  },
];

export function MatchRunPanel({
  instanceId,
  state,
  enrolledCount,
}: {
  instanceId: string;
  state: string;
  enrolledCount: number;
}) {
  const router = useRouter();
  const [strategyKey, setStrategyKey] = useState("cross-functional");
  const [preview, setPreview] = useState<MatchRunPreview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "publish" | null>(null);

  const canPreview = state === "locked" && enrolledCount >= 2;
  const unmatched = preview?.diagnostics?.unmatched ?? [];

  async function runPreview() {
    setError(null);
    setBusy("preview");
    const result = await apiMutate<MatchRunPreview>(
      `/instances/${instanceId}/match-runs`,
      {
        method: "POST",
        idempotencyKey: newIdempotencyKey(),
        body: { strategyKey, preview: true },
      },
    );
    setBusy(null);

    if (!result.ok) {
      setError(describeProblem(result.error));
      return;
    }
    setPreview(result.data);
    setAcknowledged(false);
  }

  async function publish() {
    if (!preview) return;
    setError(null);
    setBusy("publish");
    const result = await apiMutate(
      `/instances/${instanceId}/match-runs/${preview.runId}/publish`,
      {
        method: "POST",
        idempotencyKey: newIdempotencyKey(),
        body: { acknowledgedUnmatched: acknowledged },
      },
    );
    setBusy(null);

    if (!result.ok) {
      setError(describeProblem(result.error));
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {error ? (
        <Alert tone="error" title="Matching failed">
          {error}
        </Alert>
      ) : null}

      {!canPreview ? (
        <Alert tone="warning" title="You cannot match people yet">
          {state !== "locked"
            ? "Close sign-up first. Matching needs a settled list of who is taking part."
            : "You need at least two people taking part."}
        </Alert>
      ) : (
        <>
          <SelectField
            id="strategy"
            label="Matching strategy"
            value={strategyKey}
            onChange={(event) => setStrategyKey(event.target.value)}
            options={STRATEGIES}
            hint="The rules built into the Culture Pack always apply on top of this."
          />
          <Button
            variant="primary"
            busy={busy === "preview"}
            onClick={runPreview}
          >
            Try a match
          </Button>
        </>
      )}

      {preview ? (
        <div className="space-y-4 rounded border border-border p-4">
          <h3 className="font-heading font-semibold">
            Preview · {preview.strategyKey}@{preview.strategyVersion}
          </h3>

          {preview.diagnostics ? (
            <dl className="grid gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-xs uppercase text-muted-foreground">
                  Matched
                </dt>
                <dd>
                  {preview.diagnostics.matchedParticipants} of{" "}
                  {preview.diagnostics.consideredParticipants}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">
                  Pairs considered
                </dt>
                <dd>{preview.diagnostics.consideredEdges}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">
                  Method
                </dt>
                <dd>{preview.diagnostics.approximationReason ?? "exact"}</dd>
              </div>
            </dl>
          ) : null}

          {preview.diagnostics?.constraintViolations.length ? (
            <Alert
              tone="info"
              title="Constraints that excluded candidate pairs"
            >
              {preview.diagnostics.constraintViolations.join(", ")}
            </Alert>
          ) : null}

          {preview.fairness ? (
            <div className="space-y-2">
              <h4 className="font-medium">Fairness</h4>
              <p className="text-sm text-muted-foreground">
                Repeat exposure: {preview.fairness.repeatExposureCount} · score
                range {preview.fairness.scoreDistribution.min.toFixed(2)} to{" "}
                {preview.fairness.scoreDistribution.max.toFixed(2)} · cohorts
                under {preview.fairness.minimumCohortSize} are suppressed.
              </p>
              <DataTable
                caption="Matched participants by department"
                rows={preview.fairness.byDepartment}
                rowKey={(row) => row.cohort}
                columns={[
                  {
                    key: "cohort",
                    header: "Department",
                    render: (row) => row.cohort,
                  },
                  {
                    key: "matched",
                    header: "Matched",
                    render: (row) =>
                      row.suppressed
                        ? "Hidden"
                        : `${row.matched} of ${row.participants}`,
                  },
                ]}
              />
            </div>
          ) : null}

          {unmatched.length > 0 ? (
            <div className="space-y-2">
              <Alert
                tone="warning"
                title={`${unmatched.length} ${unmatched.length === 1 ? "person" : "people"} could not be matched`}
              >
                They have not been quietly dropped. Tick the box once you have
                decided how you will let them know.
              </Alert>
              <CheckboxField
                id="acknowledge-unmatched"
                label="I have thought about the people who could not be matched"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
            </div>
          ) : null}

          <Button
            variant="primary"
            busy={busy === "publish"}
            disabled={unmatched.length > 0 && !acknowledged}
            onClick={publish}
          >
            Publish matches
          </Button>
          <p className="text-xs text-muted-foreground">
            Publishing shows people their match, as far as the privacy setting
            allows. You cannot undo it.
          </p>
        </div>
      ) : null}
    </div>
  );
}
