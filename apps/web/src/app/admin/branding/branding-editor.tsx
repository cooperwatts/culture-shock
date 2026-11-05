"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, StatusBadge, TextField } from "@culture-shock/ui";
import {
  contrastRatio,
  themeToCssVariables,
  type BrandTheme,
} from "@culture-shock/config";
import { apiMutate, describeProblem } from "@/lib/api-client";

type ColorKey = keyof BrandTheme["colors"];
type AssetKey = keyof BrandTheme["assets"];

const COLOR_FIELDS: ReadonlyArray<{
  key: ColorKey;
  label: string;
  hint?: string;
}> = [
  { key: "primary", label: "Primary", hint: "Buttons and the logo mark" },
  { key: "primaryForeground", label: "Primary text", hint: "Text on primary" },
  { key: "accent", label: "Accent", hint: "Links and focus rings" },
  { key: "accentForeground", label: "Accent text" },
  { key: "background", label: "Background" },
  { key: "foreground", label: "Body text" },
  { key: "muted", label: "Muted surface" },
  { key: "mutedForeground", label: "Muted text" },
  { key: "border", label: "Borders" },
  { key: "destructive", label: "Destructive" },
  { key: "success", label: "Success" },
  { key: "warning", label: "Warning" },
];

const CONTRAST_PAIRS: ReadonlyArray<{
  label: string;
  fg: ColorKey;
  bg: ColorKey;
}> = [
  { label: "Body text on background", fg: "foreground", bg: "background" },
  { label: "Text on primary", fg: "primaryForeground", bg: "primary" },
  { label: "Text on accent", fg: "accentForeground", bg: "accent" },
  { label: "Muted text on muted", fg: "mutedForeground", bg: "muted" },
];

const ASSET_SLOTS: ReadonlyArray<{
  slot: AssetKey;
  label: string;
  hint: string;
  accept: string;
}> = [
  {
    slot: "logoLight",
    label: "Logo",
    hint: "Shown in the header. SVG or PNG, up to 512 KB.",
    accept: "image/png,image/jpeg,image/webp,image/svg+xml",
  },
  {
    slot: "logoDark",
    label: "Logo for dark surfaces",
    hint: "Optional.",
    accept: "image/png,image/jpeg,image/webp,image/svg+xml",
  },
  {
    slot: "favicon",
    label: "Favicon",
    hint: "ICO, PNG or SVG.",
    accept: "image/x-icon,image/png,image/svg+xml",
  },
  {
    slot: "emailHeader",
    label: "Email header",
    hint: "Optional, used at the top of messages.",
    accept: "image/png,image/jpeg,image/webp",
  },
  {
    slot: "bodyFontFile",
    label: "Body font",
    hint: "WOFF2 only, up to 1 MB. Falls back to the stack below if it fails to load.",
    accept: "font/woff2,.woff2",
  },
  {
    slot: "headingFontFile",
    label: "Heading font",
    hint: "WOFF2 only. Leave empty to use the body font for headings too.",
    accept: "font/woff2,.woff2",
  },
];

export function BrandingEditor({
  revision,
  initial,
  terminology,
}: {
  revision: number;
  initial: BrandTheme;
  terminology: Record<string, string>;
}) {
  const router = useRouter();
  const [theme, setTheme] = useState<BrandTheme>(initial);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const previewCss = useMemo(() => themeToCssVariables(theme), [theme]);

  const contrast = CONTRAST_PAIRS.map((pair) => ({
    ...pair,
    ratio: Number(
      contrastRatio(theme.colors[pair.fg], theme.colors[pair.bg]).toFixed(2),
    ),
  }));
  const failing = contrast.filter((pair) => pair.ratio < 4.5);

  function setColor(key: ColorKey, value: string) {
    setTheme((current) => ({
      ...current,
      colors: { ...current.colors, [key]: value },
    }));
    setNotice(null);
  }

  async function upload(slot: AssetKey, file: File) {
    setError(null);
    setNotice(null);
    setBusy(slot);

    const csrf = document.cookie
      .split(";")
      .map((part) => part.trim().split("="))
      .find(([key]) => key === "cs_csrf" || key === "__Host-cs_csrf")?.[1];

    const response = await fetch(`/api/v1/admin/branding/assets/${slot}`, {
      method: "POST",
      // Browsers do not always set a type for .woff2, so it is sent explicitly.
      headers: {
        "content-type":
          file.type || (file.name.endsWith(".woff2") ? "font/woff2" : ""),
        "x-cs-csrf": csrf ?? "",
      },
      body: file,
      credentials: "same-origin",
    });
    setBusy(null);

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setError(payload?.error?.message ?? "Upload failed");
      return;
    }

    setTheme((current) => ({
      ...current,
      assets: { ...current.assets, [slot]: payload.data.objectKey },
    }));
    setNotice(`${slot} uploaded. Publish to make it live.`);
  }

  async function publish() {
    setError(null);
    setNotice(null);
    setBusy("publish");

    const result = await apiMutate("/admin/branding", {
      method: "PUT",
      ifMatch: revision,
      body: { ...theme, revision: theme.revision + 1 },
    });
    setBusy(null);

    if (!result.ok) {
      setError(describeProblem(result.error));
      return;
    }
    setNotice("Published. The new theme is live.");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {error ? (
        <Alert tone="error" title="Could not save">
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert tone="success" title="Done">
          {notice}
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <fieldset>
            <legend className="mb-3 text-sm font-semibold">Colours</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {COLOR_FIELDS.map((field) => (
                <div
                  key={field.key}
                  className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
                >
                  <input
                    type="color"
                    id={`color-${field.key}`}
                    value={theme.colors[field.key]}
                    onChange={(event) =>
                      setColor(field.key, event.target.value)
                    }
                    className="h-9 w-9 shrink-0 cursor-pointer rounded border border-border bg-transparent"
                  />
                  <div className="min-w-0 flex-1">
                    <label
                      htmlFor={`color-${field.key}`}
                      className="block text-sm font-medium"
                    >
                      {field.label}
                    </label>
                    {field.hint ? (
                      <p className="truncate text-xs text-muted-foreground">
                        {field.hint}
                      </p>
                    ) : null}
                  </div>
                  <code className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {theme.colors[field.key]}
                  </code>
                </div>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-3 text-sm font-semibold">
              Typography and shape
            </legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                id="body-font"
                label="Body font stack"
                value={theme.typography.bodyFont}
                onChange={(event) =>
                  setTheme((c) => ({
                    ...c,
                    typography: {
                      ...c.typography,
                      bodyFont: event.target.value,
                    },
                  }))
                }
                hint="Only letters, numbers, spaces, commas and quotes."
              />
              <TextField
                id="heading-font"
                label="Heading font stack"
                value={theme.typography.headingFont}
                onChange={(event) =>
                  setTheme((c) => ({
                    ...c,
                    typography: {
                      ...c.typography,
                      headingFont: event.target.value,
                    },
                  }))
                }
                hint="Used for headings and headline numbers."
              />
              <TextField
                id="base-size"
                label="Base text size"
                type="number"
                min={12}
                max={20}
                value={String(theme.typography.baseSizePx)}
                onChange={(event) =>
                  setTheme((c) => ({
                    ...c,
                    typography: {
                      ...c.typography,
                      baseSizePx: Number(event.target.value),
                    },
                  }))
                }
                hint="Pixels. Everything else scales from this."
              />
              <TextField
                id="radius"
                label="Corner radius"
                type="number"
                min={0}
                max={32}
                value={String(theme.radiusPx)}
                onChange={(event) =>
                  setTheme((c) => ({
                    ...c,
                    radiusPx: Number(event.target.value),
                  }))
                }
                hint="Pixels. Zero gives square corners."
              />
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-3 text-sm font-semibold">Assets</legend>
            <ul className="space-y-2">
              {ASSET_SLOTS.map((asset) => (
                <li
                  key={asset.slot}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{asset.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {theme.assets[asset.slot] ? "Uploaded" : asset.hint}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {theme.assets[asset.slot] ? (
                      <StatusBadge state="ready" label="set" />
                    ) : null}
                    <input
                      ref={(element) => {
                        fileInputs.current[asset.slot] = element;
                      }}
                      type="file"
                      accept={asset.accept}
                      className="sr-only"
                      id={`file-${asset.slot}`}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void upload(asset.slot, file);
                      }}
                    />
                    <Button
                      size="sm"
                      busy={busy === asset.slot}
                      onClick={() => fileInputs.current[asset.slot]?.click()}
                    >
                      {theme.assets[asset.slot] ? "Replace" : "Choose file"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </fieldset>
        </div>

        <aside className="space-y-4">
          <div>
            <h3 className="mb-2 text-sm font-semibold">Preview</h3>
            <div
              style={{ ...(parseCss(previewCss) as React.CSSProperties) }}
              className="overflow-hidden rounded-lg border"
            >
              <div
                className="border-b p-3"
                style={{
                  borderColor: theme.colors.border,
                  background: theme.colors.background,
                }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="flex h-7 w-7 items-center justify-center rounded-md text-xs font-semibold"
                    style={{
                      background: theme.colors.primary,
                      color: theme.colors.primaryForeground,
                    }}
                  >
                    {(terminology.platformName ?? "C").charAt(0)}
                  </span>
                  <span
                    className="text-sm font-semibold"
                    style={{ color: theme.colors.foreground }}
                  >
                    {terminology.platformName ?? "Culture Shock"}
                  </span>
                </div>
              </div>
              <div
                className="space-y-3 p-4"
                style={{ background: theme.colors.background }}
              >
                <p
                  className="text-sm font-semibold"
                  style={{ color: theme.colors.foreground }}
                >
                  Your connection is ready
                </p>
                <p
                  className="text-xs"
                  style={{ color: theme.colors.mutedForeground }}
                >
                  You have been matched for this round. Times show in your own
                  time zone.
                </p>
                <div className="flex gap-2">
                  <span
                    className="rounded-md px-3 py-1.5 text-xs font-medium"
                    style={{
                      background: theme.colors.primary,
                      color: theme.colors.primaryForeground,
                    }}
                  >
                    View match
                  </span>
                  <span
                    className="rounded-md border px-3 py-1.5 text-xs font-medium"
                    style={{
                      borderColor: theme.colors.border,
                      color: theme.colors.foreground,
                    }}
                  >
                    Not now
                  </span>
                </div>
                <a
                  className="block text-xs underline"
                  style={{ color: theme.colors.accent }}
                  href="#preview"
                >
                  Manage your preferences
                </a>
              </div>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">Contrast</h3>
            <ul className="space-y-1.5">
              {contrast.map((pair) => (
                <li
                  key={pair.label}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span className="text-muted-foreground">{pair.label}</span>
                  <StatusBadge
                    state={pair.ratio >= 4.5 ? "ok" : "failed"}
                    label={`${pair.ratio.toFixed(2)}:1`}
                  />
                </li>
              ))}
            </ul>
            {failing.length > 0 ? (
              <p className="mt-2 text-xs text-destructive">
                Publishing is blocked until every pair reaches 4.5:1.
              </p>
            ) : null}
          </div>
        </aside>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button
          variant="primary"
          busy={busy === "publish"}
          disabled={failing.length > 0}
          onClick={publish}
        >
          Publish theme
        </Button>
        <Button variant="ghost" onClick={() => setTheme(initial)}>
          Reset
        </Button>
        <span className="text-xs text-muted-foreground">
          Current revision {revision}
        </span>
      </div>
    </div>
  );
}

/** Turns the generated custom-property block into a style object for the preview. */
function parseCss(css: string): Record<string, string> {
  const style: Record<string, string> = {};
  for (const line of css.split("\n")) {
    const [name, ...rest] = line.split(":");
    if (!name || rest.length === 0) continue;
    style[name.trim()] = rest.join(":").replace(/;$/, "").trim();
  }
  return style;
}
