import { apiGet } from "./api-server";
import type { MeResponse } from "./types";

export type Session =
  | { readonly signedIn: false }
  | { readonly signedIn: true; readonly user: MeResponse };

/**
 * Session state for the shell. Anything other than a successful `/me` counts as
 * signed out: the web app never infers identity on its own, so an unreachable
 * API degrades to the least-privileged view rather than a half-rendered one.
 */
export async function loadSession(): Promise<Session> {
  const me = await apiGet<MeResponse>("/me");
  return me.ok ? { signedIn: true, user: me.data } : { signedIn: false };
}

/**
 * Administration is installation-scoped only, so hiding it from users without
 * the role is safe. Designer access is deliberately not filtered: it can also
 * come from a per-experience grant that `/me` roles do not report.
 */
export function canSeeAdministration(session: Session): boolean {
  if (!session.signedIn) return false;
  return (
    session.user.roles.includes("admin") ||
    session.user.roles.includes("support_readonly")
  );
}
