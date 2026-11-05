import {
  Alert,
  Card,
  DataTable,
  DescriptionList,
  PageHeader,
  StatusBadge,
} from "@culture-shock/ui";
import { apiGet, isUnauthenticated } from "@/lib/api-server";
import { ProblemNotice, SignInPrompt } from "@/components/auth-states";
import { PackControls } from "./pack-controls";
import type { MeResponse, PackSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

interface AdminConfig {
  setupComplete: boolean;
  organization: {
    name: string;
    slug: string;
    defaultLocale: string;
    defaultTimeZone: string;
  };
  authentication: {
    providers: Array<{ kind: string; enabled: boolean }>;
    magicLink: { enabled: boolean };
  };
  ai: { enabled: boolean; egressReviewedBy: string | null };
  privacy: {
    consentVersion: string;
    minimumCohortSize: number;
    allowConversationHosting: boolean;
  };
  notifications: { emailEnabled: boolean; provider: string };
}

const SETTINGS = [
  {
    href: "/admin/branding",
    title: "Branding and theme",
    description:
      "Your logo, colours, fonts and the words this site uses for things.",
  },
  {
    href: "/admin/privacy",
    title: "Privacy requests",
    description:
      "Handle requests to export or delete someone's data, and place legal holds.",
  },
  {
    href: "/admin/operations",
    title: "Operations",
    description:
      "Check that email, background jobs and scheduled work are keeping up.",
  },
  {
    href: "/admin/packs/drafts",
    title: "Culture Pack drafts",
    description:
      "Review and publish new Culture Packs before anyone can use them.",
  },
];

export default async function AdminPage() {
  const [me, config, packs] = await Promise.all([
    apiGet<MeResponse>("/me"),
    apiGet<AdminConfig>("/admin/config"),
    apiGet<PackSummary[]>("/packs"),
  ]);

  if (isUnauthenticated(me)) return <SignInPrompt redirect="/admin" />;
  if (!me.ok)
    return <ProblemNotice code={me.error.code} message={me.error.message} />;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Settings"
        title="Administration"
        description="Set up how this site looks, who can sign in, and what people can run. Changes that affect privacy or security ask you to sign in again first."
      />

      <nav aria-label="Settings sections">
        <ul className="grid gap-4 sm:grid-cols-2">
          {SETTINGS.map((item) => (
            <li key={item.href} className="flex">
              <a
                href={item.href}
                className="group cs-lift relative flex h-full w-full flex-col overflow-hidden rounded-lg border border-border bg-background p-5 shadow-sm hover:border-accent"
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 top-0 h-[3px] bg-brand"
                />
                <span className="font-heading text-title font-semibold tracking-tight">
                  {item.title}
                </span>
                <span className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {item.description}
                </span>
                <span className="mt-auto pt-4 text-sm font-medium text-accent">
                  Open
                  <span
                    aria-hidden="true"
                    className="cs-nudge ml-1 inline-block"
                  >
                    →
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Card
        title="Current setup"
        description="A summary of what is switched on right now."
      >
        {!config.ok ? (
          <ProblemNotice
            code={config.error.code}
            message={config.error.message}
          />
        ) : (
          <div className="space-y-4">
            {!config.data.setupComplete ? (
              <Alert tone="warning" title="Setup is not finished">
                Once your sign-in and privacy settings are how you want them,
                mark setup complete to clear this.
              </Alert>
            ) : null}
            <DescriptionList
              items={[
                { term: "Organization", detail: config.data.organization.name },
                {
                  term: "Default language",
                  detail: config.data.organization.defaultLocale,
                },
                {
                  term: "Default time zone",
                  detail: config.data.organization.defaultTimeZone,
                },
                {
                  term: "Sign-in methods",
                  detail:
                    config.data.authentication.providers
                      .filter((provider) => provider.enabled)
                      .map((provider) => provider.kind)
                      .join(", ") || "None enabled",
                },
                {
                  term: "Magic links",
                  detail: config.data.authentication.magicLink.enabled
                    ? "Enabled"
                    : "Disabled",
                },
                {
                  term: "AI features",
                  detail: config.data.ai.enabled
                    ? `On · egress reviewed by ${config.data.ai.egressReviewedBy ?? "unknown"}`
                    : "Off — everything falls back to fixed rules instead",
                },
                {
                  term: "Email",
                  detail: config.data.notifications.emailEnabled
                    ? config.data.notifications.provider
                    : "Not sending",
                },
                {
                  term: "Consent version",
                  detail: config.data.privacy.consentVersion,
                },
                {
                  term: "Smallest group reported",
                  detail: `${config.data.privacy.minimumCohortSize} people — anything smaller is hidden so individuals cannot be identified`,
                },
              ]}
            />
            <p className="text-sm">
              Most of this is changed in{" "}
              <a className="underline" href="/admin/branding">
                Branding
              </a>{" "}
              or by publishing a new configuration. Colour changes are rejected
              if text would become hard to read.
            </p>
          </div>
        )}
      </Card>

      <Card
        title="Culture Packs"
        description="A Culture Pack is a ready-made programme, like a coffee roulette or a gift exchange. Turn one on to let organizers use it. Retiring one keeps live programmes running but stops new ones."
        actions={
          <a className="text-sm underline" href="/admin/packs/drafts">
            Review drafts
          </a>
        }
      >
        {!packs.ok ? (
          <ProblemNotice
            code={packs.error.code}
            message={packs.error.message}
          />
        ) : (
          <DataTable
            caption="Installed Culture Packs"
            rows={packs.data}
            rowKey={(row) => row.slug}
            columns={[
              {
                key: "name",
                header: "Pack",
                render: (row) => (
                  <div>
                    <p className="font-medium">{row.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.summary}
                    </p>
                  </div>
                ),
              },
              {
                key: "origin",
                header: "Origin",
                render: (row) => <StatusBadge state={row.origin} />,
              },
              {
                key: "version",
                header: "Version",
                render: (row) =>
                  row.pinnedVersion ?? row.latestVersion ?? "None published",
              },
              {
                key: "state",
                header: "State",
                render: (row) => (
                  <StatusBadge
                    state={
                      row.status === "retired"
                        ? "retired"
                        : row.enabled
                          ? "enabled"
                          : "disabled"
                    }
                  />
                ),
              },
              {
                key: "actions",
                header: "Actions",
                render: (row) => (
                  <PackControls
                    slug={row.slug}
                    enabled={row.enabled}
                    status={row.status}
                  />
                ),
              },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
