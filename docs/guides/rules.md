# The rules engine

Rules decide who is eligible, what privacy mode applies, which matching constraints are in force, and which activities are available. They are data, evaluated by `packages/rules`.

This is not a programming language and is not trying to become one. There are no loops, no user-defined functions, no field paths, no network access, and no SQL. A rule can inspect an allowlisted set of facts and produce one of eight effects. That is the whole surface.

## Shape

```json
{
  "id": "matching.cross-department",
  "category": "matching",
  "priority": 20,
  "when": { "field": "participant.department", "op": "isSet", "value": true },
  "then": { "type": "setMatchingConstraint", "constraint": "different_department" }
}
```

`when` is optional. A rule without one always fires.

## Facts

Conditions can only reference these:

```
participant.team                 participant.department
participant.geography            participant.timeZone
participant.remotePreference     participant.tenureBand
participant.languages            participant.state
instance.phase                   instance.participationMode
consent.scope                    priorMatch.count
match.sameDepartment             match.sameTeam
match.timeZoneOverlapMinutes
```

That is the complete list, defined in `packages/rules/src/ast.ts`. There is no path syntax, so a rule cannot walk into free text, identifiers, or anything resembling a protected characteristic. Extending the list is a platform change with review attached.

## Operators

`eq`, `neq`, `in`, `nin`, `gte`, `lte`, `between`, `contains`, `isSet`.

Combine conditions with `all`, `any`, `not`, nested up to five deep and a hundred nodes. Both limits are enforced at publish time rather than discovered at runtime.

```json
{
  "all": [
    { "field": "participant.remotePreference", "op": "eq", "value": "remote" },
    { "not": { "field": "participant.tenureBand", "op": "eq", "value": "lt_3_months" } }
  ]
}
```

## Missing facts

A condition on a fact that is absent evaluates false. It does not match a default and it does not throw.

This matters more than it sounds. Participants choose what to share, so absent fields are normal rather than exceptional. A rule that denies eligibility when `department` equals `technology` will not fire for someone who never told you their department. If you need to catch that case, use `isSet` explicitly.

## Effects

| Effect | Does |
| --- | --- |
| `allow` | Permits, with an optional decision code |
| `deny` | Refuses, with a required code |
| `requireApproval` | Flags for human review |
| `setPrivacyMode` | `anonymous`, `pseudonymous`, `reveal_at_end`, `never_reveal` |
| `setMatchingConstraint` | A named hard constraint, optionally with a value |
| `setActivityCapability` | Turns a named activity on or off |
| `setPool` | Puts the participant in a named pool |
| `scheduleRelativeAction` | Schedules an action against an anchor |

## Authority

Every category sits at an authority level, and this is the part worth understanding properly.

| Level | Categories |
| --- | --- |
| 0, highest | `installation_safety` |
| 1 | `privacy`, `consent` |
| 2 | `eligibility`, `participation` |
| 3 | `matching`, `inclusion`, `schedule` |
| 4, lowest | `activity` |

Rules are evaluated highest authority first. Within a level, deny beats allow. **A lower-authority rule cannot weaken a decision a higher-authority rule has already made.**

So an `installation_safety` rule disabling address collection cannot be re-enabled by an `activity` rule, whatever its priority. Priority orders rules within a level; it does not promote one between levels.

This is why experience-level overrides cannot introduce `installation_safety`, `privacy` or `consent` rules at all. An experience can tighten things below those levels; it cannot loosen what the installation decided.

## Conflict analysis

Rule sets are analysed before publication and before launch. The analyser catches duplicate ids, conditions nested too deep or too large, contradictory constraints such as `same_department` with `different_department`, an unsatisfiable group size, multiple unconditional privacy modes at the same authority, a capability unconditionally both enabled and disabled, a reveal scheduled under `never_reveal`, and an eligibility rule that denies everyone.

The last of those is reported as a warning rather than an error, since it is occasionally what somebody meant.

## Decision output

Evaluation produces a decision carrying whether the subject is allowed, which rules fired, denial and approval codes, the resolved privacy mode, matching constraints, activity capabilities, pools, and scheduled actions.

Logs record rule ids and decision codes. They never record the participant attributes that caused the decision, which keeps the audit trail useful without making it a second copy of the profile data.

## Trying it out

The sandbox dry run in `packages/pack-sdk` evaluates a rule set against a synthetic population of forty and reports how many are eligible, which denial codes fired and how often, and what actually resolved. Run `pnpm test` or use `/admin/packs/drafts` in the interface.

If your eligibility rules exclude everybody, this is where you find out, rather than at launch.
