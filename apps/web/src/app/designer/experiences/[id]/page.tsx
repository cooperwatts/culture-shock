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
import { CreateInstanceForm } from "./create-instance-form";
import { formatInstant } from "@/lib/format";
import type {
  ExperienceDetail,
  InstanceSummary,
  MeResponse,
} from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ExperiencePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [me, experience, instances] = await Promise.all([
    apiGet<MeResponse>("/me"),
    apiGet<ExperienceDetail>(`/experiences/${id}`),
    apiGet<InstanceSummary[]>(`/experiences/${id}/instances`),
  ]);

  if (isUnauthenticated(me))
    return <SignInPrompt redirect={`/designer/experiences/${id}`} />;
  if (!me.ok)
    return <ProblemNotice code={me.error.code} message={me.error.message} />;
  if (!experience.ok) {
    if (experience.error.code === "not_found") notFound();
    return (
      <ProblemNotice
        code={experience.error.code}
        message={experience.error.message}
      />
    );
  }

  const zone = me.data.timeZone;

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb">
        <Link className="text-sm underline" href="/designer">
          Back to all experiences
        </Link>
      </nav>

      <header className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold">
          {experience.data.name}
        </h1>
        {experience.data.description ? (
          <p className="text-muted-foreground">{experience.data.description}</p>
        ) : null}
      </header>

      <Card title="Definition">
        <DescriptionList
          items={[
            {
              term: "Culture Pack",
              detail: experience.data.definition.packSlug ?? "Unknown",
            },
            {
              term: "Pinned version",
              detail: experience.data.definition.packVersion ?? "Unknown",
            },
          ]}
        />
      </Card>

      <Card title="Runs">
        {!instances.ok ? (
          <ProblemNotice
            code={instances.error.code}
            message={instances.error.message}
          />
        ) : instances.data.length === 0 ? (
          <EmptyState title="Nothing scheduled yet">
            Set the dates below. Nothing happens until you open it for sign-up.
          </EmptyState>
        ) : (
          <DataTable
            caption="Scheduled runs"
            rows={instances.data}
            rowKey={(row) => row.id}
            columns={[
              {
                key: "name",
                header: "Name",
                render: (row) => (
                  <Link
                    className="underline"
                    href={`/designer/instances/${row.id}`}
                  >
                    {row.name}
                  </Link>
                ),
              },
              {
                key: "state",
                header: "State",
                render: (row) => <StatusBadge state={row.state} />,
              },
              {
                key: "starts",
                header: "Starts",
                render: (row) =>
                  formatInstant(
                    row.startsAt,
                    row.timeZone || zone,
                    me.data.locale,
                  ),
              },
              {
                key: "enrollment",
                header: "Enrollment closes",
                render: (row) =>
                  formatInstant(
                    row.enrollmentClosesAt,
                    row.timeZone || zone,
                    me.data.locale,
                  ),
              },
            ]}
          />
        )}
      </Card>

      <Card
        title="Schedule a run"
        description="Enter the times in whichever time zone you are planning in. Everyone taking part sees them in their own. Sign-up has to close before it starts."
      >
        <CreateInstanceForm experienceId={id} defaultTimeZone={zone} />
      </Card>
    </div>
  );
}
