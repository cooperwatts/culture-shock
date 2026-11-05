# Scope

What Culture Shock does, what it leaves to you, and what it refuses to do on purpose.

## In the box

Five ready-to-run programmes: Secret Santa, Appreciation Week, Coffee Roulette, New Hire Buddy, Cross-Team Connector. Enable them and they work.

Sign-in through Microsoft Entra ID or Google Workspace, with tenant and domain allowlists, PKCE, and server-side revocable sessions.

Five matching strategies with tunable weights, hard constraints that cannot be traded away by scoring, and a fairness report the designer reads before anything is published.

A rules engine that decides eligibility, privacy mode, matching constraints and activity availability from declarative data.

Email delivery through Resend, SendGrid, MailChannels, or a self-hosted relay, with consent and enrolment re-checked immediately before each send.

Seven aggregate metrics with cohort suppression, plus recommendations drawn from them.

Optional AI across six separate purposes, each independently switchable, each with a deterministic fallback. The product is fully usable with every provider off.

Privacy export and erasure as background jobs, with legal holds, audited downloads, and third-party pseudonymisation.

Operational health checks, structured redacting logs, and alert lines you can route on.

A branding editor covering colours, typography, custom WOFF2 fonts and logo upload, with a live preview and a contrast gate on publish.

## Your responsibility

Self-hosting means some things are yours rather than ours.

Where the data lives, how long you keep it, and the lawful basis you process it under. The retention defaults are chosen to be defensible, not to be advice.

Whether to enable AI at all, which providers you trust, and the data processing agreements behind them. Validation refuses to turn AI on until somebody records an egress review, which is the most the code can reasonably do.

Verifying that a person making a privacy request is who they claim to be. The platform records your stated reason and nothing more.

Edge rate limiting through Cloudflare WAF, your backup and restore procedure, and the pre-launch checks in [operations/readiness.md](operations/readiness.md).

## Not included

Some of these are on the roadmap. Others are waiting for somebody who needs them enough to build them.

**Magic-link sign-in.** Present in the configuration schema and the database with no implementation behind it. Leave it disabled and use OIDC.

**SAML and SCIM.** The adapter boundary exists so they can be added without disturbing anything else. No code yet.

**In-app notifications.** The schema has a channel for them. Only email is delivered today.

**Conversation hosting and clue exchange.** Storage, gating and encryption are in place; there is no participant interface, so a pack can declare the capabilities and nobody can use them.

**Editing a published pack.** Published versions are immutable by design, and there is no interface for drafting a new version from an existing one. Changing a pack means authoring a new manifest.

**An experience lifecycle.** The architecture describes experiences moving through `draft`, `validated` and `ready`, and the column exists with that vocabulary, but no transition was ever implemented: every experience reads `draft` forever. Rather than show a status that cannot change, the designer list reports the state of the most recent run. The column stays for whoever implements the lifecycle.

**Multi-tenancy.** Every query is organization-scoped and the schema supports more than one, but the isolation assumptions have not been reviewed for it. One organization per installation.

## Known trade-offs

Decisions that went one way and could reasonably have gone the other.

**Matching above small pools is approximate.** Greedy with a bounded 2-opt improvement pass, not exact maximum-weight matching. The diagnostics report which path ran. For connection programmes the difference is immaterial; if you need provable optimality, you need a different matcher.

**Duplicate emails are possible with some providers.** Resend and the self-hosted relay honour idempotency keys. SendGrid and MailChannels do not. Reconcile from `delivery_attempts` rather than assuming exactly-once, which nothing here claims.

**Dead-letter queue depth is not directly observable.** A Worker cannot query it, so health checks infer delivery problems from failure counts and outbox age instead.

**`connection_score` reports as suppressed.** It depends on post-experience survey responses and there is no survey interface yet. The metric is defined so its shape is stable when one arrives.

## Deliberately absent

These look like gaps and are not. A proposal to add one needs to be very good.

**No admin impersonation.** It is the most abused support feature in products of this kind.

**No participant-level analytics.** The insight engine computes aggregates with cohort suppression. No route reports on an individual, and adding one would undo the suppression everywhere else.

**No message content in analytics or AI requests.** Recognitions and conversations are encrypted at rest and never become an input to anything.

**No home addresses, personal email addresses or phone numbers.** No column, no field, no form input. Physical gift exchange is arranged between participants off-platform.

**No arbitrary metrics in packs.** A metric is a query over participant data. Letting a manifest define one reopens everything the data-only pack contract closes.

**No AI in the matching path.** A model can propose bounded weights for a human to accept. It cannot be the matcher, and it cannot override eligibility, consent, or a fairness constraint.
