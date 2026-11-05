"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, SelectField, TextAreaField, TextField } from "@culture-shock/ui";
import { apiMutate, describeProblem } from "@/lib/api-client";
import type { PackSummary } from "@/lib/types";

export function CreateExperienceForm({ packs }: { packs: PackSummary[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [packSlug, setPackSlug] = useState(packs[0]?.slug ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = packs.find((pack) => pack.slug === packSlug);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const version = selected?.pinnedVersion ?? selected?.latestVersion;
    if (!version) {
      setError("That Culture Pack has no published version.");
      return;
    }

    setBusy(true);
    const result = await apiMutate<{ id: string }>("/experiences", {
      method: "POST",
      body: { name, description: description || undefined, packSlug, packVersion: version },
    });
    setBusy(false);

    if (!result.ok) {
      setError(describeProblem(result.error));
      return;
    }
    router.push(`/designer/experiences/${result.data.id}`);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error ? <Alert tone="error" title="Could not create">{error}</Alert> : null}

      <TextField
        id="experience-name"
        label="Name"
        required
        maxLength={120}
        value={name}
        onChange={(event) => setName(event.target.value)}
        hint="Participants see this name in every message."
      />

      <TextAreaField
        id="experience-description"
        label="Description"
        maxLength={600}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        hint="Optional. Explain why this is running and that taking part is voluntary."
      />

      <SelectField
        id="experience-pack"
        label="Culture Pack"
        required
        value={packSlug}
        onChange={(event) => setPackSlug(event.target.value)}
        options={packs.map((pack) => ({
          value: pack.slug,
          label: `${pack.name} (${pack.pinnedVersion ?? pack.latestVersion ?? "no version"})`,
        }))}
      />

      {selected ? <p className="text-sm text-muted-foreground">{selected.summary}</p> : null}

      <Button type="submit" variant="primary" busy={busy} disabled={!name || !packSlug}>
        Create
      </Button>
    </form>
  );
}
