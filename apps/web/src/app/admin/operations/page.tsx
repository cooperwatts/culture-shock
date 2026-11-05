import Link from "next/link";
import { Alert, Card, DataTable, StatusBadge } from "@culture-shock/ui";
import { apiGet, isUnauthenticated } from "@/lib/api-server";
import { ProblemNotice, SignInPrompt } from "@/components/auth-states";
import { formatInstant } from "@/lib/format";
import type { MeResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

interface SloCheck {
  key: string;
  title: string;
  status: "ok" | "degraded" | "breached";
  observed: number;
  threshold: number | null;
  action: string;
}

interface OperationsReport {
  status: "ok" | "degraded" | "breached";
  evaluatedAt: string;
  checks: SloCheck[];
  snapshot: Record<string, number>;
}

const TONE = { ok: "success", degraded: "warning", breached: "error" } as const;

export default async function OperationsPage() {
  const [me, operations] = await Promise.all([
    apiGet<MeResponse>("/me"),
    apiGet<OperationsReport>("/admin/operations"),
  ]);

  if (isUnauthenticated(me)) return <SignInPrompt redirect="/admin/operations" />;
  if (!me.ok) return <ProblemNotice code={me.error.code} message={me.error.message} />;

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb">
        <Link className="text-sm underline" href="/admin">
          Back to administration
        </Link>
      </nav>

      <header className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold">Operations</h1>
        <p className="text-muted-foreground">
          Delivery and job health. Counts and ages only, so this page is safe for support staff who
          have no access to participant data.
        </p>
      </header>

      {!operations.ok ? (
        <ProblemNotice code={operations.error.code} message={operations.error.message} />
      ) : (
        <>
          <Alert
            tone={TONE[operations.data.status]}
            title={
              operations.data.status === "ok"
                ? "All checks are within target"
                : operations.data.status === "degraded"
                  ? "Some checks are degraded"
                  : "One or more checks are breached"
            }
          >
            Evaluated {formatInstant(operations.data.evaluatedAt, me.data.timeZone, me.data.locale)}.
            The jobs Worker re-evaluates this every five minutes and emits an alert line per breach.
          </Alert>

          <Card title="Service level checks">
            <DataTable
              caption="Operational checks"
              rows={operations.data.checks}
              rowKey={(row) => row.key}
              columns={[
                { key: "title", header: "Check", render: (row) => row.title },
                { key: "status", header: "Status", render: (row) => <StatusBadge state={row.status} /> },
                {
                  key: "observed",
                  header: "Observed",
                  render: (row) =>
                    row.threshold === null
                      ? String(row.observed)
                      : `${row.observed} (target under ${row.threshold})`,
                },
                {
                  key: "action",
                  header: "What to do",
                  render: (row) =>
                    row.action ? (
                      <span className="text-sm text-muted-foreground">{row.action}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Nothing</span>
                    ),
                },
              ]}
            />
          </Card>

          <Card title="Raw counters">
            <dl className="grid gap-3 sm:grid-cols-3">
              {Object.entries(operations.data.snapshot).map(([key, value]) => (
                <div key={key}>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    {key.replace(/([A-Z])/g, " $1").toLowerCase()}
                  </dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </>
      )}
    </div>
  );
}
