"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@culture-shock/ui";
import { apiMutate, describeProblem } from "@/lib/api-client";

export function PackControls({
  slug,
  enabled,
  status,
}: {
  slug: string;
  enabled: boolean;
  status: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(action: "enable" | "retire") {
    if (action === "retire" && !window.confirm(`Retire ${slug}? It cannot be re-enabled.`)) return;

    setError(null);
    setBusy(action);
    const result = await apiMutate(`/packs/${slug}/${action}`, { method: "POST" });
    setBusy(null);

    if (!result.ok) {
      setError(describeProblem(result.error));
      return;
    }
    router.refresh();
  }

  if (status === "retired") {
    return <span className="text-xs text-muted-foreground">Retired</span>;
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        {!enabled ? (
          <Button busy={busy === "enable"} onClick={() => act("enable")}>
            Enable
          </Button>
        ) : null}
        <Button variant="danger" busy={busy === "retire"} onClick={() => act("retire")}>
          Retire
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
