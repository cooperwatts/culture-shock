import Link from "next/link";
import { Card, DataTable, EmptyState, StatusBadge } from "@culture-shock/ui";
import { apiGet, isUnauthenticated } from "@/lib/api-server";
import { ProblemNotice, SignInPrompt } from "@/components/auth-states";
import { loadBranding } from "@/lib/branding";
import { formatInstant } from "@/lib/format";
import type { MeResponse, ParticipantInstance } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ParticipantPage() {
  const [me, instances, branding] = await Promise.all([
    apiGet<MeResponse>("/me"),
    apiGet<ParticipantInstance[]>("/me/instances"),
    loadBranding(),
  ]);

  if (isUnauthenticated(me)) return <SignInPrompt redirect="/participant" />;
  if (!me.ok) return <ProblemNotice code={me.error.code} message={me.error.message} />;

  const open = instances.ok
    ? instances.data.filter((row) => row.state === "enrolling" && row.participantStatus !== "enrolled")
    : [];
  const mine = instances.ok ? instances.data.filter((row) => row.participantStatus !== null) : [];

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold">
          {branding.terminology.participantSingular}
        </h1>
        <p className="text-muted-foreground">
          Taking part is your choice. You can withdraw at any time, and you only share the details
          you decide to share.
        </p>
      </header>

      {!instances.ok ? (
        <ProblemNotice code={instances.error.code} message={instances.error.message} />
      ) : (
        <>
          <Card title="Open for sign-up">
            {open.length === 0 ? (
              <EmptyState title="Nothing is open right now">
                You will be notified when a new {branding.terminology.experienceSingular.toLowerCase()}{" "}
                opens.
              </EmptyState>
            ) : (
              <DataTable
                caption="Experiences open for sign-up"
                rows={open}
                rowKey={(row) => row.id}
                columns={[
                  {
                    key: "name",
                    header: "Name",
                    render: (row) => (
                      <Link className="underline" href={`/participant/instances/${row.id}`}>
                        {row.name}
                      </Link>
                    ),
                  },
                  {
                    key: "closes",
                    header: "Sign-up closes",
                    render: (row) =>
                      formatInstant(row.enrollmentClosesAt, me.data.timeZone, me.data.locale),
                  },
                ]}
              />
            )}
          </Card>

          <Card title="Your experiences">
            {mine.length === 0 ? (
              <EmptyState title="You have not joined anything yet" />
            ) : (
              <DataTable
                caption="Experiences you joined"
                rows={mine}
                rowKey={(row) => row.id}
                columns={[
                  {
                    key: "name",
                    header: "Name",
                    render: (row) => (
                      <Link className="underline" href={`/participant/instances/${row.id}`}>
                        {row.name}
                      </Link>
                    ),
                  },
                  {
                    key: "status",
                    header: "Your status",
                    render: (row) => <StatusBadge state={row.participantStatus ?? "invited"} />,
                  },
                  { key: "state", header: "Stage", render: (row) => <StatusBadge state={row.state} /> },
                  {
                    key: "ends",
                    header: "Ends",
                    render: (row) => formatInstant(row.endsAt, me.data.timeZone, me.data.locale),
                  },
                ]}
              />
            )}
          </Card>
        </>
      )}
    </div>
  );
}
