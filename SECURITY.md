# Security policy

## Reporting a vulnerability

Please report security issues privately. Use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) on this repository, or email the maintainers listed in `package.json` if that is not available to you.

Do not open a public issue for a vulnerability, and please do not test against an installation you do not own.

Include whatever you have: the version or commit, what you did, what happened, and what you expected. A proof of concept helps but is not required to make a report worth sending.

You should get an acknowledgement within a few days. Maintainers are volunteers, so please be patient if the fix takes longer than the acknowledgement.

## What counts

This project is self-hosted, so the deployer owns the environment. That split matters for triage.

In scope:

- Authentication or session handling flaws: forged or fixed sessions, CSRF gaps, broken token validation.
- Authorization flaws: reading or writing another participant's data, cross-instance access, escalation through experience-scoped grants.
- Anything that lets a Culture Pack manifest escape the data-only contract, reach an unreviewed capability, or inject into a rendered template or prompt.
- Leaks of participant data through aggregates, insight queries, exports, logs, or AI requests.
- Injection in any form, including into D1 through a repository.
- Secrets reachable from the client bundle or from an unauthenticated route.

Out of scope, though still worth telling us about if something reads badly:

- Findings that require an attacker to already hold an administrator session.
- Missing hardening on an installation that has not completed the checks in [docs/operations/readiness.md](docs/operations/readiness.md).
- Rate limits on a free Cloudflare plan, which the project explicitly does not rely on for capacity.
- Anything in a third-party identity or AI provider rather than in this code.

## Disclosure

We will work with you on a fix and credit you in the release notes unless you would rather we did not. We ask for a reasonable window before public disclosure, and we will tell you when a patch ships rather than leaving you guessing.

If a fix needs a schema migration or a configuration change by deployers, the advisory will say so plainly, because a patch nobody can apply is not a fix.

## Notes for deployers

A few things are your responsibility, not the project's:

Rotate the keys listed in `apps/api/.dev.vars.example` on the schedule your policy requires. There is a key version column on encrypted fields for exactly this reason.

Unset `SETUP_TOKEN` once the bootstrap call has run. It is an unauthenticated route guarded only by that secret.

Keep preview deployments away from production D1. The configuration files ship with separate environments for this.

Read [docs/operations/readiness.md](docs/operations/readiness.md) before taking real traffic. Several of the checks there, particularly the restore rehearsal and the privacy erasure exercise, are things you only want to discover the state of before you need them.
