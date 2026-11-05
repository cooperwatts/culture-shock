import Link from "next/link";
import {
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  Stat,
  StatGrid,
  StatusBadge,
} from "@culture-shock/ui";
import { apiGet, isUnauthenticated } from "@/lib/api-server";
import { ProblemNotice, SignInPrompt } from "@/components/auth-states";
import { CreateExperienceForm } from "./create-experience-form";
import { loadBranding } from "@/lib/branding";
import { formatDate } from "@/lib/format";
import type { ExperienceSummary, MeResponse, PackSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DesignerPage() {
  const [me, experiences, packs, branding] = await Promise.all([
    apiGet<MeResponse>("/me"),
    apiGet<ExperienceSummary[]>("/experiences"),
    apiGet<PackSummary[]>("/packs"),
    loadBranding(),
  ]);

  if (isUnauthenticated(me)) return <SignInPrompt redirect="/designer" />;
  if (!me.ok)
    return <ProblemNotice code={me.error.code} message={me.error.message} />;

  const terminology = branding.terminology;
  const enabledPacks = packs.ok
    ? packs.data.filter((pack) => pack.enabled && pack.status === "active")
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={terminology.designerSingular}
        title={`${terminology.experiencePlural}`}
        description={`Set up a ${terminology.experienceSingular.toLowerCase()}, open it for sign-up, and review the matches before anyone sees them. Nothing reaches a ${terminology.participantSingular.toLowerCase()} until you publish it.`}
      />

      <StatGrid>
        <Stat
          label={terminology.experiencePlural}
          value={experiences.ok ? experiences.data.length : "—"}
        />
        <Stat
          label="Ready to use"
          value={enabledPacks.length}
          hint={`${terminology.packPlural} an admin turned on`}
        />
        <Stat
          label="No dates set"
          value={
            experiences.ok
              ? experiences.data.filter((row) => row.instanceCount === 0).length
              : "—"
          }
          hint="Not scheduled yet"
        />
        <Stat
          label="People taking part"
          value={
            experiences.ok
              ? experiences.data.reduce(
                  (total, row) => total + row.enrolledCount,
                  0,
                )
              : "—"
          }
          hint={`Across every ${terminology.experienceSingular.toLowerCase()}`}
        />
      </StatGrid>

      <Card
        title={terminology.experiencePlural}
        flush={experiences.ok && experiences.data.length > 0}
      >
        {!experiences.ok ? (
          <ProblemNotice
            code={experiences.error.code}
            message={experiences.error.message}
          />
        ) : experiences.data.length === 0 ? (
          <EmptyState
            title={`No ${terminology.experiencePlural.toLowerCase()} yet`}
          >
            Start one below using a ready-made{" "}
            {terminology.packSingular.toLowerCase()}.
          </EmptyState>
        ) : (
          <DataTable
            caption={`All ${terminology.experiencePlural.toLowerCase()}`}
            rows={experiences.data}
            rowKey={(row) => row.id}
            columns={[
              {
                key: "name",
                header: "Name",
                render: (row) => (
                  <Link
                    className="underline"
                    href={`/designer/experiences/${row.id}`}
                  >
                    {row.name}
                  </Link>
                ),
              },
              {
                key: "state",
                header: "Latest run",
                render: (row) =>
                  row.latestInstanceState ? (
                    <StatusBadge state={row.latestInstanceState} />
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      Not scheduled
                    </span>
                  ),
              },
              {
                key: "runs",
                header: "Runs",
                render: (row) => row.instanceCount,
              },
              {
                key: "enrolled",
                header: `${terminology.participantPlural}`,
                render: (row) => row.enrolledCount,
              },
              {
                key: "updated",
                header: "Updated",
                render: (row) =>
                  formatDate(row.updatedAt, me.data.timeZone, me.data.locale),
              },
            ]}
          />
        )}
      </Card>

      <Card
        title={`Start a new ${terminology.experienceSingular.toLowerCase()}`}
        description={`Pick a ${terminology.packSingular.toLowerCase()} to base it on. It keeps the version you start with, so later updates to the ${terminology.packSingular.toLowerCase()} will not change your setup underneath you.`}
      >
        {enabledPacks.length === 0 ? (
          <EmptyState
            title={`No ${terminology.packPlural.toLowerCase()} are available`}
          >
            Ask an administrator to turn one on first.
          </EmptyState>
        ) : (
          <CreateExperienceForm packs={enabledPacks} />
        )}
      </Card>

      <Card
        title="Not sure where to start?"
        description="Answer a few questions and get a suggestion. It only ever sees rough numbers, never anyone's details."
      >
        <Link className="underline" href="/designer/copilot">
          Help me choose a {terminology.packSingular.toLowerCase()}
        </Link>
      </Card>
    </div>
  );
}
