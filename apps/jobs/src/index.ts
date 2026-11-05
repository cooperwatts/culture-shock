import type { DomainEventEnvelope } from "@culture-shock/domain";
import { dispatchOutbox, type JobsEnv } from "./outbox.js";
import { handlersFor } from "./handlers.js";
import { deliverDueNotifications } from "./delivery.js";
import { evaluateAndAlert } from "./health.js";
import { loggerFor } from "./log.js";
import { sweepRetention } from "./retention.js";

/** Cron expressions configured in wrangler.toml. */
const MINUTE_CRON = "* * * * *";
const HEALTH_CRON = "*/5 * * * *";

export default {
  /**
   * Queue consumer. Each message is processed by every registered handler for
   * its event type; handlers are individually idempotent, so a retry of the
   * batch cannot double-apply an effect that already succeeded.
   */
  async queue(batch: MessageBatch<DomainEventEnvelope>, env: JobsEnv): Promise<void> {
    const logger = loggerFor(env, { component: "queue" });

    for (const message of batch.messages) {
      const event = message.body;
      try {
        const handlers = handlersFor(event.eventType);
        if (handlers.length === 0) {
          message.ack();
          continue;
        }
        for (const handler of handlers) {
          await handler.run(env, event);
        }
        message.ack();
      } catch (cause) {
        // Log identifiers only: dead-lettered messages must stay redacted.
        logger.error("handler_failed", {
          eventId: event.eventId,
          eventType: event.eventType,
          attempt: message.attempts,
          error: cause instanceof Error ? cause.name : "unknown",
        });
        message.retry();
      }
    }
  },

  async scheduled(event: ScheduledController, env: JobsEnv, ctx: ExecutionContext): Promise<void> {
    const logger = loggerFor(env, { component: "scheduled", cron: event.cron });

    if (event.cron === MINUTE_CRON) {
      ctx.waitUntil(
        (async () => {
          const published = await dispatchOutbox(env);
          if (published.failed > 0) {
            logger.warn("outbox_publish_failures", { ...published });
          }

          const delivery = await deliverDueNotifications(env);
          if (delivery.considered > 0) {
            logger.info("notification_delivery", {
              considered: delivery.considered,
              sent: delivery.sent,
              suppressed: delivery.suppressed,
              failed: delivery.failed,
            });
          }
        })(),
      );
      return;
    }

    if (event.cron === HEALTH_CRON) {
      ctx.waitUntil(evaluateAndAlert(env));
      return;
    }

    ctx.waitUntil(
      sweepRetention(env).then((results) => {
        logger.info("retention_sweep", results);
      }),
    );
  },
};
