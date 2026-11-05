# Contributing

Thanks for looking. This document covers how to get set up, what the review process is like, and which parts of the codebase need more care than others.

## Before you start

For anything beyond a typo fix, open an issue first. It saves you building something that gets turned down for a reason that was not obvious from the code.

Three kinds of contribution are especially welcome:

New Culture Packs. These are JSON files in `packs/`. You do not need to understand the platform internals to write one, and the conformance test suite will tell you if it is wrong.

Translations. Pack text and interface copy are locale keyed. Adding a locale is mechanical work that makes the project usable for more people.

Bug reports with a reproduction. Especially anything involving time zones, daylight saving, or matching edge cases, which is where the bodies are buried.

## Setting up

Node 22 or newer, and pnpm.

```bash
pnpm install
pnpm test
pnpm typecheck
```

Both should pass on a clean checkout. If they do not, that is a bug and worth an issue on its own.

For a running system, see [docs/development.md](docs/development.md).

## How the repository is organised

It is a pnpm workspace. The `packages/*` directories hold logic that does not depend on Cloudflare: domain rules, the pack SDK, matching, AI adapters. The `apps/*` directories hold the deployable Workers and the Next.js app, and they are where Cloudflare bindings are allowed to appear.

The direction of dependency matters. Packages must not import from apps, and `packages/domain` must not import from anything. If you find yourself wanting to break that, the design is probably telling you something.

## Tests

Run `pnpm test`. It is fast, a second or so, so there is no excuse for not running it.

Tests live in `test/` beside the package they cover. We prefer tests that pin a rule we care about over tests that restate what the code does. Some examples of the former already in the suite:

- A lower authority rule cannot re-enable a capability that a higher authority rule disabled.
- A pack updated after an instance launched cannot unlock an activity in that running instance.
- A privacy export contains no third-party identifiers.
- Matching never pairs someone with themselves, and never silently drops anyone.

If you change behaviour in one of those areas, expect to be asked for a test that would have failed before your change.

## What gets reviewed harder

Not all changes are equal, and it is only fair to say so up front.

Anything touching the **capability surface** in `packages/pack-sdk/src/capabilities.ts` effectively changes what a pack is allowed to do. New capabilities need a clear argument for why existing ones cannot express the mechanic, plus validation and tests.

Anything touching **privacy**: the redaction lists, cohort suppression, consent checks, the export bundle shape. The rule of thumb is that a change here should make the system share less, not more, unless there is a specific reason.

Anything touching **matching fairness**: hard constraint evaluation, the fairness report, cohort suppression in it.

Anything touching **authorization** in `packages/domain/src/authorization.ts`.

These are not off limits. They just need more explanation in the pull request than a UI tweak does.

## Style

TypeScript, strict mode, no `any` without a comment explaining why.

Comments should say something the code cannot. A comment explaining _why_ a constraint exists earns its place; one restating the next line does not.

Error messages that reach a user should be actionable and should not leak internals. Error messages in logs should carry identifiers and codes, never content.

We use the structured logger in `packages/observability`, not `console.log`. It drops forbidden field names and scrubs email addresses and tokens, which is easy to get wrong by hand.

## Commits and pull requests

Small, focused commits with messages that explain why. If a pull request needs a paragraph of context, put it in the description rather than making the reviewer reconstruct it.

Describe what you tested. "Ran the suite" is fine for a contained change. For anything touching matching, delivery, or privacy, say what you exercised and how.

## Adding a Culture Pack

Create `packs/<slug>/manifest.json` and run `pnpm test`. The conformance suite picks up new directories automatically and checks the manifest against the same validation an imported pack gets: schema, capabilities, workflow structure, template variables, prompt safety, and the sandbox dry run.

[docs/guides/writing-a-culture-pack.md](docs/guides/writing-a-culture-pack.md) walks through it properly.

A pack that needs a mechanic the platform does not implement will fail validation with a message naming the missing capability. That is the system working. Open an issue describing the mechanic rather than trying to work around it.

## Governance

Decisions get made in issues and pull requests, in public. Maintainers have the final say on changes to the pack capability surface, the privacy model, and matching fairness, because those are the parts an installation cannot easily undo once it has shipped.

Deployment choices stay with the deployer. Data residency, retention periods, lawful basis, and whether to turn AI on at all belong to whoever runs the installation. The project should keep making those configurable rather than picking for them, and a pull request that hardcodes one will be asked to make it a setting instead.

## Licence

Contributions are accepted under the Apache 2.0 licence that covers the project.
