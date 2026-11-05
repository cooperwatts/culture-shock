import { z } from "zod";

/**
 * Brand theme tokens. Every participant-facing surface reads these tokens;
 * no colour, font, or product noun is hardcoded in source.
 */
const hexColor = z
  .string()
  .regex(
    /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/,
    "Expected a hex colour such as #1f2937",
  );

const fontStack = z
  .string()
  .min(1)
  .max(200)
  // Font stacks are injected into CSS custom properties; reject anything that
  // could terminate the declaration or start a new one.
  .regex(/^[A-Za-z0-9 ,'"_-]+$/, "Font stack contains unsupported characters");

export const colorTokensSchema = z.object({
  primary: hexColor,
  primaryForeground: hexColor,
  accent: hexColor,
  accentForeground: hexColor,
  background: hexColor,
  foreground: hexColor,
  muted: hexColor,
  mutedForeground: hexColor,
  border: hexColor,
  destructive: hexColor,
  success: hexColor,
  warning: hexColor,
});

export const typographyTokensSchema = z.object({
  bodyFont: fontStack,
  headingFont: fontStack,
  baseSizePx: z.number().int().min(12).max(20),
  scaleRatio: z.number().min(1).max(1.6),
});

export const assetKeysSchema = z.object({
  /** Private R2 object keys; assets are streamed through authorized routes. */
  logoLight: z.string().max(256).nullable().default(null),
  logoDark: z.string().max(256).nullable().default(null),
  favicon: z.string().max(256).nullable().default(null),
  emailHeader: z.string().max(256).nullable().default(null),
  bodyFontFile: z.string().max(256).nullable().default(null),
  headingFontFile: z.string().max(256).nullable().default(null),
});

/**
 * Family names for uploaded faces. Generated rather than author-supplied, so a
 * font name can never be used to inject into the CSS declaration.
 */
export const CUSTOM_FONT_FAMILIES = {
  body: "CultureShockBody",
  heading: "CultureShockHeading",
} as const;

export const brandThemeSchema = z.object({
  revision: z.number().int().min(1),
  colors: colorTokensSchema,
  typography: typographyTokensSchema,
  assets: assetKeysSchema,
  radiusPx: z.number().int().min(0).max(32).default(8),
  /** Forces high-contrast token overrides regardless of designer choices. */
  highContrastMode: z.boolean().default(false),
});

export type BrandTheme = z.infer<typeof brandThemeSchema>;
export type ColorTokens = z.infer<typeof colorTokensSchema>;

export const DEFAULT_BRAND_THEME: BrandTheme = brandThemeSchema.parse({
  revision: 1,
  colors: {
    primary: "#1f2937",
    primaryForeground: "#ffffff",
    accent: "#2563eb",
    accentForeground: "#ffffff",
    background: "#ffffff",
    foreground: "#111827",
    muted: "#f3f4f6",
    mutedForeground: "#4b5563",
    border: "#d1d5db",
    destructive: "#b91c1c",
    success: "#15803d",
    warning: "#b45309",
  },
  typography: {
    bodyFont: "system-ui, sans-serif",
    headingFont: "system-ui, sans-serif",
    baseSizePx: 16,
    scaleRatio: 1.25,
  },
  assets: {},
});

function kebab(token: string): string {
  return token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/**
 * Serializes validated tokens to CSS custom properties. Values are re-validated
 * by the schema above, so this never concatenates untrusted input into CSS.
 * An uploaded face is prepended to the stack, keeping the author's fallbacks.
 */
export function themeToCssVariables(theme: BrandTheme): string {
  const declarations: string[] = [];
  for (const [token, value] of Object.entries(theme.colors)) {
    declarations.push(`--cs-color-${kebab(token)}: ${value};`);
  }

  const bodyStack = theme.assets.bodyFontFile
    ? `"${CUSTOM_FONT_FAMILIES.body}", ${theme.typography.bodyFont}`
    : theme.typography.bodyFont;
  const headingStack = theme.assets.headingFontFile
    ? `"${CUSTOM_FONT_FAMILIES.heading}", ${theme.typography.headingFont}`
    : theme.typography.headingFont;

  declarations.push(`--cs-font-body: ${bodyStack};`);
  declarations.push(`--cs-font-heading: ${headingStack};`);
  declarations.push(`--cs-font-size-base: ${theme.typography.baseSizePx}px;`);
  declarations.push(`--cs-font-scale: ${theme.typography.scaleRatio};`);
  declarations.push(`--cs-radius: ${theme.radiusPx}px;`);
  return declarations.join("\n");
}

/**
 * `@font-face` rules for uploaded faces. The caller supplies the URL builder so
 * this module stays free of API route knowledge.
 */
export function themeFontFaceCss(
  theme: BrandTheme,
  assetUrl: (slot: string) => string,
): string {
  const faces: string[] = [];

  if (theme.assets.bodyFontFile) {
    faces.push(
      `@font-face{font-family:"${CUSTOM_FONT_FAMILIES.body}";src:url("${assetUrl("bodyFontFile")}") format("woff2");font-display:swap;font-weight:100 900;}`,
    );
  }
  if (theme.assets.headingFontFile) {
    faces.push(
      `@font-face{font-family:"${CUSTOM_FONT_FAMILIES.heading}";src:url("${assetUrl("headingFontFile")}") format("woff2");font-display:swap;font-weight:100 900;}`,
    );
  }

  return faces.join("\n");
}

/** WCAG 2.x relative luminance contrast ratio between two hex colours. */
export function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string): number => {
    const normalized =
      hex.length === 4
        ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
        : hex;
    const channels = [1, 3, 5].map((offset) => {
      const channel =
        Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255;
      return channel <= 0.03928
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const a = luminance(foreground);
  const b = luminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

export interface ContrastFinding {
  readonly pair: string;
  readonly ratio: number;
  readonly minimum: number;
}

/** Accessibility gate applied before a theme revision may be published. */
export function checkThemeContrast(
  theme: BrandTheme,
  minimum = 4.5,
): ContrastFinding[] {
  const pairs: Array<[string, string, string]> = [
    ["foreground/background", theme.colors.foreground, theme.colors.background],
    [
      "primaryForeground/primary",
      theme.colors.primaryForeground,
      theme.colors.primary,
    ],
    [
      "accentForeground/accent",
      theme.colors.accentForeground,
      theme.colors.accent,
    ],
    ["mutedForeground/muted", theme.colors.mutedForeground, theme.colors.muted],
  ];
  return pairs
    .map(([pair, fg, bg]) => ({
      pair,
      ratio: Number(contrastRatio(fg, bg).toFixed(2)),
      minimum,
    }))
    .filter((finding) => finding.ratio < minimum);
}
