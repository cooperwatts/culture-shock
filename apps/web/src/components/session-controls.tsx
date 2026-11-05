"use client";

import { useState } from "react";
import { Button } from "@culture-shock/ui";
import { apiMutate } from "@/lib/api-client";

/**
 * Sign-out is a POST so it carries CSRF protection and cannot be triggered by a
 * link or a prefetch. A full reload follows so no stale server-rendered page
 * keeps showing the signed-in shell.
 */
export function SignOutButton() {
  const [busy, setBusy] = useState(false);

  return (
    <Button
      variant="ghost"
      size="sm"
      busy={busy}
      onClick={async () => {
        setBusy(true);
        await apiMutate("/auth/logout", { method: "POST" });
        window.location.assign("/");
      }}
    >
      Sign out
    </Button>
  );
}
