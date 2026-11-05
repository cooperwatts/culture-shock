import Link from "next/link";
import { Alert, Button } from "@culture-shock/ui";

const DEV_ROLES = [
  "admin",
  "designer",
  "participant",
  "support_readonly",
] as const;

/**
 * Shown when the API reports an unauthenticated session. The sign-in links go
 * to the API Worker, which owns the OIDC flow.
 */
export function SignInPrompt({ redirect = "/" }: { redirect?: string }) {
  const target = encodeURIComponent(redirect);
  return (
    <div className="space-y-4">
      <Alert tone="info" title="Sign in to continue">
        Culture Shock uses your organization&apos;s identity provider. No
        separate password is created or stored.
      </Alert>
      <div className="flex flex-wrap gap-3">
        <Link href={`/api/v1/auth/entra-id/start?redirect=${target}`}>
          <Button variant="primary">Sign in with Microsoft Entra ID</Button>
        </Link>
        <Link href={`/api/v1/auth/google-workspace/start?redirect=${target}`}>
          <Button>Sign in with Google Workspace</Button>
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">
        Only providers your administrator enabled will work; the others return
        &quot;not enabled&quot;.
      </p>

      {/* Stripped from a production build, and the route 404s outside development anyway. */}
      {process.env.NODE_ENV !== "production" ? (
        <div className="rounded-lg border border-dashed border-border p-4">
          <p className="text-sm font-medium">Local development</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in without an identity provider. Each link gives the account
            exactly that role, so you can check what every role can reach.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {DEV_ROLES.map((role) => (
              <li key={role}>
                <a
                  href={`/api/v1/auth/dev-login?as=${role}&redirect=${target}`}
                  className="inline-flex min-h-9 items-center rounded-md border border-border px-3 text-xs font-medium transition-colors hover:border-accent hover:text-accent"
                >
                  {role}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function ProblemNotice({
  code,
  message,
}: {
  code: string;
  message: string;
}) {
  const tone =
    code === "forbidden" || code === "unauthenticated" ? "warning" : "error";
  return (
    <Alert
      tone={tone}
      title={code === "forbidden" ? "Not permitted" : "Something went wrong"}
    >
      {message}
    </Alert>
  );
}
