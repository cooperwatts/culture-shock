import Link from "next/link";
import { Card, PageHeader } from "@culture-shock/ui";
import type { BrandTheme } from "@culture-shock/config";
import { apiGet, isUnauthenticated } from "@/lib/api-server";
import { ProblemNotice, SignInPrompt } from "@/components/auth-states";
import { BrandingEditor } from "./branding-editor";
import type { MeResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Branding" };

interface BrandingConfig {
  schemaVersion: string;
  branding: BrandTheme;
  terminology: Record<string, string>;
}

export default async function BrandingPage() {
  const [me, config] = await Promise.all([
    apiGet<MeResponse>("/me"),
    apiGet<BrandingConfig>("/admin/config"),
  ]);

  if (isUnauthenticated(me)) return <SignInPrompt redirect="/admin/branding" />;
  if (!me.ok)
    return <ProblemNotice code={me.error.code} message={me.error.message} />;
  if (!config.ok)
    return (
      <ProblemNotice code={config.error.code} message={config.error.message} />
    );

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb">
        <Link className="text-sm text-muted-foreground underline" href="/admin">
          Back to settings
        </Link>
      </nav>

      <PageHeader
        eyebrow="Administration"
        title="Branding"
        description="Your colours, fonts and logo. These are used everywhere, including the emails people receive, so this is not just how the site looks."
      />

      <Card
        title="Theme"
        description="The preview updates as you type. Publishing makes it live for everyone, and is blocked if any text would be too faint to read comfortably."
      >
        <BrandingEditor
          revision={config.revision ?? 0}
          initial={config.data.branding}
          terminology={config.data.terminology}
        />
      </Card>
    </div>
  );
}
