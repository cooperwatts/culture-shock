import Link from "next/link";
import { Card } from "@culture-shock/ui";
import { apiGet, isUnauthenticated } from "@/lib/api-server";
import { ProblemNotice, SignInPrompt } from "@/components/auth-states";
import { CopilotForm } from "./copilot-form";
import type { MeResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CopilotPage() {
  const me = await apiGet<MeResponse>("/me");
  if (isUnauthenticated(me))
    return <SignInPrompt redirect="/designer/copilot" />;
  if (!me.ok)
    return <ProblemNotice code={me.error.code} message={me.error.message} />;

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb">
        <Link className="text-sm underline" href="/designer">
          Back to designer
        </Link>
      </nav>

      <header className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold">Culture Copilot</h1>
        <p className="text-muted-foreground">
          Tell us roughly what your organization looks like and what you are
          hoping for, and we will suggest something. Only rough size bands and
          the goals you type are ever sent anywhere — no names, no employee
          records. If your administrator has not turned on AI, a set of built-in
          rules answers instead and tells you so.
        </p>
      </header>

      <Card title="Your organization">
        <CopilotForm />
      </Card>
    </div>
  );
}
