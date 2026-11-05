# Configuration reference

One validated document holds every setting. It is read through `GET /api/v1/admin/config` and replaced through `PUT`, which requires an `If-Match` header carrying the revision you read. Each publish creates a new immutable revision, so two administrators cannot quietly overwrite each other.

Nothing here is a secret. Credentials live in Worker secrets and never appear in this document or in any response.

The schema is defined in `packages/config/src/installation.ts`. Anything not described below is rejected.

## organization

| Field              | Default     | Notes                                  |
| ------------------ | ----------- | -------------------------------------- |
| `name`             | required    | Appears in participant-facing messages |
| `slug`             | required    | Lowercase, hyphenated                  |
| `defaultLocale`    | `en-CA`     | Must appear in `supportedLocales`      |
| `supportedLocales` | `["en-CA"]` | BCP-47 codes                           |
| `defaultTimeZone`  | `UTC`       | IANA identifier                        |
| `supportContact`   | `null`      | Shown in message footers when set      |

## setupComplete

False until you say otherwise. While false, the requirement to have a working authentication method is relaxed, which is what makes first-run bootstrap possible. Set it to `true` once identity and privacy settings are final.

## branding

Colours, typography, border radius, and R2 keys for logo assets. Every token becomes a CSS custom property, and both the web app and email templates read from them, so there is no hardcoded colour anywhere in the interface.

Edit this through `/admin/branding` rather than by hand. The editor previews changes live, reports the contrast ratio for each text pair, and uploads logos.

Twelve colour tokens are required: `primary`, `primaryForeground`, `accent`, `accentForeground`, `background`, `foreground`, `muted`, `mutedForeground`, `border`, `destructive`, `success`, `warning`.

Font stacks are validated against a restrictive character set. This is not fussiness: the value ends up inside a CSS declaration, and anything that could terminate it is a vector.

You can upload a WOFF2 for body text and another for headings. An uploaded face is prepended to the stack you configured, so the fallbacks still apply if it fails to load. The family name is generated rather than author-supplied, which keeps a font name from being used to inject into the declaration. WOFF2 is the only accepted format: every supported browser reads it, and narrowing the parser surface is worth more than legacy coverage.

Publishing runs a contrast check over foreground and background pairs at a 4.5:1 minimum and rejects the change if any pair fails.

## terminology

Ten keys covering the nouns the product uses: `platformName`, `designerSingular`, `designerPlural`, `participantSingular`, `participantPlural`, `experienceSingular`, `experiencePlural`, `packSingular`, `packPlural`, `matchSingular`.

Rename anything you like. If your organization says "Connector" rather than "Organizer", set it here and every interface and message follows. The defaults are deliberately plain: Organizer, Participant, Programme, Culture Pack, Connection.

## authentication

```json
{
  "providers": [
    {
      "kind": "entra-id",
      "enabled": true,
      "issuer": "https://login.microsoftonline.com/<tenant>/v2.0",
      "clientId": "<client-id>",
      "allowedDomains": ["example.com"],
      "allowedTenantIds": ["<tenant-id>"],
      "scopes": ["openid", "profile", "email"]
    }
  ],
  "magicLink": { "enabled": false },
  "sessionTtlSeconds": 28800,
  "sessionAbsoluteTtlSeconds": 86400,
  "stepUpMaxAgeSeconds": 900,
  "allowedRedirectPaths": ["/"]
}
```

`sessionTtlSeconds` is the sliding window; `sessionAbsoluteTtlSeconds` is the hard ceiling that activity cannot extend. `stepUpMaxAgeSeconds` controls how recently someone must have authenticated to perform sensitive administrative actions such as publishing configuration or requesting an erasure.

`allowedRedirectPaths` is an exact-match allowlist of same-origin paths. Anything not listed falls back to the first entry.

Set `allowedTenantIds` wherever your provider supports it. Domain checks alone are weaker than you would like.

Magic links are modelled in the schema but **not implemented**. Leave them disabled.

## ai

Off by default, and the product works fully with it off. Every AI path has a deterministic fallback that produces a usable result and labels itself as not having used a model.

```json
{
  "enabled": true,
  "providers": [
    {
      "key": "primary",
      "kind": "openai",
      "requestTimeoutMs": 20000,
      "maxRetries": 2
    }
  ],
  "purposes": {
    "copilot_recommendation": {
      "enabled": true,
      "providerKey": "primary",
      "modelId": "gpt-4o-mini",
      "maxOutputTokens": 1024,
      "maxCostUsdPerRequest": 0.1,
      "maxClassification": "internal"
    }
  },
  "egressReviewedBy": "Name of whoever reviewed it",
  "egressReviewedAt": "2026-01-15T00:00:00Z"
}
```

Provider kinds are `openai`, `azure-openai`, `anthropic` and `cloudflare-ai`. Azure additionally needs `baseUrl`, `deployment` and `apiVersion`.

Purposes are `copilot_recommendation`, `pack_draft`, `communication_draft`, `gift_suggestion`, `insight_summary` and `matching_weight_proposal`. Each is enabled separately, so you can allow recommendations without allowing anything near participant content.

`maxClassification` is the ceiling on what may leave the installation for that purpose. A request carrying data above it is rejected before the provider is called.

**`egressReviewedBy` is required when `enabled` is true.** Validation fails without it. The intent is to make somebody put their name against the decision that this data may leave, having read the provider's retention and training terms.

API keys come from Worker secrets named `AI_API_KEY_<PROVIDER_KEY>`, uppercased.

## privacy

| Field                              | Default      | Notes                                                |
| ---------------------------------- | ------------ | ---------------------------------------------------- |
| `consentVersion`                   | `2026-01-01` | Bump to invalidate existing consent and re-ask       |
| `minimumCohortSize`                | `10`         | Floor for any aggregate shown anywhere               |
| `allowConversationHosting`         | `false`      | Platform-hosted threads                              |
| `allowRecognitionPublicVisibility` | `false`      | Whether recognition can be seen beyond its recipient |

Retention periods, all under `privacy.retention`:

| Field                               | Default |
| ----------------------------------- | ------- |
| `magicLinkTokenSeconds`             | 900     |
| `sessionSeconds`                    | 86400   |
| `cultureProfileDaysAfterCompletion` | 90      |
| `conversationDaysAfterCompletion`   | 30      |
| `auditEventDays`                    | 365     |
| `aiRawContentDays`                  | 0       |

These are starting points chosen to be defensible, not legal advice. Your retention schedule is a decision for whoever is accountable for employment data where you operate.

Raising `minimumCohortSize` is the single most effective privacy control available. At the default, a department with nine people produces no visible statistics at all.

Changing `consentVersion` means every existing grant stops being current, participants are asked again, and anything depending on consent stops until they answer. That is the intended behaviour when the purposes you process for have changed.

## notifications

| Field                     | Default | Notes                                              |
| ------------------------- | ------- | -------------------------------------------------- |
| `emailEnabled`            | `false` | Nothing is delivered while false                   |
| `provider`                | `none`  | `resend`, `sendgrid`, `mailchannels`, `smtp-relay` |
| `fromAddress`             | `null`  | Required when email is on                          |
| `replyToAddress`          | `null`  |                                                    |
| `maxPerParticipantPerDay` | `5`     | Hard cap, checked at send time                     |
| `queueBatchSize`          | `25`    | Messages per dispatcher run                        |
| `maxDeliveryAttempts`     | `5`     | Then the message is marked failed                  |

Use a domain with SPF and DKIM configured. Resend and the self-hosted relay honour idempotency keys; SendGrid and MailChannels do not, so duplicates there need reconciling from `delivery_attempts`.

## culturePacks

| Field                    | Default | Notes                          |
| ------------------------ | ------- | ------------------------------ |
| `enabled`                | `[]`    | Slugs available to designers   |
| `pinnedVersions`         | `{}`    | Pin a slug to an exact version |
| `allowImportedPacks`     | `false` | Accept third-party manifests   |
| `allowAiGeneratedPacks`  | `false` | Allow the pack builder         |
| `requireSignedManifests` | `false` | Reserved for a future release  |

Pinning is the mechanism for keeping a running programme stable while the catalogue moves underneath it. An instance already carries a snapshot of its pack, so pinning matters for what designers can create next, not for what is already running.

Leave `allowImportedPacks` off unless you have a review process for manifests you did not write. Validation is thorough, but it checks for the attacks it knows about.

## Worked example

A minimal production configuration with AI off and email on:

```json
{
  "schemaVersion": "1.0.0",
  "setupComplete": true,
  "organization": {
    "name": "Example Corp",
    "slug": "example-corp",
    "defaultLocale": "en-CA",
    "supportedLocales": ["en-CA", "fr-CA"],
    "defaultTimeZone": "America/Toronto",
    "supportContact": "people-ops@example.com"
  },
  "branding": {
    "revision": 1,
    "colors": { "...": "..." },
    "typography": { "...": "..." },
    "assets": {}
  },
  "terminology": { "platformName": "Connect" },
  "authentication": {
    "providers": [
      {
        "kind": "entra-id",
        "enabled": true,
        "issuer": "https://login.microsoftonline.com/abc/v2.0",
        "clientId": "def",
        "allowedDomains": ["example.com"],
        "allowedTenantIds": ["abc"]
      }
    ]
  },
  "ai": { "enabled": false },
  "privacy": {
    "consentVersion": "2026-01-01",
    "minimumCohortSize": 15,
    "retention": {}
  },
  "notifications": {
    "emailEnabled": true,
    "provider": "resend",
    "fromAddress": "connect@example.com"
  },
  "culturePacks": { "enabled": ["coffee-roulette", "appreciation-week"] }
}
```
