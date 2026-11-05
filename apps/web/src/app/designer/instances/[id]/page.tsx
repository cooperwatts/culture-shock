import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Card,
  DataTable,
  DescriptionList,
  EmptyState,
  StatusBadge,
} from "@culture-shock/ui";
import { apiGet, isUnauthenticated } from "@/lib/api-server";
import { ProblemNotice, SignInPrompt } from "@/components/auth-states";
import { LifecycleControls } from "./lifecycle-controls";
import { MatchRunPanel } from "./match-run-panel";
import { formatInstant, formatPercent, metricLabel } from "@/lib/format";
import type { InsightsReport, InstanceDetail, MeResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function InstancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [me, instance] = await Promise.all([
    apiGet<MeResponse>("/me"),
    apiGet<InstanceDetail>(`/instances/${id}`),
  ]);

  if (isUnauthenticated(me))
    return <SignInPrompt redirect={`/designer/instances/${id}`} />;
  if (!me.ok)
    return <ProblemNotice code={me.error.code} message={me.error.message} />;
  if (!instance.ok) {
    if (instance.error.code === "not_found") notFound();
    return (
      <ProblemNotice
        code={instance.error.code}
        message={instance.error.message}
      />
    );
  }

  // Insights are only meaningful once there is something to measure.
  const insights =
    instance.data.state === "draft" || instance.data.state === "enrolling"
      ? null
      : await apiGet<InsightsReport>(`/instances/${id}/insights`);

  const zone = instance.data.timeZone || me.data.timeZone;
  const counts = instance.data.participantCounts;
  const enrolled = counts.enrolled ?? 0;

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb">
        <Link
          className="text-sm underline"
          href={`/designer/experiences/${instance.data.experienceId}`}
        >
          Back to experience
        </Link>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h1 className="font-heading text-2xl font-semibold">
            {instance.data.name}
          </h1>
          <StatusBadge state={instance.data.state} />
        </div>
      </header>

      <Card title="Dates and privacy">
        <DescriptionList
          items={[
            { term: "Time zone", detail: zone },
            {
              term: "Sign-up closes",
              detail: formatInstant(
                instance.data.enrollmentClosesAt,
                zone,
                me.data.locale,
              ),
            },
            {
              term: "Starts",
              detail: formatInstant(
                instance.data.startsAt,
                zone,
                me.data.locale,
              ),
            },
            {
              term: "Ends",
              detail: formatInstant(instance.data.endsAt, zone, me.data.locale),
            },
            {
              term: "Who sees whom",
              detail: instance.data.privacyMode.replace(/_/g, " "),
            },
            {
              term: "Big reveal",
              detail: instance.data.revealEnabled ? "On" : "Off",
            },
            { term: "Pack version", detail: instance.data.packVersion },
            {
              term: "People",
              detail: `${enrolled} taking part, ${counts.withdrawn ?? 0} left, ${counts.invited ?? 0} invited`,
            },
          ]}
        />
      </Card>

      <Card
        title="What happens next"
        description="Each step has to happen in order. You cannot start the programme until you have published the matches."
      >
        <LifecycleControls
          instanceId={id}
          state={instance.data.state}
          revision={instance.revision ?? instance.data.revision}
          revealEnabled={instance.data.revealEnabled}
        />
      </Card>

      <Card
        title="Matching"
        description="Try as many times as you like. Nobody sees anything until you publish, and the same settings always give the same result."
      >
        <MatchRunPanel
          instanceId={id}
          state={instance.data.state}
          enrolledCount={enrolled}
        />
      </Card>

      <Card
        title="How it is going"
        description={`Groups smaller than your organization's minimum are hidden, so no result can be traced back to one person.`}
      >
        {!insights ? (
          <EmptyState title="Nothing to show yet">
            Results appear once sign-up closes and people start taking part.
          </EmptyState>
        ) : !insights.ok ? (
          <ProblemNotice
            code={insights.error.code}
            message={insights.error.message}
          />
        ) : (
          <div className="space-y-4">
            <DataTable
              caption="Experience metrics"
              rows={insights.data.metrics}
              rowKey={(row) => row.key}
              columns={[
                {
                  key: "metric",
                  header: "Metric",
                  render: (row) => metricLabel(row.key),
                },
                {
                  key: "value",
                  header: "Value",
                  render: (row) =>
                    row.suppressed ? "Hidden" : formatPercent(row.value),
                },
                {
                  key: "basis",
                  header: "Based on",
                  render: (row) =>
                    row.suppressed
                      ? `Fewer than ${insights.data.minimumCohortSize} people`
                      : `${row.numerator ?? 0} of ${row.denominator ?? 0}`,
                },
                {
                  key: "flags",
                  header: "Quality",
                  render: (row) =>
                    row.qualityFlags.length > 0
                      ? row.qualityFlags.join(", ")
                      : "—",
                },
              ]}
            />

            {insights.data.recommendations.length > 0 ? (
              <ul className="space-y-2">
                {insights.data.recommendations.map((recommendation) => (
                  <li
                    key={recommendation.code}
                    className="rounded border border-border p-3"
                  >
                    <p className="font-medium">{recommendation.summary}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Evidence: {recommendation.evidence.join(", ")} · sample
                      size {recommendation.sampleSize}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </Card>
    </div>
  );
}
