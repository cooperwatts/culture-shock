import Link from "next/link";
import { Card, DataTable, EmptyState, StatusBadge } from "@culture-shock/ui";
import { apiGet, isUnauthenticated } from "@/lib/api-server";
import { ProblemNotice, SignInPrompt } from "@/components/auth-states";
import { PrivacyRequestForms } from "./privacy-request-forms";
import { formatInstant } from "@/lib/format";
import type { MeResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

interface PrivacyRequest {
  id: string;
  subjectUserId: string;
  kind: string;
  state: string;
  reason: string;
  downloadAvailable: boolean;
  blockedReason: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface LegalHold {
  id: string;
  user_id: string;
  reason: string;
  created_at: string;
}

export default async function PrivacyPage() {
  const [me, requests, holds] = await Promise.all([
    apiGet<MeResponse>("/me"),
    apiGet<PrivacyRequest[]>("/admin/privacy/requests"),
    apiGet<LegalHold[]>("/admin/privacy/holds"),
  ]);

  if (isUnauthenticated(me)) return <SignInPrompt redirect="/admin/privacy" />;
  if (!me.ok) return <ProblemNotice code={me.error.code} message={me.error.message} />;

  const zone = me.data.timeZone;

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb">
        <Link className="text-sm underline" href="/admin">
          Back to administration
        </Link>
      </nav>

      <header className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold">Privacy requests</h1>
        <p className="text-muted-foreground">
          Export and erasure run as background jobs. Verify the person&apos;s identity through your own
          process before raising a request; this system records your stated reason but cannot verify
          it for you.
        </p>
      </header>

      <Card title="Requests">
        {!requests.ok ? (
          <ProblemNotice code={requests.error.code} message={requests.error.message} />
        ) : requests.data.length === 0 ? (
          <EmptyState title="No requests yet" />
        ) : (
          <DataTable
            caption="Privacy requests"
            rows={requests.data}
            rowKey={(row) => row.id}
            columns={[
              { key: "kind", header: "Kind", render: (row) => <StatusBadge state={row.kind} /> },
              { key: "subject", header: "Subject", render: (row) => <code>{row.subjectUserId}</code> },
              {
                key: "state",
                header: "State",
                render: (row) => (
                  <div>
                    <StatusBadge state={row.state} />
                    {row.blockedReason ? (
                      <p className="mt-1 text-xs text-destructive">{row.blockedReason}</p>
                    ) : null}
                  </div>
                ),
              },
              {
                key: "created",
                header: "Requested",
                render: (row) => formatInstant(row.createdAt, zone, me.data.locale),
              },
              {
                key: "download",
                header: "Export",
                render: (row) =>
                  row.downloadAvailable ? (
                    <a className="underline" href={`/api/v1/admin/privacy/requests/${row.id}/download`}>
                      Download
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground">Not available</span>
                  ),
              },
            ]}
          />
        )}
      </Card>

      <Card
        title="Legal holds"
        description="An active hold blocks erasure for that person. Erasure requests are recorded as blocked rather than silently skipped."
      >
        {!holds.ok ? (
          <ProblemNotice code={holds.error.code} message={holds.error.message} />
        ) : holds.data.length === 0 ? (
          <EmptyState title="No active holds" />
        ) : (
          <DataTable
            caption="Active legal holds"
            rows={holds.data}
            rowKey={(row) => row.id}
            columns={[
              { key: "subject", header: "Subject", render: (row) => <code>{row.user_id}</code> },
              { key: "reason", header: "Reason", render: (row) => row.reason },
              {
                key: "placed",
                header: "Placed",
                render: (row) => formatInstant(row.created_at, zone, me.data.locale),
              },
            ]}
          />
        )}
      </Card>

      <Card title="Raise a request">
        <PrivacyRequestForms />
      </Card>
    </div>
  );
}
