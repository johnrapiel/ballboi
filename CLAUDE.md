# Ball Boi

iOS tennis app: find local players, run leagues, and record matches with Ball Boi shot analysis. Ships on the App Store, meets Apple's guidelines and WCAG 2.2 AA.

John (owner) is a product designer, not an engineer. Explain changes in plain language and lead with outcomes.

## Sources of truth

Build from these, in this order. If the repo disagrees with them, the live source wins; flag the gap and update the snapshot.

1. **Product spec** (live): https://claude.ai/code/artifact/ff76f66f-d4ec-49cb-b49a-7b9ad76fb102. Snapshot: `docs/product-spec.md`. The decision log at its end is the latest word.
2. **Design system** (live): https://claude.ai/artifact/XRuxb1uAfy18AQ1irQCkrf. Snapshot: `docs/design-system/README.md` and `docs/design-system/tokens.json`.
3. **Screen designs**: the "Ball Boi iOS" design canvas, https://claude.ai/artifact/LCm9Q9eKeRypqioMcTqDBU.
4. **App Store checklist**: `docs/app-store-checklist.md`. Update its status column in the same PR that changes an item.

Don't invent product behavior. If the spec doesn't cover something, ask John.

The mobile app's current screens came over from the original Replit build. They're being replaced flow by flow with screens built from the spec, design system, and canvas. Don't polish an old screen; rebuild it.

## Design rules

- Colors, type, spacing, and radii come from the design system tokens only: `paper`, `linen`, `sand`, `ink`, `ink-muted`, `on-ink`, `pool`, `clay`, `sun`, `danger`. Cormorant Garamond for display and scores, DM Sans for everything else.
- Retired, don't add new uses: the old palette (Ink Navy, Court Cream, Teal Ace), the generic cyan palette in `constants/colors.ts`, and the Inter, Playfair Display, and DM Mono fonts.
- Every text pair clears 4.5:1 (3:1 for 24px+ text, focus rings, and control borders) in both Day and Night themes. `sun` is never text.
- Color is never the only signal: pair it with an icon or text.
- Touch targets are at least 44×44pt. Dynamic Type stays on. Respect Reduce Motion. Every interactive element has an `accessibilityLabel`.
- Voice cues always have a text caption. Gestures always have a non-gesture alternative.
- No emojis in the UI.

## How work ships

- Every change goes through a pull request. Never push to `main`.
- One feature per PR, with a plain-English description: what changed, which spec section and canvas screen it implements, which checklist item it covers, and how to test it on a phone.
- Any `package.json` change must commit the regenerated `pnpm-lock.yaml` in the same PR.
- Before calling a PR ready, run `pnpm typecheck` and `pnpm test` and say what passed.
- Use merge commits for stacked PRs; squash is fine otherwise.
- Don't run destructive database migrations without John's go-ahead.
- Never commit secrets. Keys live in `.env` locally and in Cloudflare secrets in production.

## Commands

Use pnpm only; a `preinstall` hook rejects npm and yarn. Requires Node 22+, pnpm 10, and Docker.

```sh
pnpm install
cp .env.example .env        # add Clerk dev keys; ADMIN_EMAIL controls who is admin
pnpm db:up                  # Postgres and local object storage in Docker (db:down to stop)
pnpm db:push                # drizzle-kit push of lib/db schema to local DB
pnpm dev                    # API on :8080 (scripts/dev.sh; loads .env)
pnpm dev:mobile             # Expo app in Expo Go on a phone (run alongside pnpm dev)
pnpm dev:ml                 # optional FastAPI ML server on :8000

pnpm test                   # api-server vitest suite
pnpm typecheck              # tsc --build for lib/*, then per-package typecheck
pnpm build                  # typecheck + build all packages
```

Single tests:

```sh
pnpm --filter @workspace/api-server exec vitest run src/__tests__/roundPairing.test.ts
cd artifacts/ml-server && .venv/bin/python -m pytest tests/test_court_detection.py   # ML tests; venv setup in README
```

`pnpm typecheck` may still report type errors carried over from the original build; check that you haven't added new ones. The ML server needs Python 3.10+ and OpenCV below 5.

API tests live in `src/__tests__/`, run in the node environment, and mock `@clerk/express`, the logger, object storage, and `@workspace/db` with `vi.mock`, then exercise routers through `supertest`. No live database is needed.

`scripts/with-env.sh <cmd>` runs any command with `.env` loaded.

## Architecture

pnpm monorepo (`pnpm-workspace.yaml`): deployable apps in `artifacts/*`, shared libraries in `lib/*`, and repo scripts in `scripts`. Shared dependency versions are pinned via the workspace `catalog:`. Don't add platform-exclusion `overrides` for native binaries (esbuild, rollup, lightningcss, Tailwind oxide); they break installs on macOS. `minimumReleaseAge` blocks npm versions less than a day old, so don't disable it.

- **`artifacts/mobile`**: the product. Expo SDK 58 app using expo-router (`app/`), Clerk via `@clerk/expo`, and the generated React Query hooks from `lib/api-client-react`. The API base URL comes from `EXPO_PUBLIC_API_URL` via `setBaseUrl`, and Clerk session tokens are sent as `Authorization: Bearer` through `setAuthTokenGetter`. Keep Expo packages on SDK 58 versions (Expo Go only runs the latest SDK; `expo` is pinned to 58.0.10 because newer patches needed a CLI younger than `minimumReleaseAge`): check with `pnpm --filter @workspace/mobile exec expo install --check`.
- **`artifacts/api-server`**: Express 5 API. All routes are mounted under `/api` in `src/routes/index.ts`, one router per domain. `clerkMiddleware()` runs globally. Routes call `getAuth(req)` themselves, and admin-only routes use `middlewares/requireAdmin.ts`, which compares the Clerk primary email to `ADMIN_EMAIL`. Business logic lives in `src/services/`, pure helpers in `src/lib/`. Bundled with esbuild (`build.mjs`); `pnpm dev` builds then starts, so there is no hot reload. Startup runs the SQL migrations, seeds global seasons, then starts `node-cron` jobs in `services/scheduler.ts`.
- **`artifacts/ml-server`**: FastAPI service (`main.py`, `services/analyzer.py`) for ball and shot detection, court-line detection, and perspective mapping. Analysis endpoints require an `X-ML-Secret` header matching `ML_SECRET`. The API calls it at `ML_SERVICE_URL`, and the ML server posts results back to the API's shot-callback route.
- **`lib/db`**: Drizzle ORM schema (`src/schema/*.ts`) and the shared `db` client, imported as `@workspace/db`.
- **`lib/api-spec`**: `openapi.yaml` is the API contract. Orval generates `lib/api-client-react/src/generated` (React Query hooks) and `lib/api-zod/src/generated` (Zod schemas for the API). Generated code is committed. After editing the spec, run `pnpm --filter @workspace/api-spec run codegen`, then `pnpm typecheck`. Don't hand-edit `generated/`.
- **Object storage** (`api-server/src/lib/objectStorage.ts`) is S3-compatible: SeaweedFS from docker-compose locally, Cloudflare R2 in production, configured with `S3_*` env vars. The database stores `/objects/<key>` paths. Presigned PUTs need `requestChecksumCalculation: "WHEN_REQUIRED"`; without it every upload fails with BadDigest. Per the spec, match video is analysis input only: never played back in the app.
- **Infrastructure:** Cloudflare. Keep new services there where possible and keep costs near zero for the MVP. Replit and the old web app are retired; don't reintroduce either.

### Schema changes

Production doesn't use `drizzle-kit push`. `scripts/run-db-migrations.mjs` applies each `scripts/migrations/*.sql` file once, in filename order, tracked in a `schema_migrations` table, on API start. A schema change needs both an update to the Drizzle schema in `lib/db/src/schema/` and a new date-prefixed (`YYYYMMDD_name.sql`), idempotent SQL migration.

### Backend rules that aren't obvious from code

More detail in `docs/backend-notes.md`.

- Scores are stored as strings like `6-3, 7-5, 7-6(4)`, with the tiebreak loser's points in parentheses; the winner is derived from set wins.
- Standings exclude matches from seasons that have ended. Per-league seasons take precedence over global ones (`services/seasonService.ts`).
- Day-before reminders are at-most-once: the reminder is claimed in `match_reminders_log` before the push is sent.
- Today, players join leagues only through invite links and scheduling ignores location. The spec changes both (Open leagues, Find a Matchup, home area); follow the spec when building those features.
