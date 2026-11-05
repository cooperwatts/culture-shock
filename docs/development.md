# Local development

## Requirements

Node 22 or newer and pnpm. Wrangler comes in as a dev dependency, so there is nothing to install globally.

```bash
pnpm install
pnpm test        # ~1s
pnpm typecheck
```

Both should pass on a clean checkout. If they do not, open an issue.

## Running it

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars
```

Generate a value for each key in that file:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Then:

```bash
pnpm db:migrate:local
pnpm dev:api     # http://localhost:8788
pnpm dev:web     # http://localhost:3000
```

The Next dev server proxies `/api/v1` through to the API Worker, so work against
`http://localhost:3000` rather than hitting the Worker port directly.

## Seeding something to look at

With both servers running:

```bash
pnpm seed:dev
```

This bootstraps an organization, seeds the built-in packs, enables Coffee Roulette,
creates a launched run, and enrols twenty-four participants with varied departments,
time zones and consent choices. It prints sign-in links when it finishes.

To see the whole flow, open the instance page, close enrolment, generate a preview,
and publish. The fairness report is more interesting with the seeded population than
with two accounts.

Pass `SEED_PARTICIPANTS=1200` to exercise the bounded candidate generation.

## Signing in locally

OIDC needs a real identity provider, which is inconvenient on a laptop, so there is a
development-only route that issues a session directly:

```
/api/v1/auth/dev-login?as=admin
/api/v1/auth/dev-login?as=participant&handle=person01
/api/v1/auth/dev-login?as=admin&redirect=/designer
```

It is hard-gated on `ENVIRONMENT` being `development`, which the staging and production
wrangler environments both override, and it is the only route that creates a session
without verifying an identity token. If you are reviewing security, that is the one to
look at first.

Any page that asks you to sign in also lists these links under "Local development", so
you do not have to type the URLs.

## Testing each role

`as=` takes any installation role: `admin`, `designer`, `participant` or
`support_readonly`. Anything else is rejected with the valid list. Each sign-in replaces
the account's installation grants, so the account holds exactly the role you asked for —
reusing a `handle` with a different `as` switches it rather than silently keeping the
old one.

Omit `handle` and it defaults to the role name, which gives you four stable accounts you
can switch between:

```
/api/v1/auth/dev-login?as=designer&redirect=/designer
/api/v1/auth/dev-login?as=support_readonly&redirect=/designer
```

What each role can reach is defined in `ROLE_PERMISSIONS` in
[packages/domain/src/authorization.ts](packages/domain/src/authorization.ts). Two results
are worth knowing before you treat them as bugs: designers hold `config:read`, so
`/admin` renders for them, and `support_readonly` can read experiences and packs but
cannot write anything.

Navigation hides Administration from roles that do not hold it, but hiding is only
tidiness. The API authorizes every request on its own, so a hidden route is still
enforced if you type the URL.

## Testing the AI features

AI is off by default, and everything that uses it has a deterministic fallback. Both
paths need testing, because the fallback is what most installations will actually run.

**With AI off**, ask the copilot for a suggestion at `/designer/copilot`. It answers from
fixed rules and says so, reporting `source: deterministic_fallback` and
`uncertainty: ["ai_disabled"]`.

**With AI on**, there is a `mock` provider kind that answers locally. It exists because
the real providers need a paid API key and `baseUrl` must be `https://`, so you cannot
point one at a stub on localhost. The mock runs the whole path — purpose gating,
redaction, budget, schema validation, the enabled-pack check and the interaction log —
without a network call or a bill. Publish this into `ai`:

```json
{
  "enabled": true,
  "egressReviewedBy": "local testing",
  "egressReviewedAt": "2026-01-01T00:00:00.000Z",
  "providers": [{ "key": "local", "kind": "mock" }],
  "purposes": {
    "copilot_recommendation": {
      "enabled": true,
      "providerKey": "local",
      "modelId": "mock"
    }
  }
}
```

The copilot then reports `source: ai` with `providerKind: mock` and
`uncertainty: ["mock_provider"]`, so a mocked answer is never mistaken for a real one.
Check what was recorded with:

```bash
wrangler d1 execute culture_shock --local \
  --command "SELECT purpose, provider_key, status, input_tokens FROM ai_interactions ORDER BY created_at DESC LIMIT 5;"
```

The mock is development-only and gated twice: publishing a configuration that uses it is
rejected unless `ENVIRONMENT` is `development`, and the orchestrator strips mock providers
anywhere else, so a configuration carried into production degrades to the fallback rather
than serving stub answers.

**With a real provider**, add the key to `apps/api/.dev.vars` as `AI_API_KEY_<KEY>`, where
`<KEY>` is the provider's `key` upper-cased with non-alphanumerics replaced by
underscores — a provider keyed `local` reads `AI_API_KEY_LOCAL`. Then set `kind` to
`openai`, `anthropic`, `azure-openai` or `cloudflare-ai`.

Note that `config:write` requires a sign-in within the last 15 minutes, so publishing any
of this may return `step_up_required`. Sign in again and retry.

What to check beyond "it returned something": the request body in
`packages/ai/test/ai.test.ts` shows exactly what leaves the installation. Headcounts
become bands, percentages round to the nearest five, and departments smaller than the
minimum cohort size are dropped entirely. No participant record is ever part of a prompt.

## Cookie names differ locally

Deployed, session cookies use the `__Host-` prefix, which requires `Secure` and so
cannot be set over plain HTTP. Local development drops the prefix and uses `cs_session`
and `cs_csrf`. If you are inspecting cookies in devtools and expecting `__Host-`, that
is why it is missing.

## Layout

A pnpm workspace. `packages/*` holds logic with no Cloudflare dependency. `apps/*` holds the deployable Workers and the web app, and is the only place bindings appear.

| Package         | Depends on               |
| --------------- | ------------------------ |
| `domain`        | nothing                  |
| `crypto`        | nothing                  |
| `config`        | domain                   |
| `rules`         | domain                   |
| `observability` | nothing                  |
| `pack-sdk`      | domain, rules            |
| `matching`      | domain, rules            |
| `notifications` | domain, config, pack-sdk |
| `ai`            | domain, config, pack-sdk |
| `contracts`     | domain, config, pack-sdk |
| `ui`            | nothing (React peer)     |

Packages must not import from apps. `domain` must not import from anything. If a change wants to violate that, it is usually pointing at a design problem rather than a rule that needs relaxing.

## Tests

Vitest, run from the root. Test files sit in `test/` next to the package they cover.

```bash
pnpm test
pnpm test -- packages/matching      # one package
pnpm exec vitest                    # watch mode
```

The suite is deliberately biased towards pinning rules rather than restating implementation. A test that would still pass if the rule were removed is not earning its place.

Some of what is covered, as a flavour of the style:

- A lower-authority rule cannot re-enable a capability a higher-authority rule disabled.
- A pack edited after an instance launched cannot unlock an activity in that instance.
- An export contains no third-party identifiers.
- Matching is deterministic for the same input regardless of input order.
- Cohorts below the minimum are suppressed in fairness reports.

## Building

```bash
pnpm typecheck                                  # whole workspace

cd apps/api  && wrangler deploy --dry-run       # bundles the API Worker
cd apps/jobs && wrangler deploy --dry-run       # bundles the jobs Worker
cd apps/web  && pnpm build                      # builds the Next.js app
```

A dry-run deploy catches bundling problems that typechecking misses, which is mostly module resolution and anything the Workers runtime will not accept.

## A note on module resolution

Workspace packages use ESM-correct `.js` specifiers that resolve to `.ts` source. Next's webpack does not do that by default, so `apps/web/next.config.ts` sets `transpilePackages` and `resolve.extensionAlias`. If you switch to Turbopack you will need the equivalent there.

## Migrations

```bash
pnpm db:migrate:local
pnpm db:migrate:remote
```

New migrations go in `db/migrations/` with an ordered numeric prefix. Forward-only. Write them so the previous application version keeps working against the new schema, since deployment applies migrations before the new code is live.

## Adding a Culture Pack

Create `packs/<slug>/manifest.json` and run `pnpm test`. The conformance suite discovers directories automatically and will tell you precisely what is wrong.

See [guides/writing-a-culture-pack.md](guides/writing-a-culture-pack.md).

## Common problems

**`pnpm install` reports ignored build scripts.** Run `pnpm rebuild`. The approved list lives in `pnpm-workspace.yaml`.

**Typecheck passes but the Worker will not bundle.** Usually an import the Workers runtime rejects. The dry-run output names the file.

**Times render as raw ISO strings.** Almost always an invalid `Intl.DateTimeFormat` option combination falling through to the fallback. `dateStyle` and `timeStyle` cannot be combined with `timeZoneName`, which is a real bug this project shipped once already.
