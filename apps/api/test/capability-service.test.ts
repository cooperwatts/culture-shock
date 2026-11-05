import { describe, expect, it } from "vitest";
import { isDomainError, type InstanceSnapshot } from "@culture-shock/domain";
import { packManifestSchema, type PackManifest } from "@culture-shock/pack-sdk";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  resolveActivityPermission,
  resolveRecognitionVisibility,
} from "../src/services/capability-service.js";

function loadManifest(slug: string): PackManifest {
  const path = fileURLToPath(new URL(`../../../packs/${slug}/manifest.json`, import.meta.url));
  return packManifestSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

function snapshotFor(manifest: PackManifest): InstanceSnapshot {
  return {
    packTemplateId: "ptl_00000000000000000000000000000000" as InstanceSnapshot["packTemplateId"],
    packVersion: manifest.version,
    schemaVersion: manifest.schemaVersion,
    capabilities: manifest.requiredCapabilities,
    privacyMode: manifest.reveal.mode,
    revealEnabled: manifest.reveal.enabled,
    consentVersion: "2026-01-01",
    classification: "internal",
    packConfig: {},
  };
}

describe("activity capability gating", () => {
  const appreciation = loadManifest("appreciation-week");
  const secretSanta = loadManifest("secret-santa");

  it("allows an activity the pack declared", () => {
    const permission = resolveActivityPermission(
      appreciation,
      snapshotFor(appreciation),
      "recognition",
    );
    expect(permission.activityKey).toBe("recognition");
    expect(permission.maxPerParticipant).toBeGreaterThan(0);
  });

  it("refuses an activity the pack never declared", () => {
    try {
      resolveActivityPermission(appreciation, snapshotFor(appreciation), "gift_exchange");
      throw new Error("expected a capability failure");
    } catch (error) {
      expect(isDomainError(error)).toBe(true);
      if (isDomainError(error)) expect(error.code).toBe("capability_disabled");
    }
  });

  it("refuses an unknown activity type outright", () => {
    expect(() =>
      resolveActivityPermission(secretSanta, snapshotFor(secretSanta), "wire_transfer"),
    ).toThrowError();
  });

  it("honours the frozen snapshot over a later manifest edit", () => {
    // A pack updated to add recognition cannot unlock it in a running instance.
    const edited: PackManifest = {
      ...secretSanta,
      activities: [
        ...secretSanta.activities,
        {
          key: "recognition",
          type: "recognition",
          title: { "en-CA": "Recognition" },
          optional: true,
          maxPerParticipant: 5,
        },
      ],
    };
    const staleSnapshot = snapshotFor(secretSanta);

    expect(() => resolveActivityPermission(edited, staleSnapshot, "recognition")).toThrowError();
  });
});

describe("recognition visibility", () => {
  it("permits private visibility under restrictive policy", () => {
    expect(resolveRecognitionVisibility("recipient_only", false)).toBe("recipient_only");
  });

  it("rejects organization-wide visibility when policy forbids it", () => {
    try {
      resolveRecognitionVisibility("organization", false);
      throw new Error("expected a policy failure");
    } catch (error) {
      expect(isDomainError(error)).toBe(true);
      if (isDomainError(error)) expect(error.code).toBe("policy_violation");
    }
  });

  it("permits broader visibility once policy allows it", () => {
    expect(resolveRecognitionVisibility("organization", true)).toBe("organization");
  });
});
