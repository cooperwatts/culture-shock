import type { Config } from "tailwindcss";

/**
 * Every colour and font resolves to a CSS custom property published from the
 * installation's brand theme, so no organization branding is compiled in.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "var(--cs-color-primary)",
        "primary-foreground": "var(--cs-color-primary-foreground)",
        accent: "var(--cs-color-accent)",
        "accent-foreground": "var(--cs-color-accent-foreground)",
        background: "var(--cs-color-background)",
        foreground: "var(--cs-color-foreground)",
        muted: "var(--cs-color-muted)",
        "muted-foreground": "var(--cs-color-muted-foreground)",
        border: "var(--cs-color-border)",
        destructive: "var(--cs-color-destructive)",
        success: "var(--cs-color-success)",
        warning: "var(--cs-color-warning)",
        "surface-sunken": "var(--cs-surface-sunken)",
        "surface-hover": "var(--cs-surface-hover)",
        hairline: "var(--cs-hairline)",
        "wash-accent": "var(--cs-wash-accent)",
      },
      fontFamily: {
        sans: ["var(--cs-font-body)"],
        heading: ["var(--cs-font-heading)"],
      },
      fontSize: {
        title: ["var(--cs-text-title)", { lineHeight: "1.2" }],
        display: ["var(--cs-text-display)", { lineHeight: "1.1" }],
      },
      // Mapped off the single brand radius so `rounded-lg` follows the theme
      // instead of Tailwind's fixed scale. A brand that picks 0 stays square.
      borderRadius: {
        DEFAULT: "var(--cs-radius)",
        sm: "var(--cs-radius-sm)",
        md: "var(--cs-radius)",
        lg: "var(--cs-radius-lg)",
        xl: "var(--cs-radius-xl)",
      },
      backgroundImage: {
        brand: "var(--cs-gradient-brand)",
      },
      boxShadow: {
        sm: "var(--cs-shadow-sm)",
        DEFAULT: "var(--cs-shadow-sm)",
        md: "var(--cs-shadow-md)",
      },
    },
  },
  plugins: [],
};

export default config;
