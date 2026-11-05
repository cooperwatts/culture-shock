import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Card, DataTable, DescriptionList, EmptyState, StatusBadge } from "@culture-shock/ui";
import { apiGet, isUnauthenticated } from "@/lib/api-server";
import { ProblemNotice, SignInPrompt } from "@/components/auth-states";
import { PublishDraftControls } from "./publish-draft-controls";
import type { MeResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

interface DryRunReport {
  ok: boolean;
  sampleSize: number;
  eligibleCount: number;
  deniedCount: number;
  denialCodes: Record<string, number>;
  privacyMode: string | null;
  matchingConstraints: string[];
  pools: string[];
  scheduledActions: Array<{ action: string; anchor: string; offsetMinutes: number }>;
  workflowOrder: string[];
  renderedSamples: Array<{ templateKey: string; locale: string; subject: string; body: string }>;
  findings: Array<{ severity: "error" | "warning" | "info"; code: string; message: string }>;
}

interface DraftReview {
  ok: boolean;
  source?: string;
  rationale?: string;
  provenance?: Record<string, unknown> | null;
  validationIssues: Array<{ severity: string; code: string; message: string; path: string }>;
  dryRun: DryRunReport | null;
  matching: { ok: boolean; matched: number; unmatched: number; note: string } | null;
  blockingReasons: string[];
}

interface DraftDetail {
  id: string;
  source: string;
  manifest: {
    id: string;
    version: string;
    name: Record<string, string>;
    summary: Record<string, string>;
    requiredCapabilities: string[];
    matching: { strategyKey: string; groupSize: number; hardConstraints: string[] };
    reveal: { enabled: boolean; mode: string };
    dataRequirements: string[];
  } | null;
  review: DraftReview | null;
  createdAt: string;
}

export default async function DraftDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, draft] = await Promise.all([
    apiGet<MeResponse>("/me"),
    apiGet<DraftDetail>(`/packs/drafts/${id}`),
  ]);

  if (isUnauthenticated(me)) return <SignInPrompt redirect={`/admin/packs/drafts/${id}`} />;
  if (!me.ok) return <ProblemNotice code={me.error.code} message={me.error.message} />;
  if (!draft.ok) {
    if (draft.error.code === "not_found") notFound();
    return <ProblemNotice code={draft.error.code} message={draft.error.message} />;
  }

  const manifest = draft.data.manifest;
  const review = draft.data.review;
  const locale = me.data.locale;
  const errors = review?.validationIssues.filter((issue) => issue.severity === "error") ?? [];
  const warnings = review?.validationIssues.filter((issue) => issue.severity === "warning") ?? [];

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb">
        <Link className="text-sm underline" href="/admin/packs/drafts">
          Back to drafts
        </Link>
      </nav>

      <header className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold">
          {manifest?.name[locale] ?? manifest?.name["en-CA"] ?? "Draft"}
        </h1>
        <div className="flex flex-wrap gap-2">
          <StatusBadge
            state={review?.source === "ai" ? "ai" : "deterministic"}
            label={review?.source === "ai" ? "AI draft" : "Deterministic draft"}
          />
          <StatusBadge
            state={review?.ok ? "ready" : "blocked"}
            label={review?.ok ? "Passes all checks" : "Blocked"}
          />
        </div>
        {manifest ? <p className="text-muted-foreground">{manifest.summary[locale] ?? manifest.summary["en-CA"]}</p> : null}
      </header>

      {review?.rationale ? (
        <Alert
          tone={review.source === "ai" ? "info" : "warning"}
          title={review.source === "ai" ? "Why the generator proposed this" : "Produced without AI"}
        >
          {review.rationale}
        </Alert>
      ) : null}

      {review && review.blockingReasons.length > 0 ? (
        <Alert tone="error" title="This draft cannot be published yet">
          <ul className="list-disc pl-5">
            {review.blockingReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {manifest ? (
        <Card title="What it does">
          <DescriptionList
            items={[
              { term: "Slug", detail: manifest.id },
              { term: "Matching strategy", detail: manifest.matching.strategyKey },
              { term: "Group size", detail: String(manifest.matching.groupSize) },
              { term: "Hard constraints", detail: manifest.matching.hardConstraints.join(", ") },
              { term: "Privacy mode", detail: manifest.reveal.mode.replace(/_/g, " ") },
              { term: "Reveal", detail: manifest.reveal.enabled ? "Enabled" : "Disabled" },
              {
                term: "Capabilities",
                detail: manifest.requiredCapabilities.join(", "),
              },
              {
                term: "Data it asks for",
                detail: manifest.dataRequirements.length > 0 ? manifest.dataRequirements.join(", ") : "None",
              },
            ]}
          />
        </Card>
      ) : null}

      <Card title="Validation">
        {errors.length === 0 && warnings.length === 0 ? (
          <EmptyState title="No validation issues" />
        ) : (
          <ul className="space-y-2">
            {[...errors, ...warnings].map((issue) => (
              <li key={`${issue.code}-${issue.path}`} className="rounded border border-border p-3">
                <p className="font-medium">
                  {issue.severity === "error" ? "Error" : "Warning"}: {issue.code}
                </p>
                <p className="text-sm text-muted-foreground">{issue.message}</p>
                <p className="text-xs text-muted-foreground">at {issue.path}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Sandbox dry run"
        description="Executed against a synthetic population. No stored participant data is read."
      >
        {!review?.dryRun ? (
          <EmptyState title="No dry run recorded" />
        ) : (
          <div className="space-y-4">
            <DescriptionList
              items={[
                {
                  term: "Eligible",
                  detail: `${review.dryRun.eligibleCount} of ${review.dryRun.sampleSize} sample participants`,
                },
                { term: "Effective privacy mode", detail: review.dryRun.privacyMode ?? "default" },
                {
                  term: "Matching constraints",
                  detail: review.dryRun.matchingConstraints.join(", ") || "None",
                },
                { term: "Workflow order", detail: review.dryRun.workflowOrder.join(" → ") },
                {
                  term: "Matching feasibility",
                  detail: review.matching?.note ?? "Not applicable",
                },
              ]}
            />

            {review.dryRun.findings.length > 0 ? (
              <ul className="space-y-2">
                {review.dryRun.findings.map((finding) => (
                  <li key={finding.code} className="rounded border border-border p-3">
                    <p className="font-medium">
                      {finding.severity === "error" ? "Error" : "Warning"}: {finding.code}
                    </p>
                    <p className="text-sm text-muted-foreground">{finding.message}</p>
                  </li>
                ))}
              </ul>
            ) : null}

            {review.dryRun.renderedSamples.length > 0 ? (
              <div className="space-y-2">
                <h3 className="font-heading font-semibold">Rendered messages</h3>
                <DataTable
                  caption="Sample rendered communications"
                  rows={review.dryRun.renderedSamples}
                  rowKey={(row) => row.templateKey}
                  columns={[
                    { key: "key", header: "Trigger", render: (row) => row.templateKey },
                    { key: "subject", header: "Subject", render: (row) => row.subject },
                    {
                      key: "body",
                      header: "Body",
                      render: (row) => (
                        <pre className="whitespace-pre-wrap font-sans text-xs text-muted-foreground">
                          {row.body}
                        </pre>
                      ),
                    },
                  ]}
                />
              </div>
            ) : null}
          </div>
        )}
      </Card>

      <Card title="Approval">
        <PublishDraftControls draftId={id} canPublish={review?.ok === true} />
      </Card>
    </div>
  );
}
