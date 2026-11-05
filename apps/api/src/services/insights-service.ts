import type { ExperienceInstanceId } from "@culture-shock/domain";
import type { MetricKey } from "@culture-shock/pack-sdk";
import { Database } from "../db/database.js";

export const METRIC_VERSION = "1.0.0";

export interface MetricResult {
  readonly key: MetricKey;
  readonly value: number | null;
  readonly numerator: number | null;
  readonly denominator: number | null;
  readonly suppressed: boolean;
  readonly qualityFlags: string[];
}

export interface InsightRecommendation {
  readonly code: string;
  readonly summary: string;
  readonly evidence: string[];
  readonly sampleSize: number;
}

interface Counts {
  invited: number;
  enrolled: number;
  withdrawn: number;
  engaged: number;
  completed: number;
  remoteEnrolled: number;
  remoteCompleted: number;
  departmentsEnrolled: number;
  crossDepartmentConnections: number;
  knownDepartmentConnections: number;
  departmentsConnected: number;
}

/**
 * Builds a rate with an explicit denominator and cohort suppression. A metric
 * whose denominator is below the threshold reports as suppressed rather than
 * as a small-sample percentage that could identify individuals.
 */
function rate(
  key: MetricKey,
  numerator: number,
  denominator: number,
  minimumCohortSize: number,
  qualityFlags: string[] = [],
): MetricResult {
  if (denominator < minimumCohortSize) {
    return { key, value: null, numerator: null, denominator: null, suppressed: true, qualityFlags };
  }
  return {
    key,
    value: denominator === 0 ? null : Number((numerator / denominator).toFixed(4)),
    numerator,
    denominator,
    suppressed: false,
    qualityFlags,
  };
}

async function gatherCounts(db: Database, instanceId: ExperienceInstanceId): Promise<Counts> {
  const participantRows = await db.all<{ status: string; count: number }>(
    `SELECT status, COUNT(*) AS count FROM participants
      WHERE instance_id = ? AND organization_id = ? GROUP BY status`,
    [instanceId, db.organizationId],
  );
  const byStatus = new Map(participantRows.map((row) => [row.status, row.count]));

  const engaged = await db.first<{ count: number }>(
    `SELECT COUNT(DISTINCT participant_id) AS count FROM activities
      WHERE instance_id = ? AND organization_id = ? AND state = 'completed' AND participant_id IS NOT NULL`,
    [instanceId, db.organizationId],
  );

  const completed = await db.first<{ count: number }>(
    `SELECT COUNT(*) AS count FROM (
       SELECT a.participant_id
         FROM activities a
         JOIN missions m ON m.id = a.mission_id
        WHERE a.instance_id = ? AND a.organization_id = ? AND a.state = 'completed'
          AND json_extract(m.definition_json, '$.requiredForCompletion') = 1
        GROUP BY a.participant_id
     )`,
    [instanceId, db.organizationId],
  );

  // Department and remote cohorts come from the consented profile snapshot only.
  const profiles = await db.all<{ participant_id: string; department: string | null; remote: string | null; completed: number }>(
    `SELECT p.id AS participant_id,
            json_extract(pr.preferences_json, '$.department') AS department,
            json_extract(pr.preferences_json, '$.remotePreference') AS remote,
            (SELECT COUNT(*) FROM activities a WHERE a.participant_id = p.id AND a.state = 'completed') AS completed
       FROM participants p
       LEFT JOIN participant_profiles pr ON pr.participant_id = p.id
      WHERE p.instance_id = ? AND p.organization_id = ? AND p.status = 'enrolled'`,
    [instanceId, db.organizationId],
  );

  const departments = new Set<string>();
  let remoteEnrolled = 0;
  let remoteCompleted = 0;
  for (const row of profiles) {
    if (row.department) departments.add(row.department);
    if (row.remote === "remote") {
      remoteEnrolled += 1;
      if (row.completed > 0) remoteCompleted += 1;
    }
  }

  const connections = await db.all<{ left_department: string | null; right_department: string | null }>(
    `SELECT json_extract(lp.preferences_json, '$.department') AS left_department,
            json_extract(rp.preferences_json, '$.department') AS right_department
       FROM match_members a
       JOIN match_members b ON b.match_id = a.match_id AND b.participant_id <> a.participant_id
       JOIN matches m ON m.id = a.match_id
       LEFT JOIN participant_profiles lp ON lp.participant_id = a.participant_id
       LEFT JOIN participant_profiles rp ON rp.participant_id = b.participant_id
      WHERE m.instance_id = ? AND m.organization_id = ? AND m.state = 'published'`,
    [instanceId, db.organizationId],
  );

  let crossDepartment = 0;
  let knownDepartment = 0;
  const connectedDepartments = new Set<string>();
  for (const row of connections) {
    if (!row.left_department || !row.right_department) continue;
    knownDepartment += 1;
    connectedDepartments.add(row.left_department);
    if (row.left_department !== row.right_department) crossDepartment += 1;
  }

  return {
    invited: (byStatus.get("invited") ?? 0) + (byStatus.get("enrolled") ?? 0) + (byStatus.get("withdrawn") ?? 0),
    enrolled: byStatus.get("enrolled") ?? 0,
    withdrawn: byStatus.get("withdrawn") ?? 0,
    engaged: engaged?.count ?? 0,
    completed: completed?.count ?? 0,
    remoteEnrolled,
    remoteCompleted,
    departmentsEnrolled: departments.size,
    crossDepartmentConnections: crossDepartment,
    knownDepartmentConnections: knownDepartment,
    departmentsConnected: connectedDepartments.size,
  };
}

export interface InsightsReport {
  readonly metricVersion: string;
  readonly minimumCohortSize: number;
  readonly metrics: MetricResult[];
  readonly recommendations: InsightRecommendation[];
}

/**
 * Computes the registered metric set. Metrics derive from participation,
 * activity and match events only; recognition and conversation text is never
 * an input.
 */
export async function computeInsights(
  db: Database,
  instanceId: ExperienceInstanceId,
  requested: readonly MetricKey[],
  minimumCohortSize: number,
): Promise<InsightsReport> {
  const counts = await gatherCounts(db, instanceId);

  const all: Record<MetricKey, MetricResult> = {
    participation_rate: rate(
      "participation_rate",
      counts.enrolled,
      counts.invited,
      minimumCohortSize,
      counts.withdrawn > 0 ? [`opt_outs:${counts.withdrawn}`] : [],
    ),
    engagement_rate: rate("engagement_rate", counts.engaged, counts.enrolled, minimumCohortSize),
    connection_score: {
      key: "connection_score",
      value: null,
      numerator: null,
      denominator: null,
      suppressed: true,
      qualityFlags: ["requires_opt_in_survey_responses"],
    },
    department_bridge_score: rate(
      "department_bridge_score",
      counts.crossDepartmentConnections,
      counts.knownDepartmentConnections,
      minimumCohortSize,
      counts.knownDepartmentConnections < counts.enrolled ? ["unknown_departments_excluded"] : [],
    ),
    organizational_reach: rate(
      "organizational_reach",
      counts.departmentsConnected,
      counts.departmentsEnrolled,
      minimumCohortSize,
    ),
    remote_inclusion_score: rate(
      "remote_inclusion_score",
      counts.remoteCompleted,
      counts.remoteEnrolled,
      minimumCohortSize,
    ),
    experience_completion_rate: rate(
      "experience_completion_rate",
      counts.completed,
      counts.enrolled,
      minimumCohortSize,
    ),
  };

  const metrics = (requested.length > 0 ? requested : (Object.keys(all) as MetricKey[])).map(
    (key) => all[key],
  );

  const recommendations: InsightRecommendation[] = [];
  const bridge = all.department_bridge_score;
  if (!bridge.suppressed && bridge.value !== null && bridge.value < 0.4) {
    recommendations.push({
      code: "low_cross_department_interaction",
      summary:
        "Fewer than half of published connections cross departments. A Cross-Team Connector run would target this directly.",
      evidence: [`department_bridge_score:${bridge.value}`, `connections:${bridge.denominator}`],
      sampleSize: bridge.denominator ?? 0,
    });
  }
  const remote = all.remote_inclusion_score;
  const engagement = all.engagement_rate;
  if (
    !remote.suppressed &&
    !engagement.suppressed &&
    remote.value !== null &&
    engagement.value !== null &&
    remote.value + 0.15 < engagement.value
  ) {
    recommendations.push({
      code: "remote_participation_gap",
      summary:
        "Remote participants completed activities at a noticeably lower rate. Consider asynchronous-first missions for the next run.",
      evidence: [`remote_inclusion_score:${remote.value}`, `engagement_rate:${engagement.value}`],
      sampleSize: remote.denominator ?? 0,
    });
  }

  return { metricVersion: METRIC_VERSION, minimumCohortSize, metrics, recommendations };
}
