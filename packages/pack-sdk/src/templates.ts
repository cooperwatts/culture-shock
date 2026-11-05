/**
 * Inert template rendering. Pack templates are data: only allowlisted variables
 * resolve, values are escaped for the target surface, and nothing is evaluated.
 */

export const TEMPLATE_VARIABLES = [
  "organization.name",
  "experience.name",
  "experience.startsAt",
  "experience.endsAt",
  "experience.enrollmentClosesAt",
  "experience.timeZone",
  "participant.displayName",
  "participant.pseudonym",
  "match.peerDisplayName",
  "match.peerPseudonym",
  "terminology.platformName",
  "terminology.participantSingular",
  "terminology.experienceSingular",
  "terminology.matchSingular",
  "links.experienceUrl",
  "links.supportUrl",
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z][a-zA-Z0-9.]*)\s*\}\}/g;

export function isTemplateVariable(name: string): name is TemplateVariable {
  return (TEMPLATE_VARIABLES as readonly string[]).includes(name);
}

export function extractVariables(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(VARIABLE_PATTERN)) {
    if (match[1]) found.add(match[1]);
  }
  return [...found];
}

export function unknownVariables(template: string): string[] {
  return extractVariables(template).filter((name) => !isTemplateVariable(name));
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type TemplateSurface = "text" | "html";

export type TemplateValues = Partial<Record<TemplateVariable, string>>;

export interface RenderOptions {
  readonly surface: TemplateSurface;
  /** Rendered output is truncated to this many characters. */
  readonly maxLength?: number;
}

/**
 * Renders a template. Unknown variables render as empty strings rather than
 * leaking the raw placeholder, and values are escaped for HTML surfaces.
 */
export function renderTemplate(
  template: string,
  values: TemplateValues,
  options: RenderOptions = { surface: "text" },
): string {
  const maxLength = options.maxLength ?? 5000;
  const output = template.replace(VARIABLE_PATTERN, (_match, name: string) => {
    if (!isTemplateVariable(name)) return "";
    const value = values[name] ?? "";
    return options.surface === "html" ? escapeHtml(value) : value;
  });
  return output.length > maxLength ? output.slice(0, maxLength) : output;
}
