import {
  escapeHtml,
  renderTemplate,
  type CommunicationTemplate,
  type TemplateValues,
} from "@culture-shock/pack-sdk";
import { themeToCssVariables, type BrandTheme, type Terminology } from "@culture-shock/config";

export interface RenderContext {
  readonly locale: string;
  readonly defaultLocale: string;
  readonly terminology: Terminology;
  readonly theme: BrandTheme;
  readonly organizationName: string;
  readonly supportUrl: string | null;
  readonly unsubscribeUrl: string | null;
}

export interface RenderedMessage {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

function pick(localized: Record<string, string>, locale: string, fallback: string): string {
  return localized[locale] ?? localized[fallback] ?? Object.values(localized)[0] ?? "";
}

/**
 * Wraps rendered body text in a minimal, high-contrast HTML document. Styling
 * uses the organization's validated theme tokens; no external stylesheet, font
 * or image is referenced, so the message renders the same in a locked-down
 * mail client as it does in a browser.
 */
function wrapHtml(bodyHtml: string, context: RenderContext): string {
  const tokens = themeToCssVariables(context.theme);
  const footer = [
    escapeHtml(`Sent by ${context.organizationName} through ${context.terminology.platformName}.`),
    context.supportUrl ? `<a href="${escapeHtml(context.supportUrl)}">Contact support</a>` : "",
    context.unsubscribeUrl
      ? `<a href="${escapeHtml(context.unsubscribeUrl)}">Manage your notification settings</a>`
      : "",
  ]
    .filter(Boolean)
    .join(" &middot; ");

  return [
    "<!doctype html>",
    `<html lang="${escapeHtml(context.locale)}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<style>:root{${tokens}}`,
    "body{margin:0;padding:24px;background:var(--cs-color-background);color:var(--cs-color-foreground);font-family:var(--cs-font-body);font-size:var(--cs-font-size-base);line-height:1.5}",
    ".cx-card{max-width:600px;margin:0 auto;border:1px solid var(--cs-color-border);border-radius:var(--cs-radius);padding:24px}",
    ".cx-footer{max-width:600px;margin:16px auto 0;color:var(--cs-color-muted-foreground);font-size:12px}",
    "a{color:var(--cs-color-accent)}",
    "</style>",
    "</head>",
    '<body><div class="cx-card" role="article">',
    bodyHtml,
    `</div><div class="cx-footer">${footer}</div></body></html>`,
  ].join("");
}

/**
 * Renders a pack communication template. Values are escaped for the HTML
 * surface, and the plain-text alternative is always produced so a text-only
 * client or screen reader gets an equivalent message.
 */
export function renderNotification(
  template: CommunicationTemplate,
  values: TemplateValues,
  context: RenderContext,
): RenderedMessage {
  const subject = renderTemplate(
    pick(template.subject, context.locale, context.defaultLocale),
    values,
    { surface: "text", maxLength: 150 },
  );

  const bodyText = renderTemplate(
    pick(template.body, context.locale, context.defaultLocale),
    values,
    { surface: "text", maxLength: 4000 },
  );

  const plainText = renderTemplate(
    pick(template.plainTextBody, context.locale, context.defaultLocale),
    values,
    { surface: "text", maxLength: 4000 },
  );

  const paragraphs = bodyText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");

  return {
    subject,
    html: wrapHtml(paragraphs, context),
    text: plainText.length > 0 ? plainText : bodyText,
  };
}

export interface NotificationReferences {
  readonly organizationName: string;
  readonly experienceName: string;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly enrollmentClosesAt: string | null;
  readonly timeZone: string;
  readonly participantDisplayName: string | null;
  readonly participantPseudonym: string;
  readonly peerDisplayName: string | null;
  readonly peerPseudonym: string | null;
  readonly experienceUrl: string;
  readonly supportUrl: string | null;
}

function formatInstant(value: string | null, timeZone: string, locale: string): string {
  if (!value) return "";
  try {
    // Explicit components rather than dateStyle/timeStyle, which cannot be
    // combined with timeZoneName.
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
      timeZoneName: "short",
    }).format(new Date(value));
  } catch {
    return new Date(value).toISOString();
  }
}

/**
 * Builds the allowlisted template values. Peer identity is only populated when
 * the caller has already applied the instance's privacy policy.
 */
export function buildTemplateValues(
  references: NotificationReferences,
  context: RenderContext,
): TemplateValues {
  return {
    "organization.name": references.organizationName,
    "experience.name": references.experienceName,
    "experience.startsAt": formatInstant(references.startsAt, references.timeZone, context.locale),
    "experience.endsAt": formatInstant(references.endsAt, references.timeZone, context.locale),
    "experience.enrollmentClosesAt": formatInstant(
      references.enrollmentClosesAt,
      references.timeZone,
      context.locale,
    ),
    "experience.timeZone": references.timeZone,
    "participant.displayName": references.participantDisplayName ?? references.participantPseudonym,
    "participant.pseudonym": references.participantPseudonym,
    "match.peerDisplayName": references.peerDisplayName ?? references.peerPseudonym ?? "",
    "match.peerPseudonym": references.peerPseudonym ?? "",
    "terminology.platformName": context.terminology.platformName,
    "terminology.participantSingular": context.terminology.participantSingular,
    "terminology.experienceSingular": context.terminology.experienceSingular,
    "terminology.matchSingular": context.terminology.matchSingular,
    "links.experienceUrl": references.experienceUrl,
    "links.supportUrl": references.supportUrl ?? "",
  };
}
