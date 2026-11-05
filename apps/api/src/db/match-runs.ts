import { newId, type ExperienceInstanceId, type UserId } from "@culture-shock/domain";
import type { MatchRunResult } from "@culture-shock/matching";
import { Database, nowIso } from "./database.js";

export interface MatchRunRow {
  id: string;
  instance_id: string;
  strategy_id: string;
  input_hash: string;
  state: string;
  diagnostics_json: string;
  fairness_json: string;
  published_at: string | null;
}

export class MatchRunRepository {
  constructor(private readonly db: Database) {}

  async findById(runId: string): Promise<MatchRunRow | null> {
    return this.db.first<MatchRunRow>(
      `SELECT id, instance_id, strategy_id, input_hash, state, diagnostics_json, fairness_json, published_at
         FROM match_runs WHERE id = ? AND organization_id = ?`,
      [runId, this.db.organizationId],
    );
  }

  async findByInput(
    instanceId: ExperienceInstanceId,
    strategyId: string,
    inputHash: string,
  ): Promise<MatchRunRow | null> {
    return this.db.first<MatchRunRow>(
      `SELECT id, instance_id, strategy_id, input_hash, state, diagnostics_json, fairness_json, published_at
         FROM match_runs WHERE instance_id = ? AND strategy_id = ? AND input_hash = ? AND organization_id = ?`,
      [instanceId, strategyId, inputHash, this.db.organizationId],
    );
  }

  async ensureStrategy(input: {
    instanceId: ExperienceInstanceId;
    strategyKey: string;
    strategyVersion: string;
    weights: Record<string, number>;
    constraints: unknown;
  }): Promise<string> {
    const existing = await this.db.first<{ id: string; version: number }>(
      `SELECT id, version FROM matching_strategies
        WHERE instance_id = ? AND organization_id = ? AND strategy_key = ? AND strategy_version = ?
        ORDER BY version DESC LIMIT 1`,
      [input.instanceId, this.db.organizationId, input.strategyKey, input.strategyVersion],
    );
    if (existing) return existing.id;

    const latest = await this.db.first<{ version: number }>(
      `SELECT version FROM matching_strategies WHERE instance_id = ? AND organization_id = ?
        ORDER BY version DESC LIMIT 1`,
      [input.instanceId, this.db.organizationId],
    );
    const id = newId("MatchingStrategyId");
    const timestamp = nowIso();
    await this.db.run(
      `INSERT INTO matching_strategies
         (id, organization_id, instance_id, version, strategy_key, strategy_version, weights_json, constraints_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        this.db.organizationId,
        input.instanceId,
        (latest?.version ?? 0) + 1,
        input.strategyKey,
        input.strategyVersion,
        JSON.stringify(input.weights),
        JSON.stringify(input.constraints),
        timestamp,
        timestamp,
      ],
    );
    return id;
  }

  /**
   * Persists a preview run and its proposed groups. Nothing is visible to a
   * participant until a designer publishes the run.
   */
  async savePreview(input: {
    instanceId: ExperienceInstanceId;
    strategyId: string;
    inputHash: string;
    result: MatchRunResult;
    fairness: unknown;
    actorUserId: UserId;
  }): Promise<string> {
    const existing = await this.findByInput(input.instanceId, input.strategyId, input.inputHash);
    if (existing) return existing.id;

    const runId = newId("MatchRunId");
    const timestamp = nowIso();
    const statements = [
      this.db.statement(
        `INSERT INTO match_runs
           (id, organization_id, instance_id, strategy_id, input_hash, state, diagnostics_json, fairness_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'preview', ?, ?, ?, ?)`,
        [
          runId,
          this.db.organizationId,
          input.instanceId,
          input.strategyId,
          input.inputHash,
          JSON.stringify({ ...input.result.diagnostics, unmatched: input.result.unmatched }),
          JSON.stringify(input.fairness),
          timestamp,
          timestamp,
        ],
      ),
    ];

    for (const match of input.result.matches) {
      const matchId = newId("MatchId");
      statements.push(
        this.db.statement(
          `INSERT INTO matches
             (id, organization_id, run_id, instance_id, group_key, state, score, rationale_codes_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'proposed', ?, ?, ?, ?)`,
          [
            matchId,
            this.db.organizationId,
            runId,
            input.instanceId,
            match.groupKey,
            match.score,
            JSON.stringify(match.rationaleCodes),
            timestamp,
            timestamp,
          ],
        ),
      );
      for (const participantId of match.memberParticipantIds) {
        statements.push(
          this.db.statement(
            `INSERT INTO match_members (id, organization_id, match_id, run_id, participant_id, role, created_at)
             VALUES (?, ?, ?, ?, ?, 'member', ?)`,
            [newId("MatchId"), this.db.organizationId, matchId, runId, participantId, timestamp],
          ),
        );
      }
    }

    await this.db.commit(statements, {
      actorUserId: input.actorUserId,
      actorKind: "user",
      action: "match_run.previewed",
      resourceType: "match_run",
      resourceId: runId,
      purpose: "matching",
      metadata: {
        matches: input.result.matches.length,
        unmatched: input.result.unmatched.length,
        approximation: input.result.diagnostics.approximationReason,
      },
    });

    return runId;
  }

  /**
   * Single-winner publication. The unique partial index on published runs plus
   * the state guard means a retry either wins once or conflicts cleanly.
   */
  async publish(input: { runId: string; instanceId: ExperienceInstanceId; actorUserId: UserId }): Promise<void> {
    const timestamp = nowIso();
    const result = await this.db.run(
      `UPDATE match_runs SET state = 'published', approved_by = ?, published_at = ?, updated_at = ?
        WHERE id = ? AND organization_id = ? AND state = 'preview'`,
      [input.actorUserId, timestamp, timestamp, input.runId, this.db.organizationId],
    );
    if ((result.meta.changes ?? 0) === 0) throw new Error("not_publishable");

    await this.db.commit(
      [
        this.db.statement(
          `UPDATE matches SET state = 'published', updated_at = ? WHERE run_id = ? AND organization_id = ?`,
          [timestamp, input.runId, this.db.organizationId],
        ),
      ],
      {
        actorUserId: input.actorUserId,
        actorKind: "user",
        action: "match_run.published",
        resourceType: "match_run",
        resourceId: input.runId,
        purpose: "matching",
      },
      {
        aggregateType: "match_run",
        aggregateId: input.runId,
        eventType: "match_run.published",
        references: { instanceId: input.instanceId, runId: input.runId },
      },
    );
  }

  async publishedMatchForParticipant(
    instanceId: ExperienceInstanceId,
    participantId: string,
  ): Promise<{ groupKey: string; peerParticipantIds: string[] } | null> {
    const row = await this.db.first<{ match_id: string; group_key: string }>(
      `SELECT m.id AS match_id, m.group_key AS group_key
         FROM match_members mm
         JOIN matches m ON m.id = mm.match_id
         JOIN match_runs r ON r.id = m.run_id
        WHERE mm.participant_id = ? AND m.instance_id = ? AND m.organization_id = ?
          AND m.state = 'published' AND r.state = 'published'
        LIMIT 1`,
      [participantId, instanceId, this.db.organizationId],
    );
    if (!row) return null;

    const peers = await this.db.all<{ participant_id: string }>(
      `SELECT participant_id FROM match_members
        WHERE match_id = ? AND organization_id = ? AND participant_id <> ? ORDER BY participant_id`,
      [row.match_id, this.db.organizationId, participantId],
    );
    return { groupKey: row.group_key, peerParticipantIds: peers.map((peer) => peer.participant_id) };
  }
}
