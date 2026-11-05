import {
  DEFAULT_BRAND_THEME,
  brandingResponseSchema,
  themeFontFaceCss,
  themeToCssVariables,
  type Terminology,
} from "@culture-shock/config";
import { headers } from "next/headers";

const DEFAULT_TERMINOLOGY: Terminology = {
  platformName: "Culture Shock",
  designerSingular: "Organizer",
  designerPlural: "Organizers",
  participantSingular: "Participant",
  participantPlural: "Participants",
  experienceSingular: "Programme",
  experiencePlural: "Programmes",
  packSingular: "Culture Pack",
  packPlural: "Culture Packs",
  matchSingular: "Connection",
};

export interface Branding {
  readonly css: string;
  readonly fontFaceCss: string;
  readonly terminology: Terminology;
  readonly organizationName: string;
  readonly hasLogo: boolean;
  readonly hasFavicon: boolean;
}

/**
 * Reads branding from the API Worker on the same origin. The web app holds no
 * credentials, so an unauthenticated read falls back to neutral defaults rather
 * than failing the render.
 */
export async function loadBranding(): Promise<Branding> {
  const fallback: Branding = {
    css: themeToCssVariables(DEFAULT_BRAND_THEME),
    fontFaceCss: "",
    terminology: DEFAULT_TERMINOLOGY,
    organizationName: "",
    hasLogo: false,
    hasFavicon: false,
  };

  try {
    const requestHeaders = await headers();
    const host = requestHeaders.get("host");
    if (!host) return fallback;

    const protocol =
      host.startsWith("localhost") || host.startsWith("127.")
        ? "http"
        : "https";
    const response = await fetch(`${protocol}://${host}/api/v1/branding`, {
      headers: { cookie: requestHeaders.get("cookie") ?? "" },
      cache: "no-store",
    });
    if (!response.ok) return fallback;

    const payload = (await response.json()) as { data?: unknown };
    const parsed = brandingResponseSchema.safeParse(payload.data);
    if (!parsed.success) return fallback;

    return {
      css: themeToCssVariables(parsed.data.branding),
      fontFaceCss: themeFontFaceCss(
        parsed.data.branding,
        (slot) => `/api/v1/branding/assets/${slot}`,
      ),
      terminology: parsed.data.terminology,
      organizationName: parsed.data.organizationName,
      hasLogo: Boolean(parsed.data.branding.assets.logoLight),
      hasFavicon: Boolean(parsed.data.branding.assets.favicon),
    };
  } catch {
    return fallback;
  }
}
