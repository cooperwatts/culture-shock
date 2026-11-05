import { describe, expect, it } from "vitest";
import {
  CUSTOM_FONT_FAMILIES,
  DEFAULT_BRAND_THEME,
  INSTALLATION_CONFIG_SCHEMA_VERSION,
  checkThemeContrast,
  contrastRatio,
  themeFontFaceCss,
  themeToCssVariables,
  validateInstallationConfig,
} from "../src/index.js";

const base = {
  schemaVersion: INSTALLATION_CONFIG_SCHEMA_VERSION,
  setupComplete: true,
  organization: {
    name: "Example Corp",
    slug: "example-corp",
    defaultLocale: "en-CA",
    supportedLocales: ["en-CA", "fr-CA"],
    defaultTimeZone: "America/Toronto",
  },
  branding: DEFAULT_BRAND_THEME,
  authentication: {
    providers: [
      {
        kind: "entra-id",
        enabled: true,
        issuer: "https://login.microsoftonline.com/tenant/v2.0",
        clientId: "client-id",
        allowedDomains: ["example.com"],
      },
    ],
  },
};

describe("installation configuration", () => {
  it("accepts a minimal valid configuration", () => {
    const result = validateInstallationConfig(base);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("requires an authentication method once setup is complete", () => {
    const result = validateInstallationConfig({
      ...base,
      authentication: { providers: [], magicLink: { enabled: false } },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-https issuer", () => {
    const result = validateInstallationConfig({
      ...base,
      authentication: {
        providers: [
          {
            ...base.authentication.providers[0],
            issuer: "http://insecure.example",
          },
        ],
      },
    });
    expect(result.ok).toBe(false);
  });

  it("refuses to enable AI without a recorded egress review", () => {
    const result = validateInstallationConfig({
      ...base,
      ai: {
        enabled: true,
        providers: [{ key: "primary", kind: "openai" }],
        purposes: {
          copilot_recommendation: {
            enabled: true,
            providerKey: "primary",
            modelId: "gpt-4o-mini",
          },
        },
      },
    });
    expect(result.ok).toBe(false);
    expect(
      result.issues.some((issue) => issue.path.includes("egressReviewedBy")),
    ).toBe(true);
  });

  it("rejects an AI purpose that references an unconfigured provider", () => {
    const result = validateInstallationConfig({
      ...base,
      ai: {
        enabled: true,
        providers: [{ key: "primary", kind: "openai" }],
        egressReviewedBy: "Privacy Officer",
        egressReviewedAt: "2026-01-01T00:00:00Z",
        purposes: {
          pack_draft: {
            enabled: true,
            providerKey: "missing",
            modelId: "gpt-4o-mini",
          },
        },
      },
    });
    expect(result.ok).toBe(false);
  });

  it("requires an email provider before magic links are enabled", () => {
    const result = validateInstallationConfig({
      ...base,
      authentication: { ...base.authentication, magicLink: { enabled: true } },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a default locale that is not supported", () => {
    const result = validateInstallationConfig({
      ...base,
      organization: { ...base.organization, defaultLocale: "de-DE" },
    });
    expect(result.ok).toBe(false);
  });
});

describe("brand theme", () => {
  it("emits CSS custom properties for every token", () => {
    const css = themeToCssVariables(DEFAULT_BRAND_THEME);
    expect(css).toContain("--cs-color-primary:");
    expect(css).toContain("--cs-font-body:");
    expect(css).toContain("--cs-radius:");
  });

  it("uses the author's stack when no font file is uploaded", () => {
    const css = themeToCssVariables(DEFAULT_BRAND_THEME);
    expect(css).toContain("--cs-font-body: system-ui, sans-serif;");
    expect(
      themeFontFaceCss(DEFAULT_BRAND_THEME, (slot) => `/assets/${slot}`),
    ).toBe("");
  });

  it("prepends an uploaded face while keeping the fallbacks", () => {
    const theme = {
      ...DEFAULT_BRAND_THEME,
      assets: {
        ...DEFAULT_BRAND_THEME.assets,
        bodyFontFile: "branding/org/body.woff2",
      },
    };
    const css = themeToCssVariables(theme);
    expect(css).toContain(
      `--cs-font-body: "${CUSTOM_FONT_FAMILIES.body}", system-ui, sans-serif;`,
    );

    const faces = themeFontFaceCss(theme, (slot) => `/assets/${slot}`);
    expect(faces).toContain(`font-family:"${CUSTOM_FONT_FAMILIES.body}"`);
    expect(faces).toContain(`url("/assets/bodyFontFile") format("woff2")`);
    expect(faces).toContain("font-display:swap");
    // Only the uploaded slot produces a face.
    expect(faces).not.toContain(CUSTOM_FONT_FAMILIES.heading);
  });

  it("rejects a font stack that could break out of the CSS declaration", () => {
    const result = validateInstallationConfig({
      ...base,
      branding: {
        ...DEFAULT_BRAND_THEME,
        typography: {
          ...DEFAULT_BRAND_THEME.typography,
          bodyFont: "x; } body { display:none",
        },
      },
    });
    expect(result.ok).toBe(false);
  });

  it("computes the expected contrast for black on white", () => {
    expect(Math.round(contrastRatio("#000000", "#ffffff"))).toBe(21);
  });

  it("flags a theme that fails the minimum contrast ratio", () => {
    const findings = checkThemeContrast({
      ...DEFAULT_BRAND_THEME,
      colors: {
        ...DEFAULT_BRAND_THEME.colors,
        foreground: "#cccccc",
        background: "#ffffff",
      },
    });
    expect(
      findings.some((finding) => finding.pair === "foreground/background"),
    ).toBe(true);
  });

  it("passes the shipped default theme", () => {
    expect(checkThemeContrast(DEFAULT_BRAND_THEME)).toEqual([]);
  });
});
