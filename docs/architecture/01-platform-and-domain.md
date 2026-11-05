# 1. Product, repository, domain, and Culture Pack architecture

## Product architecture and boundaries

One self-hosted installation is owned by one organization. An Organizer uses the web UI to select or draft a Culture Pack, configure an Experience Instance, invite participants, review recommendations, run activities, and examine privacy-preserving insights. Participants use a separate, least-privilege view. Installation administrators manage identity, branding, policies, AI providers, secrets and pack enablement. Operations staff may see delivery/health metadata without participant content.

| Boundary                                             | Responsibilities                                                                                                                     | Explicitly not responsible for                           |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Web (Next.js App Router, React, Tailwind, shadcn/ui) | Accessible designer/participant/admin interfaces; TanStack Query for server state, Zustand for ephemeral UI state; no server secrets | Authoritative permissions, matching, pack interpretation |
| API (Hono Worker)                                    | Validated REST contracts, sessions, authorization, workflow commands, pack interpreter, audit, AI orchestration                      | Browser-only identity checks, blocking bulk jobs         |
| Domain packages                                      | Stable entities, invariants, policies, rules AST, typed pack capabilities, scoring interfaces                                        | Cloudflare SDK specifics                                 |
| Infrastructure adapters                              | D1 repositories/transactions, R2 private objects, Queue/outbox, OIDC, email, AI providers                                            | Domain policy decisions                                  |
| Background consumers                                 | Due transitions, matching, notifications, analytics, AI proposals, outbox publishing                                                 | Direct unvalidated state changes                         |

Next.js runs on Cloudflare Workers using a maintained compatible adapter; the Hono Worker serves `/api/v1` on the same origin through routes, avoiding cross-origin cookie/CORS complexity. Static assets may be cached; personalized pages and API responses are private/no-store. Prefer portable APIs; isolate runtime-specific bindings in adapters. The web app never accesses D1/R2 or AI credentials directly. Installation branding lives in validated configuration and private R2 objects, not source constants.

## Proposed repository structure (design only; do not scaffold yet)

| Path                  | Intended content                                                            |
| --------------------- | --------------------------------------------------------------------------- |
| `apps/web/`           | Next.js routes, design system, accessible forms, locales, branded templates |
| `apps/api/`           | Hono routes, middleware, auth, domain application services                  |
| `apps/jobs/`          | Queue consumers, scheduled dispatcher and maintenance handlers              |
| `packages/domain/`    | Entities, policies, domain events, branded IDs and invariants               |
| `packages/contracts/` | Request/response schemas, generated OpenAPI and client types                |
| `packages/pack-sdk/`  | Pack manifest schema, registry/interpreter and validators                   |
| `packages/rules/`     | Allowlisted condition AST, evaluator and conflict checker                   |
| `packages/matching/`  | Strategy interfaces, optimization and fairness reports                      |
| `packages/ai/`        | Provider adapters, prompt templates, redaction and validation               |
| `packages/config/`    | Installation/experience config schemas, theme tokens                        |
| `packages/ui/`        | Reusable accessible, brand-neutral components                               |
| `packs/`              | Five first-party, versioned data-only manifests and fixture scenarios       |
| `infra/cloudflare/`   | Worker deployment templates, bindings, secrets documentation                |
| `db/migrations/`      | Ordered D1 migrations with backward-compatible rollout policy               |
| `tests/`              | Contract, accessibility, policy, pack conformance, integration/e2e          |
| `docs/`               | Architecture, operations, contribution and security policies                |

Use a TypeScript monorepo with pinned toolchain and lockfile, workspace boundaries, contract generation and separate Worker build targets. Do not treat package import paths as runtime trust boundaries. Public contributors can propose data-only packs; deployment owners choose what to install.

## Domain architecture

Identity and organization: **Organization** (one per installation initially), **User** (corporate pseudonymous subject plus optional display name and work email), **IdentityProvider** (OIDC or optional magic-link configuration), **BrandTheme**, **Configuration** (versioned installation settings). Users receive installation roles `admin`, `designer`, `participant`, or `support_readonly`; experience-scoped roles are separate grants. Email is only collected when needed for login/delivery, and not required for OIDC participants where an opaque subject suffices.

Pack catalog: **CulturePack** (stable slug and owner: built-in or local), **CulturePackTemplate** (immutable published manifest version), **Experience** (editable designer-authored definition referencing a template), **ExperienceInstance** (immutable launch snapshot and operational state). `Experience` and `ExperienceInstance` are the domain and API terms and do not change. The default _displayed_ wording is Organizer and Programme, because "Culture Designer" read as a visual-design job and "Experience" as marketing language to the people actually using it; an earlier revision of this paper mandated Culture Designer and forbade organizer, which is superseded. Every noun is organization-configurable terminology, so an installation can restore either. An Experience is a reusable configured plan; each Instance is a scheduled execution of that plan. Instances snapshot template version, rules, prompts, schedule, theme and consent policy so later updates cannot silently alter live behavior.

Participation: **Participant** (instance-local membership linking a User), **ParticipantProfile** (opt-in structured preferences, accessibility accommodation category if strictly necessary, time zone and remote preference), **CultureProfile** (derived, minimized, revocable interests/affinities, provenance and expiry). Raw free-text intake must not be sent to AI or stored long-term by default. Accommodation specifics are not exposed to match peers; only scheduling/format constraints are used.

Experience mechanics: **Rule** and **RuleSet** (versioned declarative policy); **MatchingStrategy** (versioned scoring/configuration), **Match** (pair/group membership, score explanation visible only to authorized designers), **Mission** (assigned goal), **Activity** (participant action/status), **Conversation** (only platform-hosted threads if explicitly enabled; otherwise external-link metadata without message ingestion), **Clue**, **Recognition**, **Reveal**, **Notification**. Non-gift packs have no gift, clue or reveal requirements. Secret Santa's gift suggestion is optional and needs no shipping details.

Governance/measurement: **AnalyticsSnapshot** (aggregated metrics with suppression), **AIInteraction** (metadata, consent, template/model/version/cost and redacted content references; no raw sensitive prompts in audit), **AuditEvent** (append-only privileged and state-change facts). All primary records use generated opaque IDs, organization ID and timestamps; instance-owned records also use instance ID. Avoid direct participant names in logs, analytics or matching exports.

## Invariants and lifecycle

- Pack template publications are immutable. Retirement hides a pack from new instances but preserves referenced versions; deletion is blocked while referenced, then subject to retention policy. Local pack import may be fully removed only when no live or retained dependencies exist.
- Draft definition -> validated -> ready -> launched Instance. Instance states: `draft`, `enrolling`, `locked`, `active`, `reveal_pending` (only when enabled), `completed`, `cancelled`, `archived`. Transitions require explicit capability, schedule and actor policy; cancellation is terminal for actions, not immediate deletion.
- Enrollment and opt-out are idempotent; withdrawal revokes visibility and future match eligibility. Before lock, recompute. After launch, replacement/remediation follows pack-approved policy and notifies affected participants; never reassign silently.
- Match members must be enrolled and eligible for the same instance and may not see other participants' private data. A strict no-self/no-repeat exclusion takes priority over scoring. An odd pair count yields a configured triad or an explicitly unpaired outcome; never silently drop anyone.
- Public participant-facing copy is generated from brand/terminology tokens, localized templates and experience settings. Store locale and IANA time zone, UTC instants for scheduling.

## Data-only plugin contract

A manifest has `id`, `schemaVersion`, `version`, `origin`, `objectives`, `requiredCapabilities`, `configurationSchema`, `defaults`, `eligibility`, `rules`, `workflow`, `matching`, `missions`, `activities`, `communications`, `aiAssistants`, `reveal`, `insights`, and `analytics`. Rules reference typed allowlisted predicates, capability names and declarative actions. Workflows are a DAG of approved transition/action types (enroll, lock, match, assign, remind, collect feedback, reveal, finish) with bounded retries, timeouts and human gates. Templates are typed, localized, length-limited and escaped on output. Prompts are inert text templates with only approved variables and explicit classification; they are never system instructions or authority over policy. Metrics are registered aggregates, not raw SQL. Manifests carry provenance and checksum; installation policy optionally requires signed releases.

Registry maps capability identifiers to core versioned handlers, not pack IDs to `switch` statements. Pack compatibility (`schemaVersion`, minimum capabilities and supported handlers) is validated on import; old immutable versions remain executable until migration/retirement. Organization can enable/disable, pin version, configure allowed fields and preview in a dry-run sandbox. Unknown fields/handlers, unsafe template variables, invalid DAG edges, recursive rules, arbitrary code/URLs/SQL, or forbidden data requirements fail closed. No `eval`, dynamic imports from a pack or remote execution. A genuinely new mechanic requires a reviewed core capability release rather than pretending data can express arbitrary code.

| Built-in manifest    | Default capabilities                                                    | Specific configuration                                                                 |
| -------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Secret Santa         | pair-match, optional anonymous gifting, clues, gated reveal, suggestion | gift budget optional, no address collection, digital/office/independent exchange modes |
| Appreciation Week    | recognition, messages, campaigns, aggregate insights                    | recipient visibility and moderation; gifts/reveal disabled                             |
| Coffee Roulette      | pair/group match, conversation prompts, survey                          | time-zone overlap, asynchronous alternative, cadence                                   |
| New Hire Buddy       | buddy assignment, check-ins, milestones                                 | tenure eligibility, buddy load cap, reassignment                                       |
| Cross-Team Connector | cross-department match, shared topics, follow-up                        | department diversity, remote inclusion, opt-in cadence                                 |

Every first-party pack passes the same conformance tests as imported manifests. Future packs (Mentorship Exchange, Leadership Connect, Innovation Exchange, Charity Campaign, Recognition Week) require only data definitions when existing capabilities suffice; otherwise add a reviewed capability with migration and tests. The AI builder uses exactly the same validation/publishing pipeline, with explicit human approval.
