# API reference

Everything is under `/api/v1` on the same origin as the web app. Routes are defined in `apps/api/src/routes/`.

## Conventions

Successful responses:

```json
{ "data": {}, "meta": { "requestId": "...", "revision": 3 } }
```

Errors:

```json
{
  "error": {
    "code": "forbidden",
    "message": "Not permitted",
    "requestId": "..."
  }
}
```

Codes are stable and safe to branch on. Messages are for humans and may change. Neither carries diagnostics or internal detail.

### Authentication

A `__Host-cs_session` cookie, HttpOnly and SameSite=Lax. There is no bearer token, and nothing authentication-related is readable by script.

Unsafe methods additionally require the `x-cs-csrf` header matching the readable `__Host-cs_csrf` cookie, and an `Origin` that matches the configured base URL. The CSRF token is bound to the session record server-side, so a token minted elsewhere will not work.

### Headers

`Idempotency-Key` is required on: instance creation, launch, match run creation, match run publication, pack publication, and privacy requests. Reusing a key with a different body is a conflict rather than a second execution.

`If-Match` carries the revision you read and is required on: configuration and branding updates, experience and instance patches, and launch.

Request bodies must be `application/json` and cap at 64 KB.

## Health and setup

| Route                   | Who             | Notes                                         |
| ----------------------- | --------------- | --------------------------------------------- |
| `GET /health`           | anyone          | Bare status. Deliberately uninformative       |
| `POST /admin/bootstrap` | `x-setup-token` | One-time. Refuses once an organization exists |

## Authentication

| Route                          | Notes                                  |
| ------------------------------ | -------------------------------------- |
| `GET /auth/:provider/start`    | Begins OIDC with PKCE, state and nonce |
| `GET /auth/:provider/callback` | Verifies the token, issues a session   |
| `POST /auth/logout`            | Revokes server-side                    |
| `GET /me`                      | Current user, roles, locale, time zone |

`:provider` is `entra-id` or `google-workspace`.

## Administration

| Route                               | Permission                            |
| ----------------------------------- | ------------------------------------- |
| `GET /admin/config`                 | `config:read`                         |
| `PUT /admin/config`                 | `config:write`, step-up, `If-Match`   |
| `GET /admin/branding`               | `branding:read`                       |
| `PUT /admin/branding`               | `branding:write`, step-up, `If-Match` |
| `GET /admin/branding/assets`        | `branding:read`                       |
| `POST /admin/branding/assets/:slot` | `branding:write`, step-up             |
| `GET /branding/assets/:slot`        | signed in                             |
| `GET /admin/audit`                  | `audit:read`, step-up                 |
| `GET /admin/operations`             | `instances:read`                      |

Reading the audit log is itself audited.

Asset upload is the one route that takes a binary body rather than JSON. Slots are
`logoLight`, `logoDark`, `favicon`, `emailHeader`, `bodyFontFile` and `headingFontFile`.
Images are capped at 512 KB and fonts at 1 MB. Every upload is checked against magic
bytes rather than the declared type, a font slot refuses an image and an image slot
refuses a font, and SVGs carrying script or external references are rejected. Assets are
served only to signed-in users, under a restrictive CSP, because the bucket has no
public access.

`GET /branding` is separate from `GET /admin/branding`. It returns presentation data
only — theme tokens, terminology and the organization name — and is readable by any
signed-in user, because every page has to render the theme. `GET /admin/branding` and
the write routes remain behind `branding:read` and `branding:write`.

`/admin/operations` deliberately does not require step-up. Making an operator re-authenticate to check health during an incident would be backwards.

## Privacy

| Route                                      | Notes                                    |
| ------------------------------------------ | ---------------------------------------- |
| `POST /admin/privacy/export`               | Queues an export                         |
| `POST /admin/privacy/erase`                | Queues an erasure                        |
| `GET /admin/privacy/requests`              | Request history and state                |
| `GET /admin/privacy/requests/:id/download` | Streams the export, audited per download |
| `GET /admin/privacy/holds`                 | Active legal holds                       |
| `POST /admin/privacy/holds`                | Place a hold, blocking erasure           |
| `DELETE /admin/privacy/holds/:id`          | Release a hold                           |

All require step-up. Exports expire after seven days and the download route checks expiry before serving.

## Culture Packs

| Route                                | Permission               |
| ------------------------------------ | ------------------------ |
| `GET /packs`                         | `packs:read`             |
| `GET /packs/:slug/versions/:version` | `packs:read`             |
| `POST /packs/import`                 | `packs:import`, step-up  |
| `POST /packs/:slug/versions`         | `packs:publish`, step-up |
| `POST /packs/:slug/enable`           | `packs:enable`, step-up  |
| `POST /packs/:slug/retire`           | `packs:retire`, step-up  |

Import lands as a draft and never publishes directly. Retiring hides a pack from new instances without touching running ones.

### Drafts

| Route                             | Permission               |
| --------------------------------- | ------------------------ |
| `GET /packs/drafts`               | `packs:draft`            |
| `GET /packs/drafts/:id`           | `packs:draft`            |
| `POST /packs/drafts:generate`     | `packs:draft`            |
| `POST /packs/drafts/:id/validate` | `packs:draft`            |
| `POST /packs/drafts/:id/publish`  | `packs:publish`, step-up |
| `DELETE /packs/drafts/:id`        | `packs:draft`            |

Publishing re-runs the full review rather than trusting the stored result, so a draft approved before a policy tightened cannot slip through. Generated packs publish disabled; enabling is a separate decision with its own audit entry.

## Experiences

| Route                             | Permission                           |
| --------------------------------- | ------------------------------------ |
| `GET /experiences`                | `experiences:read`                   |
| `POST /experiences`               | `experiences:write`                  |
| `GET /experiences/:id`            | `experiences:read`                   |
| `PATCH /experiences/:id`          | `experiences:write`, `If-Match`      |
| `GET /experiences/:id/instances`  | `instances:read`                     |
| `POST /experiences/:id/instances` | `instances:write`, `Idempotency-Key` |

## Instances

| Route                        | Permission                                        |
| ---------------------------- | ------------------------------------------------- |
| `GET /instances/:id`         | `instances:read`                                  |
| `PATCH /instances/:id`       | `instances:write`, `If-Match`                     |
| `POST /instances/:id/launch` | `instances:launch`, `If-Match`, `Idempotency-Key` |

State transitions go through `PATCH` with the target state. The server enforces the lifecycle: `draft` → `enrolling` → `locked` → `active` → `reveal_pending` → `completed`, with `cancelled` reachable from most states and `archived` terminal.

Transitions have preconditions. An instance cannot become `active` without published matches, and cannot enter `reveal_pending` unless its launch snapshot enabled reveal.

## Participation

| Route                                            | Notes                                 |
| ------------------------------------------------ | ------------------------------------- |
| `GET /me/instances`                              | Yours, plus anything open for sign-up |
| `POST /instances/:id/enroll`                     | Idempotent                            |
| `POST /instances/:id/withdraw`                   | Idempotent                            |
| `GET /instances/:id/participants/me`             | Your own record only                  |
| `PUT /instances/:id/participants/me/preferences` | Preferences and per-purpose consent   |
| `DELETE /instances/:id/participants/me/profile`  | Revokes derived data                  |
| `GET /instances/:id/my-match`                    | Peers, filtered by privacy mode       |
| `GET /instances/:id/peers`                       | Directory, if the mode allows one     |
| `GET`/`POST /instances/:id/activities`           |                                       |
| `GET`/`POST /instances/:id/recognitions`         | Encrypted at rest                     |

`my-match` resolves peer identity server-side according to the instance snapshot. Before a reveal it returns a pseudonym regardless of what the client requests.

## Matching

| Route                                           | Permission                             |
| ----------------------------------------------- | -------------------------------------- |
| `POST /instances/:id/match-runs`                | `matchruns:create`, `Idempotency-Key`  |
| `GET /instances/:id/match-runs/:runId`          | `matchruns:read`                       |
| `POST /instances/:id/match-runs/:runId/publish` | `matchruns:publish`, `Idempotency-Key` |

Creating a run returns `202` with diagnostics and a fairness report. If unmatched participants exist, publishing requires `acknowledgedUnmatched: true` in the body.

## Insights and AI

| Route                           | Permission      |
| ------------------------------- | --------------- |
| `GET /instances/:id/insights`   | `insights:read` |
| `POST /copilot/recommendations` | `ai:copilot`    |

Insights suppress anything below the cohort threshold. Copilot responses carry a `source` of `ai` or `deterministic_fallback` so the client can say which produced the answer, and always set `requiresHumanApproval`.

## Error codes

| Code                       | Status |
| -------------------------- | ------ |
| `unauthenticated`          | 401    |
| `csrf_failed`              | 403    |
| `forbidden`                | 403    |
| `not_found`                | 404    |
| `conflict`                 | 409    |
| `invalid_state_transition` | 409    |
| `precondition_required`    | 428    |
| `precondition_failed`      | 412    |
| `validation_failed`        | 422    |
| `policy_violation`         | 422    |
| `consent_required`         | 422    |
| `capability_disabled`      | 422    |
| `ai_disabled`              | 422    |
| `payload_too_large`        | 413    |
| `unsupported_media_type`   | 415    |
| `rate_limited`             | 429    |
| `ai_provider_error`        | 502    |
| `dependency_unavailable`   | 503    |
| `internal_error`           | 500    |

A `forbidden` response carrying `details.reason` of `step_up_required` means re-authenticate and retry rather than that the permission is missing.

Cross-organization access returns `forbidden` rather than confirming whether the resource exists.
