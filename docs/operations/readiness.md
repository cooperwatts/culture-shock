# Production readiness

A pre-launch checklist. Work through it before real participants use the installation, the same way you would for anything else handling employee data.

Most of it is quick. The load test and the restore rehearsal take longer and are the two people most often skip, which is also why they are the two that tend to bite.

## Platform

- [ ] Adapter and runtime compatibility confirmed for the Next.js version you are deploying, including middleware, image handling and fonts on Workers.
- [ ] D1, R2 and Queue bindings resolve in the deployed environment, not only locally.
- [ ] Preview and production use separate D1 databases. Confirm by checking the database IDs differ, not by assuming.
- [ ] Cron triggers are registered on the jobs Worker and firing. Check the logs for `health_evaluated` lines.
- [ ] `SETUP_TOKEN` has been unset since bootstrap.

## Load

- [ ] Matching runs to completion with 1,200 enrolled participants, and you have looked at `approximationReason` in the diagnostics to see which path it took.
- [ ] Candidate generation stays bounded at that size. The implementation caps candidates per participant rather than materialising every pair; confirm `consideredEdges` reflects that.
- [ ] API latency under expected concurrency is acceptable to you, and you have written down what acceptable means.
- [ ] Notification delivery drains a realistic backlog within the window you need, given `queueBatchSize` and the per-minute cron.

## Recovery

- [ ] A restore from backup into a scratch database has been rehearsed end to end, and somebody timed it.
- [ ] You know what your recovery point objective actually is, rather than what you would like it to be.
- [ ] Migration behaviour under rollback is understood: migrations are forward-only, so an application rollback needs a compatible schema.

## Authentication

- [ ] Sign-in works for each enabled provider.
- [ ] A user outside the configured tenant or domain allowlist is rejected.
- [ ] A tampered or expired identity token is rejected.
- [ ] A replayed authorization callback fails.
- [ ] Sessions expire at the absolute ceiling, not just the sliding window.
- [ ] Administrative actions prompt for re-authentication once `stepUpMaxAgeSeconds` has elapsed.

## Authorization

- [ ] A participant cannot read another participant's profile, match, or recognitions through any route.
- [ ] A designer with a grant on one experience cannot act on another.
- [ ] Unauthenticated requests to participant and admin routes are rejected.
- [ ] Peer identity respects the instance privacy mode, including before a reveal.

## Privacy

- [ ] An export has been generated and read end to end. Confirm no third party is identifiable in it.
- [ ] An erasure has been run on a test account, and you have checked what remains: audit rows present with no actor, no participant rows, no R2 objects.
- [ ] A legal hold blocks erasure and records the request as blocked.
- [ ] Aggregates below `minimumCohortSize` are suppressed everywhere, including fairness reports.
- [ ] If AI is on, you have inspected what actually leaves the installation for each enabled purpose and confirmed the egress review is recorded.

## Accessibility

- [ ] Keyboard-only navigation works through the participant and designer flows.
- [ ] A screen reader announces form errors and status changes.
- [ ] Brand colours pass the contrast gate, which the publish path enforces but which is worth checking against real content.
- [ ] Time zones render correctly for participants outside the organization's default, including across a daylight saving boundary.

Target WCAG 2.2 AA. An automated checker will get you part of the way; it will not tell you whether the flow makes sense without a mouse.

## Packs

- [ ] Every enabled pack passes conformance, which `pnpm test` covers.
- [ ] Every enabled pack has been dry-run through the sandbox, and you have read the rendered messages rather than assuming they read well.
- [ ] Pinned versions are set if you need stability while the catalogue moves.

## Operations

- [ ] Health checks are being evaluated and you can see the output.
- [ ] Alerting routes on the `alert` field and reaches a human.
- [ ] Thresholds in `packages/observability/src/health.ts` have been tuned to your traffic rather than left at the shipped defaults.
- [ ] You have decided what your latency and delivery targets are, and written them down somewhere other than here.

## Review

- [ ] Somebody who did not build it has attempted to break it.
- [ ] Data processing agreements with any AI or email provider are in place.
- [ ] Retention periods match your actual obligations rather than the shipped defaults.
- [ ] Employment-law notice requirements have been met where participation data is involved.

The last four are not engineering tasks and cannot be satisfied by reading the code.
