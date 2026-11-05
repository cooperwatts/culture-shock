import Link from "next/link";
import { Card, DataTable, EmptyState, StatusBadge } from "@culture-shock/ui";
import { apiGet, isUnauthenticated } from "@/lib/api-server";
import { ProblemNotice, SignInPrompt } from "@/components/auth-states";
import { GenerateDraftForm } from "./generate-draft-form";
import { formatInstant } from "@/lib/format";
import type { MeResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

interface DraftSummary {
  id: string;
  slug: string;
  source: string;
  generator: string | null;
  ready: boolean;
  createdAt: string;
  expiresAt: string;
}

interface AdminConfigSlice {
  culturePacks: { allowAiGeneratedPacks: boolean };
  ai: { enabled: boolean };
}

export default async function PackDraftsPage() {
  const [me, drafts, config] = await Promise.all([
    apiGet<MeResponse>("/me"),
    apiGet<DraftSummary[]>("/packs/drafts"),
    apiGet<AdminConfigSlice>("/admin/config"),
  ]);

  if (isUnauthenticated(me)) return <SignInPrompt redirect="/admin/packs/drafts" />;
  if (!me.ok) return <ProblemNotice code={me.error.code} message={me.error.message} />;

  const generationAllowed = config.ok ? config.data.culturePacks.allowAiGeneratedPacks : false;
  const aiEnabled = config.ok ? config.data.ai.enabled : false;

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb">
        <Link className="text-sm underline" href="/admin">
          Back to administration
        </Link>
      </nav>

      <header className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold">Culture Pack drafts</h1>
        <p className="text-muted-foreground">
          A draft is a proposal. It is not installed, enabled or visible to designers until you
          review it and publish it. Publishing re-runs every check rather than trusting the stored
          result.
        </p>
      </header>

      <Card title="Drafts awaiting review">
        {!drafts.ok ? (
          <ProblemNotice code={drafts.error.code} message={drafts.error.message} />
        ) : drafts.data.length === 0 ? (
          <EmptyState title="No drafts" />
        ) : (
          <DataTable
            caption="Culture Pack drafts"
            rows={drafts.data}
            rowKey={(row) => row.id}
            columns={[
              {
                key: "slug",
                header: "Slug",
                render: (row) => (
                  <Link className="underline" href={`/admin/packs/drafts/${row.id}`}>
                    {row.slug}
                  </Link>
                ),
              },
              {
                key: "source",
                header: "Produced by",
                render: (row) => (
                  <StatusBadge
                    state={row.generator === "ai" ? "ai" : "deterministic"}
                    label={row.generator === "ai" ? "AI draft" : "Deterministic draft"}
                  />
                ),
              },
              {
                key: "ready",
                header: "Review",
                render: (row) => (
                  <StatusBadge
                    state={row.ready ? "ready" : "blocked"}
                    label={row.ready ? "Passes checks" : "Blocked"}
                  />
                ),
              },
              {
                key: "expires",
                header: "Expires",
                render: (row) => formatInstant(row.expiresAt, me.data.timeZone, me.data.locale),
              },
            ]}
          />
        )}
      </Card>

      <Card
        title="Draft a new Culture Pack"
        description="Describe the outcome you want. The platform builds the workflow, rules and capability list; a generator only fills in content."
      >
        {!generationAllowed ? (
          <ProblemNotice
            code="forbidden"
            message="Generated Culture Packs are disabled. Enable culturePacks.allowAiGeneratedPacks in the installation configuration first."
          />
        ) : (
          <GenerateDraftForm aiEnabled={aiEnabled} />
        )}
      </Card>
    </div>
  );
}
