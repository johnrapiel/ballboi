# Tennis League Manager

A full-featured Tennis League Manager web app with Clerk authentication and a PolyMarket-inspired dark UI.

## Design
- Wilson heritage brand aesthetic: court-cream (#F5F0E8) light / deep-navy (#0F1520) dark
- Teal Ace (#00B4A0) primary accent; Ink Navy (#1A2744) primary text (light mode)
- Typography: Playfair Display (display/headings), DM Sans (body/UI), DM Mono (labels/data)
- Light mode is the default; Sun/Moon toggle persists preference in localStorage
- Theme toggle button in sidebar (desktop) and mobile header
- No emojis anywhere in the UI

## Authentication
- Clerk auth with white-label proxy setup
- Home route (/) is a public landing page for unauthenticated users
- After sign-in, users are redirected to /dashboard
- Protected user routes: /dashboard, /leagues, /my-matches, /availability, /profile
- Legacy/deep-link routes remain available for player and match details; /matches and /schedule redirect to /my-matches in the streamlined player navigation
- Public routes: /, /sign-in, /sign-up, /join/:code (invite acceptance)
- Profile onboarding at /onboarding after first sign-up

## Architecture

### Frontend (`artifacts/tennis-league`)
- React + Vite, Tailwind v4, shadcn/ui components
- Wouter for routing
- TanStack Query for data fetching
- Framer Motion for animations
- ClerkProvider wraps all routes
- Port: `$PORT` (env var), configured via vite.config.ts

### API Server (`artifacts/api-server`)
- Express + routes
- Port: 8080
- All routes under `/api/*`
- Clerk middleware for auth verification
- `requireAuth` guard on protected routes
- Scheduler runs availability-based schedule generation and reminders. Day-before match reminders respect each linked player's notification preference and are deduplicated with a per-match reminder log. The job claims the reminder before sending, so day-before reminders are at-most-once per match date rather than retried after a push-send failure. Player home location, court-distance scheduling, and geocoding are no longer product workflows.

### Database (`lib/db`)
- PostgreSQL via Drizzle ORM
- Tables: leagues, players, matches, users, league_invites, player_availability, schedule_generation_logs, match_reminders_log, ball_boi_sessions, match_shots, match_statistics
- `schedule_generation_logs` also records availability reminder batches with `status = "availability_reminder"`, using `generated_at` as the reminder timestamp and `matches_generated` as the count sent.

### API Client (`lib/api-client-react`)
- Generated hooks from OpenAPI spec (`lib/api-spec/openapi.yaml`)
- Run codegen: `pnpm --filter @workspace/api-spec run codegen`
- After codegen, rebuild types: `cd lib/api-client-react && npx tsc -p tsconfig.json`

## Pages
- `/` — Public landing page (unauthenticated) or redirect to /dashboard (authenticated)
- `/sign-in` — Clerk sign-in page
- `/sign-up` — Clerk sign-up page
- `/onboarding` — Profile setup after first sign-up (protected)
- `/join/:code` — League invitation acceptance (public, prompts sign-in if needed)
- `/dashboard` — Stats, top players, recent activity, and upcoming matches (protected)
- `/leagues` — My Leagues list with create/delete (protected)
- `/leagues/:id` — League detail with standings, invite management, match list (protected)
- `/players` — Players table with search and invite guidance (protected, legacy/deep-link only; not in non-admin nav)
- `/players/:id` — Player detail with stats, win/loss bars, head-to-head (protected)
- `/my-matches` — Personal win/loss summary, upcoming and past match history across all invite-joined player profiles, and inline result logging for uncompleted matches (protected; in non-admin nav)
- `/matches` — Redirects to /my-matches
- `/matches/:id` — Match detail with set-by-set score recording (protected)
- `/matches/:id/replay` — Ball Boi replay with video, shot-by-shot review, rallies, heatmap, timeline, stats dashboard, and comparison modes (protected)
- `/schedule` — Redirects to /my-matches
- `/availability` — Weekly player availability selection (protected)
- `/profile` — Player profile details and day-before match reminder preferences for invite-joined leagues (protected)
- Players join leagues exclusively through invite links. Accepting an invite creates and links the league player record to the signed-in account; profile claiming and manual player creation are not normal product flows.

## Scheduling
- Availability is the primary scheduling input.
- Automatic schedule generation pairs players from shared availability and rematch rules only.
- Player home location, travel radius, managed courts, distance estimates, and geocoding are not used by app code.
- Match location remains a simple optional free-text field on the match record.

## API Endpoints
- `GET/POST /api/leagues`
- `GET/PATCH/DELETE /api/leagues/:id`
- `GET /api/leagues/:id/standings`
- `GET/POST /api/leagues/:id/invites`
- `GET /api/invites/:code` — public invite info
- `POST /api/invites/:code/join` — join league via invite
- `DELETE /api/invites/:code` — deactivate invite
- `GET /api/players`
- `GET /api/players/me` — player records linked to the current user through invite joins
- `GET/PATCH/DELETE /api/players/:id`
- `GET /api/players/:id/stats`
- `GET/POST /api/matches`
- `GET/PATCH/DELETE /api/matches/:id`
- `POST /api/ball-boi/matches/:id/sessions/start`
- `POST /api/ball-boi/sessions/:id/upload-url`
- `POST /api/ball-boi/sessions/:id/cancel`
- `POST /api/ball-boi/sessions/:id/live-shot`
- `POST /api/ball-boi/sessions/:id/complete`
- `GET /api/ball-boi/matches/:id/replay`
- `POST /api/matches/:id/ball-boi/end`
- `POST /api/matches/:id/ball-boi/shot-callback`
- `GET /api/matches/:id/ball-boi/status`
- `GET /api/matches/:id/ball-boi/replay-metadata`
- `GET /api/matches/:id/narrative`
- `GET /api/users/me` — current user profile
- `POST /api/users/me` — upsert user profile
- `PUT /api/users/me` — update user profile fields
- `GET /api/stats/dashboard`
- `GET /api/stats/top-players`
- `GET /api/stats/recent-activity`
- `GET /api/stats/head-to-head`
- `GET /api/healthz`

## Match Score Recording
- Set-by-set entry (up to 3 sets) with tiebreak support (auto-shown when score is 7-6)
- Score format: `6-3, 7-5, 7-6(4)` (comma-separated sets, tiebreak loser score in parens)
- Winner auto-calculated from set wins
- `recordedByClerkUserId` and `recordedAt` tracked on each match

## Ball Boi Mode
- Match detail pages include Ball Boi browser camera recording, pre-recording four-corner court calibration, chunked object storage upload, live shot detection from captured camera frames, and replay processing. The live camera overlay has minimal, standard, and advanced density modes.
- Replay pages expose seven review modes: Full Video, Shot-by-Shot, Rally Replay, Heatmap, Timeline, Stats Dashboard, and Comparison, with set filters, shot scrubber markers, heatmap filters, timeline momentum, and player comparison details.
- My Matches shows Ball Boi replay badges and quick shot stats only for matches that have recorded Ball Boi data.
- The API stores session metadata in `ball_boi_sessions`, including optional Ball Boi court calibration points, detections in `match_shots`, and aggregated replay analytics in `match_statistics`.
- The ML server includes `/analyze-match-live` for low-latency detections and `/analyze-match-batch` for post-match video analysis callbacks. When calibration metadata is present, ML maps detected ball positions through a perspective transform so heatmap points align with real court zones.

## League Invitations
- Unique invite codes (10-char nanoid)
- QR code generation (qrcode.react library)
- Invite link format: `/join/:code`
- Usage tracking, optional max uses and expiry
- Invite management panel in LeagueDetail page
- Invite acceptance is the only normal path for creating league player records

## Seed Data
3 leagues, 6 players, 8 matches (5 completed, 3 scheduled) pre-loaded.

## Workflows
- `artifacts/api-server: API Server` — runs on port 8080
- `artifacts/tennis-league: web` — frontend dev server
- `artifacts/mockup-sandbox: Component Preview Server` — design tool
- `ML Server` — FastAPI Ball Boi analysis service (`artifacts/ml-server/main.py`), runs on port 8000

All four services are independently startable from the services panel. The Run button launches the `Project` workflow which currently starts the ML Server; the frontend and API workflows can be started separately alongside it. `ML_SERVICE_URL=http://localhost:8000` (shared env var) connects the API to the ML server.

## Season Tagging & Management
- Matches have a `season` TEXT nullable column.
- Seasons are stored in a `seasons` DB table (id, league_id nullable, name, start_date, end_date).
- Seeded global seasons: `"Spring Exhibition"` (Jan 1 – May 31, 2026) and `"Summer League"` (Jun 1 – Aug 24, 2026).
- Admins can create, edit, and delete seasons per-league (or globally when league_id is null) via the LeagueDetail admin panel Seasons section.
- Auto-season assignment reads from the DB: per-league seasons checked first, then global. Runs on manual match creation and round-generated matches.
- Standings filter: matches in ended seasons (endDate < today) are excluded. Active and untagged matches count.
- Season badges appear on match rows. The active season name is shown dynamically in the standings header.
- Service: `artifacts/api-server/src/services/seasonService.ts` — `getAutoSeason`, `getPastSeasonNames`, `getSeasonsForLeague`.

## User Preferences
- Use the `user_query` tool whenever a prompt is ambiguous before starting work

## Post-Merge Setup
- `scripts/post-merge.sh` installs dependencies and runs SQL files in `scripts/migrations` through `scripts/run-db-migrations.mjs`.
- `scripts/migrations/20260421_day_before_match_reminder_preference.sql` ensures `players.day_before_match_reminder_enabled` exists for day-before reminder preferences.
- `scripts/migrations/20260421_match_reminders_log.sql` creates `match_reminders_log` with a unique match/type/date key so day-before reminders are only sent once per match date.
- `scripts/migrations/20260529_season_tagging.sql` adds `season` column to `matches` and tags all existing completed matches as `"Spring Exhibition"`.
- `scripts/migrations/20260529_seasons_table.sql` creates the `seasons` table and seeds the Spring Exhibition and Summer League global seasons.
- `scripts/migrations/20260622_fix_league1_round_pairings.sql` deletes and correctly rebuilds rounds 3–6 for league 1, eliminating 6 duplicate matchups (including Rapiel vs Sirman three times) caused by the circle-method receiving different player orderings across separate generation calls.
