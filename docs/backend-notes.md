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

## API contract

- `lib/api-spec/openapi.yaml` lists every route the app calls, including the ones it calls with `apiFetch` (messages, safety and moderation, bans and appeals, recording, onboarding, push tokens, photos), with the responses the server really sends. Errors are `{ error, code? }` (`ErrorResponse`). After changing the spec, run `pnpm --filter @workspace/api-spec run codegen`.
- `artifacts/api-server/src/__tests__/apiContract.test.ts` fails when a spec route is missing from the server, when the app calls an address or method the spec doesn't list, or when the generated client wasn't regenerated. It also checks messaging and ban/appeal bodies against the generated schemas.

## Access rules (Wave 1 review)

- `GET /api/leagues`, `GET /api/leagues/:id`, `/standings`, `/schedule`, `/bracket`, `/seasons` and `/seasons/active` need sign-in. A Private league shows only to its players (current or past) and admins; Open leagues show to anyone signed in. `GET /api/leagues?clerkUserId=` only accepts the caller's own id. The invite join screen uses `GET /api/invites/:code`, which stays open.
- `POST /api/matches`, `PATCH /api/matches/:id` and `DELETE /api/matches/:id` are for that league's admins only and never change a result: no score, winner or status. Scores go through the league score routes only (enter, the players' 24-hour edit, admin correction). A completed or playoff match can't be deleted.
- `GET /api/matches` and `GET /api/matches/:id` need sign-in and return only matches the caller played in or in leagues they can see (`lib/matchAccess.ts`).
- `GET /api/players`, `/players/:id` and `/players/:id/stats` need sign-in and show only the caller's own records and players in leagues they can see. Email and phone show only to the player and their league's admins. `PATCH /api/players/:id` is for the player themselves or an admin of their league (co-admins included); an admin changes contact details only for players who haven't signed up, reminder settings stay the player's own, and it never changes a player's league or linked account or edits a "Deleted player" record. It refuses name and level changes for a signed-up player, even from the player: both come from their profile and change only in Edit profile. Admins set a level only for placeholder players who aren't on Ball Boi.
- A league's `/rounds`, `/rounds/current`, `/playoffs`, `/admins`, `GET /api/shot-leaderboards/:leagueId/*`, `GET /api/drills/:leagueId`, `GET /api/scheduling/:leagueId/suggestions` and `/:weekOf`, and the availability routes follow the same league rule (`middlewares/requireLeagueViewer.ts`). `GET /api/availability/:leagueId/:weekOf` shows everyone's rows to league admins and only the caller's own to players. `POST /api/availability` saves the caller's own availability; only a league admin can name another `playerId`, and only one in that league. Availability participation and reminders, and `GET /api/scheduling/:leagueId/log`, are for league admins (owner or co-admins).
- Draft rounds (decision 29) stay with the league's admins: `/rounds`, `/rounds/current`, `/schedule`, `GET /api/matches` and `/matches/:id`, `/stats/my-matches`, `/stats/my-schedule` and `/scheduling/:leagueId/:weekOf` leave out a round that hasn't gone out, and its pairings, for everyone else (`lib/draftRounds.ts`). Reading rounds never creates or re-pairs them; the 7am league job, the legacy midnight job and an admin's own actions do. Legacy rounds (leagues with no season length) are published as they're made.
- `GET /api/drills/:id/leaderboard` and `POST /api/drills/:id/results` follow the drill's league: same rule as the league itself.
- The legacy `/api/shots/*` routes (shot upload, status, ML callback and `/shots/stats/me`) were removed (D30). Ball Boi recording uses `/api/ball-boi/*`.
- `DELETE /api/players/:id` is for that league's admins and refuses (409) any player who has matches; use the remove-player flow in Manage (`POST /api/leagues/:leagueId/players/:playerId/remove`) instead.
- `GET /api/stats/top-players`, `/recent-activity` and `/head-to-head` need sign-in and only count matches in the caller's leagues or matches they played.
- `POST /api/storage/uploads/request-url` needs sign-in and takes JPEG, PNG, HEIC/HEIF or WebP up to 10 MB. Saving a profile re-checks the stored file. `GET /api/storage/objects/*` serves only current profile photos, to someone signed in (A17; the app's `Avatar` sends the session token with each photo request), and everything to the ML server with `X-ML-Secret`. A replaced or removed photo's file is deleted.
- The profile (`users`) is the one source of a signed-up player's name, photo and self-rated level (`users.rating`). Rosters, join requests, pairing review names and Flex pairing read it through `lib/playerProfile.ts`; a league player row's own `skillLevel` counts only for placeholders, and its `name` is a copy the API refreshes from the profile whenever the player saves a new name. Match results never change a level.
- Admin-added league players link to an account only by the account's verified primary email from Clerk: when the admin adds them (if the account exists) or when the person first creates their profile. Never by display name or a typed-in email, never onto a record linked to another account, a "Deleted player" record or a quick match placeholder.

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
- Leagues run on their creator's time zone (`leagues.time_zone`, IANA name, Eastern for leagues made before Nov 4, 2026). Today's date, week starts and ends, score deadlines, 7am pairing and the 8am day-before reminder all follow it (`lib/leagueCalendar.ts`; the scheduler runs hourly and acts when a league's clock reaches the hour).
- A club league can have a weekly match day and time (`match_day` 0 to 6, `match_time` "HH:MM" in the league's zone). New rounds set every match's `scheduledAt` from it. Without one, either player (or a league admin) sets a match's time inside its week with `PUT /leagues/:id/matches/:matchId/time`.
- A set time never gates recording: every unplayed league match in its round's week, grace week included, is recordable (`lib/recordableMatches.ts`). A set time today only sorts it first.

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
- `GET /api/matches` and `GET /api/matches/:id` need sign-in and return only matches the caller played in or in leagues they can see (`lib/matchAccess.ts`).
- `GET /api/players`, `/players/:id` and `/players/:id/stats` need sign-in and show only the caller's own records and players in leagues they can see. Email and phone show only to the player and their league's admins. `PATCH /api/players/:id` is for the player themselves or an admin of their league (co-admins included); an admin changes contact details only for players who haven't signed up, reminder settings stay the player's own, and it never changes a player's league or linked account or edits a "Deleted player" record. It refuses name and level changes for a signed-up player, even from the player: both come from their profile and change only in Edit profile. Admins set a level only for placeholder players who aren't on Ball Boi.
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
- Match video is never sent to the app: there is no video-url endpoint, the replay response carries no video link, and `GET /storage/objects/*` serves Ball Boi video (uploads and training copies) only to the ML server with `X-ML-Secret`. The old video-playing replay screen is replaced by a placeholder until the simulated replay is built.
- Every shot from the shot analysis pipeline is stored as structured data in `match_shots`: `hitter_side` (near or far, as the camera sees it), landing spot in court meters (`landing_x_m`, `landing_y_m`; origin at the center of the net, +y toward the far baseline), `line_call` (in, out, net) with `close_call` and `line_distance_m`, `serve_number`, `serve_zone`, `point_end`, and `model_version`. Mapping lives in `structuredShotFields` (`lib/ballBoiUtils.ts`). The pipeline names a side, not a player, so `player_id` stays empty for its shots.
- My Matches shows Ball Boi replay badges and quick shot stats only for matches that have recorded Ball Boi data.
- The API stores session metadata in `ball_boi_sessions`, including optional Ball Boi court calibration points, detections in `match_shots`, and aggregated replay analytics in `match_statistics`.
- Video retention (`api-server/src/lib/videoRetention.ts`): once analysis finishes, the raw upload (the only copy with audio) is deleted. If every player left training on, the API asks the ML server for a video-only copy under `/objects/training/` and keeps it in `metadata.trainingVideoPath`. An hourly sweep finishes failed deletes, drops training copies once any player turns training off or deletes their account, and clears raw uploads from analyses that failed more than 7 days ago.
- The ML server includes `/analyze-match-live` for low-latency detections and `/analyze-match-batch` for post-match video analysis callbacks. When calibration metadata is present, ML maps detected ball positions through a perspective transform so heatmap points align with real court zones.
- Per-stat accuracy gates (`api-server/src/lib/statGates.ts`): every analysis result carries `statGates` from the ML server (`evaluation/gates.py`), decided from the committed eval report for that exact pipeline and model files. It's saved on the session's metadata. Every Ball Boi read endpoint blanks the fields of hidden stats and the replay lists them in `hiddenStats`. No gates (older sessions, or no eval report yet) means every stat is hidden. The written summary needs shot type, point ending, rally length and speed all shown.

## League Invitations

- Unique invite codes (10-char nanoid)
- QR code generation (qrcode.react library)
- Invite link format: `/join/:code`
- Usage tracking, optional max uses and expiry
- Invite management panel in LeagueDetail page
- Invite acceptance is the only normal path for creating league player records

## League chat (decisions 145 and 146)

- One chat per league on the messaging service (`message_groups.league_id`), listed in Messages with the other chats. `messaging/leagueChats.ts` keeps it in step with the league; `messaging/service.ts` holds the rules.
- League routes call `leagueChat.*` from `messaging/leagueChatEvents.ts` after joins, leaves, removals, admin changes, renames, ends, deletes, published rounds and scores. These are fire-and-forget and do nothing until `startLeagueChats()` runs at API start, so route tests don't need messaging.
- At start, every league is synced once (idempotent), which is how existing leagues get their chat. Opening the chat from the league page (`GET /api/leagues/:leagueId/chat`) also makes a missing one.
- Members are current players with an account plus admins (the creator for leagues without admin rows). An ended league's chat is closed for sending; a deleted league's chat loses its members.
- `message_group_members.unread` drives the bold row; `attention` (mentions of you and admin posts) is what the Messages button counts. Automatic posts add to `unread` only and never push.
- Admin deletes and mutes file a `league_admin` report into the moderation queue. Mentions are found on the server from "@Full Name" in the text (`messaging/mentions.ts`).

## Season Tagging & Management

- Matches have a `season` TEXT nullable column.
- Seasons are stored in a `seasons` DB table (id, league_id nullable, name, start_date, end_date).
- Seeded global seasons: `"Spring Exhibition"` (Jan 1 – May 31, 2026) and `"Summer League"` (Jun 1 – Aug 24, 2026).
- Admins can create, edit, and delete seasons per-league (or globally when league_id is null) via the LeagueDetail admin panel Seasons section.
- Auto-season assignment reads from the DB: per-league seasons checked first, then global. Runs on manual match creation and round-generated matches.
- Standings filter: matches in ended seasons (endDate < today) are excluded. Active and untagged matches count.
- Season badges appear on match rows. The active season name is shown dynamically in the standings header.
- Service: `artifacts/api-server/src/services/seasonService.ts` — `getAutoSeason`, `getPastSeasonNames`, `getSeasonsForLeague`.

## Doubles leagues (Wave 2, doubles flow review D1 to D10, Nov 9)

- A doubles league is Fixed partners or Rotating partners (`leagues.partner_mode`), never has playoffs, and needs 4 active players before a round can be paired.
- Pairing lives in `lib/doublesPairing.ts` (pure); `services/doublesRounds.ts` loads and saves it. Side 1 is `player1` + `player3`, side 2 is `player2` + `player4`, as scoring and standings already assume.
- Rotating: fours by close level, the most even split, a repeat partner only when every choice repeats one (cost above any level gap), leftovers get byes fewest first, blocked pairs never share a four.
- Fixed: `league_teams` holds teams; split or broken teams keep their row (`dissolved_at`), and `matches.team1_id`/`team2_id` say which team played, so team standings (`computeTeamStandings`) count only the active team's own matches. Anyone without a partner when the first round goes out is auto-teamed by level; after that they have byes until an admin re-teams them.
- Team-up requests (`league_partner_requests`) expire after 48 hours via the 15-minute job in `services/scheduler.ts`. Declined, expired or "taken" (the other player teamed up with someone else) puts the sender back on Looking for a partner (`players.looking_for_partner_at`) with a notice until they dismiss it.
- Each published doubles match gets a group chat for all four (`message_groups.match_id`, titled per member in `member_titles`). It gets day-before and "Did it happen?" lines once each (`league_match_chat_cards`) and goes read only once the score is in or the match is voided.
- Account deletion: `lib/doublesAccountDeletion.ts`.

## Migrations

- SQL files in `scripts/migrations` run through `scripts/run-db-migrations.mjs` when the API starts.
- `scripts/migrations/20260421_day_before_match_reminder_preference.sql` ensures `players.day_before_match_reminder_enabled` exists for day-before reminder preferences.
- `scripts/migrations/20260421_match_reminders_log.sql` creates `match_reminders_log` with a unique match/type/date key so day-before reminders are only sent once per match date.
- `scripts/migrations/20260529_season_tagging.sql` adds `season` column to `matches` and tags all existing completed matches as `"Spring Exhibition"`.
- `scripts/migrations/20260529_seasons_table.sql` creates the `seasons` table and seeds the Spring Exhibition and Summer League global seasons.
- `scripts/migrations/20260622_fix_league1_round_pairings.sql` deletes and correctly rebuilds rounds 3–6 for league 1, eliminating 6 duplicate matchups (including Rapiel vs Sirman three times) caused by the circle-method receiving different player orderings across separate generation calls.
