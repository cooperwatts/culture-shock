import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Alert,
  Card,
  DescriptionList,
  EmptyState,
  StatusBadge,
} from "@culture-shock/ui";
import { apiGet, isUnauthenticated } from "@/lib/api-server";
import { ProblemNotice, SignInPrompt } from "@/components/auth-states";
import { EnrollmentControls } from "./enrollment-controls";
import { PreferencesForm } from "./preferences-form";
import { ActivityPanel } from "./activity-panel";
import { formatInstant } from "@/lib/format";
import type {
  ActivityOverview,
  MeResponse,
  MyMatch,
  MyParticipation,
  ParticipantInstance,
  PeerOption,
} from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ParticipantInstancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [me, instances] = await Promise.all([
    apiGet<MeResponse>("/me"),
    apiGet<ParticipantInstance[]>("/me/instances"),
  ]);

  if (isUnauthenticated(me))
    return <SignInPrompt redirect={`/participant/instances/${id}`} />;
  if (!me.ok)
    return <ProblemNotice code={me.error.code} message={me.error.message} />;
  if (!instances.ok)
    return (
      <ProblemNotice
        code={instances.error.code}
        message={instances.error.message}
      />
    );

  const instance = instances.data.find((row) => row.id === id);
  if (!instance) notFound();

  const enrolled = instance.participantStatus === "enrolled";

  // Participant-scoped reads only make sense once enrolled; the API would
  // reject them anyway, and asking avoids showing confusing errors.
  const [participation, match, activities, peers] = enrolled
    ? await Promise.all([
        apiGet<MyParticipation>(`/instances/${id}/participants/me`),
        apiGet<MyMatch>(`/instances/${id}/my-match`),
        apiGet<ActivityOverview>(`/instances/${id}/activities`),
        apiGet<PeerOption[]>(`/instances/${id}/peers`),
      ])
    : [null, null, null, null];

  const zone = me.data.timeZone;

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb">
        <Link className="text-sm underline" href="/participant">
          Back to your experiences
        </Link>
      </nav>

      <header className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold">{instance.name}</h1>
        <div className="flex flex-wrap gap-2">
          <StatusBadge state={instance.state} />
          {instance.participantStatus ? (
            <StatusBadge state={instance.participantStatus} />
          ) : null}
        </div>
      </header>

      <Card title="When">
        <DescriptionList
          items={[
            {
              term: "Sign-up closes",
              detail: formatInstant(
                instance.enrollmentClosesAt,
                zone,
                me.data.locale,
              ),
            },
            {
              term: "Starts",
              detail: formatInstant(instance.startsAt, zone, me.data.locale),
            },
            {
              term: "Ends",
              detail: formatInstant(instance.endsAt, zone, me.data.locale),
            },
            { term: "Shown in", detail: `${zone} (your time zone)` },
          ]}
        />
      </Card>

      <Card title="Taking part">
        <EnrollmentControls
          instanceId={id}
          state={instance.state}
          participantStatus={instance.participantStatus}
        />
      </Card>

      {enrolled && participation?.ok ? (
        <>
          <Card
            title="Your preferences"
            description="All of this is optional. Leaving something blank will not keep you out of the matching — it just means we have less to go on."
          >
            <PreferencesForm
              instanceId={id}
              defaultTimeZone={zone}
              existing={participation.data.preferences}
            />
          </Card>

          <Card title="Your connection">
            {!match?.ok ? (
              <ProblemNotice
                code={match?.error.code ?? "internal_error"}
                message={
                  match?.error.message ?? "Could not load your connection"
                }
              />
            ) : match.data.state === "not_published" ? (
              <EmptyState title="Not matched yet">
                Connections appear once the{" "}
                {me.data.roles.includes("designer") ? "designer" : "organizer"}{" "}
                reviews and publishes them.
              </EmptyState>
            ) : (
              <div className="space-y-3">
                <ul className="space-y-2">
                  {match.data.peers.map((peer) => (
                    <li
                      key={peer.pseudonym ?? peer.label}
                      className="rounded border border-border p-3"
                    >
                      <span className="font-medium">{peer.label}</span>
                      {!peer.revealed ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          Identity hidden until the reveal
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {instance.privacyMode &&
                instance.privacyMode !== "never_reveal" ? (
                  <p className="text-xs text-muted-foreground">
                    Privacy mode: {instance.privacyMode.replace(/_/g, " ")}.
                  </p>
                ) : null}
              </div>
            )}
          </Card>

          <Card title="Activities">
            {!activities?.ok ? (
              <ProblemNotice
                code={activities?.error.code ?? "internal_error"}
                message={
                  activities?.error.message ?? "Could not load activities"
                }
              />
            ) : (
              <ActivityPanel
                instanceId={id}
                overview={activities.data}
                peers={peers?.ok ? peers.data : []}
                locale={me.data.locale}
                open={
                  instance.state === "active" ||
                  instance.state === "reveal_pending"
                }
              />
            )}
          </Card>
        </>
      ) : enrolled ? (
        <Alert tone="warning" title="Could not load your participation">
          Reload the page, or sign in again if the problem continues.
        </Alert>
      ) : null}
    </div>
  );
}
