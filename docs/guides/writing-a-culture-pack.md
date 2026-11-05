# Writing a Culture Pack

A Culture Pack is a JSON file. It describes a programme: what it is for, who can take part, how people get matched, what they are asked to do, and what gets sent to them.

Packs are data. The platform reads a manifest and drives it through capabilities that live in the source. This has a consequence worth understanding before you start: **you cannot invent a mechanic.** If a pack needs something the platform does not implement, validation fails with a message naming the missing capability, and the fix is a platform change with its own review rather than a clever manifest.

In practice the existing capabilities cover most of what people want.

## Getting started

Create `packs/your-slug/manifest.json` and run `pnpm test`. The conformance suite finds new directories on its own and checks your manifest against the same validation an externally imported pack would face.

Copying an existing pack is the fastest way in. `packs/coffee-roulette/manifest.json` is the simplest; `packs/secret-santa/manifest.json` exercises the most features.

## Required shape

```json
{
  "id": "your-slug",
  "schemaVersion": "1.0.0",
  "version": "1.0.0",
  "name": { "en-CA": "Your Programme" },
  "summary": { "en-CA": "One sentence on what it does." },
  "provenance": { "origin": "builtin", "author": "Your Name" },
  "requiredCapabilities": ["enrollment.self-serve", "matching.pair"],
  "objectives": [],
  "workflow": { "entry": "open", "nodes": [] },
  "matching": { "strategyKey": "cross-functional" }
}
```

Every participant-facing string is keyed by locale. At minimum you need the installation's default locale, which for the built-in packs is `en-CA`.

`id` must match the directory name. `version` is semantic and immutable once published.

## Capabilities

Declare what the pack needs. The full list is in `packages/pack-sdk/src/capabilities.ts`:

```
enrollment.self-serve        enrollment.invite-only
matching.pair                matching.group               matching.buddy
activity.gift-exchange       activity.recognition         activity.conversation-prompt
activity.check-in            activity.milestone           activity.survey
clue.exchange                reveal.gated                 suggestion.gift
communications.templated     insights.aggregate           ai.assistant
```

Declaring a capability the installation has disabled means the pack cannot be enabled there. Declaring one that does not exist fails validation immediately.

Some workflow actions require a matching capability. `run_matching` needs one of the three matching capabilities; `send_notification` needs `communications.templated`; `reveal` needs `reveal.gated`.

## Objectives

What the programme is for, and how you would know it worked.

```json
"objectives": [{
  "key": "break_silos",
  "title": { "en-CA": "Break organizational silos" },
  "description": { "en-CA": "Create working relationships between departments that rarely overlap." },
  "metric": "department_bridge_score"
}]
```

The metric must be one the insight engine computes: `participation_rate`, `engagement_rate`, `connection_score`, `department_bridge_score`, `organizational_reach`, `remote_inclusion_score`, `experience_completion_rate`. You cannot define your own, because a metric is a query over participant data and that surface is deliberately closed.

## Workflow

A directed acyclic graph of actions. Validation checks that it is acyclic, that every edge points somewhere real, that it is reachable from the entry node, and that it terminates.

```json
"workflow": {
  "entry": "open",
  "nodes": [
    { "key": "open",     "action": "open_enrollment",  "next": ["invite"] },
    { "key": "invite",   "action": "send_notification", "templateKey": "enrollment_open", "next": ["close"] },
    { "key": "close",    "action": "close_enrollment",  "next": ["match"] },
    { "key": "match",    "action": "run_matching",      "timeoutMinutes": 120, "next": ["approve"] },
    { "key": "approve",  "action": "publish_matches",   "humanGate": true, "next": ["missions"] },
    { "key": "missions", "action": "assign_missions",   "next": ["done"] },
    { "key": "done",     "action": "finish",            "next": [] }
  ]
}
```

Available actions: `open_enrollment`, `close_enrollment`, `run_matching`, `publish_matches`, `assign_missions`, `send_notification`, `collect_feedback`, `reveal`, `finish`.

`humanGate` stops the workflow until a person acts. Put one on `publish_matches` and on `reveal`. Matching should never publish itself, and no reveal should happen without somebody deciding it should.

Node keys need at least two characters. A single letter fails the pattern, which is an easy way to waste ten minutes.

## Rules

Rules are declarative. A rule has a category, a priority, an optional condition, and an effect.

```json
"rules": [
  {
    "id": "privacy.pseudonymous",
    "category": "privacy",
    "priority": 10,
    "then": { "type": "setPrivacyMode", "mode": "pseudonymous" }
  },
  {
    "id": "inclusion.async-track",
    "category": "inclusion",
    "priority": 30,
    "when": {
      "all": [
        { "field": "participant.remotePreference", "op": "eq", "value": "remote" },
        { "field": "match.timeZoneOverlapMinutes", "op": "lte", "value": 60 }
      ]
    },
    "then": { "type": "setPool", "pool": "asynchronous" }
  }
]
```

Conditions can only reference an allowlisted set of fields, listed in `packages/pack-sdk`'s dependency `packages/rules/src/ast.ts`. You cannot reach participant free text, identifiers, or anything resembling a protected characteristic, by construction rather than by convention.

Categories carry authority, and a lower-authority rule cannot weaken a higher-authority one. `installation_safety` outranks `privacy` and `consent`, which outrank `eligibility` and `participation`, which outrank `matching`, `inclusion` and `schedule`, which outrank `activity`. Within the same authority, deny beats allow.

[rules.md](rules.md) goes into this properly.

## Matching

```json
"matching": {
  "strategyKey": "cross-functional",
  "groupSize": 2,
  "allowTriadForOddCount": true,
  "weights": { "department_diversity": 1, "novel_connection": 0.9 },
  "hardConstraints": ["no_self_match", "no_repeat_match", "different_department"]
}
```

Five strategies ship: `cross-functional`, `diversity-optimized`, `remote-first`, `new-hire-friendly`, `leadership-mix`. Each exposes weight keys you can tune; anything outside 0 to 1 is clamped.

Hard constraints resolve before any weighting and cannot be traded away by scoring. If they are too strict, people go unmatched, and the dry run will tell you so before a designer finds out.

`allowTriadForOddCount` decides what happens to the last person when the count is odd. With it on they join the best-fitting pair. With it off they are reported as unmatched and a designer has to decide. There is no third option where they are quietly dropped.

## Missions

What you are actually asking people to do.

```json
"missions": [{
  "key": "first_conversation",
  "title": { "en-CA": "Have one conversation" },
  "description": { "en-CA": "Spend half an hour comparing how your teams work." },
  "requiredForCompletion": true,
  "asynchronousAlternative": { "en-CA": "Exchange written answers in a shared thread instead." },
  "dueOffsetMinutes": 20160
}]
```

Write an `asynchronousAlternative` for every mission that assumes a live conversation. The dry run warns when none of your missions has one, because a programme that only works for people in overlapping time zones has quietly excluded everyone else.

## Communications

```json
"communications": [{
  "key": "enrollment_open",
  "channel": "email",
  "trigger": "enrollment_open",
  "subject": { "en-CA": "{{experience.name}} is open for sign-up" },
  "body": { "en-CA": "Hello {{participant.displayName}},\n\nSign up before {{experience.enrollmentClosesAt}} if you would like to join.\n\n{{links.experienceUrl}}" },
  "plainTextBody": { "en-CA": "Sign up for {{experience.name}} before {{experience.enrollmentClosesAt}}. {{links.experienceUrl}}" }
}]
```

Only these variables resolve:

```
organization.name
experience.name  experience.startsAt  experience.endsAt
experience.enrollmentClosesAt         experience.timeZone
participant.displayName               participant.pseudonym
match.peerDisplayName                 match.peerPseudonym
terminology.platformName              terminology.participantSingular
terminology.experienceSingular        terminology.matchSingular
links.experienceUrl                   links.supportUrl
```

Anything else fails validation. Unknown variables render as empty rather than leaking the raw placeholder into somebody's inbox.

`plainTextBody` is required, not optional. It is what text-only clients and some screen readers get.

Do not put literal URLs in templates. The validator flags them, because a URL in a pack you did not write is a phishing vector. Use `{{links.experienceUrl}}`.

Templates are scanned for prompt-injection patterns too. That is not paranoia about your pack; it is about the imported pack somebody enables next year.

## Reveal

```json
"reveal": {
  "enabled": true,
  "mode": "reveal_at_end",
  "requiresDesignerApproval": true,
  "offsetMinutesFromEnd": 0
}
```

Modes are `anonymous`, `pseudonymous`, `reveal_at_end`, `never_reveal`. Enabling reveal while the mode is `never_reveal` is a contradiction and fails validation.

Privacy mode is enforced on every read and every message, not just in the interface. A participant cannot obtain a peer's identity through the API before a reveal, whatever the client does.

## Insights

```json
"insights": {
  "metrics": ["participation_rate", "department_bridge_score"],
  "minimumCohortSize": 10
}
```

`minimumCohortSize` cannot go below the installation's own floor. You can raise it for a sensitive programme, not lower it.

## Data requirements

```json
"dataRequirements": ["department", "team", "time_zone", "remote_preference"]
```

Declare only what the matching actually uses. An installation can refuse fields, and a pack asking for more than it needs will be rejected somewhere it would otherwise have worked.

There is no field for a home address, a personal email, or a phone number. That is not an oversight.

## Configuration fields

If designers should be able to adjust something, declare a typed field:

```json
"configurationSchema": [{
  "key": "group_size",
  "type": "number",
  "label": { "en-CA": "People per group" },
  "required": true,
  "min": 2,
  "max": 4,
  "default": 3
}]
```

Types are `string`, `number`, `boolean`, `enum`, `stringList`. This is a restricted meta-schema on purpose: packs cannot ship JSON Schema or regular expressions, because that is executable validation by another name.

## Testing it

```bash
pnpm test
```

The conformance suite checks the schema, capabilities, workflow structure, template variables, prompt safety, and runs the sandbox dry run against a synthetic population of forty.

The dry run is the useful part. It reports how many sample participants are eligible, what privacy mode and constraints actually resolve, the order the workflow executes in, and your messages fully rendered. Read the rendered messages. Variables that silently render empty are obvious there and invisible in the JSON.

Administrators see the same report before publishing, through `/admin/packs/drafts`.

## Contributing a pack back

Open a pull request with the manifest and a short description of what the programme is and who it is for. A pack that has actually been run with real people is more valuable than a theoretically elegant one, so say so if it has.
