import { newId, type UserId } from "@culture-shock/domain";
import { Database, nowIso } from "./database.js";

export interface PackDraftRow {
  id: string;
  pack_id: string | null;
  author_user_id: string;
  source: string;
  manifest_json: string;
  validation_json: string;
  revision: number;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export class PackDraftRepository {
  constructor(private readonly db: Database) {}

  async list(limit = 50): Promise<PackDraftRow[]> {
    return this.db.all<PackDraftRow>(
      `SELECT id, pack_id, author_user_id, source, manifest_json, validation_json, revision,
              expires_at, created_at, updated_at
         FROM pack_drafts WHERE organization_id = ? AND expires_at > ?
        ORDER BY created_at DESC LIMIT ?`,
      [this.db.organizationId, nowIso(), limit],
    );
  }

  async findById(draftId: string): Promise<PackDraftRow | null> {
    return this.db.first<PackDraftRow>(
      `SELECT id, pack_id, author_user_id, source, manifest_json, validation_json, revision,
              expires_at, created_at, updated_at
         FROM pack_drafts WHERE id = ? AND organization_id = ?`,
      [draftId, this.db.organizationId],
    );
  }

  async create(input: {
    authorUserId: UserId;
    source: "human" | "ai" | "import";
    manifest: unknown;
    validation: unknown;
    ttlDays: number;
  }): Promise<string> {
    const id = newId("PackDraftId");
    const timestamp = nowIso();

    await this.db.commit(
      [
        this.db.statement(
          `INSERT INTO pack_drafts
             (id, organization_id, pack_id, author_user_id, source, manifest_json, validation_json, revision, expires_at, created_at, updated_at)
           VALUES (?, ?, NULL, ?, ?, ?, ?, 1, ?, ?, ?)`,
          [
            id,
            this.db.organizationId,
            input.authorUserId,
            input.source,
            JSON.stringify(input.manifest),
            JSON.stringify(input.validation),
            new Date(Date.now() + input.ttlDays * 86400 * 1000).toISOString(),
            timestamp,
            timestamp,
          ],
        ),
      ],
      {
        actorUserId: input.authorUserId,
        actorKind: input.source === "ai" ? "ai" : "user",
        action: "pack_draft.created",
        resourceType: "pack_draft",
        resourceId: id,
        purpose: "pack_catalog",
        metadata: { source: input.source },
      },
    );

    return id;
  }

  async saveValidation(draftId: string, validation: unknown): Promise<void> {
    await this.db.run(
      `UPDATE pack_drafts SET validation_json = ?, revision = revision + 1, updated_at = ?
        WHERE id = ? AND organization_id = ?`,
      [JSON.stringify(validation), nowIso(), draftId, this.db.organizationId],
    );
  }

  /** Publication consumes the draft so the same review cannot be published twice. */
  async discard(draftId: string, actorUserId: UserId, reason: string): Promise<void> {
    await this.db.commit(
      [
        this.db.statement(`DELETE FROM pack_drafts WHERE id = ? AND organization_id = ?`, [
          draftId,
          this.db.organizationId,
        ]),
      ],
      {
        actorUserId,
        actorKind: "user",
        action: "pack_draft.discarded",
        resourceType: "pack_draft",
        resourceId: draftId,
        purpose: "pack_catalog",
        metadata: { reason },
      },
    );
  }
}
