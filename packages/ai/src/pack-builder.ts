import { z } from "zod";
import { packBlueprintSchema, type PackBlueprint } from "@culture-shock/pack-sdk";

export const PACK_BUILDER_PROMPT_VERSION = "pack_builder.blueprint/1.0.0";

export const packBuilderInputSchema = z.object({
  objective: z.string().min(10).max(600),
  audience: z.string().max(300).optional(),
  locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).default("en-CA"),
  /** Slugs already installed; the generator must not collide with them. */
  existingSlugs: z.array(z.string().max(60)).max(100).default([]),
});

export type PackBuilderInput = z.infer<typeof packBuilderInputSchema>;

export const packBuilderResponseSchema = z.object({
  blueprint: packBlueprintSchema,
  rationale: z.string().max(600),
});

export type PackBuilderResponse = z.infer<typeof packBuilderResponseSchema>;

/**
 * The generator receives only the designer's own objective text and the list of
 * mechanics the platform implements. It never sees participant data, and it
 * cannot describe a mechanic outside the enumerated set.
 */
export function buildPackBuilderMessage(input: PackBuilderInput): string {
  return [
    "You are drafting a workplace connection programme for review by a human administrator.",
    "Produce a blueprint only. You cannot write code, queries, URLs, or new platform features.",
    "Choose exactly one mechanic from: pair_match, group_match, buddy_match, recognition_only.",
    "Every mission must include an asynchronous alternative so remote staff are not excluded.",
    "Do not request home addresses, personal contact details, or any protected characteristic.",
    `Do not reuse these slugs: ${input.existingSlugs.join(", ") || "none"}.`,
    `Write all participant-facing text in ${input.locale}.`,
    `Objective: ${input.objective}`,
    input.audience ? `Audience: ${input.audience}` : "",
    "Respond with JSON matching the blueprint schema.",
  ]
    .filter(Boolean)
    .join("\n");
}

function slugify(value: string, existing: readonly string[]): string {
  const base =
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "culture-pack";
  const padded = base.length >= 3 ? base : `${base}-pack`;
  if (!existing.includes(padded)) return padded;

  for (let suffix = 2; suffix < 50; suffix += 1) {
    const candidate = `${padded}-${suffix}`;
    if (!existing.includes(candidate)) return candidate;
  }
  return `${padded}-draft`;
}

interface MechanicTemplate {
  readonly keywords: readonly string[];
  readonly mechanic: PackBlueprint["mechanic"];
  readonly strategy: PackBlueprint["matchingStrategyKey"];
  readonly crossDepartment: boolean;
  readonly activityType: "conversation" | "check_in" | "recognition";
}

const TEMPLATES: readonly MechanicTemplate[] = [
  {
    keywords: ["silo", "cross", "department", "function", "collaborat", "bridge"],
    mechanic: "pair_match",
    strategy: "cross-functional",
    crossDepartment: true,
    activityType: "conversation",
  },
  {
    keywords: ["onboard", "new hire", "buddy", "ramp", "induct"],
    mechanic: "buddy_match",
    strategy: "new-hire-friendly",
    crossDepartment: false,
    activityType: "check_in",
  },
  {
    keywords: ["recogni", "apprecia", "thank", "gratitude", "morale"],
    mechanic: "recognition_only",
    strategy: "diversity-optimized",
    crossDepartment: false,
    activityType: "recognition",
  },
  {
    keywords: ["remote", "distributed", "timezone", "time zone", "hybrid"],
    mechanic: "pair_match",
    strategy: "remote-first",
    crossDepartment: false,
    activityType: "conversation",
  },
];

/**
 * Deterministic blueprint used when AI is disabled or fails. It produces a
 * genuinely usable starting point rather than an empty shell, and is explicitly
 * labelled so an administrator knows no model was involved.
 */
export function fallbackBlueprint(input: PackBuilderInput): PackBuilderResponse {
  const text = `${input.objective} ${input.audience ?? ""}`.toLowerCase();
  const scored = TEMPLATES.map((template) => ({
    template,
    score: template.keywords.reduce((sum, keyword) => sum + (text.includes(keyword) ? 1 : 0), 0),
  })).sort((a, b) => b.score - a.score);

  const chosen = scored[0]?.template ?? TEMPLATES[0];
  if (!chosen) throw new Error("No blueprint template is registered");

  const title = input.objective.split(/[.!?]/)[0]?.trim().slice(0, 60) || "Connection programme";
  const slug = slugify(title, input.existingSlugs);
  const isRecognition = chosen.mechanic === "recognition_only";

  const blueprint = packBlueprintSchema.parse({
    slug,
    name: title,
    summary: `Draft generated from a stated objective without AI assistance. Review and edit before publishing.`,
    mechanic: chosen.mechanic,
    matchingStrategyKey: chosen.strategy,
    groupSize: 2,
    privacyMode: isRecognition ? "never_reveal" : "pseudonymous",
    revealEnabled: false,
    crossDepartment: chosen.crossDepartment,
    objectives: [
      {
        key: "primary_objective",
        title: "Primary objective",
        description: input.objective.slice(0, 400),
        metric: isRecognition ? "engagement_rate" : "department_bridge_score",
      },
      {
        key: "broad_participation",
        title: "Broad participation",
        description: "Reach people across the organization rather than the same engaged group.",
        metric: "participation_rate",
      },
    ],
    missions: [
      {
        key: isRecognition ? "recognize_colleagues" : "first_conversation",
        title: isRecognition ? "Recognize three colleagues" : "Have one conversation",
        description: isRecognition
          ? "Send a short, specific thank-you to three people whose work helped you."
          : "Spend half an hour with the person you were matched with and compare how your teams work.",
        requiredForCompletion: true,
        asynchronousAlternative: isRecognition
          ? "Write your messages whenever suits you; nothing is time-boxed to a meeting."
          : "Exchange written answers in a shared thread if your working hours do not overlap.",
        dueOffsetMinutes: 20160,
      },
      {
        key: "share_takeaway",
        title: "Share one takeaway",
        description: "Note one thing you learned or one person you would work with again.",
        requiredForCompletion: false,
        asynchronousAlternative: "A single written sentence is enough.",
        dueOffsetMinutes: 40320,
      },
    ],
    activities: [
      {
        key: chosen.activityType,
        type: chosen.activityType,
        title: isRecognition ? "Send recognition" : "Record your conversation",
        optional: false,
        maxPerParticipant: isRecognition ? 10 : 3,
      },
      { key: "closing_survey", type: "survey", title: "Closing survey", optional: true, maxPerParticipant: 1 },
    ],
    communications: [
      {
        key: "enrollment_open",
        trigger: "enrollment_open",
        subject: "{{experience.name}} is open for sign-up",
        body: "Hello {{participant.displayName}},\n\n{{organization.name}} is running {{experience.name}}. Taking part is optional. Sign up before {{experience.enrollmentClosesAt}} if you would like to join.\n\n{{links.experienceUrl}}",
      },
      {
        key: "mission_reminder",
        trigger: "mission_reminder",
        subject: "A reminder about {{experience.name}}",
        body: "Hello {{participant.displayName}},\n\n{{experience.name}} runs until {{experience.endsAt}}. There is still time to take part.\n\n{{links.experienceUrl}}",
      },
      {
        key: "completed",
        trigger: "completed",
        subject: "{{experience.name}} has wrapped up",
        body: "Hello {{participant.displayName}},\n\nThank you for taking part in {{experience.name}} at {{organization.name}}.\n\n{{links.experienceUrl}}",
      },
    ],
    insightMetrics: isRecognition
      ? ["participation_rate", "engagement_rate", "organizational_reach"]
      : ["participation_rate", "engagement_rate", "department_bridge_score", "remote_inclusion_score"],
    dataRequirements: chosen.crossDepartment
      ? ["department", "team", "time_zone", "remote_preference"]
      : ["time_zone", "remote_preference"],
    risks: [
      "Generated without AI assistance from keyword matching on the stated objective.",
      "Mission wording and timings are generic defaults and should be edited for your organization.",
    ],
  });

  return {
    blueprint,
    rationale:
      "Selected deterministically from the stated objective because AI assistance is unavailable. Review every field before publishing.",
  };
}
