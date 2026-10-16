# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Ball Boi is a tennis league app (leagues, invites, availability-based scheduling, standings, score recording) plus "Ball Boi" match video analysis. It was imported from Replit; `replit.md` has detailed product notes (pages, endpoints, scheduling rules, design tokens) and is worth reading for feature work.

## Commands

Use pnpm only; a `preinstall` hook rejects npm and yarn. Requires Node 22+, pnpm 10, and Docker.

```sh
pnpm install
cp .env.example .env        # add Clerk dev keys; ADMIN_EMAIL controls who is admin
pnpm db:up                  # Postgres 16 in Docker (db:down to stop)
pnpm db:push                # drizzle-kit push of lib/db schema to local DB
pnpm dev                    # API :8080 + web :5173 (scripts/dev.sh; loads .env)
pnpm dev:ios                # Expo app in the iOS Simulator (needs Xcode; run alongside pnpm dev)
pnpm dev:ml                 # optional FastAPI ML server on :8000

pnpm test                   # api-server + tennis-league vitest suites
pnpm typecheck              # tsc --build for lib/*, then per-package typecheck
pnpm build                  # typecheck + build all packages
```

Single tests:

```sh
pnpm --filter @workspace/api-server exec vitest run src/__tests__/roundPairing.test.ts
pnpm --filter @workspace/tennis-league exec vitest run src/__tests__/parseScore.test.ts -t "tiebreak"
cd artifacts/ml-server && .venv/bin/python -m pytest tests/test_court_detection.py   # ML tests; venv setup in README
```

`pnpm typecheck` currently fails on type errors carried over from Replit (see README), so check that you haven't added new ones instead of expecting it to pass. The ML server needs Python 3.10+ and OpenCV below 5.

Tests live in `src/__tests__/` in each package. API tests run in the node environment and mock `@clerk/express`, the logger, object storage, and `@workspace/db` with `vi.mock`, then exercise routers through `supertest`. No live database is needed (`vitest.config.ts` sets a placeholder `DATABASE_URL`). Web tests use jsdom.

`scripts/with-env.sh <cmd>` runs any command with `.env` loaded.

## Architecture

pnpm monorepo (`pnpm-workspace.yaml`): deployable apps in `artifacts/*`, shared libraries in `lib/*`, and repo scripts in `scripts`. Shared dependency versions are pinned via the workspace `catalog:`. Don't add platform-exclusion `overrides` for native binaries (esbuild, rollup, lightningcss, Tailwind oxide): Replit had them and they break installs on macOS. `minimumReleaseAge` blocks npm versions less than a day old, so don't disable it.

- **`artifacts/api-server`**: Express 5 API. All routes are mounted under `/api` in `src/routes/index.ts`, one router per domain. `clerkMiddleware()` runs globally. Routes call `getAuth(req)` themselves, and admin-only routes use `middlewares/requireAdmin.ts`, which compares the Clerk primary email to `ADMIN_EMAIL`. Business logic lives in `src/services/` (round pairing, match generation, playoff brackets, seasons, Ball Boi retry), and pure helpers live in `src/lib/`. It is bundled with esbuild (`build.mjs`). `pnpm dev` builds and then starts the server, so there is no hot reload. Startup runs the SQL migrations, seeds global seasons, then starts `node-cron` jobs in `services/scheduler.ts` (round generation, schedule generation, availability and match reminders, and web/Expo push).
- **`artifacts/tennis-league`**: React 19 + Vite web app using Wouter routing, TanStack Query, Tailwind v4, shadcn/ui (`src/components/ui`), and Clerk. The Vite dev server proxies `/api` to the API (`API_PORT` / `API_PROXY_TARGET`). `@/` aliases `src/`.
- **`artifacts/mobile`**: Expo SDK 54 app using expo-router (`app/`), `@clerk/expo` with email/password sign-in, and the same generated React Query hooks as the web app. The API base URL comes from `EXPO_PUBLIC_API_URL` via `setBaseUrl`, and Clerk session tokens are sent as `Authorization: Bearer` through `setAuthTokenGetter`. Keep Expo packages on SDK 54 versions: check with `pnpm --filter @workspace/mobile exec expo install --check`.
- **`artifacts/ml-server`**: FastAPI service (`main.py`, `services/analyzer.py`) for ball and shot detection, court-line detection, and perspective mapping. All analysis endpoints require an `X-ML-Secret` header matching `ML_SECRET`. The API calls it at `ML_SERVICE_URL` (`/analyze-match-live` for live frames, `/analyze-match-batch` for post-match video), and the ML server posts results back to the API's shot-callback route.
- **`lib/db`**: Drizzle ORM schema (`src/schema/*.ts`, one file per table group) and the shared `db` client, imported as `@workspace/db`.
- **`lib/api-spec`**: `openapi.yaml` is the API contract. Orval generates two packages from it:
  - `lib/api-client-react/src/generated`: React Query hooks used by the web app, fetching through `custom-fetch.ts`
  - `lib/api-zod/src/generated`: Zod schemas used by the API for validation

  Generated code is committed. After editing the spec, run `pnpm --filter @workspace/api-spec run codegen`, then `pnpm typecheck`. Don't hand-edit `generated/`.
- **Object storage** (`api-server/src/lib/objectStorage.ts`) is S3-compatible: SeaweedFS from docker-compose locally (`pnpm db:up` also creates the bucket), R2 or S3 in production, configured with `S3_*` env vars. Clients upload and play video through presigned URLs. The ML server downloads through `/api/storage/objects/*` with `X-ML-Secret`. The database stores `/objects/<key>` paths. Presigned PUTs need `requestChecksumCalculation: "WHEN_REQUIRED"`; without it every upload fails with BadDigest. `lib/object-storage-web` is currently unused.

### Schema changes

Production does not use `drizzle-kit push`. `scripts/run-db-migrations.mjs` applies each `scripts/migrations/*.sql` file once, in filename order, tracked in a `schema_migrations` table. It runs on API start and in `scripts/post-merge.sh`. A schema change needs both an update to the Drizzle schema in `lib/db/src/schema/` and a new date-prefixed (`YYYYMMDD_name.sql`), idempotent SQL migration. Locally, `pnpm db:push` syncs the Drizzle schema.

### Product rules that aren't obvious from code

- Players join leagues only through invite links (`/join/:code`). Accepting an invite creates the league player record and links it to the Clerk user. Manual player creation and profile claiming are not normal flows.
- Scheduling is driven by player availability and rematch rules. Location, distance, and geocoding code (e.g. `playerLocations`, `courts` tables) is legacy and unused. Match location is free text.
- Scores are stored as strings like `6-3, 7-5, 7-6(4)`, with the tiebreak loser's points in parentheses, and the winner is derived from set wins.
- Standings exclude matches from seasons that have ended. Seasons can be per-league or global (`league_id` null), and per-league seasons take precedence (`services/seasonService.ts`).
- Day-before reminders are at-most-once: the reminder is claimed in `match_reminders_log` before the push is sent.
- UI: no emojis.
