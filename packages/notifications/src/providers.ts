export interface EmailRecipient {
  readonly address: string;
  readonly displayName: string | null;
}

export interface EmailMessage {
  readonly to: EmailRecipient;
  readonly from: string;
  readonly replyTo: string | null;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  /**
   * Stable key reused on retry. Providers that honour it collapse duplicates;
   * those that do not mean duplicates are possible and must be reconciled.
   */
  readonly idempotencyKey: string;
}

export type SendOutcome =
  | { readonly status: "sent"; readonly providerMessageId: string | null }
  | { readonly status: "failed"; readonly retryable: boolean; readonly errorCode: string };

export interface EmailProvider {
  readonly kind: string;
  /** True when the provider deduplicates on the idempotency key. */
  readonly supportsIdempotency: boolean;
  send(message: EmailMessage, signal?: AbortSignal): Promise<SendOutcome>;
}

export interface EmailCredentials {
  readonly apiKey?: string;
  /** Full URL for a self-hosted SMTP-to-HTTP relay. */
  readonly relayUrl?: string;
}

function classify(status: number): SendOutcome {
  const retryable = status === 408 || status === 429 || status >= 500;
  return { status: "failed", retryable, errorCode: `http_${status}` };
}

async function post(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal,
  });
}

function createResendProvider(credentials: EmailCredentials): EmailProvider {
  return {
    kind: "resend",
    supportsIdempotency: true,
    async send(message, signal) {
      if (!credentials.apiKey) return { status: "failed", retryable: false, errorCode: "missing_credential" };
      try {
        const response = await post(
          "https://api.resend.com/emails",
          {
            authorization: `Bearer ${credentials.apiKey}`,
            "idempotency-key": message.idempotencyKey,
          },
          {
            from: message.from,
            to: [message.to.address],
            ...(message.replyTo ? { reply_to: message.replyTo } : {}),
            subject: message.subject,
            html: message.html,
            text: message.text,
          },
          signal,
        );
        if (!response.ok) return classify(response.status);
        const payload = (await response.json().catch(() => null)) as { id?: string } | null;
        return { status: "sent", providerMessageId: payload?.id ?? null };
      } catch {
        return { status: "failed", retryable: true, errorCode: "network_error" };
      }
    },
  };
}

function createSendgridProvider(credentials: EmailCredentials): EmailProvider {
  return {
    kind: "sendgrid",
    supportsIdempotency: false,
    async send(message, signal) {
      if (!credentials.apiKey) return { status: "failed", retryable: false, errorCode: "missing_credential" };
      try {
        const response = await post(
          "https://api.sendgrid.com/v3/mail/send",
          { authorization: `Bearer ${credentials.apiKey}` },
          {
            personalizations: [
              {
                to: [{ email: message.to.address, ...(message.to.displayName ? { name: message.to.displayName } : {}) }],
                custom_args: { idempotency_key: message.idempotencyKey },
              },
            ],
            from: { email: message.from },
            ...(message.replyTo ? { reply_to: { email: message.replyTo } } : {}),
            subject: message.subject,
            content: [
              { type: "text/plain", value: message.text },
              { type: "text/html", value: message.html },
            ],
          },
          signal,
        );
        if (!response.ok) return classify(response.status);
        return { status: "sent", providerMessageId: response.headers.get("x-message-id") };
      } catch {
        return { status: "failed", retryable: true, errorCode: "network_error" };
      }
    },
  };
}

function createMailChannelsProvider(): EmailProvider {
  return {
    kind: "mailchannels",
    supportsIdempotency: false,
    async send(message, signal) {
      try {
        const response = await post(
          "https://api.mailchannels.net/tx/v1/send",
          {},
          {
            personalizations: [{ to: [{ email: message.to.address }] }],
            from: { email: message.from },
            ...(message.replyTo ? { reply_to: { email: message.replyTo } } : {}),
            subject: message.subject,
            content: [
              { type: "text/plain", value: message.text },
              { type: "text/html", value: message.html },
            ],
          },
          signal,
        );
        if (!response.ok) return classify(response.status);
        return { status: "sent", providerMessageId: null };
      } catch {
        return { status: "failed", retryable: true, errorCode: "network_error" };
      }
    },
  };
}

function createRelayProvider(credentials: EmailCredentials): EmailProvider {
  return {
    kind: "smtp-relay",
    supportsIdempotency: true,
    async send(message, signal) {
      if (!credentials.relayUrl) return { status: "failed", retryable: false, errorCode: "missing_relay_url" };
      try {
        const response = await post(
          credentials.relayUrl,
          credentials.apiKey ? { authorization: `Bearer ${credentials.apiKey}` } : {},
          {
            to: message.to.address,
            from: message.from,
            replyTo: message.replyTo,
            subject: message.subject,
            html: message.html,
            text: message.text,
            idempotencyKey: message.idempotencyKey,
          },
          signal,
        );
        if (!response.ok) return classify(response.status);
        return { status: "sent", providerMessageId: message.idempotencyKey };
      } catch {
        return { status: "failed", retryable: true, errorCode: "network_error" };
      }
    },
  };
}

/** Used when email delivery is disabled: records the attempt and sends nothing. */
export function createNullProvider(): EmailProvider {
  return {
    kind: "none",
    supportsIdempotency: true,
    async send() {
      return { status: "failed", retryable: false, errorCode: "email_disabled" };
    },
  };
}

export function createEmailProvider(kind: string, credentials: EmailCredentials): EmailProvider {
  switch (kind) {
    case "resend":
      return createResendProvider(credentials);
    case "sendgrid":
      return createSendgridProvider(credentials);
    case "mailchannels":
      return createMailChannelsProvider();
    case "smtp-relay":
      return createRelayProvider(credentials);
    default:
      return createNullProvider();
  }
}
