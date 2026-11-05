# 2. Logical database schema and API contracts

This is a **design**, not executable migrations or implementation. D1 is the authoritative transactional store. All identifiers are opaque and generated; timestamps are UTC ISO-8601; foreign keys are enabled in every connection. Every table below (except migration metadata) has `organization_id`, `created_at` and `updated_at` unless noted. One organization per installation is the MVP invariant, but scope by organization ID in every repository/API boundary. JSON columns store versioned, schema-validated configuration only; never use JSON for identity or membership joins. Indexed IDs are never derived from email. Restrict SQL access to repository adapters.

## Logical D1 schema

| Table | Primary fields beyond common columns | Essential constraints/indexes |
| --- | --- | --- |
| organizations | id, slug, display_name, locale, status | unique slug; installation may have one active org |
| users | id, status, display_name?, work_email_ciphertext?, work_email_lookup_hmac?, deleted_at? | unique `(organization_id, work_email_lookup_hmac)` when set; opaque identifiers |
| identity_providers | id, kind, issuer?, client_id?, enabled, config_version | unique `(organization_id, kind, issuer)`; no client secrets in D1 |
| identities | id, user_id, provider_id, provider_subject | unique `(provider_id, provider_subject)`; immutable external subject mapping |
| role_grants | id, user_id, role, scope_type, scope_id? | unique `(user_id, role, scope_type, scope_id)` via normalized scope key |
| sessions | id, user_id, token_hash, expires_at, revoked_at?, last_seen_at | unique token_hash; index expiry; bounded rotation |
| magic_link_challenges | id, email_lookup_hmac, token_hash, expires_at, consumed_at?, attempts | unique token_hash; expiring, single-use, email optional feature |
| brand_themes | id, revision, tokens_json, asset_keys_json, status | unique `(organization_id, revision)`; publish immutable revision |
| configurations | id, scope, revision, schema_version, config_json, status | unique `(organization_id, scope, revision)`; immutable published revision |
| culture_packs | id, slug, origin, status, enabled | unique `(organization_id, slug)`; builtin/imported/generated provenance |
| culture_pack_templates | id, pack_id, version, schema_version, manifest_json, checksum, state, provenance | unique `(pack_id, version)`; published immutable; referential deletion block |
| pack_drafts | id, pack_id?, author_user_id, source, manifest_json, validation_json, revision, expires_at | mutable bounded drafts; publish creates immutable template |
| experiences | id, designer_user_id, name, current_revision, state | unique id; optimistic current_revision update |
| experience_revisions | id, experience_id, revision, pack_template_id, definition_json, created_by | unique `(experience_id, revision)`; immutable history for launch references |
| experience_instances | id, experience_id, pack_template_id, snapshot_json, state, enrollment_close_at?, start_at?, end_at?, published_at? | index `(organization_id, state, start_at)`; guard snapshot/version |
| participants | id, instance_id, user_id, status, joined_at, withdrawn_at? | unique `(instance_id, user_id)`; indexes `(instance_id, status)` |
| participant_profiles | id, participant_id, revision, preferences_json, consent_version, expires_at | unique `(participant_id, revision)`; encrypted sensitive optional fields |
| culture_profiles | id, participant_id, version, derived_traits_json, provenance_json, consent_version, expires_at, revoked_at? | index `(participant_id, revoked_at)`; short retention |
| rule_sets | id, instance_id, version, rules_json, checksum | unique `(instance_id, version)`; evaluated snapshot |
| rules | id, rule_set_id, rule_key, category, condition_json, effect_json, priority | unique `(rule_set_id, rule_key)`; condition/effect DSL only |
| matching_strategies | id, instance_id, version, strategy_key, weights_json, constraints_json | unique `(instance_id, version)`; no arbitrary expressions |
| match_runs | id, instance_id, strategy_id, input_hash, state, diagnostics_json, approved_by?, published_at? | unique `(instance_id, input_hash, strategy_id)` for idempotent runs |
| matches | id, run_id, instance_id, group_key, state, score, rationale_codes_json | index `(instance_id, run_id)`; no participant PII in rationale |
| match_members | id, match_id, participant_id, role | unique `(match_id, participant_id)`; unique `(run_id, participant_id)` enforced via denormalized run_id and validation |
| missions | id, instance_id, key, definition_json, state | unique `(instance_id, key)` |
| activities | id, instance_id, mission_id?, participant_id?, type, state, payload_json, completed_at? | index `(instance_id, type, state)`; activity-specific payload validated |
| conversations | id, instance_id, match_id?, state, retention_until | optional feature; membership enforced by service |
| conversation_messages | id, conversation_id, sender_participant_id, body_ciphertext, created_at, deleted_at? | optional, private, per-conversation retention; never analytics text input |
| clues | id, instance_id, author_participant_id, recipient_participant_id, text_ciphertext, release_at | pack-gated; plaintext never in analytics |
| recognitions | id, instance_id, author_participant_id, recipient_participant_id, message_ciphertext, visibility, moderation_state | index `(instance_id, moderation_state)`; visibility enforced |
| reveals | id, instance_id, match_id, revealed_at, policy_version | unique `(instance_id, match_id)`; never for never-reveal rules |
| notifications | id, instance_id?, recipient_user_id, channel, template_key, payload_json, state, scheduled_at, delivered_at? | index `(state, scheduled_at)`; no message bodies in queue |
| delivery_attempts | id, notification_id, provider_message_key, state, attempted_at, completed_at? | unique `(notification_id, provider_message_key)`; external send reconciliation |
| r2_objects | id, owner_type, owner_id, object_key, checksum, classification, expires_at? | unique object_key; private access and lifecycle metadata |
| analytics_snapshots | id, instance_id?, metric_version, period_start, period_end, aggregates_json, suppression_json | unique `(instance_id, metric_version, period_start, period_end)` with org-level normalized scope |
| ai_interactions | id, instance_id?, user_id?, purpose, provider_key, model_id, prompt_version, consent_version?, redaction_level, tokens?, cost_estimate?, status, content_expires_at? | index `(organization_id, purpose, created_at)`; sanitized metadata only |
| audit_events | id, actor_user_id?, actor_kind, action, resource_type, resource_id?, purpose, metadata_json, occurred_at | append-only; index `(organization_id, occurred_at)`; restrictive access |
| outbox_events | id, aggregate_type, aggregate_id, event_type, payload_json, occurred_at, available_at, published_at?, attempts, lease_until? | index `(published_at, available_at)`; payload contains references, not PII |
| job_receipts | id, event_id, handler_key, completed_at | unique `(event_id, handler_key)`; idempotent consumer |
| idempotency_keys | id, actor_user_id, route, request_hash, response_ref, expires_at | unique `(organization_id, actor_user_id, route, id)`; TTL cleanup |
| schema_migrations | version, applied_at, checksum | installation-global, exceptions to common fields |

D1 uses SQLite: migrations will enforce real foreign keys, `CHECK` constraints and indexes appropriate to the final queries. Partial unique indexes or normalized scope keys handle SQLite `NULL` uniqueness (notably role grants and org-level analytics). Restrict write transactions to short D1 transactions; use optimistic `revision`/compare-and-swap on state and definitions, not read-modify-write across requests. Pack publications and instance snapshots are size-bounded. Large assets, exports and draft attachments live in private R2 with D1 metadata, owner, checksum, expiry and lifecycle cleanup. Never store AI credentials, OIDC secrets or signing keys in D1/R2.

### Deletion and retention

Withdrawal immediately removes a participant from future processing and hides their personal data; enqueue re-evaluation/remediation. Retention values are installation policy defaults, configured before deployment: magic-link tokens <= 15 minutes; sessions <= 24 hours renewable by rotation; raw AI content not retained by default; derived culture profiles <= 90 days after instance completion; conversation content <= 30 days after completion; audit/security metadata e.g. 365 days if local policy permits. These are proposed defaults, not universal legal requirements. Schedule sweeps for D1 records/R2 objects, legal hold only by explicit admin policy, and export/delete requests with audited outcomes. Aggregates below cohort threshold must be suppressed; small cohorts cannot be reconstructed via filters.

## REST API (`/api/v1`)

Contract-first TypeScript validation generates OpenAPI. All writes consume validated JSON (size limits), reject unknown security-sensitive fields and require `Content-Type: application/json`, a CSRF token for cookie-authenticated unsafe methods, and `Idempotency-Key` for publish/match/launch/send operations. Responses: `{ data, meta: { requestId, revision? } }`; errors: `{ error: { code, message, requestId, details? } }` with stable codes, no sensitive diagnostics. Cursor pagination with bounded limit; ISO UTC and IANA zone fields. Auth via secure, HttpOnly, SameSite=Lax session cookies and Origin+CSRF check; no bearer token stored in browser localStorage. Public auth endpoints use separate strict abuse limits.

| Method + route | Actor | Request / response and behavior |
| --- | --- | --- |
| GET `/health` | deployment monitor | coarse health only; no config/secrets |
| GET `/auth/:provider/start`, GET `/auth/:provider/callback` | anonymous | OIDC Authorization Code + PKCE/state/nonce; callback creates/rotates session and redirects to same-origin allowlist |
| POST `/auth/magic/request`, POST `/auth/magic/consume` | anonymous (feature gated) | fixed response to avoid account enumeration; one-use token by email, rate-limited |
| POST `/auth/logout`, GET `/me` | signed in | revoke session / return role and minimised profile |
| GET/PUT `/admin/config`, GET/PUT `/admin/branding` | admin | validated versioned settings with `If-Match` revision; never return secrets |
| GET/POST `/packs`, GET `/packs/:id/versions/:version`, POST `/packs/import`, POST `/packs/:id/enable`, POST `/packs/:id/retire` | admin (catalog read: designer) | validate/dry-run/install/enable/retire manifests; import cannot publish directly |
| POST `/packs/drafts:generate`, POST `/packs/drafts/:id/validate`, POST `/packs/drafts/:id/publish` | admin/designer draft; admin publish | AI-generated structured draft; diagnostics then reviewed immutable publication |
| GET/POST `/experiences`, GET/PATCH `/experiences/:id` | designer | create/configure reusable definition, optimistic revision |
| POST `/experiences/:id/instances`, GET/PATCH `/instances/:id`, POST `/instances/:id/launch` | designer | configure schedule, snapshot, transition only after validation |
| POST `/instances/:id/enroll`, POST `/instances/:id/withdraw`, GET `/instances/:id/participants/me` | participant | idempotent participation; minimal own profile |
| PUT `/instances/:id/participants/me/preferences`, DELETE `/instances/:id/participants/me/profile` | participant | explicit consent and profile revocation |
| POST `/instances/:id/match-runs`, GET `/instances/:id/match-runs/:runId`, POST `/instances/:id/match-runs/:runId/publish` | designer | asynchronous scoring preview with constraints/fairness report; human-approved publication |
| GET `/instances/:id/my-match`, GET/POST `/instances/:id/activities`, GET/POST `/instances/:id/recognitions` | eligible participant | own assignments and pack-gated actions; access filtered server-side |
| POST `/instances/:id/reveal`, GET `/instances/:id/insights` | designer; participant read only public release | gated reveal; suppressed/aggregated insights for designers |
| POST `/copilot/recommendations`, POST `/instances/:id/communications:draft` | designer | opt-in AI proposals with data classification, schema validation and review required |
| GET `/admin/audit`, POST `/admin/privacy/export`, POST `/admin/privacy/erase` | admin with additional policy | restricted audit and asynchronous verified export/erasure |

Examples of normative payload shapes (not implementation): `POST /experiences/:id/instances` takes `{ name, startsAt, endsAt, timeZone, enrollmentClosesAt, rulesOverride, packConfig }`, returns `{ data: { id, state: "draft", revision } }`; `POST /instances/:id/match-runs` takes `{ strategyKey, strategyVersion, preview: true }`, returns HTTP 202 `{ data: { runId, state: "queued" } }`. `GET /instances/:id/my-match` returns only that participant's permitted peer display fields after publication, never raw profile/score; anonymous modes return a pseudonym until a permitted reveal. AI endpoints return draft artifacts and redaction metadata, not executed changes.

Authorize every read/write using session, org scope, experience grant, participant membership, pack capabilities, current instance state and privacy policy. Reject unsupported actions with a stable conflict/forbidden error; do not hide policy failures in 500s. `If-Match` is required on mutable definitions, status transitions and admin settings. Mutation emits domain event and audit fact atomically with the D1 write and outbox row; notifications and queue processing follow asynchronously.
