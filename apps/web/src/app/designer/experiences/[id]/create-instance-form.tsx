"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, SelectField, TextField } from "@culture-shock/ui";
import {
  apiMutate,
  describeProblem,
  newIdempotencyKey,
} from "@/lib/api-client";

const PARTICIPATION_MODES = [
  { value: "optional", label: "Optional — people choose whether to join" },
  { value: "invite_only", label: "Invite only — you pick who takes part" },
  { value: "mandatory", label: "Required — needs HR and legal sign-off first" },
];

/** Converts a datetime-local value in a named zone into a UTC instant. */
function toUtcInstant(local: string, timeZone: string): string | null {
  if (!local) return null;
  const naive = new Date(`${local}:00Z`);
  if (Number.isNaN(naive.getTime())) return null;

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
  const parts = formatter.formatToParts(naive);
  const lookup = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    lookup("year"),
    lookup("month") - 1,
    lookup("day"),
    lookup("hour") % 24,
    lookup("minute"),
    lookup("second"),
  );
  const offset = asUtc - naive.getTime();
  return new Date(naive.getTime() - offset).toISOString();
}

export function CreateInstanceForm({
  experienceId,
  defaultTimeZone,
}: {
  experienceId: string;
  defaultTimeZone: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [timeZone, setTimeZone] = useState(defaultTimeZone);
  const [enrollmentClosesAt, setEnrollmentClosesAt] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [participationMode, setParticipationMode] = useState("optional");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const starts = toUtcInstant(startsAt, timeZone);
    const ends = toUtcInstant(endsAt, timeZone);
    const closes = toUtcInstant(enrollmentClosesAt, timeZone);
    if (!starts || !ends || !closes) {
      setError("Enter a valid time zone and all three dates.");
      return;
    }

    setBusy(true);
    const result = await apiMutate<{ id: string }>(
      `/experiences/${experienceId}/instances`,
      {
        method: "POST",
        idempotencyKey: newIdempotencyKey(),
        body: {
          name,
          timeZone,
          startsAt: starts,
          endsAt: ends,
          enrollmentClosesAt: closes,
          participationMode,
        },
      },
    );
    setBusy(false);

    if (!result.ok) {
      setError(describeProblem(result.error));
      return;
    }
    router.push(`/designer/instances/${result.data.id}`);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error ? (
        <Alert tone="error" title="Could not schedule">
          {error}
        </Alert>
      ) : null}

      <TextField
        id="instance-name"
        label="Run name"
        required
        maxLength={120}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />

      <TextField
        id="instance-timezone"
        label="Time zone"
        required
        value={timeZone}
        onChange={(event) => setTimeZone(event.target.value)}
        hint="Something like America/Toronto or Europe/London. Everyone still sees their own local times."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          id="instance-enrollment"
          label="Enrollment closes"
          type="datetime-local"
          required
          value={enrollmentClosesAt}
          onChange={(event) => setEnrollmentClosesAt(event.target.value)}
        />
        <TextField
          id="instance-start"
          label="Starts"
          type="datetime-local"
          required
          value={startsAt}
          onChange={(event) => setStartsAt(event.target.value)}
        />
        <TextField
          id="instance-end"
          label="Ends"
          type="datetime-local"
          required
          value={endsAt}
          onChange={(event) => setEndsAt(event.target.value)}
        />
      </div>

      <SelectField
        id="instance-mode"
        label="Participation mode"
        value={participationMode}
        onChange={(event) => setParticipationMode(event.target.value)}
        options={PARTICIPATION_MODES}
        hint="Making something required is an employment decision for HR, not a setting to flip lightly."
      />

      <Button type="submit" variant="primary" busy={busy} disabled={!name}>
        Schedule run
      </Button>
    </form>
  );
}
