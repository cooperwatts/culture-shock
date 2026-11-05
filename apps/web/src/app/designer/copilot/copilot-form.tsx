"use client";

import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  DescriptionList,
  TextAreaField,
  TextField,
} from "@culture-shock/ui";
import { apiMutate, describeProblem } from "@/lib/api-client";

interface Recommendation {
  packId: string;
  fitReasons: string[];
  matchingStrategy: { key: string; rationale: string };
  communicationPlan: Array<{
    trigger: string;
    timing: string;
    summary: string;
  }>;
  participationPlan: {
    mode: string;
    expectedParticipationPercent: number;
    inclusionNotes: string[];
  };
  revealPlan: { mode: string; rationale: string } | null;
  metricPlan: string[];
  risks: string[];
  assumptions: string[];
}

interface CopilotResponse {
  source: "ai" | "deterministic_fallback";
  provenance: Record<string, unknown> | null;
  uncertainty: string[];
  recommendation: Recommendation;
  alternatives: Recommendation[];
  requiresHumanApproval: boolean;
}

function RecommendationView({
  value,
  heading,
}: {
  value: Recommendation;
  heading: string;
}) {
  return (
    <Card title={heading} description={value.packId} headingLevel={3}>
      <div className="space-y-4">
        <DescriptionList
          items={[
            { term: "Matching strategy", detail: value.matchingStrategy.key },
            {
              term: "Participation",
              detail: `${value.participationPlan.mode.replace(/_/g, " ")} · expect about ${value.participationPlan.expectedParticipationPercent}%`,
            },
            {
              term: "Reveal",
              detail:
                value.revealPlan?.mode.replace(/_/g, " ") ?? "Not applicable",
            },
            { term: "Metrics", detail: value.metricPlan.join(", ") },
          ]}
        />

        <div>
          <h4 className="font-medium">Why this fits</h4>
          <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
            {value.fitReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>

        {value.participationPlan.inclusionNotes.length > 0 ? (
          <div>
            <h4 className="font-medium">Inclusion</h4>
            <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
              {value.participationPlan.inclusionNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {value.risks.length > 0 ? (
          <div>
            <h4 className="font-medium">Risks and assumptions</h4>
            <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
              {[...value.risks, ...value.assumptions].map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export function CopilotForm() {
  const [headcount, setHeadcount] = useState("1200");
  const [remoteShare, setRemoteShare] = useState("70");
  const [objectives, setObjectives] = useState(
    "We want stronger cross-functional relationships.",
  );
  const [response, setResponse] = useState<CopilotResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    const result = await apiMutate<CopilotResponse>(
      "/copilot/recommendations",
      {
        method: "POST",
        body: {
          headcount: Number(headcount),
          remoteSharePercent: Number(remoteShare),
          objectives: objectives
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .slice(0, 5),
        },
      },
    );
    setBusy(false);

    if (!result.ok) {
      setError(describeProblem(result.error));
      return;
    }
    setResponse(result.data);
  }

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="space-y-4">
        {error ? (
          <Alert tone="error" title="Could not produce a recommendation">
            {error}
          </Alert>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="headcount"
            label="Headcount"
            type="number"
            min={1}
            required
            value={headcount}
            onChange={(event) => setHeadcount(event.target.value)}
            hint="Rounded into a size band before it goes anywhere."
          />
          <TextField
            id="remote-share"
            label="Remote share (%)"
            type="number"
            min={0}
            max={100}
            required
            value={remoteShare}
            onChange={(event) => setRemoteShare(event.target.value)}
            hint="Roughly what share of people work remotely most of the time."
          />
        </div>

        <TextAreaField
          id="objectives"
          label="Objectives"
          required
          value={objectives}
          onChange={(event) => setObjectives(event.target.value)}
          hint="One per line, up to five. For example: help new starters settle in."
        />

        <Button type="submit" variant="primary" busy={busy}>
          Suggest something
        </Button>
      </form>

      {response ? (
        <div className="space-y-4">
          <Alert
            tone={response.source === "ai" ? "info" : "warning"}
            title={
              response.source === "ai"
                ? "Suggested by AI"
                : "Suggested using built-in rules"
            }
          >
            {response.source === "ai"
              ? "Have a read before you act on it. This is only a suggestion — nothing has been created or sent to anyone."
              : "AI is switched off or unavailable, so this came from fixed rules rather than a model."}
            {response.uncertainty.length > 0
              ? ` Worth knowing: ${response.uncertainty.join(", ")}.`
              : ""}
          </Alert>

          <RecommendationView
            value={response.recommendation}
            heading="Our suggestion"
          />
          {response.alternatives.map((alternative) => (
            <RecommendationView
              key={alternative.packId}
              value={alternative}
              heading="Alternative"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
