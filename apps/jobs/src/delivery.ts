import { newId } from "@culture-shock/domain";
import { decryptField } from "@culture-shock/crypto";
import {
  buildTemplateValues,
  createEmailProvider,
  renderNotification,
  type EmailProvider,
  type RenderContext,
} from "@culture-shock/notifications";
import { packManifestSchema, type CommunicationTemplate } from "@culture-shock/pack-sdk";
import type { InstallationConfig } from "@culture-shock/config";
import { loadInstallation } from "./installation.js";
import { loggerFor } from "./log.js";
import type { JobsEnv } from "./outbox.js";

interface DueNotificationRow {
  id: string;
  instance_id: string | null;
  recipient_user_id: string;
  template_key: string;
  locale: string;
  payload_json: string;
  scheduled_at: string;
  display_name: string | null;
  work_email_ciphertext: string | null;
  participant_status: string | null;
  consent_json: string | null;
  consent_version: string | null;
  instance_name: string | null;
  instance_state: string | null;
  time_zone: string | null;
  start_at: string | null;
  end_at: string | null;
  enrollment_close_at: string | null;
  manifest_json: string | null;
}

export interface DeliverySummary {
  readonly considered: number;
  readonly sent: number;
  readonly suppressed: number;
  readonly failed: number;
  readonly suppressionReasons: Record<string, number>;
}

const EMPTY: DeliverySummary = {
  considered: 0,
  sent: 0,
  suppressed: 0,
  failed: 0,
  suppressionReasons: {},
};

async function markSuppressed(env: JobsEnv, notificationId: string, reason: string): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE notifications SET state = 'suppressed', updated_at = ? WHERE id = ?`).bind(
      now,
      notificationId,
    ),
    env.DB.prepare(
      `INSERT INTO delivery_attempts
         (id, organization_id, notification_id, provider_message_key, state, error_code, attempted_at, completed_at)
       SELECT ?, organization_id, id, ?, 'failed', ?, ?, ? FROM notifications WHERE id = ?`,
    ).bind(newId("NotificationId"), `suppressed:${reason}`, reason, now, now, notificationId),
  ]);
}

/** Counts messages already delivered to a recipient inside the rolling day. */
async function dailyCount(env: JobsEnv, userId: string): Promise<number> {
  const since = new Date(Date.now() - 86400 * 1000).toISOString();
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM notifications
      WHERE recipient_user_id = ? AND state = 'delivered' AND delivered_at > ?`,
  )
    .bind(userId, since)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

function templateFor(manifestJson: string | null, templateKey: string): CommunicationTemplate | null {
  if (!manifestJson) return null;
  const parsed = packManifestSchema.safeParse(JSON.parse(manifestJson));
  if (!parsed.success) return null;
  return parsed.data.communications.find((template) => template.key === templateKey) ?? null;
}

function renderContextFor(config: InstallationConfig, locale: string): RenderContext {
  return {
    locale,
    defaultLocale: config.organization.defaultLocale,
    terminology: config.terminology,
    theme: config.branding,
    organizationName: config.organization.name,
    supportUrl: config.organization.supportContact ? `mailto:${config.organization.supportContact}` : null,
    unsubscribeUrl: null,
  };
}

/**
 * Sends due notifications.
 *
 * Consent, participation status and instance state are re-checked here rather
 * than trusted from when the message was queued, because any of them may have
 * changed in the interval. A delivery attempt row is written before the provider
 * call so a crash mid-send leaves evidence to reconcile against.
 */
export async function deliverDueNotifications(env: JobsEnv): Promise<DeliverySummary> {
  const installation = await loadInstallation(env);
  if (!installation) return EMPTY;

  const { config, organizationId } = installation;
  if (!config.notifications.emailEnabled || config.notifications.provider === "none") {
    return EMPTY;
  }

  const logger = loggerFor(env, { component: "delivery" });
  if (!config.notifications.fromAddress) {
    logger.warn("notifications_missing_from_address");
    return EMPTY;
  }

  const fieldKey = env.FIELD_ENCRYPTION_KEY;
  if (!fieldKey) {
    logger.warn("notifications_missing_encryption_key");
    return EMPTY;
  }

  const provider: EmailProvider = createEmailProvider(config.notifications.provider, {
    apiKey: env.EMAIL_PROVIDER_API_KEY,
    relayUrl: env.EMAIL_RELAY_URL,
  });

  const now = new Date().toISOString();
  const due = await env.DB.prepare(
    `SELECT n.id, n.instance_id, n.recipient_user_id, n.template_key, n.locale, n.payload_json, n.scheduled_at,
            u.display_name, u.work_email_ciphertext,
            p.status AS participant_status,
            pr.consent_json, pr.consent_version,
            i.name AS instance_name, i.state AS instance_state, i.time_zone, i.start_at, i.end_at, i.enrollment_close_at,
            t.manifest_json
       FROM notifications n
       JOIN users u ON u.id = n.recipient_user_id
       LEFT JOIN experience_instances i ON i.id = n.instance_id
       LEFT JOIN culture_pack_templates t ON t.id = i.pack_template_id
       LEFT JOIN participants p ON p.instance_id = n.instance_id AND p.user_id = n.recipient_user_id
       LEFT JOIN participant_profiles pr ON pr.participant_id = p.id
      WHERE n.organization_id = ? AND n.state = 'scheduled' AND n.scheduled_at <= ?
      ORDER BY n.scheduled_at
      LIMIT ?`,
  )
    .bind(organizationId, now, config.notifications.queueBatchSize)
    .all<DueNotificationRow>();

  const rows = due.results ?? [];
  const summary = { ...EMPTY, considered: rows.length, suppressionReasons: {} as Record<string, number> };

  const suppress = async (row: DueNotificationRow, reason: string) => {
    await markSuppressed(env, row.id, reason);
    summary.suppressed += 1;
    summary.suppressionReasons[reason] = (summary.suppressionReasons[reason] ?? 0) + 1;
  };

  for (const row of rows) {
    if (row.participant_status !== null && row.participant_status !== "enrolled") {
      await suppress(row, "not_enrolled");
      continue;
    }
    if (row.instance_state === "cancelled" || row.instance_state === "archived") {
      await suppress(row, "instance_closed");
      continue;
    }

    const consent = row.consent_json ? (JSON.parse(row.consent_json) as Record<string, boolean>) : {};
    const consentCurrent = row.consent_version === config.privacy.consentVersion;
    if (!consentCurrent || consent.messaging !== true) {
      await suppress(row, "no_messaging_consent");
      continue;
    }

    if (!row.work_email_ciphertext) {
      await suppress(row, "no_delivery_address");
      continue;
    }

    if ((await dailyCount(env, row.recipient_user_id)) >= config.notifications.maxPerParticipantPerDay) {
      await suppress(row, "daily_cap_reached");
      continue;
    }

    const template = templateFor(row.manifest_json, row.template_key);
    if (!template) {
      await suppress(row, "template_missing");
      continue;
    }

    let address: string;
    try {
      address = await decryptField(fieldKey, row.work_email_ciphertext);
    } catch {
      await suppress(row, "address_undecryptable");
      continue;
    }

    const locale = row.locale || config.organization.defaultLocale;
    const context = renderContextFor(config, locale);
    const rendered = renderNotification(
      template,
      buildTemplateValues(
        {
          organizationName: config.organization.name,
          experienceName: row.instance_name ?? config.terminology.experienceSingular,
          startsAt: row.start_at,
          endsAt: row.end_at,
          enrollmentClosesAt: row.enrollment_close_at,
          timeZone: row.time_zone ?? config.organization.defaultTimeZone,
          participantDisplayName: row.display_name,
          participantPseudonym: `member-${row.recipient_user_id.slice(-6)}`,
          // Peer identity is resolved only by the API under the privacy policy;
          // a queued message never carries it.
          peerDisplayName: null,
          peerPseudonym: null,
          experienceUrl: `${env.PUBLIC_BASE_URL}/participant/instances/${row.instance_id ?? ""}`,
          supportUrl: config.organization.supportContact,
        },
        context,
      ),
      context,
    );

    // The idempotency key is stable for a notification, so a retry reuses it.
    const providerMessageKey = `n_${row.id}`;
    const attemptedAt = new Date().toISOString();

    const claimed = await env.DB.prepare(
      `INSERT OR IGNORE INTO delivery_attempts
         (id, organization_id, notification_id, provider_message_key, state, attempted_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
    )
      .bind(newId("NotificationId"), organizationId, row.id, providerMessageKey, attemptedAt)
      .run();

    if ((claimed.meta.changes ?? 0) === 0) {
      // Another invocation already owns this send; leave it to reconcile.
      continue;
    }

    await env.DB.prepare(`UPDATE notifications SET state = 'sending', updated_at = ? WHERE id = ?`)
      .bind(attemptedAt, row.id)
      .run();

    const outcome = await provider.send({
      to: { address, displayName: row.display_name },
      from: config.notifications.fromAddress,
      replyTo: config.notifications.replyToAddress,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: providerMessageKey,
    });

    const completedAt = new Date().toISOString();

    if (outcome.status === "sent") {
      summary.sent += 1;
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE delivery_attempts SET state = 'sent', completed_at = ? WHERE notification_id = ? AND provider_message_key = ?`,
        ).bind(completedAt, row.id, providerMessageKey),
        env.DB.prepare(
          `UPDATE notifications SET state = 'delivered', delivered_at = ?, updated_at = ? WHERE id = ?`,
        ).bind(completedAt, completedAt, row.id),
      ]);
      continue;
    }

    summary.failed += 1;
    const attempts = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM delivery_attempts WHERE notification_id = ?`,
    )
      .bind(row.id)
      .first<{ count: number }>();

    const exhausted =
      !outcome.retryable || (attempts?.count ?? 1) >= config.notifications.maxDeliveryAttempts;

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE delivery_attempts SET state = 'failed', error_code = ?, completed_at = ? WHERE notification_id = ? AND provider_message_key = ?`,
      ).bind(outcome.errorCode, completedAt, row.id, providerMessageKey),
      env.DB.prepare(`UPDATE notifications SET state = ?, updated_at = ? WHERE id = ?`).bind(
        exhausted ? "failed" : "scheduled",
        completedAt,
        row.id,
      ),
      // Retries move the schedule forward so a failing message cannot spin.
      env.DB.prepare(
        `UPDATE notifications SET scheduled_at = ? WHERE id = ? AND state = 'scheduled'`,
      ).bind(new Date(Date.now() + 15 * 60 * 1000).toISOString(), row.id),
    ]);
  }

  return summary;
}
