# Operations

Day-to-day running of an installation: what the background jobs do, what the health checks mean, and what to do when one goes red.

## Background jobs

The jobs Worker runs on three schedules.

**Every minute** it publishes queued events from the outbox, then delivers notifications that are due. Both are batched and bounded, so a backlog drains over several runs rather than one enormous invocation.

**Every five minutes** it evaluates operational health and emits an alert line for anything breached.

**Nightly at 03:15 UTC** it sweeps retention: expired sessions and challenges, old audit events, revoked culture profiles, expired exports in R2.

Queue messages are consumed by handlers registered in `apps/jobs/src/handlers.ts`. Each handler claims a receipt before doing work, so a redelivered message is a no-op rather than a duplicate effect.

## Delivery semantics

Worth being blunt about, since it affects how you read incidents.

Queue delivery is **at-least-once**. The outbox write is transactional with the state change that caused it, but publishing to the queue is not, so a crash between sending and marking published can duplicate a message. Handlers deduplicate on `job_receipts`.

Email delivery is at-least-once too, and whether duplicates actually reach someone depends on the provider. Resend and the self-hosted relay honour the idempotency key. SendGrid and MailChannels do not.

Nothing in this system is exactly-once, and anything claiming otherwise would be lying.

## Health checks

`GET /api/v1/admin/operations` returns the current report, and `/admin/operations` renders it. Everything in it is a count or an age, so it contains nothing about any individual and the `support_readonly` role can see it.

| Check | Degraded | Breached | What it usually means |
| --- | --- | --- | --- |
| `outbox_age` | 300s | 900s | The dispatcher is behind, or not running at all |
| `outbox_exhausted` | — | 1 | Events past the retry ceiling that will never publish on their own |
| `notifications_overdue` | 50 | — | Delivery is lagging behind its schedule |
| `notification_failure_rate` | 5% | 20% | Provider trouble, or a from-address that is not authenticated |
| `match_runs_stuck` | — | 1 | A matching job stopped partway |
| `ai_failure_rate` | 25% | — | Provider trouble, covered by fallbacks |
| `auth_failures` | 100/h | — | Misconfigured provider, or credential stuffing |
| `expired_exports` | — | 1 | Privacy exports outlived retention; the sweep is not running |

The AI check deliberately cannot breach. A provider outage is not user-facing breakage, because every AI path falls back to a deterministic result. Nobody should be woken for it.

The thresholds that ship are starting points for a single installation. Tune them against your own traffic in `packages/observability/src/health.ts` before alerting on them.

## Alerting

Breaches are emitted as structured log lines with an `alert` field carrying the check key. Route on the field rather than parsing the message:

```json
{ "level": "error", "message": "alert", "alert": "outbox_age", "observed": 1200, "threshold": 900 }
```

One line per breached check, not one combined line, so a rule can match a single condition.

## Runbook

### outbox_age breached

The dispatcher is not keeping up or not running. Check that the jobs Worker cron triggers are registered and that the queue binding resolves. If the Worker is healthy, look at `outbox_events.last_error` for a pattern.

A large backlog drains on its own once the cause is fixed, since each run takes a bounded batch.

### outbox_exhausted breached

These events hit the retry ceiling and will never publish by themselves. They need a decision, not a retry loop.

Read `last_error` first. Replaying blindly re-runs handlers that may have partly succeeded. Handlers are idempotent on `job_receipts`, so replay is safe in principle, but understand why it failed before you do it.

### notification_failure_rate breached

Check the provider's status page, then your domain authentication. SPF or DKIM going stale is the most common cause and shows up as a sudden cliff rather than a gradual rise.

Failed messages stop after `maxDeliveryAttempts` and stay in the `failed` state, so nothing spins.

### match_runs_stuck breached

A matching job stopped mid-run. Runs are keyed by an input hash, so re-requesting the same preview is safe and returns the stored run if one completed. If the participant set has not changed, the designer can simply ask for the preview again.

### expired_exports breached

Privacy exports outlived their seven-day retention and are still in R2. The nightly sweep is not running. This is worth treating seriously because those objects contain the most sensitive data the system produces.

## Backups

D1 supports point-in-time recovery through Cloudflare. Your restore procedure is your own, and the only way to know it works is to have done it.

Migrations are forward-only. An application rollback is fine as long as the schema it expects is compatible; a schema rollback is not supported and you would be restoring from backup instead.

Rehearse a restore into a scratch database before you need one. [readiness.md](readiness.md) treats this as a gate rather than a nicety.

## Logs

The structured logger in `packages/observability` drops a list of forbidden field names outright and scrubs email addresses, bearer tokens and phone numbers from whatever is left. Values truncate at 300 characters so a single line cannot carry a payload.

Use it rather than `console.log`. Getting redaction right by hand is harder than it looks and the failure mode is a log aggregator full of participant data.

## Privacy requests

Export and erasure both run as background jobs, raised from `/admin/privacy`.

An export lands in R2 with a seven-day expiry and is downloaded through an authorized, audited route. Every other person in the bundle is reduced to a pseudonym.

Erasure deletes optional content, removes membership rows, and severs the actor link on audit entries so the record that something happened survives without the identity behind it. Published groups that lose a member are flagged `remediated` for a designer rather than quietly rewritten.

An active legal hold blocks erasure. The request is recorded as blocked with a reason, not silently skipped.

Verifying that the person making a request is who they claim is your process, not the platform's. It records your stated reason and nothing more.
