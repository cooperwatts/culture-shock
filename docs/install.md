# Installing on Cloudflare

This walks through a deployment into an account you control. Budget an afternoon the first time, mostly spent waiting on DNS and identity provider configuration.

You will need a Cloudflare account with Workers, D1, R2 and Queues available, admin access to either Microsoft Entra ID or Google Workspace, and a domain you can point at Cloudflare.

## 1. Create the resources

```bash
wrangler d1 create culture_shock
wrangler r2 bucket create culture-shock-assets
wrangler queues create culture-shock-jobs
wrangler queues create culture-shock-jobs-dlq
```

Take the database ID that `d1 create` prints and put it in both `apps/api/wrangler.toml` and `apps/jobs/wrangler.toml`. The placeholder zeroes in the checked-in files are there to make a misconfiguration obvious rather than silently working against the wrong database.

Set `PUBLIC_BASE_URL` in both files to the origin you will actually serve from. Session cookies use the `__Host-` prefix, so this has to be HTTPS on a real domain outside local development.

Keep environments apart. The configuration files define `staging` and `production` sections for this. Never point a preview deployment at production D1; it is the single easiest way to leak data in this system.

## 2. Generate and set secrets

Three keys need generating. Use separate values for each, since the whole point of splitting the encryption key from the lookup HMAC key is that compromising one does not hand over the other.

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Run it three times, then:

```bash
cd apps/api
wrangler secret put FIELD_ENCRYPTION_KEY
wrangler secret put EMAIL_LOOKUP_HMAC_KEY
wrangler secret put SETUP_TOKEN
wrangler secret put OIDC_CLIENT_SECRET_ENTRA_ID        # or GOOGLE_WORKSPACE
```

The jobs Worker needs the encryption key too, because it decrypts work email addresses at send time:

```bash
cd ../jobs
wrangler secret put FIELD_ENCRYPTION_KEY
wrangler secret put EMAIL_PROVIDER_API_KEY             # once you enable email
```

`apps/api/.dev.vars.example` lists every secret the system reads, including the AI provider keys you only need if you turn AI on. The naming convention for provider secrets is derived from the provider kind or key, uppercased with non-alphanumerics replaced by underscores, so a provider configured as `entra-id` reads `OIDC_CLIENT_SECRET_ENTRA_ID`.

## 3. Apply migrations

```bash
pnpm db:migrate:remote
```

Migrations are forward-only. Rolling the application back to a previous version is supported as long as the schema is compatible, but rolling a migration back is not. Take a backup before applying anything to a database with real data in it.

## 4. Deploy

Order matters. The jobs Worker first, so background processing is ready before anything produces work for it:

```bash
cd apps/jobs && wrangler deploy --env production
cd ../api  && wrangler deploy --env production
cd ../web  && pnpm deploy
```

Point `/api/v1/*` at the API Worker and everything else at the web Worker, on the same origin. Same-origin routing is not a convenience here: the session cookie is `SameSite=Lax` and `__Host-` prefixed, and splitting the origins breaks authentication.

Check it responds:

```bash
curl https://your-domain.example/api/v1/health
```

That route returns a bare status and nothing else. It will not tell you whether the database is reachable, which is intentional, since an unauthenticated endpoint should not be a reconnaissance tool.

## 5. Bootstrap the installation

A fresh database has no organization, so the normal routes have nothing to attach to. One unauthenticated route exists to fix that, guarded by the `SETUP_TOKEN` secret and refusing to run once an organization exists.

```bash
curl -X POST https://your-domain.example/api/v1/admin/bootstrap \
  -H "content-type: application/json" \
  -H "x-setup-token: $SETUP_TOKEN" \
  -d '{
    "organizationName": "Example Corp",
    "organizationSlug": "example-corp",
    "locale": "en-CA",
    "timeZone": "America/Toronto",
    "identityProviders": [{
      "kind": "entra-id",
      "issuer": "https://login.microsoftonline.com/<tenant-id>/v2.0",
      "clientId": "<client-id>",
      "allowedDomains": ["example.com"]
    }]
  }'
```

This creates the organization, registers your identity providers, publishes a locked-down default configuration, and seeds the five built-in packs through the same validation an imported pack would face.

**Now unset the token.** It is an unauthenticated route and it has done its job:

```bash
wrangler secret delete SETUP_TOKEN --env production
```

## 6. Configure the identity provider

In Entra ID or Google Workspace, register an application with the redirect URI:

```
https://your-domain.example/api/v1/auth/entra-id/callback
```

Substitute `google-workspace` for the other provider. Request the `openid`, `profile` and `email` scopes.

The platform verifies the issuer, audience, signature, expiry, state and nonce on every callback, and checks the tenant and domain allowlists you configured. An email domain alone is never treated as identity, so configure `allowedTenantIds` where your provider supports it.

## 7. Sign in and finish setup

Visit the site and sign in. **The first account to authenticate becomes the administrator.** Every account after that starts as a participant. Do this yourself, immediately, before you tell anyone the system exists.

Then publish a real configuration. `GET /api/v1/admin/config` returns the current document and its revision; `PUT` the edited version back with an `If-Match` header carrying that revision. At minimum you want to set `setupComplete` to `true`, enable the packs you intend to use, set `privacy.consentVersion`, and adjust branding.

Brand colours are checked against a 4.5:1 contrast ratio and the publish is rejected if they fail. This catches the common case where a brand palette looks fine in a deck and is unreadable on screen.

## 8. Enable email

Nothing is delivered until you configure a provider. Set `notifications.emailEnabled`, pick a `provider`, and set `fromAddress` to an address on a domain you have authenticated with SPF and DKIM.

Supported providers are Resend, SendGrid, MailChannels, and a self-hosted SMTP relay you expose over HTTPS. Resend and the relay honour an idempotency key; SendGrid and MailChannels do not, which means duplicate sends are possible there and you should reconcile from the `delivery_attempts` table rather than assuming exactly-once.

## 9. Work through the readiness checks

[docs/operations/readiness.md](operations/readiness.md) lists what to verify before real participants arrive. The load test and the restore rehearsal in particular are worth doing while nothing is at stake.

## Upgrading later

Pull, install, apply migrations, redeploy in the same order: jobs, API, web.

Published pack versions are immutable, so upgrading the platform never rewrites a running experience. Instances carry a snapshot of the pack they launched with. If a new platform version adds capabilities, existing packs carry on unchanged until someone publishes a new version of them.
