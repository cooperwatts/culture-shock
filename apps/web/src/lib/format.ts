/**
 * All instants are stored in UTC. Rendering always names the zone so a
 * participant in another region is never shown an ambiguous local time.
 */
export function formatInstant(
  value: string | null,
  timeZone: string,
  locale = "en-CA",
): string {
  if (!value) return "Not set";
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

export function formatDate(value: string | null, timeZone: string, locale = "en-CA"): string {
  if (!value) return "Not set";
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone }).format(new Date(value));
  } catch {
    return new Date(value).toISOString().slice(0, 10);
  }
}

export function formatPercent(value: number | null): string {
  if (value === null) return "Suppressed";
  return `${Math.round(value * 100)}%`;
}

export function localized(text: Record<string, string> | undefined, locale: string): string {
  if (!text) return "";
  return text[locale] ?? text["en-CA"] ?? Object.values(text)[0] ?? "";
}

const METRIC_LABELS: Record<string, string> = {
  participation_rate: "Participation rate",
  engagement_rate: "Engagement rate",
  connection_score: "Connection score",
  department_bridge_score: "Department bridge score",
  organizational_reach: "Organizational reach",
  remote_inclusion_score: "Remote inclusion score",
  experience_completion_rate: "Completion rate",
};

export function metricLabel(key: string): string {
  return METRIC_LABELS[key] ?? key.replace(/_/g, " ");
}

const ACTIVITY_LABELS: Record<string, string> = {
  gift_exchange: "Gift exchange",
  recognition: "Recognition",
  conversation: "Conversation",
  check_in: "Check-in",
  milestone: "Milestone",
  survey: "Survey",
  clue: "Clue",
};

export function activityLabel(type: string): string {
  return ACTIVITY_LABELS[type] ?? type.replace(/_/g, " ");
}
