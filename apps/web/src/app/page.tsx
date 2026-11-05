import { PageHeader } from "@culture-shock/ui";
import { loadBranding } from "@/lib/branding";
import { canSeeAdministration, loadSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [{ terminology }, session] = await Promise.all([
    loadBranding(),
    loadSession(),
  ]);

  const destinations = [
    {
      href: "/designer",
      title: terminology.designerSingular,
      description: `Set up a ${terminology.experienceSingular.toLowerCase()}, choose who gets matched with whom, and see how it went.`,
      shown: true,
    },
    {
      href: "/participant",
      title: terminology.participantSingular,
      description: `Join what is open, see who you have been matched with, and decide what you share.`,
      shown: true,
    },
    {
      href: "/admin",
      title: "Administration",
      description: `Sign-in, branding, privacy requests and which ${terminology.packPlural.toLowerCase()} people can use.`,
      // Hidden once we know the roles and they do not include it.
      shown: !session.signedIn || canSeeAdministration(session),
    },
  ].filter((destination) => destination.shown);

  // Signed out, the links still point at the section: each page sends you back
  // there after sign-in, so a deep link is not lost.
  const affordance = session.signedIn ? "Open" : "Sign in";

  return (
    <div>
      <PageHeader
        title={terminology.platformName}
        description={`Help colleagues meet people they would not otherwise meet. Pick a ready-made ${terminology.packSingular.toLowerCase()}, choose when it runs, and ${terminology.platformName} handles the matching and the reminders.`}
      />

      <nav aria-label="Sections">
        <ul className="grid gap-4 sm:grid-cols-3">
          {destinations.map((destination, index) => (
            // The list item stretches to the row height; the link fills it.
            <li key={destination.href} className="flex">
              <a
                href={destination.href}
                className="group cs-lift relative flex h-full w-full flex-col overflow-hidden rounded-lg border border-border bg-background p-5 shadow-sm hover:border-accent"
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 top-0 h-[3px] bg-brand"
                />
                <span
                  aria-hidden="true"
                  className="font-heading text-xs font-semibold tabular-nums text-muted-foreground"
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="mt-2 font-heading text-title font-semibold tracking-tight">
                  {destination.title}
                </span>
                <span className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {destination.description}
                </span>
                <span className="mt-auto pt-5 text-sm font-medium text-accent">
                  {affordance}
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
    </div>
  );
}
