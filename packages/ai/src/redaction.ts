/**
 * Minimization and redaction applied before any text leaves the installation.
 * This is defence in depth: callers are already required to pass aggregates,
 * but a mistake upstream must not become a privacy incident.
 */

export const REDACTION_LEVELS = ["none", "identifiers_removed", "aggregate_only"] as const;
export type RedactionLevel = (typeof REDACTION_LEVELS)[number];

const PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "[email]"],
  [/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, "[phone]"],
  [/\b(?:usr|par|ses|ins|exp|mat|mrn)_[0-9a-f]{32}\b/g, "[id]"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[uuid]"],
  [/\bhttps?:\/\/\S+/g, "[url]"],
  [/\b\d{1,5}\s+[A-Z][a-z]+\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd)\b/g, "[address]"],
];

export interface RedactionOutcome {
  readonly text: string;
  readonly level: RedactionLevel;
  readonly removedKinds: readonly string[];
}

export function redact(input: string, level: RedactionLevel = "identifiers_removed"): RedactionOutcome {
  if (level === "none") return { text: input, level, removedKinds: [] };

  const removed = new Set<string>();
  let text = input;
  for (const [pattern, replacement] of PATTERNS) {
    if (pattern.test(text)) {
      removed.add(replacement.slice(1, -1));
      text = text.replace(pattern, replacement);
    }
    pattern.lastIndex = 0;
  }
  return { text, level, removedKinds: [...removed].sort() };
}

/** Coarse size bands so an exact headcount never identifies a small team. */
export function sizeBand(count: number): string {
  if (count < 10) return "under_10";
  if (count < 50) return "10_to_49";
  if (count < 200) return "50_to_199";
  if (count < 1000) return "200_to_999";
  if (count < 5000) return "1000_to_4999";
  return "5000_plus";
}

/** Percentage rounded to the nearest 5 to avoid reconstructing small cells. */
export function coarsePercentage(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round(((numerator / denominator) * 100) / 5) * 5;
}

export interface AggregateCohort {
  readonly label: string;
  readonly count: number;
}

/**
 * Converts raw cohort counts into bands, dropping any cohort below the
 * installation's minimum so the AI never receives a reconstructable cell.
 */
export function toAggregateBands(
  cohorts: readonly AggregateCohort[],
  minimumCohortSize: number,
): Array<{ label: string; band: string }> {
  return cohorts
    .filter((cohort) => cohort.count >= minimumCohortSize)
    .map((cohort) => ({ label: cohort.label, band: sizeBand(cohort.count) }))
    .sort((a, b) => (a.label < b.label ? -1 : 1));
}
