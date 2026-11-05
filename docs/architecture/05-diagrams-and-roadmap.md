# 5. C4 diagrams, sequences, lifecycle, roadmap

## C4 Level 1 — system context

```mermaid
C4Context
  title Culture Shock — self-hosted installation context
  Person(designer, "Organizer", "Creates and reviews experiences")
  Person(participant, "Participant", "Opts in and builds connections")
  Person(admin, "Installation administrator", "Controls identity, privacy, packs and branding")
  System(platform, "Culture Shock", "Organization-owned, privacy-first Culture OS")
  System_Ext(idp, "Corporate identity provider", "Entra ID or Google Workspace")
  System_Ext(email, "Transactional email provider", "Optional magic links and approved notifications")
  System_Ext(ai, "Configured AI provider", "OpenAI, Azure OpenAI, Anthropic, or Cloudflare AI")
  Rel(designer, platform, "Designs and approves")
  Rel(participant, platform, "Participates by consent")
  Rel(admin, platform, "Configures and governs")
  Rel(platform, idp, "OIDC authentication")
  Rel(platform, email, "Optional delivery")
  Rel(platform, ai, "Optional minimized, purpose-limited requests")
```

## C4 Level 2 — deployment containers

```mermaid
C4Container
  title Culture Shock — one organization's Cloudflare deployment
  Person(user, "Designer / participant / admin")
  System_Boundary(cx, "Culture Shock installation") {
    Container(web, "Web Worker", "Next.js, React", "Accessible branded experience")
    Container(api, "API Worker", "Hono, TypeScript", "Authorization and domain workflows")
    Container(jobs, "Jobs Worker", "Queues / Cron", "Async processing and outbox dispatch")
    ContainerDb(d1, "D1", "SQLite", "Domain data, audit, outbox")
    ContainerDb(r2, "Private R2", "Object storage", "Assets and expiring exports")
    Container(queue, "Queue + DLQ", "Cloudflare Queues", "At-least-once events")
  }
  System_Ext(idp, "Corporate identity")
  System_Ext(delivery, "Email adapter")
  System_Ext(model, "Chosen AI adapter/provider")
  Rel(user, web, "HTTPS")
  Rel(web, api, "Same-origin API route")
  Rel(api, d1, "Scoped queries and atomic state/outbox writes")
  Rel(api, r2, "Private authorized assets")
  Rel(api, idp, "OIDC")
  Rel(jobs, d1, "Lease outbox, persist job receipts")
  Rel(jobs, queue, "Publish and consume")
  Rel(jobs, delivery, "Approved notification")
  Rel(api, model, "Opt-in draft calls")
  Rel(jobs, model, "Opt-in async proposals")
```

## C4 Level 3 — API Worker components

```mermaid
C4Component
  title API Worker — major components
  Container_Boundary(api, "Hono API Worker") {
    Component(routes, "Routes and contract validation", "Hono / schemas", "Versioned API")
    Component(policy, "Session, RBAC and privacy policy", "Domain policies", "Authorize all actions and reads")
    Component(orchestrator, "Experience application services", "TypeScript", "Transactions and lifecycle")
    Component(registry, "Pack registry / interpreter", "Versioned manifest schemas", "Resolve only approved capabilities")
    Component(rules, "Rules engine", "Typed AST", "Deterministic policy decisions")
    Component(matching, "Matching coordinator", "Scoring strategies", "Create reviewed match jobs")
    Component(copilot, "AI orchestration", "Provider interface", "Minimize, validate, return drafts")
    Component(repos, "Scoped repositories", "D1 / R2 adapters", "Persistence with outbox")
  }
  Rel(routes, policy, "Authenticate and authorize")
  Rel(routes, orchestrator, "Validate commands")
  Rel(orchestrator, registry, "Resolve pack capabilities")
  Rel(orchestrator, rules, "Evaluate constraints")
  Rel(orchestrator, matching, "Plan candidate job")
  Rel(orchestrator, copilot, "Request reviewed proposal")
  Rel(orchestrator, repos, "Write state, audit and outbox")
```

## Sequence — create and launch an experience with Copilot

```mermaid
sequenceDiagram
  actor D as Organizer
  participant W as Web
  participant A as API/policy
  participant AI as AI adapter
  participant P as Pack validator/rules
  participant DB as D1 + outbox
  participant J as Queue consumer
  D->>W: State objectives and inclusion goals
  W->>A: POST /copilot/recommendations (opt-in)
  A->>A: Authorize; classify and minimize input
  A->>AI: Typed, redacted proposal request
  AI-->>A: Candidate plans
  A->>P: Validate capabilities, privacy and schema
  A-->>W: Draft recommendations + risks
  D->>W: Choose pack, edit rules and schedule
  W->>A: Create Experience and Instance
  A->>P: Dry-run workflow and policy
  A->>DB: Store draft and audit atomically
  D->>W: Approve launch
  W->>A: POST /instances/:id/launch (idempotent)
  A->>DB: Compare-and-swap state; snapshot + audit + outbox
  DB-->>J: Outbox dispatcher sends reference event
  J->>DB: Re-check state and consent; record delivery
  J-->>D: Enrollment communication scheduled
```

## Sequence — matching, publication and reveal

```mermaid
sequenceDiagram
  actor D as Organizer
  actor U as Participant
  participant A as API
  participant Q as Queue
  participant M as Matching engine
  participant DB as D1
  D->>A: Request match preview
  A->>DB: Snapshot eligible, consented memberships; create run/outbox
  DB-->>Q: Dispatcher publishes run reference
  Q->>M: Run scoring job (at least once)
  M->>DB: Load current snapshot; apply hard rules
  M->>M: Optimize bounded scores and assess fairness
  M->>DB: Save candidate matches and diagnostics idempotently
  D->>A: Inspect unmatched and fairness report
  D->>A: Publish run with If-Match
  A->>DB: Verify state; publish once; audit + outbox
  U->>A: Request my match
  A->>DB: Check membership and privacy mode
  A-->>U: Permitted peer fields / pseudonym only
  opt Pack permits scheduled reveal
    D->>A: Authorize reveal
    A->>DB: Check policy/time; commit reveal + outbox
    U->>A: Request revealed relationship
    A-->>U: Allowed peer identity only
  end
```

## Experience event lifecycle

```mermaid
stateDiagram-v2
  [*] --> draft
  draft --> enrolling: Designer launches validated snapshot
  enrolling --> locked: Enrollment closes / explicit lock
  locked --> active: Approved matching and activities start
  active --> reveal_pending: Pack enables gated reveal
  active --> completed: No reveal capability
  reveal_pending --> completed: Reveal approved and activities finish
  draft --> cancelled: Designer cancels
  enrolling --> cancelled: Designer cancels
  locked --> cancelled: Designer cancels
  active --> cancelled: Designer cancels with notification
  reveal_pending --> cancelled: Designer cancels
  completed --> archived: Retention/archive policy
  cancelled --> archived: Retention/archive policy
  archived --> [*]
```

```mermaid
flowchart LR
  C[Authorized command] --> T[D1 transaction: state + audit + outbox]
  T --> D[Scheduled outbox dispatcher]
  D --> Q[Queue reference event]
  Q --> K{Receipt exists or stale state?}
  K -- Yes --> N[Acknowledge without effect]
  K -- No --> V[Recheck policy and consent]
  V --> E[Idempotent effect and receipt]
  E --> A[Acknowledge]
  V -- Transient error --> R[Bounded retry]
  R --> Q
  R -- Retries exhausted --> L[DLQ, alert and audited replay]
```

## Phase-based MVP roadmap and exit gates

| Phase | Deliverable | Exit gate |
| --- | --- | --- |
| 0 — architecture approval | Confirm installation scope, privacy/legal defaults, supported packs, Cloudflare adapter/plan, email delivery, OSS license choice and threat model | Explicit sign-off on this proposal; no code before gate |
| 1 — secure foundation | Monorepo, build/test CI, Cloudflare bindings, migration system, config/theme, OIDC, sessions, RBAC, audit, contract/schema generation | Tenant-scoped auth/IDOR negative tests, deployment smoke test, accessibility baseline |
| 2 — extensible core | Data-only pack registry, interpreter, rules DSL, experience lifecycle, enrollment/opt-out, notifications/outbox, five manifest fixtures | Pack conformance/dry-run, retries/idempotency tests, no pack-ID core branches |
| 3 — connection MVP | Scoring matching strategies, Secret Santa (digital-first), Appreciation Week, Coffee Roulette; participant views and restricted reveal | 1,200-person performance test, consent/reveal/odd-count edge cases, WCAG audit |
| 4 — breadth and intelligence | New Hire Buddy, Cross-Team Connector; opt-in AI Copilot and pack builder, provider adapters, human approval flow | Privacy egress audit, disabled-AI fallback, generated-pack validation, abuse tests |
| 5 — insights and release | Suppressed metrics, AI recommendations, branding localization, install docs, backup/restore, observability and OSS contribution policy | Red-team, privacy erasure/export, DR rehearsal, independent self-host install |
| Later — enterprise expansion | SCIM, SAML, advanced content moderation, reviewed new capability SDK, broader packs | Separate security/privacy review per feature |

Decisions deferred to phase 0: license and governance, actual email provider, regional data-processing constraints, which AI providers may receive which purpose/data, default retention by employer/legal context, target supported languages/locales, throughput budget/Cloudflare pricing, and whether installation-level administrators require step-up auth. These are configuration/policy questions, not excuses to weaken the MVP's security defaults.
