import type { Metadata } from "next";
import "./globals.css";
import { loadBranding } from "@/lib/branding";
import { canSeeAdministration, loadSession } from "@/lib/session";
import { PrimaryNav } from "@/components/primary-nav";
import { SignOutButton } from "@/components/session-controls";

export async function generateMetadata(): Promise<Metadata> {
  const branding = await loadBranding();
  return {
    title: {
      default: branding.terminology.platformName,
      template: `%s · ${branding.terminology.platformName}`,
    },
    description:
      "An open, privacy-first platform for intentional workplace connection.",
    robots: { index: false, follow: false },
    ...(branding.hasFavicon
      ? { icons: { icon: "/api/v1/branding/assets/favicon" } }
      : {}),
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [branding, session] = await Promise.all([
    loadBranding(),
    loadSession(),
  ]);
  const { terminology } = branding;

  const navItems = [
    { href: "/designer", label: terminology.designerPlural },
    { href: "/participant", label: terminology.participantSingular },
    ...(!session.signedIn || canSeeAdministration(session)
      ? [{ href: "/admin", label: "Admin" }]
      : []),
  ];

  return (
    <html lang="en">
      <head>
        {/* Theme tokens come from validated configuration, never from user input. */}
        <style>{`${branding.fontFaceCss}\n:root {\n${branding.css}\n}`}</style>
      </head>
      <body className="min-h-dvh">
        <a className="skip-link" href="#main">
          Skip to main content
        </a>

        <header className="sticky top-0 z-20 border-b border-border bg-background">
          <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-6">
            <a href="/" className="flex shrink-0 items-center gap-2.5">
              {branding.hasLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src="/api/v1/branding/assets/logoLight"
                  alt={branding.organizationName || terminology.platformName}
                  className="h-8 w-auto max-w-[160px] object-contain"
                />
              ) : (
                <>
                  <span
                    aria-hidden="true"
                    className="flex h-8 w-8 items-center justify-center rounded-md bg-brand text-sm font-semibold text-primary-foreground shadow-sm"
                  >
                    {terminology.platformName.charAt(0)}
                  </span>
                  <span className="font-heading text-[0.95rem] font-semibold tracking-tight">
                    {terminology.platformName}
                  </span>
                </>
              )}
            </a>

            <div className="flex-1">
              <PrimaryNav items={navItems} />
            </div>

            <div className="flex shrink-0 items-center gap-3">
              {branding.organizationName ? (
                <span className="hidden text-sm text-muted-foreground sm:block">
                  {branding.organizationName}
                </span>
              ) : null}

              {session.signedIn ? (
                <>
                  <span className="hidden text-sm font-medium sm:block">
                    {session.user.displayName ?? "Signed in"}
                  </span>
                  <SignOutButton />
                </>
              ) : (
                <a
                  href="/participant"
                  className="inline-flex min-h-9 items-center rounded-md border border-border px-3 text-sm font-medium transition-colors hover:border-accent hover:text-accent"
                >
                  Sign in
                </a>
              )}
            </div>
          </div>
        </header>

        <main id="main" className="mx-auto max-w-6xl px-6 py-10">
          {children}
        </main>

        <footer className="mx-auto max-w-6xl px-6 pb-10 text-xs text-muted-foreground">
          {terminology.platformName}
          {branding.organizationName ? ` · ${branding.organizationName}` : ""}
        </footer>
      </body>
    </html>
  );
}
