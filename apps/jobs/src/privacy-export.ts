export const EXPORT_SCHEMA_VERSION = "1.0.0";

/**
 * A data subject export must not become a way to learn about other people.
 * Every third party in the bundle is reduced to a stable pseudonym derived from
 * their participant id, which is already opaque.
 */
export function pseudonym(participantId: string): string {
  return `member-${participantId.slice(-6)}`;
}

export interface ExportInputRows {
  readonly user: {
    id: string;
    display_name: string | null;
    status: string;
    created_at: string;
  };
  readonly workEmail: string | null;
  readonly identities: ReadonlyArray<{ provider_kind: string; issuer: string | null; provider_subject: string }>;
  readonly roleGrants: ReadonlyArray<{ role: string; scope_type: string; scope_key: string; created_at: string }>;
  readonly participations: ReadonlyArray<{
    participant_id: string;
    instance_id: string;
    instance_name: string;
    status: string;
    joined_at: string | null;
    withdrawn_at: string | null;
    preferences_json: string | null;
    consent_json: string | null;
    consent_version: string | null;
  }>;
  readonly matchMemberships: ReadonlyArray<{
    instance_id: string;
    group_key: string;
    participant_id: string;
    peer_participant_id: string;
    published_at: string | null;
  }>;
  readonly activities: ReadonlyArray<{ instance_id: string; type: string; state: string; completed_at: string | null }>;
  readonly recognitions: ReadonlyArray<{
    instance_id: string;
    direction: "sent" | "received";
    counterparty_participant_id: string;
    message: string | null;
    visibility: string;
    created_at: string;
  }>;
  readonly notifications: ReadonlyArray<{
    instance_id: string | null;
    template_key: string;
    channel: string;
    state: string;
    scheduled_at: string;
    delivered_at: string | null;
  }>;
  readonly aiInteractions: ReadonlyArray<{
    purpose: string;
    provider_key: string;
    model_id: string;
    redaction_level: string;
    status: string;
    created_at: string;
  }>;
  readonly auditEvents: ReadonlyArray<{
    action: string;
    resource_type: string;
    purpose: string;
    occurred_at: string;
  }>;
}

export interface ExportBundle {
  readonly schemaVersion: string;
  readonly generatedAt: string;
  readonly notice: string;
  readonly subject: {
    readonly userId: string;
    readonly displayName: string | null;
    readonly workEmail: string | null;
    readonly status: string;
    readonly accountCreatedAt: string;
  };
  readonly identities: ReadonlyArray<{ provider: string; issuer: string | null; subject: string }>;
  readonly roles: ReadonlyArray<{ role: string; scope: string; grantedAt: string }>;
  readonly participation: ReadonlyArray<Record<string, unknown>>;
  readonly connections: ReadonlyArray<Record<string, unknown>>;
  readonly activities: ReadonlyArray<Record<string, unknown>>;
  readonly recognitions: ReadonlyArray<Record<string, unknown>>;
  readonly notifications: ReadonlyArray<Record<string, unknown>>;
  readonly aiInteractions: ReadonlyArray<Record<string, unknown>>;
  readonly auditTrail: ReadonlyArray<Record<string, unknown>>;
}

function safeParse(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/**
 * Assembles the export bundle. Pure so the shape and the third-party
 * pseudonymisation rules can be tested without a database.
 */
export function buildExportBundle(rows: ExportInputRows, generatedAt = new Date().toISOString()): ExportBundle {
  const connectionsByGroup = new Map<string, { instanceId: string; groupKey: string; publishedAt: string | null; peers: string[] }>();
  for (const membership of rows.matchMemberships) {
    const compositeKey = `${membership.instance_id}:${membership.group_key}`;
    const entry = connectionsByGroup.get(compositeKey) ?? {
      instanceId: membership.instance_id,
      groupKey: membership.group_key,
      publishedAt: membership.published_at,
      peers: [],
    };
    entry.peers.push(pseudonym(membership.peer_participant_id));
    connectionsByGroup.set(compositeKey, entry);
  }

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    generatedAt,
    notice:
      "This export contains the personal data held about you. Other participants appear only as pseudonyms so this file cannot be used to identify them.",
    subject: {
      userId: rows.user.id,
      displayName: rows.user.display_name,
      workEmail: rows.workEmail,
      status: rows.user.status,
      accountCreatedAt: rows.user.created_at,
    },
    identities: rows.identities.map((identity) => ({
      provider: identity.provider_kind,
      issuer: identity.issuer,
      subject: identity.provider_subject,
    })),
    roles: rows.roleGrants.map((grant) => ({
      role: grant.role,
      scope: grant.scope_key ? `${grant.scope_type}:${grant.scope_key}` : grant.scope_type,
      grantedAt: grant.created_at,
    })),
    participation: rows.participations.map((participation) => ({
      experience: participation.instance_name,
      instanceId: participation.instance_id,
      status: participation.status,
      joinedAt: participation.joined_at,
      withdrawnAt: participation.withdrawn_at,
      preferencesYouShared: safeParse(participation.preferences_json),
      permissionsYouGranted: safeParse(participation.consent_json),
      consentVersion: participation.consent_version,
    })),
    connections: [...connectionsByGroup.values()].map((connection) => ({
      instanceId: connection.instanceId,
      groupKey: connection.groupKey,
      publishedAt: connection.publishedAt,
      peers: connection.peers.sort(),
    })),
    activities: rows.activities.map((activity) => ({
      instanceId: activity.instance_id,
      type: activity.type,
      state: activity.state,
      completedAt: activity.completed_at,
    })),
    recognitions: rows.recognitions.map((recognition) => ({
      instanceId: recognition.instance_id,
      direction: recognition.direction,
      // The other party is pseudonymous in both directions.
      counterparty: pseudonym(recognition.counterparty_participant_id),
      message: recognition.message,
      visibility: recognition.visibility,
      createdAt: recognition.created_at,
    })),
    notifications: rows.notifications.map((notification) => ({
      instanceId: notification.instance_id,
      template: notification.template_key,
      channel: notification.channel,
      state: notification.state,
      scheduledAt: notification.scheduled_at,
      deliveredAt: notification.delivered_at,
    })),
    aiInteractions: rows.aiInteractions.map((interaction) => ({
      purpose: interaction.purpose,
      provider: interaction.provider_key,
      model: interaction.model_id,
      redactionLevel: interaction.redaction_level,
      status: interaction.status,
      at: interaction.created_at,
    })),
    auditTrail: rows.auditEvents.map((event) => ({
      action: event.action,
      resourceType: event.resource_type,
      purpose: event.purpose,
      at: event.occurred_at,
    })),
  };
}
