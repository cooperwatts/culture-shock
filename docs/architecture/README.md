# Architecture

These five papers were written before any code existed. They set out the shape of the system and, more usefully, the reasoning behind decisions that would otherwise look arbitrary.

Read them before proposing a change to the pack contract, the rules engine, or the privacy model. Most of the obvious objections are answered somewhere in here, and the trade-off discussions are the part that has aged best.

1. [Product, repository, domain and pack architecture](01-platform-and-domain.md). What the boundaries are and why Culture Packs are data rather than plugins.
2. [Data and API](02-data-and-api.md). The logical D1 schema and the shape of the REST contracts.
3. [Intelligence and engines](03-intelligence-and-engines.md). AI control plane, rules engine, matching, insights.
4. [Security, privacy and deployment](04-security-and-deployment.md). Threat model, privacy architecture, Cloudflare resources, failure semantics.
5. [Diagrams and roadmap](05-diagrams-and-roadmap.md). C4 diagrams, sequences, lifecycle, phased delivery.

## Where the implementation differs

Four decisions moved once they met real code. The code is authoritative.

**Configuration gained a `setupComplete` flag.** The original design required at least one authentication method to be configured at all times, which is impossible during first-run bootstrap. The requirement now applies only once setup is marked complete.

**The AI pack builder produces a blueprint, not a manifest.** The design implied a model could draft a manifest directly. In practice that hands too much structure to the generator. A blueprint is content only, and the platform derives the workflow graph, the rules, and the capability list from it.

**Maximum-weight matching is approximate.** The design mentions exact maximum-weight matching for pairs. The implementation uses a greedy pass with a bounded 2-opt improvement and reports which it used, because a blossom implementation was not worth the complexity at the sizes involved. This is a documented approximation, not an oversight.

**Shared crypto moved into its own package.** Both Workers need field decryption, so the helpers live in `packages/crypto` rather than inside the API.
