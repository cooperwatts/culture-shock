import { newId, type ExperienceInstanceId, type ParticipantId, type UserId } from "@culture-shock/domain";
import { Database, nowIso } from "./database.js";

export interface ActivityRow {
  id: string;
  type: string;
  state: string;
  payload_json: string;
  completed_at: string | null;
  created_at: string;
}

export class ActivityRepository {
  constructor(private readonly db: Database) {}

  async countForParticipant(participantId: ParticipantId, type: string): Promise<number> {
    const row = await this.db.first<{ count: number }>(
      `SELECT COUNT(*) AS count FROM activities
        WHERE participant_id = ? AND organization_id = ? AND type = ? AND state <> 'expired'`,
      [participantId, this.db.organizationId, type],
    );
    return row?.count ?? 0;
  }

  async listForParticipant(participantId: ParticipantId): Promise<ActivityRow[]> {
    return this.db.all<ActivityRow>(
      `SELECT id, type, state, payload_json, completed_at, created_at
         FROM activities WHERE participant_id = ? AND organization_id = ?
        ORDER BY created_at DESC LIMIT 100`,
      [participantId, this.db.organizationId],
    );
  }

  async record(input: {
    instanceId: ExperienceInstanceId;
    participantId: ParticipantId;
    type: string;
    payload: unknown;
    actorUserId: UserId;
  }): Promise<string> {
    const id = newId("ActivityId");
    const timestamp = nowIso();

    await this.db.commit(
      [
        this.db.statement(
          `INSERT INTO activities
             (id, organization_id, instance_id, participant_id, type, state, payload_json, completed_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?)`,
          [
            id,
            this.db.organizationId,
            input.instanceId,
            input.participantId,
            input.type,
            JSON.stringify(input.payload),
            timestamp,
            timestamp,
            timestamp,
          ],
        ),
      ],
      {
        actorUserId: input.actorUserId,
        actorKind: "user",
        action: "activity.completed",
        resourceType: "activity",
        resourceId: id,
        purpose: "participation",
        metadata: { type: input.type },
      },
      {
        aggregateType: "experience_instance",
        aggregateId: input.instanceId,
        eventType: "analytics.refresh_requested",
        references: { instanceId: input.instanceId },
      },
    );

    return id;
  }
}

export interface RecognitionRow {
  id: string;
  author_participant_id: string;
  recipient_participant_id: string;
  message_ciphertext: string;
  visibility: string;
  moderation_state: string;
  created_at: string;
}

export class RecognitionRepository {
  constructor(private readonly db: Database) {}

  async create(input: {
    instanceId: ExperienceInstanceId;
    authorParticipantId: ParticipantId;
    recipientParticipantId: ParticipantId;
    messageCiphertext: string;
    keyVersion: number;
    visibility: string;
    moderationState: "pending" | "approved";
    actorUserId: UserId;
  }): Promise<string> {
    const id = newId("RecognitionId");
    const timestamp = nowIso();

    await this.db.commit(
      [
        this.db.statement(
          `INSERT INTO recognitions
             (id, organization_id, instance_id, author_participant_id, recipient_participant_id,
              message_ciphertext, key_version, visibility, moderation_state, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            this.db.organizationId,
            input.instanceId,
            input.authorParticipantId,
            input.recipientParticipantId,
            input.messageCiphertext,
            input.keyVersion,
            input.visibility,
            input.moderationState,
            timestamp,
            timestamp,
          ],
        ),
      ],
      {
        actorUserId: input.actorUserId,
        actorKind: "user",
        action: "recognition.created",
        resourceType: "recognition",
        // The message itself is never part of the audit record.
        resourceId: id,
        purpose: "participation",
        metadata: { visibility: input.visibility, moderationState: input.moderationState },
      },
    );

    return id;
  }

  /** Only recognitions the caller authored or received, and only if moderated. */
  async listVisibleTo(
    instanceId: ExperienceInstanceId,
    participantId: ParticipantId,
  ): Promise<RecognitionRow[]> {
    return this.db.all<RecognitionRow>(
      `SELECT id, author_participant_id, recipient_participant_id, message_ciphertext,
              visibility, moderation_state, created_at
         FROM recognitions
        WHERE instance_id = ? AND organization_id = ?
          AND (author_participant_id = ? OR (recipient_participant_id = ? AND moderation_state = 'approved'))
        ORDER BY created_at DESC LIMIT 100`,
      [instanceId, this.db.organizationId, participantId, participantId],
    );
  }

  async countAuthored(instanceId: ExperienceInstanceId, participantId: ParticipantId): Promise<number> {
    const row = await this.db.first<{ count: number }>(
      `SELECT COUNT(*) AS count FROM recognitions
        WHERE instance_id = ? AND organization_id = ? AND author_participant_id = ?`,
      [instanceId, this.db.organizationId, participantId],
    );
    return row?.count ?? 0;
  }
}
