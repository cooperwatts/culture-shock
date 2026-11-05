-- Legal holds and privacy request tracking.
--
-- An erasure request must fail closed when a hold is active, so the hold has to
-- be a first-class record rather than an informal process note.

CREATE TABLE legal_holds (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  user_id         TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  reason          TEXT NOT NULL,
  placed_by       TEXT REFERENCES users (id) ON DELETE SET NULL,
  released_by     TEXT REFERENCES users (id) ON DELETE SET NULL,
  released_at     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
-- At most one active hold per person; releasing sets released_at.
CREATE UNIQUE INDEX ux_legal_holds_active ON legal_holds (user_id) WHERE released_at IS NULL;
CREATE INDEX ix_legal_holds_org ON legal_holds (organization_id, released_at);

CREATE TABLE privacy_requests (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  subject_user_id TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('export', 'erase')),
  state           TEXT NOT NULL DEFAULT 'queued'
                  CHECK (state IN ('queued', 'running', 'completed', 'blocked', 'failed')),
  requested_by    TEXT REFERENCES users (id) ON DELETE SET NULL,
  reason          TEXT NOT NULL,
  -- Outcome counts only; never the exported content itself.
  result_json     TEXT NOT NULL DEFAULT '{}',
  object_key      TEXT,
  blocked_reason  TEXT,
  completed_at    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX ix_privacy_requests ON privacy_requests (organization_id, kind, created_at);
CREATE INDEX ix_privacy_requests_subject ON privacy_requests (subject_user_id, state);
