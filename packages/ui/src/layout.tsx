import type { ReactNode } from "react";

export interface PageHeaderProps {
  readonly eyebrow?: string;
  readonly title: string;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly meta?: ReactNode;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
}: PageHeaderProps) {
  return (
    <header className="relative mb-8 overflow-hidden pb-6">
      <div
        aria-hidden="true"
        className="cs-texture pointer-events-none absolute -right-8 -top-10 h-40 w-2/3"
      />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          {eyebrow ? (
            <p className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              <span aria-hidden="true" className="h-px w-6 bg-brand" />
              {eyebrow}
            </p>
          ) : null}
          <h1 className="font-heading text-display font-semibold tracking-tight">
            {title}
          </h1>
          {description ? (
            <p className="mt-2.5 text-[0.95rem] leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
          {meta ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
        ) : null}
      </div>
      <hr className="cs-rule-brand absolute inset-x-0 bottom-0" />
    </header>
  );
}

export interface CardProps {
  readonly title?: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly footer?: ReactNode;
  readonly children?: ReactNode;
  readonly headingLevel?: 2 | 3 | 4;
  /** Removes inner padding, for cards whose body is a full-bleed table. */
  readonly flush?: boolean;
}

export function Card({
  title,
  description,
  actions,
  footer,
  children,
  headingLevel = 2,
  flush = false,
}: CardProps) {
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";
  const hasHead = Boolean(title || actions);

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-background shadow-sm">
      {hasHead ? (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-hairline bg-surface-sunken px-5 py-4">
          <div>
            {title ? (
              <Heading className="font-heading text-title font-semibold tracking-tight">
                {title}
              </Heading>
            ) : null}
            {description ? (
              <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 gap-2">{actions}</div>
          ) : null}
        </div>
      ) : null}
      <div className={flush ? "" : "px-5 py-4"}>{children}</div>
      {footer ? (
        <div className="border-t border-hairline bg-surface-sunken px-5 py-3 text-sm text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </section>
  );
}

export interface StatProps {
  readonly label: string;
  readonly value: ReactNode;
  readonly hint?: string;
}

/** Headline numbers. Easier to scan than the same values inside a table. */
export function Stat({ label, value, hint }: StatProps) {
  return (
    <div className="cs-lift relative overflow-hidden rounded-lg border border-border bg-background px-4 pb-3.5 pt-4 shadow-sm">
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[3px] bg-brand"
      />
      <dt className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1.5 font-heading text-display font-semibold tabular-nums leading-none tracking-tight">
        {value}
      </dd>
      {hint ? (
        <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</dl>
  );
}

export interface AlertProps {
  readonly tone: "info" | "success" | "warning" | "error";
  readonly title: string;
  readonly children?: ReactNode;
}

const ALERT_TONE: Record<AlertProps["tone"], string> = {
  info: "border-l-accent",
  success: "border-l-success",
  warning: "border-l-warning",
  error: "border-l-destructive",
};

/** Errors and warnings are assertive so they interrupt a screen reader. */
export function Alert({ tone, title, children }: AlertProps) {
  return (
    <div
      role={tone === "error" || tone === "warning" ? "alert" : "status"}
      className={`rounded-lg border border-border border-l-4 bg-surface-sunken px-4 py-3 shadow-sm ${ALERT_TONE[tone]}`}
    >
      <p className="font-medium leading-snug">{title}</p>
      {children ? (
        <div className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export interface EmptyStateProps {
  readonly title: string;
  readonly children?: ReactNode;
  readonly action?: ReactNode;
}

export function EmptyState({ title, children, action }: EmptyStateProps) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface-sunken px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children ? (
        <div className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
          {children}
        </div>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/**
 * Tone is derived from the state name, but the state is always spelled out, so
 * a badge still reads correctly in greyscale.
 */
const BADGE_TONE: Record<string, string> = {
  active: "border-success text-success",
  enrolled: "border-success text-success",
  published: "border-success text-success",
  completed: "border-success text-success",
  enabled: "border-success text-success",
  ready: "border-success text-success",
  ok: "border-success text-success",
  sent: "border-success text-success",
  enrolling: "border-accent text-accent",
  locked: "border-accent text-accent",
  preview: "border-accent text-accent",
  queued: "border-accent text-accent",
  running: "border-accent text-accent",
  reveal_pending: "border-warning text-warning",
  degraded: "border-warning text-warning",
  withdrawn: "border-warning text-warning",
  draft: "border-warning text-warning",
  blocked: "border-destructive text-destructive",
  breached: "border-destructive text-destructive",
  cancelled: "border-destructive text-destructive",
  failed: "border-destructive text-destructive",
  retired: "border-destructive text-destructive",
};

export interface StatusBadgeProps {
  readonly state: string;
  readonly label?: string;
}

export function StatusBadge({ state, label }: StatusBadgeProps) {
  const tone = BADGE_TONE[state] ?? "border-border text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${tone}`}
    >
      {label ?? state.replace(/_/g, " ")}
    </span>
  );
}

export interface DescriptionListProps {
  readonly items: ReadonlyArray<{ term: string; detail: ReactNode }>;
  readonly columns?: 2 | 3;
}

export function DescriptionList({ items, columns = 2 }: DescriptionListProps) {
  return (
    <dl
      className={`grid gap-x-6 gap-y-4 ${columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}
    >
      {items.map((item) => (
        <div key={item.term}>
          <dt className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
            {item.term}
          </dt>
          <dd className="mt-1 text-sm leading-relaxed">{item.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface DataTableProps<T> {
  readonly caption: string;
  readonly columns: ReadonlyArray<{
    key: string;
    header: string;
    render: (row: T) => ReactNode;
  }>;
  readonly rows: readonly T[];
  readonly rowKey: (row: T) => string;
}

export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
}: DataTableProps<T>) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border bg-surface-sunken">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className="whitespace-nowrap px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground"
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className="border-b border-hairline transition-colors last:border-0 hover:bg-surface-hover"
            >
              {columns.map((column) => (
                <td key={column.key} className="px-5 py-3.5 align-top">
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
