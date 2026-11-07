# Staging API

The staging API is what TestFlight builds talk to, so Ball Boi works away from home. It runs the same Express API as `pnpm dev`, hosted on Cloudflare.

- **API**: a Cloudflare Container (`artifacts/api-host`) running `artifacts/api-server/Dockerfile`. A small Worker in front forwards every request to it. It sleeps after 15 idle minutes; the first request after that takes a few seconds while it wakes.
- **Database**: Postgres on Neon's free plan (Cloudflare doesn't host Postgres). Separate from any future production database.
- **Video**: the `ballboi-staging` R2 bucket.
- **Deploys**: `.github/workflows/deploy-staging-api.yml` runs on every merge to `main` that changes the API, shared libraries or migrations. Each start applies new SQL migrations.

## What it costs

Cloudflare Containers need the Workers Paid plan: $5/month, which includes enough container time for a staging API that's mostly asleep. Neon's free plan covers staging. R2's free tier covers 10 GB of video.

## Known limits on staging

- **Scheduled jobs only run while the API is awake.** Match reminders and other `node-cron` jobs skip while it sleeps. Fine for testing; production will need a different setup.
- **Messages reset when the API sleeps**, because staging uses the in-memory messaging provider. Switching `MESSAGING_PROVIDER` to `stream` (with keys) fixes that.
- **No ML server yet.** Recording and upload work; Ball Boi analysis waits until the ML server is hosted.

## Secrets

Set as GitHub repository secrets (Settings > Secrets and variables > Actions). The deploy copies them to the Worker. Never commit them or paste them in chat.

| Secret | Where it comes from |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare > My Profile > API Tokens: "GitHub deploy: ballboi staging API" (Workers Scripts, Containers and Cloudchamber edit) |
| `DATABASE_URL` | Neon > project > Connection string (pooled, `sslmode=require`) |
| `CLERK_SECRET_KEY` | Clerk > Development instance > API Keys (same instance as local). The publishable key is public and lives in `wrangler.jsonc` |
| `ADMIN_EMAIL` | The email that gets admin access |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | R2 API token scoped to `ballboi-staging` (Object Read & Write) |
| `ANTHROPIC_API_KEY` | Optional; turns on the moderation agent |

The account ID and R2 endpoint aren't secret, so they live in `artifacts/api-host/wrangler.jsonc`.

Repository variable `STAGING_API_URL` (`https://ballboi-api-staging.jr-26c.workers.dev`) lets the deploy check that the API answers. The same URL goes into EAS as `EXPO_PUBLIC_API_URL` for the `preview` environment.

## First deploy

On a brand-new database, run the workflow by hand once (Actions > Deploy staging API > Run workflow) with **create_schema** checked. That creates the tables, then later deploys only apply SQL migrations. Never check it on a database that has data.
