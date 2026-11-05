/**
 * All scheduling is stored as UTC instants; authoring and overlap use IANA zone
 * identifiers so DST is handled by the runtime rather than fixed offsets.
 */

export interface WorkingWindow {
  /** Local hour the working window opens, 0-23. */
  readonly startHour: number;
  /** Local hour the working window closes, 1-24. */
  readonly endHour: number;
}

export const DEFAULT_WORKING_WINDOW: WorkingWindow = { startHour: 9, endHour: 17 };

// Constructing an Intl formatter is expensive and matching evaluates tens of
// thousands of candidate pairs, so formatters and offsets are memoized. Offsets
// are keyed per hour, which is fine because DST shifts land on hour boundaries.
const formatterCache = new Map<string, Intl.DateTimeFormat>();
const offsetCache = new Map<string, number>();
const validZoneCache = new Map<string, boolean>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

export function isValidTimeZone(timeZone: string): boolean {
  const cached = validZoneCache.get(timeZone);
  if (cached !== undefined) return cached;
  let valid: boolean;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    valid = true;
  } catch {
    valid = false;
  }
  validZoneCache.set(timeZone, valid);
  return valid;
}

/** Offset in minutes to add to UTC to get local time in `timeZone` at `instant`. */
export function zoneOffsetMinutes(timeZone: string, instant: Date): number {
  const bucket = Math.floor(instant.getTime() / 3_600_000);
  const cacheKey = `${timeZone}|${bucket}`;
  const cached = offsetCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const parts = formatterFor(timeZone).formatToParts(instant);
  const lookup = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part ? Number(part.value) : 0;
  };
  const asUtc = Date.UTC(
    lookup("year"),
    lookup("month") - 1,
    lookup("day"),
    lookup("hour") % 24,
    lookup("minute"),
    lookup("second"),
  );
  const offset = Math.round((asUtc - instant.getTime()) / 60000);
  offsetCache.set(cacheKey, offset);
  return offset;
}

interface Interval {
  readonly startMs: number;
  readonly endMs: number;
}

/** The UTC interval covering a zone's working window on the UTC day of `reference`. */
export function workingWindowUtc(
  timeZone: string,
  reference: Date,
  window: WorkingWindow = DEFAULT_WORKING_WINDOW,
): Interval {
  const offset = zoneOffsetMinutes(timeZone, reference);
  const dayStartUtc = Date.UTC(
    reference.getUTCFullYear(),
    reference.getUTCMonth(),
    reference.getUTCDate(),
  );
  const startMs = dayStartUtc + (window.startHour * 60 - offset) * 60000;
  const endMs = dayStartUtc + (window.endHour * 60 - offset) * 60000;
  return { startMs, endMs };
}

/**
 * Minutes of overlapping working hours between two zones. Returns 0 rather than
 * excluding a participant, so missing overlap becomes a scoring penalty and the
 * pack's asynchronous alternative can still apply.
 */
export function overlapMinutes(
  timeZoneA: string,
  timeZoneB: string,
  reference: Date = new Date(),
  window: WorkingWindow = DEFAULT_WORKING_WINDOW,
): number {
  if (!isValidTimeZone(timeZoneA) || !isValidTimeZone(timeZoneB)) return 0;
  const a = workingWindowUtc(timeZoneA, reference, window);
  const b = workingWindowUtc(timeZoneB, reference, window);
  const start = Math.max(a.startMs, b.startMs);
  const end = Math.min(a.endMs, b.endMs);
  return end <= start ? 0 : Math.round((end - start) / 60000);
}

export function toIsoUtc(value: Date | number | string): string {
  return new Date(value).toISOString();
}

export function addSeconds(instant: Date, seconds: number): Date {
  return new Date(instant.getTime() + seconds * 1000);
}
