"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Alert,
  Button,
  CheckboxField,
  SelectField,
  TextField,
} from "@culture-shock/ui";
import { apiMutate, describeProblem } from "@/lib/api-client";

const REMOTE_OPTIONS = [
  { value: "unspecified", label: "Prefer not to say" },
  { value: "remote", label: "Remote" },
  { value: "hybrid", label: "Hybrid" },
  { value: "onsite", label: "Onsite" },
];

const TENURE_OPTIONS = [
  { value: "unspecified", label: "Prefer not to say" },
  { value: "lt_3_months", label: "Less than 3 months" },
  { value: "lt_1_year", label: "Less than a year" },
  { value: "lt_3_years", label: "1 to 3 years" },
  { value: "gte_3_years", label: "More than 3 years" },
];

interface ConsentState {
  profile_derivation: boolean;
  ai_processing: boolean;
  messaging: boolean;
  insights_survey: boolean;
}

function readString(
  source: Record<string, unknown> | null,
  key: string,
  fallback = "",
): string {
  const value = source?.[key];
  return typeof value === "string" ? value : fallback;
}

export function PreferencesForm({
  instanceId,
  defaultTimeZone,
  existing,
}: {
  instanceId: string;
  defaultTimeZone: string;
  existing: Record<string, unknown> | null;
}) {
  const router = useRouter();
  const [timeZone, setTimeZone] = useState(
    readString(existing, "timeZone", defaultTimeZone),
  );
  const [remotePreference, setRemotePreference] = useState(
    readString(existing, "remotePreference", "unspecified"),
  );
  const [department, setDepartment] = useState(
    readString(existing, "department"),
  );
  const [team, setTeam] = useState(readString(existing, "team"));
  const [geography, setGeography] = useState(readString(existing, "geography"));
  const [tenureBand, setTenureBand] = useState(
    readString(existing, "tenureBand", "unspecified"),
  );
  const [interests, setInterests] = useState(
    Array.isArray(existing?.interests)
      ? (existing.interests as string[]).join(", ")
      : "",
  );
  const [consent, setConsent] = useState<ConsentState>({
    profile_derivation: false,
    ai_processing: false,
    messaging: false,
    insights_survey: false,
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setBusy(true);

    const result = await apiMutate(
      `/instances/${instanceId}/participants/me/preferences`,
      {
        method: "PUT",
        body: {
          timeZone,
          remotePreference,
          department: department || null,
          team: team || null,
          geography: geography || null,
          tenureBand,
          interests: interests
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean)
            .slice(0, 20),
          languages: [],
          schedulingConstraints: [],
          consent,
        },
      },
    );
    setBusy(false);

    if (!result.ok) {
      setError(describeProblem(result.error));
      return;
    }
    setSaved(true);
    router.refresh();
  }

  async function revoke() {
    if (!window.confirm("Delete the details you shared for this experience?"))
      return;
    setError(null);
    setBusy(true);
    const result = await apiMutate(
      `/instances/${instanceId}/participants/me/profile`,
      {
        method: "DELETE",
      },
    );
    setBusy(false);

    if (!result.ok) {
      setError(describeProblem(result.error));
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {error ? (
        <Alert tone="error" title="Could not save">
          {error}
        </Alert>
      ) : null}
      {saved ? (
        <Alert tone="success" title="Saved">
          Your preferences were updated.
        </Alert>
      ) : null}

      <TextField
        id="pref-timezone"
        label="Time zone"
        required
        value={timeZone}
        onChange={(event) => setTimeZone(event.target.value)}
        hint="Used to find working hours you genuinely share with other people."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          id="pref-remote"
          label="Where you usually work"
          value={remotePreference}
          onChange={(event) => setRemotePreference(event.target.value)}
          options={REMOTE_OPTIONS}
        />
        <SelectField
          id="pref-tenure"
          label="How long you have been here"
          value={tenureBand}
          onChange={(event) => setTenureBand(event.target.value)}
          options={TENURE_OPTIONS}
        />
        <TextField
          id="pref-department"
          label="Department"
          maxLength={80}
          value={department}
          onChange={(event) => setDepartment(event.target.value)}
        />
        <TextField
          id="pref-team"
          label="Team"
          maxLength={80}
          value={team}
          onChange={(event) => setTeam(event.target.value)}
        />
        <TextField
          id="pref-geography"
          label="Region"
          maxLength={80}
          value={geography}
          onChange={(event) => setGeography(event.target.value)}
          hint="A broad region only. Never an address."
        />
        <TextField
          id="pref-interests"
          label="Interests"
          value={interests}
          onChange={(event) => setInterests(event.target.value)}
          hint="Comma separated, used to suggest conversation starters."
        />
      </div>

      <fieldset className="space-y-3 rounded border border-border p-4">
        <legend className="px-1 text-sm font-medium">What you allow</legend>
        <p className="text-xs text-muted-foreground">
          Each permission is separate and off unless you turn it on. You can
          change them at any time.
        </p>
        <CheckboxField
          id="consent-profile"
          label="Use these details to improve my matches"
          hint="Turn this off and we keep what you entered but will not use it to match you."
          checked={consent.profile_derivation}
          onChange={(event) =>
            setConsent({ ...consent, profile_derivation: event.target.checked })
          }
        />
        <CheckboxField
          id="consent-ai"
          label="Allow AI assistance on content related to me"
          hint="Only does anything if your administrator has turned on AI."
          checked={consent.ai_processing}
          onChange={(event) =>
            setConsent({ ...consent, ai_processing: event.target.checked })
          }
        />
        <CheckboxField
          id="consent-messaging"
          label="Send me messages about this experience"
          checked={consent.messaging}
          onChange={(event) =>
            setConsent({ ...consent, messaging: event.target.checked })
          }
        />
        <CheckboxField
          id="consent-survey"
          label="Invite me to the optional closing survey"
          checked={consent.insights_survey}
          onChange={(event) =>
            setConsent({ ...consent, insights_survey: event.target.checked })
          }
        />
      </fieldset>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="primary" busy={busy}>
          Save preferences
        </Button>
        <Button variant="danger" onClick={revoke} disabled={busy}>
          Delete what I shared
        </Button>
      </div>
    </form>
  );
}
