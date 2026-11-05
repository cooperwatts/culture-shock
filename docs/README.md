# Documentation

## Running an installation

- [Installing on Cloudflare](install.md). Resources, secrets, migrations, bootstrap, first sign-in.
- [Configuration reference](configuration.md). Every setting, what it does, and what it defaults to.
- [Operations](operations/README.md). Background jobs, health checks, alerts, and what to do when one fires.
- [Production readiness](operations/readiness.md). The checks to work through before real people use this.

## Building on it

- [Writing a Culture Pack](guides/writing-a-culture-pack.md). The manifest format, with a worked example.
- [The rules engine](guides/rules.md). Conditions, effects, and how conflicts resolve.
- [Matching](guides/matching.md). Strategies, constraints, and how to read a fairness report.
- [API reference](api.md). Routes, headers, errors.

## Working on the project

- [Local development](development.md). Repository layout, test suite, common tasks.
- [Contributing](../CONTRIBUTING.md).
- [Scope](scope.md). What is included, what is yours to decide, and what the platform deliberately will not do.

## Design background

The [architecture papers](architecture/README.md) were written before the code and explain why things are shaped the way they are. Read them before proposing a change to the pack contract, the rules engine, or the privacy model, since most of the obvious objections are answered there.
