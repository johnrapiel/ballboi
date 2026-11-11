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
- **Messages are kept in the database until staging has Stream keys.** Staging runs the in-memory messaging provider, and the container's disk is wiped each time it sleeps or deploys. Until Nov 10 that emptied every chat; now the provider saves its messages to the `messaging_memory_snapshot` table (`MESSAGING_MEMORY_STORE=database`). The `STREAM_API_KEY` and `STREAM_API_SECRET` secrets are set, but staging stays on the database (`MESSAGING_PROVIDER=memory`) until chat on Stream is fixed and tested (Nov 11). Switching to Stream is then a one-line change to `MESSAGING_PROVIDER` in `artifacts/api-host/wrangler.jsonc`. Messages saved in the snapshot don't move to Stream.
- **No ML server yet.** Recording and upload work; Ball Boi analysis waits until the ML server is hosted.

## Test data

Actions > **Seed staging data** > Run workflow loads the same demo data as `pnpm seed:demo` into staging. Run it whenever you want a fresh, realistic set to review on TestFlight; each run resets the demo data to the same state (dates move with today). It only touches demo accounts, demo leagues and the rounds and matches in your Test League 1, never anyone else's data or the tables, and its log shows counts only. Tick **include_walkthrough** to also make walkthrough accounts B, C and D (`pnpm seed:walkthrough`).

Since Nov 8, staging seeds only John's three leagues and the demo players in them, every demo account has "Show me in Discover" off, and no demo Open leagues: beta testers see no fake players in Discover, Quick match or New message search, and no fake Open leagues (John still sees his league mates in the leagues they share). Running it once also removes the fake Discover players and Open leagues earlier runs made. The nearby players and Open leagues are for local development only: `pnpm seed:demo --discover`.

What you'll see in the app (sign in with the `ADMIN_EMAIL` account):

- **Test League 1** (Private, you run it): 13 players, today is the last day of week 4. Three weeks of results, your match tonight at 6:30 PM at Memorial Park, Beacon, Round 5 pairings waiting for review in Manage, and a join request from Olivia Park. Made for you if it doesn't exist yet.
- **Dutchess County Singles** (Private, you run it, so it isn't listed in Discover): full at 10 players, week 3, your match later this week at Spratt Park, and three players on the waitlist.
- **Hudson Valley Summer Singles** (Past): final standings and a finished top-8 playoff.
- **Discover**: no demo players and no demo Open leagues. Only real testers who left "Show me in Discover" on.
- **Messages**: not seeded.

Every demo player in your leagues is a real Clerk Development account: sign in as one with `ballboi-demo-first-last+clerk_test@example.com` (for example `ballboi-demo-maya-chen+clerk_test@example.com`) and code 424242.

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
| `STREAM_API_KEY`, `STREAM_API_SECRET` | Optional. Stream > app > Overview. Used only when `MESSAGING_PROVIDER` in wrangler.jsonc is `auto` or `stream` |

The account ID and R2 endpoint aren't secret, so they live in `artifacts/api-host/wrangler.jsonc`.

Repository variable `STAGING_API_URL` (`https://ballboi-api-staging.jr-26c.workers.dev`) lets the deploy check that the API answers. The same URL goes into EAS as `EXPO_PUBLIC_API_URL` for the `preview` environment.

## First deploy

On a brand-new database, run the workflow by hand once (Actions > Deploy staging API > Run workflow) with **create_schema** checked. That creates the tables, then later deploys only apply SQL migrations. Never check it on a database that has data.
