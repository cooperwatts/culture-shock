-- Culture Shock initial schema.
-- D1/SQLite. Identifiers are opaque text; timestamps are UTC ISO-8601 text.
-- Every tenant-owned table carries organization_id so repositories can scope
-- every query, even though one installation hosts one organization today.

PRAGMA foreign_keys = ON;

CREATE TABLE organizations (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  locale        TEXT NOT NULL DEFAULT 'en-CA',
  time_zone     TEXT NOT NULL DEFAULT 'UTC',
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_organizations_slug ON organizations (slug);

CREATE TABLE users (
  id                     TEXT PRIMARY KEY,
  organization_id        TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  status                 TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'deleted')),
  display_name           TEXT,
  -- Work email is encrypted at the application layer; only the keyed HMAC is
  -- indexed, so the database never holds a searchable plaintext address.
  work_email_ciphertext  TEXT,
  work_email_lookup_hmac TEXT,
  key_version            INTEGER,
  deleted_at             TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_users_email_hmac
  ON users (organization_id, work_email_lookup_hmac)
  WHERE work_email_lookup_hmac IS NOT NULL;
CREATE INDEX ix_users_org_status ON users (organization_id, status);

CREATE TABLE identity_providers (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  kind             TEXT NOT NULL CHECK (kind IN ('entra-id', 'google-workspace', 'magic-link')),
  issuer           TEXT,
  client_id        TEXT,
  allowed_domains  TEXT NOT NULL DEFAULT '[]',
  enabled          INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  config_version   INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_identity_providers
  ON identity_providers (organization_id, kind, COALESCE(issuer, ''));

CREATE TABLE identities (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  user_id          TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider_id      TEXT NOT NULL REFERENCES identity_providers (id) ON DELETE RESTRICT,
  provider_subject TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
-- Issuer + subject is the immutable account link; email is never the key.
CREATE UNIQUE INDEX ux_identities_subject ON identities (provider_id, provider_subject);
CREATE INDEX ix_identities_user ON identities (user_id);

CREATE TABLE role_grants (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  user_id          TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role             TEXT NOT NULL,
  scope_type       TEXT NOT NULL CHECK (scope_type IN ('installation', 'experience', 'instance')),
  scope_id         TEXT,
  -- Normalized scope key avoids SQLite's NULL-distinct uniqueness behaviour.
  scope_key        TEXT NOT NULL,
  granted_by       TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_role_grants ON role_grants (user_id, role, scope_type, scope_key);
CREATE INDEX ix_role_grants_scope ON role_grants (organization_id, scope_type, scope_key);

CREATE TABLE sessions (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  user_id          TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash       TEXT NOT NULL,
  csrf_token_hash  TEXT NOT NULL,
  authenticated_at TEXT NOT NULL,
  expires_at       TEXT NOT NULL,
  absolute_expires_at TEXT NOT NULL,
  revoked_at       TEXT,
  last_seen_at     TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_sessions_token ON sessions (token_hash);
CREATE INDEX ix_sessions_expiry ON sessions (expires_at);
CREATE INDEX ix_sessions_user ON sessions (user_id, revoked_at);

CREATE TABLE auth_challenges (
  id                TEXT PRIMARY KEY,
  organization_id   TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  kind              TEXT NOT NULL CHECK (kind IN ('oidc', 'magic_link')),
  state_hash        TEXT,
  code_verifier_enc TEXT,
  nonce_hash        TEXT,
  email_lookup_hmac TEXT,
  token_hash        TEXT,
  redirect_path     TEXT NOT NULL DEFAULT '/',
  attempts          INTEGER NOT NULL DEFAULT 0,
  consumed_at       TEXT,
  expires_at        TEXT NOT NULL,
  created_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_auth_challenges_state ON auth_challenges (state_hash) WHERE state_hash IS NOT NULL;
CREATE UNIQUE INDEX ux_auth_challenges_token ON auth_challenges (token_hash) WHERE token_hash IS NOT NULL;
CREATE INDEX ix_auth_challenges_expiry ON auth_challenges (expires_at);

CREATE TABLE brand_themes (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  revision         INTEGER NOT NULL,
  tokens_json      TEXT NOT NULL,
  asset_keys_json  TEXT NOT NULL DEFAULT '{}',
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'superseded')),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_brand_themes_revision ON brand_themes (organization_id, revision);

CREATE TABLE configurations (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  scope            TEXT NOT NULL CHECK (scope IN ('installation', 'experience', 'instance')),
  scope_key        TEXT NOT NULL DEFAULT '',
  revision         INTEGER NOT NULL,
  schema_version   TEXT NOT NULL,
  config_json      TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'superseded')),
  published_by     TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_configurations ON configurations (organization_id, scope, scope_key, revision);
CREATE INDEX ix_configurations_status ON configurations (organization_id, scope, status);

CREATE TABLE culture_packs (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  slug             TEXT NOT NULL,
  origin           TEXT NOT NULL CHECK (origin IN ('builtin', 'imported', 'generated')),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  enabled          INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  pinned_version   TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_culture_packs_slug ON culture_packs (organization_id, slug);

CREATE TABLE culture_pack_templates (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  pack_id          TEXT NOT NULL REFERENCES culture_packs (id) ON DELETE RESTRICT,
  version          TEXT NOT NULL,
  schema_version   TEXT NOT NULL,
  manifest_json    TEXT NOT NULL,
  checksum         TEXT NOT NULL,
  state            TEXT NOT NULL DEFAULT 'published' CHECK (state IN ('draft', 'published', 'retired')),
  provenance_json  TEXT NOT NULL DEFAULT '{}',
  approved_by      TEXT REFERENCES users (id) ON DELETE SET NULL,
  approved_at      TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
-- Published versions are immutable; retirement changes state, never content.
CREATE UNIQUE INDEX ux_pack_templates_version ON culture_pack_templates (pack_id, version);

CREATE TABLE pack_drafts (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  pack_id          TEXT REFERENCES culture_packs (id) ON DELETE SET NULL,
  author_user_id   TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  source           TEXT NOT NULL CHECK (source IN ('human', 'ai', 'import')),
  manifest_json    TEXT NOT NULL,
  validation_json  TEXT NOT NULL DEFAULT '{}',
  revision         INTEGER NOT NULL DEFAULT 1,
  expires_at       TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX ix_pack_drafts_author ON pack_drafts (organization_id, author_user_id);

CREATE TABLE experiences (
  id                TEXT PRIMARY KEY,
  organization_id   TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  designer_user_id  TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  name              TEXT NOT NULL,
  description       TEXT,
  current_revision  INTEGER NOT NULL DEFAULT 1,
  state             TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'validated', 'ready', 'archived')),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX ix_experiences_org_state ON experiences (organization_id, state);

CREATE TABLE experience_revisions (
  id                TEXT PRIMARY KEY,
  organization_id   TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  experience_id     TEXT NOT NULL REFERENCES experiences (id) ON DELETE CASCADE,
  revision          INTEGER NOT NULL,
  pack_template_id  TEXT NOT NULL REFERENCES culture_pack_templates (id) ON DELETE RESTRICT,
  definition_json   TEXT NOT NULL,
  created_by        TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_experience_revisions ON experience_revisions (experience_id, revision);

CREATE TABLE experience_instances (
  id                   TEXT PRIMARY KEY,
  organization_id      TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  experience_id        TEXT NOT NULL REFERENCES experiences (id) ON DELETE RESTRICT,
  experience_revision  INTEGER NOT NULL,
  pack_template_id     TEXT NOT NULL REFERENCES culture_pack_templates (id) ON DELETE RESTRICT,
  name                 TEXT NOT NULL,
  -- Immutable launch snapshot: later pack or config edits cannot change a live run.
  snapshot_json        TEXT NOT NULL,
  state                TEXT NOT NULL DEFAULT 'draft'
                       CHECK (state IN ('draft', 'enrolling', 'locked', 'active', 'reveal_pending', 'completed', 'cancelled', 'archived')),
  time_zone            TEXT NOT NULL DEFAULT 'UTC',
  enrollment_close_at  TEXT,
  start_at             TEXT,
  end_at               TEXT,
  published_at         TEXT,
  revision             INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX ix_instances_schedule ON experience_instances (organization_id, state, start_at);
CREATE INDEX ix_instances_experience ON experience_instances (experience_id);

CREATE TABLE participants (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  instance_id      TEXT NOT NULL REFERENCES experience_instances (id) ON DELETE CASCADE,
  user_id          TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'enrolled', 'withdrawn', 'excluded')),
  joined_at        TEXT,
  withdrawn_at     TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_participants_user ON participants (instance_id, user_id);
CREATE INDEX ix_participants_status ON participants (instance_id, status);

CREATE TABLE participant_profiles (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  participant_id   TEXT NOT NULL REFERENCES participants (id) ON DELETE CASCADE,
  revision         INTEGER NOT NULL,
  preferences_json TEXT NOT NULL,
  consent_json     TEXT NOT NULL DEFAULT '{}',
  consent_version  TEXT NOT NULL,
  expires_at       TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_participant_profiles ON participant_profiles (participant_id, revision);

CREATE TABLE culture_profiles (
  id                  TEXT PRIMARY KEY,
  organization_id     TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  participant_id      TEXT NOT NULL REFERENCES participants (id) ON DELETE CASCADE,
  version             INTEGER NOT NULL,
  derived_traits_json TEXT NOT NULL,
  provenance_json     TEXT NOT NULL,
  consent_version     TEXT NOT NULL,
  expires_at          TEXT NOT NULL,
  revoked_at          TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX ix_culture_profiles_active ON culture_profiles (participant_id, revoked_at);
CREATE INDEX ix_culture_profiles_expiry ON culture_profiles (expires_at);

CREATE TABLE rule_sets (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  instance_id      TEXT NOT NULL REFERENCES experience_instances (id) ON DELETE CASCADE,
  version          INTEGER NOT NULL,
  rules_json       TEXT NOT NULL,
  checksum         TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_rule_sets ON rule_sets (instance_id, version);

CREATE TABLE matching_strategies (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  instance_id      TEXT NOT NULL REFERENCES experience_instances (id) ON DELETE CASCADE,
  version          INTEGER NOT NULL,
  strategy_key     TEXT NOT NULL,
  strategy_version TEXT NOT NULL,
  weights_json     TEXT NOT NULL DEFAULT '{}',
  constraints_json TEXT NOT NULL DEFAULT '{}',
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_matching_strategies ON matching_strategies (instance_id, version);

CREATE TABLE match_runs (
  id                TEXT PRIMARY KEY,
  organization_id   TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  instance_id       TEXT NOT NULL REFERENCES experience_instances (id) ON DELETE CASCADE,
  strategy_id       TEXT NOT NULL REFERENCES matching_strategies (id) ON DELETE RESTRICT,
  input_hash        TEXT NOT NULL,
  state             TEXT NOT NULL DEFAULT 'queued'
                    CHECK (state IN ('queued', 'running', 'preview', 'published', 'failed', 'cancelled')),
  diagnostics_json  TEXT NOT NULL DEFAULT '{}',
  fairness_json     TEXT NOT NULL DEFAULT '{}',
  approved_by       TEXT REFERENCES users (id) ON DELETE SET NULL,
  published_at      TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
-- Idempotent runs: the same snapshot and strategy can only produce one run.
CREATE UNIQUE INDEX ux_match_runs_input ON match_runs (instance_id, input_hash, strategy_id);
-- At most one published run per instance, enforced in SQL rather than by convention.
CREATE UNIQUE INDEX ux_match_runs_published ON match_runs (instance_id) WHERE state = 'published';

CREATE TABLE matches (
  id                    TEXT PRIMARY KEY,
  organization_id       TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  run_id                TEXT NOT NULL REFERENCES match_runs (id) ON DELETE CASCADE,
  instance_id           TEXT NOT NULL REFERENCES experience_instances (id) ON DELETE CASCADE,
  group_key             TEXT NOT NULL,
  state                 TEXT NOT NULL DEFAULT 'proposed'
                        CHECK (state IN ('proposed', 'published', 'remediated', 'void')),
  score                 REAL NOT NULL DEFAULT 0,
  -- Stable codes only; rationale never contains participant attributes.
  rationale_codes_json  TEXT NOT NULL DEFAULT '[]',
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_matches_group ON matches (run_id, group_key);
CREATE INDEX ix_matches_instance ON matches (instance_id, run_id);

CREATE TABLE match_members (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  match_id        TEXT NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
  run_id          TEXT NOT NULL REFERENCES match_runs (id) ON DELETE CASCADE,
  participant_id  TEXT NOT NULL REFERENCES participants (id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'member',
  created_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_match_members ON match_members (match_id, participant_id);
-- Denormalized run_id makes "one group per participant per run" enforceable.
CREATE UNIQUE INDEX ux_match_members_run ON match_members (run_id, participant_id);

CREATE TABLE missions (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  instance_id     TEXT NOT NULL REFERENCES experience_instances (id) ON DELETE CASCADE,
  mission_key     TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  state           TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'closed')),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_missions_key ON missions (instance_id, mission_key);

CREATE TABLE activities (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  instance_id     TEXT NOT NULL REFERENCES experience_instances (id) ON DELETE CASCADE,
  mission_id      TEXT REFERENCES missions (id) ON DELETE SET NULL,
  participant_id  TEXT REFERENCES participants (id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  state           TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'completed', 'skipped', 'expired')),
  payload_json    TEXT NOT NULL DEFAULT '{}',
  completed_at    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX ix_activities_instance ON activities (instance_id, type, state);
CREATE INDEX ix_activities_participant ON activities (participant_id, state);

CREATE TABLE conversations (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  instance_id     TEXT NOT NULL REFERENCES experience_instances (id) ON DELETE CASCADE,
  match_id        TEXT REFERENCES matches (id) ON DELETE SET NULL,
  state           TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed')),
  retention_until TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX ix_conversations_retention ON conversations (retention_until);

CREATE TABLE conversation_messages (
  id                    TEXT PRIMARY KEY,
  organization_id       TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  conversation_id       TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  sender_participant_id TEXT NOT NULL REFERENCES participants (id) ON DELETE CASCADE,
  -- Message bodies are encrypted at the application layer and never analysed.
  body_ciphertext       TEXT NOT NULL,
  key_version           INTEGER NOT NULL,
  deleted_at            TEXT,
  created_at            TEXT NOT NULL
);
CREATE INDEX ix_conversation_messages ON conversation_messages (conversation_id, created_at);

CREATE TABLE clues (
  id                       TEXT PRIMARY KEY,
  organization_id          TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  instance_id              TEXT NOT NULL REFERENCES experience_instances (id) ON DELETE CASCADE,
  author_participant_id    TEXT NOT NULL REFERENCES participants (id) ON DELETE CASCADE,
  recipient_participant_id TEXT NOT NULL REFERENCES participants (id) ON DELETE CASCADE,
  text_ciphertext          TEXT NOT NULL,
  key_version              INTEGER NOT NULL,
  release_at               TEXT NOT NULL,
  created_at               TEXT NOT NULL
);
CREATE INDEX ix_clues_release ON clues (instance_id, release_at);

CREATE TABLE recognitions (
  id                       TEXT PRIMARY KEY,
  organization_id          TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  instance_id              TEXT NOT NULL REFERENCES experience_instances (id) ON DELETE CASCADE,
  author_participant_id    TEXT NOT NULL REFERENCES participants (id) ON DELETE CASCADE,
  recipient_participant_id TEXT NOT NULL REFERENCES participants (id) ON DELETE CASCADE,
  message_ciphertext       TEXT NOT NULL,
  key_version              INTEGER NOT NULL,
  visibility               TEXT NOT NULL DEFAULT 'recipient_only'
                           CHECK (visibility IN ('private', 'recipient_only', 'team', 'organization')),
  moderation_state         TEXT NOT NULL DEFAULT 'pending'
                           CHECK (moderation_state IN ('pending', 'approved', 'rejected')),
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL
);
CREATE INDEX ix_recognitions_moderation ON recognitions (instance_id, moderation_state);
CREATE INDEX ix_recognitions_recipient ON recognitions (recipient_participant_id);

CREATE TABLE reveals (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  instance_id     TEXT NOT NULL REFERENCES experience_instances (id) ON DELETE CASCADE,
  match_id        TEXT NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
  policy_version  TEXT NOT NULL,
  revealed_at     TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_reveals ON reveals (instance_id, match_id);

CREATE TABLE notifications (
  id                TEXT PRIMARY KEY,
  organization_id   TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  instance_id       TEXT REFERENCES experience_instances (id) ON DELETE CASCADE,
  recipient_user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  channel           TEXT NOT NULL CHECK (channel IN ('email', 'in_app')),
  template_key      TEXT NOT NULL,
  locale            TEXT NOT NULL DEFAULT 'en-CA',
  -- References and tokens only; rendered bodies are produced at send time.
  payload_json      TEXT NOT NULL DEFAULT '{}',
  state             TEXT NOT NULL DEFAULT 'scheduled'
                    CHECK (state IN ('scheduled', 'sending', 'delivered', 'failed', 'cancelled', 'suppressed')),
  scheduled_at      TEXT NOT NULL,
  delivered_at      TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX ix_notifications_due ON notifications (state, scheduled_at);
CREATE INDEX ix_notifications_recipient ON notifications (recipient_user_id, created_at);

CREATE TABLE delivery_attempts (
  id                   TEXT PRIMARY KEY,
  organization_id      TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  notification_id      TEXT NOT NULL REFERENCES notifications (id) ON DELETE CASCADE,
  provider_message_key TEXT NOT NULL,
  state                TEXT NOT NULL CHECK (state IN ('pending', 'sent', 'failed')),
  error_code           TEXT,
  attempted_at         TEXT NOT NULL,
  completed_at         TEXT
);
-- Provider idempotency key; duplicates are reconciled rather than claimed impossible.
CREATE UNIQUE INDEX ux_delivery_attempts ON delivery_attempts (notification_id, provider_message_key);

CREATE TABLE r2_objects (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  owner_type      TEXT NOT NULL,
  owner_id        TEXT,
  object_key      TEXT NOT NULL,
  content_type    TEXT NOT NULL,
  byte_size       INTEGER NOT NULL,
  checksum        TEXT NOT NULL,
  classification  TEXT NOT NULL CHECK (classification IN ('public', 'internal', 'confidential', 'participant_sensitive')),
  expires_at      TEXT,
  created_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_r2_objects_key ON r2_objects (object_key);
CREATE INDEX ix_r2_objects_expiry ON r2_objects (expires_at);

CREATE TABLE analytics_snapshots (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  instance_id      TEXT REFERENCES experience_instances (id) ON DELETE CASCADE,
  scope_key        TEXT NOT NULL DEFAULT '',
  metric_version   TEXT NOT NULL,
  period_start     TEXT NOT NULL,
  period_end       TEXT NOT NULL,
  aggregates_json  TEXT NOT NULL,
  suppression_json TEXT NOT NULL DEFAULT '{}',
  created_at       TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_analytics_snapshots
  ON analytics_snapshots (organization_id, scope_key, metric_version, period_start, period_end);

CREATE TABLE ai_interactions (
  id                 TEXT PRIMARY KEY,
  organization_id    TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  instance_id        TEXT REFERENCES experience_instances (id) ON DELETE SET NULL,
  user_id            TEXT REFERENCES users (id) ON DELETE SET NULL,
  purpose            TEXT NOT NULL,
  provider_key       TEXT NOT NULL,
  model_id           TEXT NOT NULL,
  prompt_version     TEXT NOT NULL,
  consent_version    TEXT,
  redaction_level    TEXT NOT NULL,
  input_tokens       INTEGER,
  output_tokens      INTEGER,
  cost_estimate_usd  REAL,
  status             TEXT NOT NULL CHECK (status IN ('succeeded', 'failed', 'blocked')),
  error_code         TEXT,
  -- Raw prompts and completions are not retained by default.
  content_ref        TEXT,
  content_expires_at TEXT,
  created_at         TEXT NOT NULL
);
CREATE INDEX ix_ai_interactions ON ai_interactions (organization_id, purpose, created_at);

CREATE TABLE audit_events (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  actor_user_id   TEXT REFERENCES users (id) ON DELETE SET NULL,
  actor_kind      TEXT NOT NULL CHECK (actor_kind IN ('user', 'system', 'job', 'ai')),
  action          TEXT NOT NULL,
  resource_type   TEXT NOT NULL,
  resource_id     TEXT,
  purpose         TEXT NOT NULL DEFAULT 'operation',
  metadata_json   TEXT NOT NULL DEFAULT '{}',
  occurred_at     TEXT NOT NULL
);
CREATE INDEX ix_audit_events ON audit_events (organization_id, occurred_at);
CREATE INDEX ix_audit_events_resource ON audit_events (resource_type, resource_id);

CREATE TABLE outbox_events (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  aggregate_type  TEXT NOT NULL,
  aggregate_id    TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  -- References only; participant data never travels through the queue.
  payload_json    TEXT NOT NULL DEFAULT '{}',
  occurred_at     TEXT NOT NULL,
  available_at    TEXT NOT NULL,
  published_at    TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  lease_until     TEXT,
  last_error      TEXT
);
CREATE INDEX ix_outbox_pending ON outbox_events (published_at, available_at);
CREATE INDEX ix_outbox_aggregate ON outbox_events (aggregate_type, aggregate_id);

CREATE TABLE job_receipts (
  id           TEXT PRIMARY KEY,
  event_id     TEXT NOT NULL,
  handler_key  TEXT NOT NULL,
  completed_at TEXT NOT NULL
);
-- Consumers are at-least-once; the receipt makes handlers idempotent.
CREATE UNIQUE INDEX ux_job_receipts ON job_receipts (event_id, handler_key);

CREATE TABLE idempotency_keys (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  actor_user_id   TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  route           TEXT NOT NULL,
  request_hash    TEXT NOT NULL,
  response_ref    TEXT,
  status_code     INTEGER,
  expires_at      TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_idempotency_keys ON idempotency_keys (organization_id, actor_user_id, route, id);
CREATE INDEX ix_idempotency_expiry ON idempotency_keys (expires_at);

CREATE TABLE rate_limit_counters (
  id          TEXT PRIMARY KEY,
  bucket_key  TEXT NOT NULL,
  window_start TEXT NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_rate_limit_counters ON rate_limit_counters (bucket_key, window_start);
CREATE INDEX ix_rate_limit_expiry ON rate_limit_counters (expires_at);
