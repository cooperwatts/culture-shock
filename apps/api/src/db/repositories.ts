import {
  newId,
  notFound,
  type ExperienceId,
  type ExperienceInstanceId,
  type InstallationRole,
  type OrganizationId,
  type ParticipantId,
  type UserId,
} from "@culture-shock/domain";
import { Database, nowIso, parseJson, type SqlValue } from "./database.js";

/* --------------------------------------------------------------- organization */

export interface OrganizationRow {
  id: string;
  slug: string;
  display_name: string;
  locale: string;
  time_zone: string;
  status: string;
}

export async function findActiveOrganization(
  db: D1Database,
): Promise<OrganizationRow | null> {
  return db
    .prepare(
      `SELECT id, slug, display_name, locale, time_zone, status FROM organizations WHERE status = 'active' LIMIT 1`,
    )
    .first<OrganizationRow>();
}

/* ----------------------------------------------------------------------- users */

export interface UserRow {
  id: string;
  status: string;
  display_name: string | null;
  work_email_ciphertext: string | null;
}

export class UserRepository {
  constructor(private readonly db: Database) {}

  async findById(userId: UserId): Promise<UserRow | null> {
    return this.db.first<UserRow>(
      `SELECT id, status, display_name, work_email_ciphertext
         FROM users WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
      [userId, this.db.organizationId],
    );
  }

  async findByEmailHmac(hmac: string): Promise<UserRow | null> {
    return this.db.first<UserRow>(
      `SELECT id, status, display_name, work_email_ciphertext
         FROM users WHERE work_email_lookup_hmac = ? AND organization_id = ? AND deleted_at IS NULL`,
      [hmac, this.db.organizationId],
    );
  }

  /** Resolves a user from the immutable issuer+subject link, never from email. */
  async findByProviderSubject(
    providerId: string,
    subject: string,
  ): Promise<UserRow | null> {
    return this.db.first<UserRow>(
      `SELECT u.id, u.status, u.display_name, u.work_email_ciphertext
         FROM identities i
         JOIN users u ON u.id = i.user_id
        WHERE i.provider_id = ? AND i.provider_subject = ? AND u.organization_id = ? AND u.deleted_at IS NULL`,
      [providerId, subject, this.db.organizationId],
    );
  }

  async createWithIdentity(input: {
    providerId: string;
    subject: string;
    displayName: string | null;
    emailCiphertext: string | null;
    emailHmac: string | null;
    keyVersion: number | null;
    defaultRole: InstallationRole;
  }): Promise<UserId> {
    const userId = newId("UserId");
    const timestamp = nowIso();

    await this.db.commit(
      [
        this.db.statement(
          `INSERT INTO users
             (id, organization_id, status, display_name, work_email_ciphertext, work_email_lookup_hmac, key_version, created_at, updated_at)
           VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
          [
            userId,
            this.db.organizationId,
            input.displayName,
            input.emailCiphertext,
            input.emailHmac,
            input.keyVersion,
            timestamp,
            timestamp,
          ],
        ),
        this.db.statement(
          `INSERT INTO identities (id, organization_id, user_id, provider_id, provider_subject, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            newId("IdentityId"),
            this.db.organizationId,
            userId,
            input.providerId,
            input.subject,
            timestamp,
            timestamp,
          ],
        ),
        this.db.statement(
          `INSERT INTO role_grants (id, organization_id, user_id, role, scope_type, scope_id, scope_key, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'installation', NULL, '', ?, ?)`,
          [
            newId("RoleGrantId"),
            this.db.organizationId,
            userId,
            input.defaultRole,
            timestamp,
            timestamp,
          ],
        ),
      ],
      {
        actorUserId: null,
        actorKind: "system",
        action: "user.provisioned",
        resourceType: "user",
        resourceId: userId,
        purpose: "authentication",
        metadata: { providerId: input.providerId, role: input.defaultRole },
      },
    );

    return userId as UserId;
  }

  async installationRoles(userId: UserId): Promise<InstallationRole[]> {
    const rows = await this.db.all<{ role: string }>(
      `SELECT role FROM role_grants
        WHERE user_id = ? AND organization_id = ? AND scope_type = 'installation'`,
      [userId, this.db.organizationId],
    );
    return rows.map((row) => row.role as InstallationRole);
  }

  async experienceGrants(
    userId: UserId,
  ): Promise<Array<{ experienceId: ExperienceId; role: string }>> {
    const rows = await this.db.all<{ scope_id: string; role: string }>(
      `SELECT scope_id, role FROM role_grants
        WHERE user_id = ? AND organization_id = ? AND scope_type = 'experience' AND scope_id IS NOT NULL`,
      [userId, this.db.organizationId],
    );
    return rows.map((row) => ({
      experienceId: row.scope_id as ExperienceId,
      role: row.role,
    }));
  }
}

/* -------------------------------------------------------------------- sessions */

export interface SessionRow {
  id: string;
  user_id: string;
  csrf_token_hash: string;
  authenticated_at: string;
  expires_at: string;
  absolute_expires_at: string;
  revoked_at: string | null;
}

export class SessionRepository {
  constructor(private readonly db: Database) {}

  async create(input: {
    userId: UserId;
    tokenHash: string;
    csrfTokenHash: string;
    ttlSeconds: number;
    absoluteTtlSeconds: number;
  }): Promise<string> {
    const id = newId("SessionId");
    const timestamp = nowIso();
    await this.db.run(
      `INSERT INTO sessions
         (id, organization_id, user_id, token_hash, csrf_token_hash, authenticated_at, expires_at, absolute_expires_at, last_seen_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        this.db.organizationId,
        input.userId,
        input.tokenHash,
        input.csrfTokenHash,
        timestamp,
        new Date(Date.now() + input.ttlSeconds * 1000).toISOString(),
        new Date(Date.now() + input.absoluteTtlSeconds * 1000).toISOString(),
        timestamp,
        timestamp,
        timestamp,
      ],
    );
    return id;
  }

  async findByTokenHash(tokenHash: string): Promise<SessionRow | null> {
    return this.db.first<SessionRow>(
      `SELECT id, user_id, csrf_token_hash, authenticated_at, expires_at, absolute_expires_at, revoked_at
         FROM sessions WHERE token_hash = ? AND organization_id = ?`,
      [tokenHash, this.db.organizationId],
    );
  }

  async touch(sessionId: string, ttlSeconds: number): Promise<void> {
    const timestamp = nowIso();
    await this.db.run(
      `UPDATE sessions
          SET last_seen_at = ?, updated_at = ?,
              expires_at = MIN(?, absolute_expires_at)
        WHERE id = ? AND organization_id = ?`,
      [
        timestamp,
        timestamp,
        new Date(Date.now() + ttlSeconds * 1000).toISOString(),
        sessionId,
        this.db.organizationId,
      ],
    );
  }

  async revoke(sessionId: string): Promise<void> {
    const timestamp = nowIso();
    await this.db.run(
      `UPDATE sessions SET revoked_at = ?, updated_at = ? WHERE id = ? AND organization_id = ? AND revoked_at IS NULL`,
      [timestamp, timestamp, sessionId, this.db.organizationId],
    );
  }

  async revokeAllForUser(userId: UserId): Promise<void> {
    const timestamp = nowIso();
    await this.db.run(
      `UPDATE sessions SET revoked_at = ?, updated_at = ? WHERE user_id = ? AND organization_id = ? AND revoked_at IS NULL`,
      [timestamp, timestamp, userId, this.db.organizationId],
    );
  }
}

/* --------------------------------------------------------------- configuration */

export class ConfigurationRepository {
  constructor(private readonly db: Database) {}

  async published(): Promise<{ revision: number; config: unknown } | null> {
    const row = await this.db.first<{ revision: number; config_json: string }>(
      `SELECT revision, config_json FROM configurations
        WHERE organization_id = ? AND scope = 'installation' AND status = 'published'
        ORDER BY revision DESC LIMIT 1`,
      [this.db.organizationId],
    );
    return row
      ? {
          revision: row.revision,
          config: parseJson<unknown>(row.config_json, null),
        }
      : null;
  }

  /**
   * Publishes a new immutable revision. The compare-and-swap on the expected
   * revision prevents two administrators silently overwriting each other.
   */
  async publish(input: {
    expectedRevision: number;
    schemaVersion: string;
    config: unknown;
    actorUserId: UserId;
  }): Promise<number> {
    const current = await this.published();
    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== input.expectedRevision) {
      throw new Error("revision_mismatch");
    }
    const revision = currentRevision + 1;
    const timestamp = nowIso();

    await this.db.commit(
      [
        this.db.statement(
          `UPDATE configurations SET status = 'superseded', updated_at = ?
            WHERE organization_id = ? AND scope = 'installation' AND status = 'published'`,
          [timestamp, this.db.organizationId],
        ),
        this.db.statement(
          `INSERT INTO configurations
             (id, organization_id, scope, scope_key, revision, schema_version, config_json, status, published_by, created_at, updated_at)
           VALUES (?, ?, 'installation', '', ?, ?, ?, 'published', ?, ?, ?)`,
          [
            newId("ConfigurationId"),
            this.db.organizationId,
            revision,
            input.schemaVersion,
            JSON.stringify(input.config),
            input.actorUserId,
            timestamp,
            timestamp,
          ],
        ),
      ],
      {
        actorUserId: input.actorUserId,
        actorKind: "user",
        action: "configuration.published",
        resourceType: "configuration",
        resourceId: null,
        purpose: "administration",
        metadata: { revision },
      },
    );

    return revision;
  }
}

/* ---------------------------------------------------------------------- packs */

export interface PackRow {
  id: string;
  slug: string;
  origin: string;
  status: string;
  enabled: number;
  pinned_version: string | null;
}

export interface PackTemplateRow {
  id: string;
  pack_id: string;
  version: string;
  schema_version: string;
  manifest_json: string;
  checksum: string;
  state: string;
}

export class PackRepository {
  constructor(private readonly db: Database) {}

  async list(): Promise<PackRow[]> {
    return this.db.all<PackRow>(
      `SELECT id, slug, origin, status, enabled, pinned_version
         FROM culture_packs WHERE organization_id = ? ORDER BY slug`,
      [this.db.organizationId],
    );
  }

  async findBySlug(slug: string): Promise<PackRow | null> {
    return this.db.first<PackRow>(
      `SELECT id, slug, origin, status, enabled, pinned_version
         FROM culture_packs WHERE organization_id = ? AND slug = ?`,
      [this.db.organizationId, slug],
    );
  }

  async latestPublishedTemplate(
    packId: string,
  ): Promise<PackTemplateRow | null> {
    return this.db.first<PackTemplateRow>(
      `SELECT id, pack_id, version, schema_version, manifest_json, checksum, state
         FROM culture_pack_templates
        WHERE organization_id = ? AND pack_id = ? AND state = 'published'
        ORDER BY version DESC LIMIT 1`,
      [this.db.organizationId, packId],
    );
  }

  async templateByVersion(
    packId: string,
    version: string,
  ): Promise<PackTemplateRow | null> {
    return this.db.first<PackTemplateRow>(
      `SELECT id, pack_id, version, schema_version, manifest_json, checksum, state
         FROM culture_pack_templates
        WHERE organization_id = ? AND pack_id = ? AND version = ?`,
      [this.db.organizationId, packId, version],
    );
  }

  async templateById(templateId: string): Promise<PackTemplateRow | null> {
    return this.db.first<PackTemplateRow>(
      `SELECT id, pack_id, version, schema_version, manifest_json, checksum, state
         FROM culture_pack_templates WHERE organization_id = ? AND id = ?`,
      [this.db.organizationId, templateId],
    );
  }

  /** Publishing is append-only: an existing version is never rewritten. */
  async publishTemplate(input: {
    packId: string;
    version: string;
    schemaVersion: string;
    manifest: unknown;
    checksum: string;
    provenance: unknown;
    actorUserId: UserId | null;
  }): Promise<string> {
    const existing = await this.templateByVersion(input.packId, input.version);
    if (existing) throw new Error("version_exists");

    const id = newId("CulturePackTemplateId");
    const timestamp = nowIso();
    await this.db.commit(
      [
        this.db.statement(
          `INSERT INTO culture_pack_templates
             (id, organization_id, pack_id, version, schema_version, manifest_json, checksum, state, provenance_json, approved_by, approved_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?, ?)`,
          [
            id,
            this.db.organizationId,
            input.packId,
            input.version,
            input.schemaVersion,
            JSON.stringify(input.manifest),
            input.checksum,
            JSON.stringify(input.provenance),
            input.actorUserId,
            input.actorUserId ? timestamp : null,
            timestamp,
            timestamp,
          ],
        ),
      ],
      {
        actorUserId: input.actorUserId,
        actorKind: input.actorUserId ? "user" : "system",
        action: "pack_template.published",
        resourceType: "culture_pack_template",
        resourceId: id,
        purpose: "pack_catalog",
        metadata: { version: input.version, checksum: input.checksum },
      },
    );
    return id;
  }

  async upsertPack(input: { slug: string; origin: string }): Promise<string> {
    const existing = await this.findBySlug(input.slug);
    if (existing) return existing.id;
    const id = newId("CulturePackId");
    const timestamp = nowIso();
    await this.db.run(
      `INSERT INTO culture_packs (id, organization_id, slug, origin, status, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', 0, ?, ?)`,
      [
        id,
        this.db.organizationId,
        input.slug,
        input.origin,
        timestamp,
        timestamp,
      ],
    );
    return id;
  }

  async setEnabled(
    packId: string,
    enabled: boolean,
    actorUserId: UserId,
  ): Promise<void> {
    const timestamp = nowIso();
    await this.db.commit(
      [
        this.db.statement(
          `UPDATE culture_packs SET enabled = ?, updated_at = ? WHERE id = ? AND organization_id = ?`,
          [enabled ? 1 : 0, timestamp, packId, this.db.organizationId],
        ),
      ],
      {
        actorUserId,
        actorKind: "user",
        action: enabled ? "pack.enabled" : "pack.disabled",
        resourceType: "culture_pack",
        resourceId: packId,
        purpose: "pack_catalog",
      },
    );
  }

  /** Retirement hides a pack from new instances but preserves live references. */
  async retire(packId: string, actorUserId: UserId): Promise<void> {
    const timestamp = nowIso();
    await this.db.commit(
      [
        this.db.statement(
          `UPDATE culture_packs SET status = 'retired', enabled = 0, updated_at = ? WHERE id = ? AND organization_id = ?`,
          [timestamp, packId, this.db.organizationId],
        ),
      ],
      {
        actorUserId,
        actorKind: "user",
        action: "pack.retired",
        resourceType: "culture_pack",
        resourceId: packId,
        purpose: "pack_catalog",
      },
    );
  }
}

/* ---------------------------------------------------------------- experiences */

export interface ExperienceRow {
  id: string;
  name: string;
  description: string | null;
  designer_user_id: string;
  current_revision: number;
  state: string;
  updated_at: string;
}

export interface ExperienceRevisionRow {
  revision: number;
  pack_template_id: string;
  definition_json: string;
}

export class ExperienceRepository {
  constructor(private readonly db: Database) {}

  async list(limit: number, cursor: string | null): Promise<ExperienceRow[]> {
    const params: SqlValue[] = [this.db.organizationId];
    let sql = `SELECT id, name, description, designer_user_id, current_revision, state, updated_at
                 FROM experiences WHERE organization_id = ?`;
    if (cursor) {
      sql += ` AND id < ?`;
      params.push(cursor);
    }
    sql += ` ORDER BY id DESC LIMIT ?`;
    params.push(limit);
    return this.db.all<ExperienceRow>(sql, params);
  }

  async findById(experienceId: ExperienceId): Promise<ExperienceRow | null> {
    return this.db.first<ExperienceRow>(
      `SELECT id, name, description, designer_user_id, current_revision, state, updated_at
         FROM experiences WHERE id = ? AND organization_id = ?`,
      [experienceId, this.db.organizationId],
    );
  }

  async requireById(experienceId: ExperienceId): Promise<ExperienceRow> {
    const row = await this.findById(experienceId);
    if (!row) throw notFound("Experience not found");
    return row;
  }

  async currentRevision(
    experienceId: ExperienceId,
  ): Promise<ExperienceRevisionRow | null> {
    return this.db.first<ExperienceRevisionRow>(
      `SELECT revision, pack_template_id, definition_json
         FROM experience_revisions
        WHERE experience_id = ? AND organization_id = ?
        ORDER BY revision DESC LIMIT 1`,
      [experienceId, this.db.organizationId],
    );
  }

  async create(input: {
    name: string;
    description: string | null;
    designerUserId: UserId;
    packTemplateId: string;
    definition: unknown;
  }): Promise<ExperienceId> {
    const id = newId("ExperienceId");
    const timestamp = nowIso();
    await this.db.commit(
      [
        this.db.statement(
          `INSERT INTO experiences
             (id, organization_id, designer_user_id, name, description, current_revision, state, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, 'draft', ?, ?)`,
          [
            id,
            this.db.organizationId,
            input.designerUserId,
            input.name,
            input.description,
            timestamp,
            timestamp,
          ],
        ),
        this.db.statement(
          `INSERT INTO experience_revisions
             (id, organization_id, experience_id, revision, pack_template_id, definition_json, created_by, created_at, updated_at)
           VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`,
          [
            newId("ExperienceId"),
            this.db.organizationId,
            id,
            input.packTemplateId,
            JSON.stringify(input.definition),
            input.designerUserId,
            timestamp,
            timestamp,
          ],
        ),
        this.db.statement(
          `INSERT INTO role_grants (id, organization_id, user_id, role, scope_type, scope_id, scope_key, created_at, updated_at)
           VALUES (?, ?, ?, 'experience_owner', 'experience', ?, ?, ?, ?)`,
          [
            newId("RoleGrantId"),
            this.db.organizationId,
            input.designerUserId,
            id,
            id,
            timestamp,
            timestamp,
          ],
        ),
      ],
      {
        actorUserId: input.designerUserId,
        actorKind: "user",
        action: "experience.created",
        resourceType: "experience",
        resourceId: id,
        purpose: "experience_design",
      },
    );
    return id as ExperienceId;
  }

  /** Optimistic update: the caller's `If-Match` revision must still be current. */
  async update(input: {
    experienceId: ExperienceId;
    expectedRevision: number;
    name?: string;
    description?: string | null;
    definition?: unknown;
    packTemplateId: string;
    actorUserId: UserId;
  }): Promise<number> {
    const nextRevision = input.expectedRevision + 1;
    const timestamp = nowIso();

    const result = await this.db.run(
      `UPDATE experiences
          SET name = COALESCE(?, name),
              description = COALESCE(?, description),
              current_revision = ?,
              updated_at = ?
        WHERE id = ? AND organization_id = ? AND current_revision = ?`,
      [
        input.name ?? null,
        input.description ?? null,
        nextRevision,
        timestamp,
        input.experienceId,
        this.db.organizationId,
        input.expectedRevision,
      ],
    );

    if ((result.meta.changes ?? 0) === 0) throw new Error("revision_mismatch");

    await this.db.commit(
      [
        this.db.statement(
          `INSERT INTO experience_revisions
             (id, organization_id, experience_id, revision, pack_template_id, definition_json, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            newId("ExperienceId"),
            this.db.organizationId,
            input.experienceId,
            nextRevision,
            input.packTemplateId,
            JSON.stringify(input.definition ?? {}),
            input.actorUserId,
            timestamp,
            timestamp,
          ],
        ),
      ],
      {
        actorUserId: input.actorUserId,
        actorKind: "user",
        action: "experience.updated",
        resourceType: "experience",
        resourceId: input.experienceId,
        purpose: "experience_design",
        metadata: { revision: nextRevision },
      },
    );

    return nextRevision;
  }
}

/* ------------------------------------------------------------------ instances */

export interface InstanceRow {
  id: string;
  experience_id: string;
  experience_revision: number;
  pack_template_id: string;
  name: string;
  snapshot_json: string;
  state: string;
  time_zone: string;
  enrollment_close_at: string | null;
  start_at: string | null;
  end_at: string | null;
  published_at: string | null;
  revision: number;
}

export class InstanceRepository {
  constructor(private readonly db: Database) {}

  async findById(
    instanceId: ExperienceInstanceId,
  ): Promise<InstanceRow | null> {
    return this.db.first<InstanceRow>(
      `SELECT id, experience_id, experience_revision, pack_template_id, name, snapshot_json, state,
              time_zone, enrollment_close_at, start_at, end_at, published_at, revision
         FROM experience_instances WHERE id = ? AND organization_id = ?`,
      [instanceId, this.db.organizationId],
    );
  }

  async requireById(instanceId: ExperienceInstanceId): Promise<InstanceRow> {
    const row = await this.findById(instanceId);
    if (!row) throw notFound("Experience instance not found");
    return row;
  }

  async listForExperience(experienceId: ExperienceId): Promise<InstanceRow[]> {
    return this.db.all<InstanceRow>(
      `SELECT id, experience_id, experience_revision, pack_template_id, name, snapshot_json, state,
              time_zone, enrollment_close_at, start_at, end_at, published_at, revision
         FROM experience_instances WHERE experience_id = ? AND organization_id = ? ORDER BY created_at DESC`,
      [experienceId, this.db.organizationId],
    );
  }

  /**
   * Rolls instances up for list views. An experience has no lifecycle of its
   * own, so its real status is whatever its most recent instance is doing.
   */
  async activityByExperience(
    experienceIds: readonly ExperienceId[],
  ): Promise<
    Map<
      string,
      { instanceCount: number; latestState: string; enrolled: number }
    >
  > {
    if (experienceIds.length === 0) return new Map();

    const placeholders = experienceIds.map(() => "?").join(", ");
    const rows = await this.db.all<{
      experience_id: string;
      instance_count: number;
      latest_state: string;
      enrolled: number;
    }>(
      `SELECT i.experience_id,
              COUNT(*) AS instance_count,
              (SELECT latest.state
                 FROM experience_instances latest
                WHERE latest.experience_id = i.experience_id
                  AND latest.organization_id = i.organization_id
                ORDER BY latest.created_at DESC LIMIT 1) AS latest_state,
              (SELECT COUNT(*)
                 FROM participants p
                 JOIN experience_instances pi ON pi.id = p.instance_id
                WHERE pi.experience_id = i.experience_id
                  AND p.organization_id = i.organization_id
                  AND p.status = 'enrolled') AS enrolled
         FROM experience_instances i
        WHERE i.organization_id = ? AND i.experience_id IN (${placeholders})
        GROUP BY i.experience_id`,
      [this.db.organizationId, ...experienceIds],
    );

    return new Map(
      rows.map((row) => [
        row.experience_id,
        {
          instanceCount: row.instance_count,
          latestState: row.latest_state,
          enrolled: row.enrolled,
        },
      ]),
    );
  }

  async create(input: {
    experienceId: ExperienceId;
    experienceRevision: number;
    packTemplateId: string;
    name: string;
    snapshot: unknown;
    timeZone: string;
    enrollmentCloseAt: string;
    startAt: string;
    endAt: string;
    actorUserId: UserId;
  }): Promise<ExperienceInstanceId> {
    const id = newId("ExperienceInstanceId");
    const timestamp = nowIso();
    await this.db.commit(
      [
        this.db.statement(
          `INSERT INTO experience_instances
             (id, organization_id, experience_id, experience_revision, pack_template_id, name, snapshot_json, state,
              time_zone, enrollment_close_at, start_at, end_at, revision, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, 1, ?, ?)`,
          [
            id,
            this.db.organizationId,
            input.experienceId,
            input.experienceRevision,
            input.packTemplateId,
            input.name,
            JSON.stringify(input.snapshot),
            input.timeZone,
            input.enrollmentCloseAt,
            input.startAt,
            input.endAt,
            timestamp,
            timestamp,
          ],
        ),
      ],
      {
        actorUserId: input.actorUserId,
        actorKind: "user",
        action: "instance.created",
        resourceType: "experience_instance",
        resourceId: id,
        purpose: "experience_design",
      },
    );
    return id as ExperienceInstanceId;
  }

  /**
   * Compare-and-swap state transition. The guard on both the current state and
   * the revision makes concurrent transitions a conflict rather than a race.
   */
  async transition(input: {
    instanceId: ExperienceInstanceId;
    fromState: string;
    toState: string;
    expectedRevision: number;
    actorUserId: UserId | null;
    eventType: string;
  }): Promise<number> {
    const nextRevision = input.expectedRevision + 1;
    const timestamp = nowIso();
    const publishedAtClause =
      input.toState === "enrolling"
        ? `, published_at = COALESCE(published_at, ?)`
        : "";
    const params: SqlValue[] = [input.toState, nextRevision, timestamp];
    if (publishedAtClause) params.push(timestamp);
    params.push(
      input.instanceId,
      this.db.organizationId,
      input.fromState,
      input.expectedRevision,
    );

    const result = await this.db.run(
      `UPDATE experience_instances
          SET state = ?, revision = ?, updated_at = ?${publishedAtClause}
        WHERE id = ? AND organization_id = ? AND state = ? AND revision = ?`,
      params,
    );
    if ((result.meta.changes ?? 0) === 0) throw new Error("revision_mismatch");

    await this.db.commit(
      [],
      {
        actorUserId: input.actorUserId,
        actorKind: input.actorUserId ? "user" : "job",
        action: `instance.${input.toState}`,
        resourceType: "experience_instance",
        resourceId: input.instanceId,
        purpose: "experience_lifecycle",
        metadata: { from: input.fromState, to: input.toState },
      },
      {
        aggregateType: "experience_instance",
        aggregateId: input.instanceId,
        eventType: input.eventType,
        references: { instanceId: input.instanceId, state: input.toState },
      },
    );

    return nextRevision;
  }
}

/* --------------------------------------------------------------- participants */

export interface ParticipantRow {
  id: string;
  instance_id: string;
  user_id: string;
  status: string;
  joined_at: string | null;
  withdrawn_at: string | null;
}

export interface ParticipantProfileRow {
  revision: number;
  preferences_json: string;
  consent_json: string;
  consent_version: string;
}

export class ParticipantRepository {
  constructor(private readonly db: Database) {}

  async findForUser(
    instanceId: ExperienceInstanceId,
    userId: UserId,
  ): Promise<ParticipantRow | null> {
    return this.db.first<ParticipantRow>(
      `SELECT id, instance_id, user_id, status, joined_at, withdrawn_at
         FROM participants WHERE instance_id = ? AND user_id = ? AND organization_id = ?`,
      [instanceId, userId, this.db.organizationId],
    );
  }

  async listEnrolled(
    instanceId: ExperienceInstanceId,
  ): Promise<ParticipantRow[]> {
    return this.db.all<ParticipantRow>(
      `SELECT id, instance_id, user_id, status, joined_at, withdrawn_at
         FROM participants WHERE instance_id = ? AND organization_id = ? AND status = 'enrolled'
        ORDER BY id`,
      [instanceId, this.db.organizationId],
    );
  }

  async latestProfile(
    participantId: ParticipantId,
  ): Promise<ParticipantProfileRow | null> {
    return this.db.first<ParticipantProfileRow>(
      `SELECT revision, preferences_json, consent_json, consent_version
         FROM participant_profiles WHERE participant_id = ? AND organization_id = ?
        ORDER BY revision DESC LIMIT 1`,
      [participantId, this.db.organizationId],
    );
  }

  /** Enrollment is idempotent: re-enrolling an enrolled participant is a no-op. */
  async enroll(input: {
    instanceId: ExperienceInstanceId;
    userId: UserId;
    actorUserId: UserId;
  }): Promise<ParticipantId> {
    const existing = await this.findForUser(input.instanceId, input.userId);
    const timestamp = nowIso();

    if (existing) {
      if (existing.status === "enrolled") return existing.id as ParticipantId;
      await this.db.commit(
        [
          this.db.statement(
            `UPDATE participants SET status = 'enrolled', joined_at = COALESCE(joined_at, ?), withdrawn_at = NULL, updated_at = ?
              WHERE id = ? AND organization_id = ?`,
            [timestamp, timestamp, existing.id, this.db.organizationId],
          ),
        ],
        {
          actorUserId: input.actorUserId,
          actorKind: "user",
          action: "participant.enrolled",
          resourceType: "participant",
          resourceId: existing.id,
          purpose: "participation",
        },
        {
          aggregateType: "participant",
          aggregateId: existing.id,
          eventType: "participant.enrolled",
          references: {
            instanceId: input.instanceId,
            participantId: existing.id,
          },
        },
      );
      return existing.id as ParticipantId;
    }

    const id = newId("ParticipantId");
    await this.db.commit(
      [
        this.db.statement(
          `INSERT INTO participants (id, organization_id, instance_id, user_id, status, joined_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'enrolled', ?, ?, ?)`,
          [
            id,
            this.db.organizationId,
            input.instanceId,
            input.userId,
            timestamp,
            timestamp,
            timestamp,
          ],
        ),
      ],
      {
        actorUserId: input.actorUserId,
        actorKind: "user",
        action: "participant.enrolled",
        resourceType: "participant",
        resourceId: id,
        purpose: "participation",
      },
      {
        aggregateType: "participant",
        aggregateId: id,
        eventType: "participant.enrolled",
        references: { instanceId: input.instanceId, participantId: id },
      },
    );
    return id as ParticipantId;
  }

  /**
   * Withdrawal is idempotent and immediately removes the participant from
   * future processing; stored data is hidden and swept by retention jobs.
   */
  async withdraw(input: {
    instanceId: ExperienceInstanceId;
    userId: UserId;
    actorUserId: UserId;
  }): Promise<void> {
    const existing = await this.findForUser(input.instanceId, input.userId);
    if (!existing || existing.status === "withdrawn") return;
    const timestamp = nowIso();

    await this.db.commit(
      [
        this.db.statement(
          `UPDATE participants SET status = 'withdrawn', withdrawn_at = ?, updated_at = ?
            WHERE id = ? AND organization_id = ?`,
          [timestamp, timestamp, existing.id, this.db.organizationId],
        ),
        this.db.statement(
          `UPDATE notifications SET state = 'cancelled', updated_at = ?
            WHERE organization_id = ? AND instance_id = ? AND recipient_user_id = ? AND state = 'scheduled'`,
          [timestamp, this.db.organizationId, input.instanceId, input.userId],
        ),
      ],
      {
        actorUserId: input.actorUserId,
        actorKind: "user",
        action: "participant.withdrawn",
        resourceType: "participant",
        resourceId: existing.id,
        purpose: "participation",
      },
      {
        aggregateType: "participant",
        aggregateId: existing.id,
        eventType: "participant.withdrawn",
        references: {
          instanceId: input.instanceId,
          participantId: existing.id,
        },
      },
    );
  }

  async saveProfile(input: {
    participantId: ParticipantId;
    preferences: unknown;
    consent: unknown;
    consentVersion: string;
    actorUserId: UserId;
  }): Promise<number> {
    const current = await this.latestProfile(input.participantId);
    const revision = (current?.revision ?? 0) + 1;
    const timestamp = nowIso();

    await this.db.commit(
      [
        this.db.statement(
          `INSERT INTO participant_profiles
             (id, organization_id, participant_id, revision, preferences_json, consent_json, consent_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            newId("ParticipantProfileId"),
            this.db.organizationId,
            input.participantId,
            revision,
            JSON.stringify(input.preferences),
            JSON.stringify(input.consent),
            input.consentVersion,
            timestamp,
            timestamp,
          ],
        ),
      ],
      {
        actorUserId: input.actorUserId,
        actorKind: "user",
        action: "participant_profile.updated",
        resourceType: "participant_profile",
        resourceId: input.participantId,
        purpose: "participation",
        metadata: { revision, consentVersion: input.consentVersion },
      },
    );
    return revision;
  }

  /** Revokes derived data without deleting the membership record. */
  async revokeProfile(
    participantId: ParticipantId,
    actorUserId: UserId,
  ): Promise<void> {
    const timestamp = nowIso();
    await this.db.commit(
      [
        this.db.statement(
          `UPDATE culture_profiles SET revoked_at = ?, updated_at = ?
            WHERE participant_id = ? AND organization_id = ? AND revoked_at IS NULL`,
          [timestamp, timestamp, participantId, this.db.organizationId],
        ),
        this.db.statement(
          `DELETE FROM participant_profiles WHERE participant_id = ? AND organization_id = ?`,
          [participantId, this.db.organizationId],
        ),
      ],
      {
        actorUserId,
        actorKind: "user",
        action: "participant_profile.revoked",
        resourceType: "participant_profile",
        resourceId: participantId,
        purpose: "privacy",
      },
    );
  }

  async priorMatchPartners(
    instanceId: ExperienceInstanceId,
  ): Promise<Map<string, string[]>> {
    const rows = await this.db.all<{ participant_id: string; peer_id: string }>(
      `SELECT mm.participant_id AS participant_id, peer.participant_id AS peer_id
         FROM match_members mm
         JOIN match_members peer ON peer.match_id = mm.match_id AND peer.participant_id <> mm.participant_id
         JOIN matches m ON m.id = mm.match_id
        WHERE m.instance_id = ? AND m.organization_id = ? AND m.state = 'published'`,
      [instanceId, this.db.organizationId],
    );
    const map = new Map<string, string[]>();
    for (const row of rows) {
      map.set(row.participant_id, [
        ...(map.get(row.participant_id) ?? []),
        row.peer_id,
      ]);
    }
    return map;
  }
}
