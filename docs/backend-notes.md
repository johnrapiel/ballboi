# Backend notes

Carried over from the original web app's project notes. Describes how the API, scheduling, seasons, and migrations behave today. Web-app pages and old design notes were dropped; see `docs/product-spec.md` and `docs/design-system/` for the current product and design.

## Authentication

- Clerk auth (standard setup, no proxy)
- Home route (/) is a public landing page for unauthenticated users
- After sign-in, users are redirected to /dashboard
- Protected user routes: /dashboard, /leagues, /my-matches, /availability, /profile
- Legacy/deep-link routes remain available for player and match details; /matches and /schedule redirect to /my-matches in the streamlined player navigation
- Public routes: /, /sign-in, /sign-up, /join/:code (invite acceptance)
- Profile onboarding at /onboarding after first sign-up

## Architecture

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
- Every shot from the shot analysis pipeline is stored as structured data in `match_shots`: `hitter_side` (near or far, as the camera sees it), landing spot in court meters (`landing_x_m`, `landing_y_m`; origin at the center of the net, +y toward the far baseline), `line_call` (in, out, net) with `close_call` and `line_distance_m`, `serve_number`, `serve_zone`, `point_end`, and `model_version`. Mapping lives in `structuredShotFields` (`lib/ballBoiUtils.ts`). The pipeline names a side, not a player, so `player_id` stays empty for its shots.
- My Matches shows Ball Boi replay badges and quick shot stats only for matches that have recorded Ball Boi data.
- The API stores session metadata in `ball_boi_sessions`, including optional Ball Boi court calibration points, detections in `match_shots`, and aggregated replay analytics in `match_statistics`.
- Video retention (`api-server/src/lib/videoRetention.ts`): once analysis finishes, the raw upload (the only copy with audio) is deleted. If every player left training on, the API asks the ML server for a video-only copy under `/objects/training/` and keeps it in `metadata.trainingVideoPath`. An hourly sweep finishes failed deletes, drops training copies once any player turns training off or deletes their account, and clears raw uploads from analyses that failed more than 7 days ago.
- The ML server includes `/analyze-match-live` for low-latency detections and `/analyze-match-batch` for post-match video analysis callbacks. When calibration metadata is present, ML maps detected ball positions through a perspective transform so heatmap points align with real court zones.

## League Invitations

- Unique invite codes (10-char nanoid)
- QR code generation (qrcode.react library)
- Invite link format: `/join/:code`
- Usage tracking, optional max uses and expiry
- Invite management panel in LeagueDetail page
- Invite acceptance is the only normal path for creating league player records

## Season Tagging & Management

- Matches have a `season` TEXT nullable column.
- Seasons are stored in a `seasons` DB table (id, league_id nullable, name, start_date, end_date).
- Seeded global seasons: `"Spring Exhibition"` (Jan 1 – May 31, 2026) and `"Summer League"` (Jun 1 – Aug 24, 2026).
- Admins can create, edit, and delete seasons per-league (or globally when league_id is null) via the LeagueDetail admin panel Seasons section.
- Auto-season assignment reads from the DB: per-league seasons checked first, then global. Runs on manual match creation and round-generated matches.
- Standings filter: matches in ended seasons (endDate < today) are excluded. Active and untagged matches count.
- Season badges appear on match rows. The active season name is shown dynamically in the standings header.
- Service: `artifacts/api-server/src/services/seasonService.ts` — `getAutoSeason`, `getPastSeasonNames`, `getSeasonsForLeague`.

## Migrations

- SQL files in `scripts/migrations` run through `scripts/run-db-migrations.mjs` when the API starts.
- `scripts/migrations/20260421_day_before_match_reminder_preference.sql` ensures `players.day_before_match_reminder_enabled` exists for day-before reminder preferences.
- `scripts/migrations/20260421_match_reminders_log.sql` creates `match_reminders_log` with a unique match/type/date key so day-before reminders are only sent once per match date.
- `scripts/migrations/20260529_season_tagging.sql` adds `season` column to `matches` and tags all existing completed matches as `"Spring Exhibition"`.
- `scripts/migrations/20260529_seasons_table.sql` creates the `seasons` table and seeds the Spring Exhibition and Summer League global seasons.
- `scripts/migrations/20260622_fix_league1_round_pairings.sql` deletes and correctly rebuilds rounds 3–6 for league 1, eliminating 6 duplicate matchups (including Rapiel vs Sirman three times) caused by the circle-method receiving different player orderings across separate generation calls.
