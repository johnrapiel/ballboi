# Ball Boi: Waves

Owned by the coordinator session ("Train Conductor"), which also merges PRs and keeps the Feature Tracker current. Feature sessions read this file; only the coordinator edits it.

**Current wave: Wave 3** (Wave 2 closed Fri Nov 13: walkthrough with John done, every Bug finding merged, last fixes #263 to #271. Next: the Wave 3 feature review with John. Wave 1 closed Nov 7)

_Created 2026-10-29 against `main` at `59fbb10`. Updated 2026-11-13 (Wave 2 close, Wave 3 list, coordinator rules; folds in the Project copy's Nov 7 lines so the two copies match again)._

## Where the source docs live

- `claude/ball-boi-flows-and-feature-spec.md` and `claude/app-store-checklist.md` are docs in the claude.ai Project "Ball Boi". Read them with the Projects tool.
- **Feature status moved** on 2026-10-30 from `claude/feature-status.md` (now retired) to the **Ball Boi Feature Tracker**: https://claude.ai/artifact/RAcKukk587nMW46iaDg9ZD. Read the tracker wherever the shared header says `claude/feature-status.md`. Only the coordinator edits it; feature sessions list status changes in their PR descriptions.
- The repo carries snapshots: `docs/product-spec.md` (spec) and `docs/app-store-checklist.md` (checklist).
- If a session can't reach the Project, it reads the repo snapshots and says so in its PR description. The Project copy wins when they differ.

## Shared header

Paste this at the top of every feature session.

```
Project: Ball Boi (github.com/johnrapiel/ballboi). Before writing code, read claude/ball-boi-flows-and-feature-spec.md, claude/app-store-checklist.md, claude/feature-status.md and docs/design-system. The spec is the source of truth. Every screen must meet WCAG 2.2 AA and the Apple guidelines in the checklist: 44pt targets, Dynamic Type through the shared Text component, VoiceOver labels and grouped elements, never color alone, Reduce Motion respected.

Rules:
- Branch from the latest main and touch only the files your scope owns. Don't edit claude/feature-status.md, claude/app-store-checklist.md, artifacts/mobile/app.json or shared components in components/ui.tsx unless your scope says so. List any needed changes in the PR description instead.
- New DB migrations get their own new file. Never edit an existing migration and never run db:push.
- Open one small PR per feature, with checks passing. Don't merge: the coordinator session does that.
- End each PR description with phone test steps I can follow, and say whether it needs a new development build.
- Tell me the cost before any service signup and prefer free tiers. Never ask me to paste secrets in chat; tell me where to put them.
- Only ask when a decision is truly mine: one question at a time, with your recommendation first.
```

## Rules for every wave

**Shared files (append-only).** Any session may add its own lines to these, and nothing else. Insert new lines in **alphabetical order** by name, not at the end of a list, so two sessions rarely touch the same spot. On a conflict, merge `main` into your branch (no rebases on stacked branches), keep both sides, regenerate any generated code, and push.

- `lib/api-spec/openapi.yaml`: add only your own paths and schemas, then run `pnpm --filter @workspace/api-spec run codegen`. Never hand-edit `generated/`.
- `artifacts/api-server/src/routes/index.ts`: one import and one `router.use` line per new router, each in alphabetical order.
- `lib/db/src/schema/index.ts`: one export line per new schema file.
- Account deletion (`artifacts/api-server/src/lib/accountDeletion.ts`): each session adds the cleanup for the data it creates, in its own helper, called from one added line.
- `artifacts/mobile/package.json` and `pnpm-lock.yaml`: any session may add a pure-JS package. Only the wave's **native owner** adds native packages (anything that needs a new development build) or touches `app.json`, `eas.json` or `ios.privacyManifests`. Others list what they need in the PR description.

**Migrations.** Date-prefixed `scripts/migrations/YYYYMMDD_<session>_<name>.sql`, idempotent, one new file per change. Dropping a column or table waits for John's go-ahead.

**Cross-session hand-offs.** When one session needs another's code, the owner merges a small interface PR first (a function signature or an endpoint with a stub), and the other session builds against it.

## Exit criteria (every wave)

A wave is done when all three hold:

1. Every feature in each session's scope below is merged on `main` and shows **Merged** in the Feature Tracker (or the matching checklist rows are ✅).
2. No PR opened by that wave's sessions is still open.
3. CI (`Checks`) is green on the latest `main` commit.

Items marked **John** below are real-world tasks (accounts, filming, legal). They're tracked, but they don't hold a wave open.

**From the Wave 1 review on, three more:**

4. Every acceptance criterion in the wave's session prompts is met.
5. John approved each PR's design and flow review before it merged.
6. John has run the wave's end-to-end walkthrough on his phone, and every finding logged as **Bug** is fixed and merged.

## Reviews: before, during and after each wave

The goal: users can actually do what each feature sets out to do, with no dead ends, and nothing reaches `main` that John hasn't seen. Every review is **holistic**: behavior and design together, never one without the other.

**Two tools, in every review:**
- **Grilling** (`/grilling`): an interview, one round at a time, every question with a recommended answer, until nothing is left assumed. This is how flows get reviewed with John.
- **Impeccable** (`/impeccable`): design and accessibility review of real screens. `critique` scores the UX, `audit` checks accessibility and technical quality, `harden` covers errors and edge cases. This is how screens get reviewed, by the coordinator before a PR merges and by sessions before they comment "ready".

**1. Before the wave is built: feature review with John.**
- The coordinator grills John through each feature: entry points, every step, empty, loading and error states, edge cases, how the user leaves, and which canvas screen covers each step. Gaps get decided, not guessed.
- Each canvas screen the feature uses gets an Impeccable `critique` against the design system, and findings go into the review so John decides them with the flow.
- The output goes into the session prompts: numbered **acceptance criteria** per feature, the canvas screens for each flow, the critique findings to address, and John's decisions. Sessions don't start until John has approved their prompt.

**2. Before each PR merges: design and flow review.**
- The session runs Impeccable `critique`, `audit` and `harden` on every screen it built, fixes what they find, and puts the results in the PR.
- The PR quotes the acceptance criteria it covers, each with the phone test step that proves it. Anything it couldn't meet is flagged with a reason.
- It shows the flow screen by screen, start to finish, including empty, error and loading states, at the largest text size and in Dark Mode, next to the canvas screens, with differences called out.
- It confirms there are no dead ends: every screen has a way forward and a way back, and every error has a recovery path.
- The coordinator checks all of this first, runs its own `critique` on the result, and sends back anything incomplete. Then it shows John the review, and **John approves the design and flow** along with the go-ahead to merge.

**3. After the wave: end-to-end walkthrough on the phone.**
- When every PR is merged, the coordinator writes `claude/walkthroughs/wave-N.md` in the Project: organized by what a player does, one "Do / Expect" table per flow, an accessibility pass on every new screen, a findings log.
- John runs it on a fresh development build. The coordinator runs an Impeccable `audit` across the wave's screens alongside, so accessibility and polish findings land in the same log.
- Each finding is bucketed:
  - **Bug:** fix before the wave closes. The owning session gets one small PR.
  - **Spec gap:** a decision for John that feeds the next wave's feature review.
  - **Polish:** a tracker row for later.
- The wave closes after the Bugs are merged.

**Wave 1** shipped without these. It gets the same treatment **before Wave 2 starts** (John, Oct 31), while its screens are still isolated and a fresh build is at hand. See "Wave 1 review" below.

**Session names:** title each feature session "Wave N, Session X" (for example, "Wave 2, Session F") so John can find it.

## How merging works

- Sessions open stacked PRs and comment on the bottom PR when the whole stack is green and merges cleanly with `main`.
- The coordinator checks every PR in the stack, then merges it bottom-up with merge commits, retargeting each PR to `main` as the one below it lands.
- If a PR conflicts with `main`, the coordinator stops there and leaves a note on the stack for its session.

## Coordinator rules

**Check everything, duplicate nothing (John, Nov 8, H28; standing rule for every coordinator).** Constantly check all working and recent sessions, open and recent PRs, branches, status docs and scheduled tasks for updates, and make sure no work is duplicated: before starting a session or a fix, confirm no other session, PR or branch already covers it.

**Merging a batch (how Wave 2 closed):**
1. One PR at a time, only on John's yes.
2. Before each merge, merge the latest `main` into that PR's branch (no rebase) and resolve conflicts there.
3. The spec decision log is the usual conflict: keep every row, in number order, with no gaps or duplicates. If two PRs took the same number, the later one is renumbered to the next free number and its references in code and docs move with it.
4. Wait for CI (`Checks`) to go green on that branch before merging, and on `main` after, before starting the next PR.

## Merge status (2026-10-31)

| Session | State |
|---|---|
| A | **Done.** #43 and #49 merged |
| B | **Done.** #46, #52, #56, #62, #60, #69, #71, #72, #74 merged |
| C | **Done.** #41 to #66 (nine PRs) merged |
| D | **Done.** #42, #45 to #59, #73 and #79 merged |
| E | **Done.** #35, #36, #70 (carrying #51 and #67), #75 to #78 merged |

## Wave 1

Native owner: **Session D**. Needs a new development build after D's first native package merges.

### A. Onboarding and Ball Boi Rating

**Status: done** (#43, #49). John's Oct 29 decision: the rating is a level players set (quiz now, UTR later) and results don't move it, so `applyMatchResult()` and rating history were dropped. Players edit their level from Profile.

**Original scope**
- Onboarding steps after the age check: name and photo (initials fallback), home area (zip, optional "Use my location"), rating quiz, "What brings you here?" with the four intent paths routing to their tabs
- Ball Boi Rating: NTRP scale 2.5 to 5.0+, Self-rated vs Verified badge (icon plus text), stored rating history
- `applyMatchResult()` rating service: every entered score moves both players, grace-period matches included, doubles at half weight. Merge this interface first so Session C can call it
- Account deletion cleanup for ratings and rating history

**Owns:** `app/onboarding/**`, `app/_layout.tsx` (onboarding gate only), `components/RatingBadge.tsx`, `routes/rating.ts`, `services/rating.ts`, `lib/db/src/schema/{players,users,playerLocations,ratings}.ts`

**Not this wave:** UTR link (needs a UTR Engage client ID: **John** applies; free), rating trend chart (Wave 2, Session H), notifications prompt (Wave 2, Session G)

### B. Messaging and moderation

**Scope**
- Stream Chat, headless, behind Ball Boi's own messaging interface (server token minting, one module wraps Stream)
- Messages screen: direct chats, Message Requests, match threads (Oct 31: a direct chat with your opponent for now, full match threads with Discover); bubbles read sender, text and time in one swipe; new messages announced; failed sends say "Not sent. Tap to retry"
- Guardrails: request inbox (sender can't send twice until a reply), no read receipts on requests, first-message filter (links, phone numbers, slurs), 5 new conversations a day for the first week, block stops DMs both ways
- Report a message (long-press plus VoiceOver custom action, server snapshot); Stream moderation events into `/api/admin/reports`
- Auto-restrict (removed Nov 4 by #104, spec decision 48: nothing happens to an account until John or the Claude moderator acts); moderator remove and suspend; agent decision log with confirm and undo; Claude moderation agent (6-hour fallback, hide / restrict / dismiss / escalate only); bans on Apple user ID and email; appeal logged
- Unread count wired into the Messages button
- Account deletion cleanup for messages, including in Stream

**Owns:** `app/messages.tsx`, `app/messages/**`, `components/messages/**`, `components/TabHeader.tsx`, `routes/messages.ts`, `routes/safety.ts`, `services/messaging/**`, `services/moderation/**`, `lib/db/src/schema/{safety,messaging}.ts`

**Not this wave:** league chat (Wave 2, Session H, on B's interface), message push and preview hiding, DeviceCheck device bans (Wave 2, Session G)

**Costs to confirm with John first:** Stream Maker plan is free (applied; Build plan fallback). The moderation agent calls the Anthropic API, which is paid per use: estimate the monthly cost before adding a key.

### C. Leagues

**Scope**
- The six Oct 29 league gaps (moved here from the retired `feature-status.md`): drop the "Unplayed matches" choice for a fixed 1-week grace period, pairing copy and default for the season's start weekday, standings on wins only, join lock at season start with a waitlist, dropouts, grace-period logic (stats yes, standings no)
- Flex pairing runs on the season's start weekday
- Score entry screen: either player, first score stands (no rating change: Oct 29 decision)
- League detail, rounds and playoffs screens; co-admins and Manage
- Home tab: upcoming matches, this week's pairings, recent results
- Match card with a "Record with Ball Boi" action on singles match-day cards linking to Session D's record route

**Owns:** `app/league/**`, `app/(tabs)/leagues.tsx`, `app/(tabs)/index.tsx`, `app/match/**`, `components/MatchCard.tsx`, `routes/{leagues,seasons,invites,rounds,playoffs,matches,scheduling}.ts`, `services/{roundPairing,matchGeneration,scheduler,playoffBracket,seasonService}.ts`, `lib/db/src/schema/{leagues,seasons,leagueRounds,leagueInvites,matches,playoffBrackets,scheduleGenerationLogs}.ts`

**Done (Nov 8):** John approved dropping `leagues.unplayed_rule` (and the old `open_match_messages` table); `20261108_z_drop_unused_leftovers.sql` drops both.

### D. Ball Boi recording (native owner)

**Scope**
- Port the camera recorder from `feat/ios-expo-app` (`record.tsx`) into `artifacts/mobile`: rear camera, no corner tapping
- Match-first entry and Quick match (format first, singles default; placeholder opponents with an invite link; solo controls; nothing counts toward standings until they join)
- Doubles disabled state with visible, VoiceOver-read text; log views
- Start in Now / 5 / 10 / 15 min with spoken countdown and captions; press-and-hold stop (2 seconds); auto-stop at low battery, low storage or 4 hours
- Background upload, Wi-Fi by default, survives app close, video kept until the server confirms
- First-recording consent screen and the training toggle setting (stored server-side; both-players rule; placeholders never trained on)
- Analysis-only audio capture
- Post-stop flow: score prompt (posts through Session C's score endpoint), processing card. The court-line corner fix moved to Wave 2, Session G, with on-device court detection (John, Nov 4)
- Ball Boi tab: "Record a match" lists today's matches, then Quick match (since #106: every unplayed match this week, today's set times first)

**Owns:** `app/record/**`, `app/(tabs)/ballboi.tsx`, `components/record/**`, `routes/{quickMatch,recording,trainingConsent}.ts`, `lib/db/src/schema/{placeholders,recordingConsent}.ts`, plus all native config: `artifacts/mobile/app.json`, `eas.json`, native packages

**Not this wave:** on-device court detection and voice coach, Live Activity, opponent recording push (Wave 2, Session G). Settings > Privacy toggle UI (Wave 2, Session H)

**When done:** `feat/ios-expo-app` is safe to delete once the recorder port merges (**John**, from GitHub's Branches page).

### E. Shot analysis (ml-server)

**Scope**
- Own and land #35 (label format and eval harness) and #36 (labeling tool)
- Server pipeline reading video from R2: ball tracking, court keypoints, player pose, shot type, in/out with "Close call" on uncertain calls, serve stats, rally length and point endings, landing and hitting positions
- Every shot stored as structured data (type, landing spot, outcome, timestamp)
- Per-stat accuracy flags from the eval: a stat below its bar is hidden by the API, not shown with a disclaimer
- Raw video and audio deleted after analysis unless both players left training on (reads Session D's training setting)

**Owns:** `artifacts/ml-server/**`, `routes/{ballBoi,shots,stats,shotLeaderboards}.ts`, `services/ballBoiRetry.ts`, `lib/db/src/schema/ballBoi.ts`

**John:** film 10 to 15 varied singles matches for the test set; create the R2 bucket and CORS (staging first; R2 free tier covers 10 GB).

## Wave 1 review (before Wave 2)

Every Wave 1 PR is merged as of 2026-10-31. Before Wave 2 starts, Wave 1 gets the reviews it skipped. Run by this coordinator.

1. **Tooling PR (Session C):** `pnpm seed:walkthrough` (test accounts B, C, D, a Private league with B in it, today's match A vs B) and dev-only time controls (season started, round deadline passed, in grace period, grace period over, run Flex pairing now), off in production builds. One small PR.
2. **Feature review with John: done Oct 31.** Seventeen questions, eight producing work. Decisions 30 and 31 and the rest are logged in `claude/walkthroughs/wave-1.md`. The Bug PRs are requested with acceptance criteria: Session A (#49 note: sign-in failures, step reasons, Edit profile), Session B (#72 note: Blocked players list), Session C (#66 note: invite links, Private join requests, late joiners, score undo and correction, "Not played", Message opponent, last-admin guard, End and Delete league), Session D (#79 note: keep-or-discard short recordings, Discard on the processing card). Impeccable critiques of the shipped screens run once the build exists.
3. **Walkthrough:** once the Bug PRs and tooling merge, John runs `claude/walkthroughs/wave-1.md` on a fresh development build, and the coordinator runs an Impeccable `audit` across every Wave 1 screen into the same log. Section 6 (analysis stats) waits for the labeled test set.
4. **Bugs** are fixed by their owning session, one small PR each, through the normal merge flow. **Spec gaps** feed Wave 2's flow review. **Polish** goes to the tracker.
5. **Nov 4 review with John: done.** Impeccable critique, audit and harden of every Wave 1 screen plus a flow trace, then 24 grilling questions. His decisions are spec decisions 48 to 76 in `docs/product-spec.md`. Eight fix PRs came out of it. Merged Nov 4: #103 (sign-in on score, league, stats and photo routes), #104 (messaging and bare-minimum moderation), #105 (sign-in, gating and account), #106 (league match times and Record from Home), #107 (profile as the one source of name, photo and self-rated level). In progress: PR 3 (native Apple and Google sign-in, needs a new development build), PR 5 (league rules and screens), PR 6 (recording, upload and analysis) and PR 8 (API cleanup and contract, after PR 5).

Done when every Bug is merged and John has signed off the walkthrough. Then Wave 2's coordinator starts.

6. **Nov 6 walkthrough, screen review and fix review: done.** John ran the build, then a screen-by-screen pass of all 23 Wave 1 screens. 31 findings, all in `claude/walkthroughs/wave-1.md` with his decisions. Fixed and merged:
   - #122 splash on ivory and Light by default (findings 2, 3)
   - #123 sign-up and profile fixes: photo upload, the `/api/users/me` loop, a clear sign-up error, no "Your level" line (1, 22, 23, 24). The Clerk Development setting behind 22 was fixed in the dashboard.
   - #124 one player search for Quick match and New message (15, 18)
   - #125 the new Day and Night palette: ivory and white by day, warm charcoal at night, roundel traces (25)
   - #127 design refresh part 2: League detail, Enter score, Create league, Schedule review, Profile, Join league and Messages restyled; one rule for every bottom sheet; 6-6 tiebreak; past days greyed out; copy icon; Ball Boi tab icon; no Message Requests; block lives inside Report; Delete account in Settings (5, 8 to 13, 17, 19 to 21), plus the follow-up fixes for blank sheets, chats and the score grid
   - #133 Match detail, My matches, Home season stats, 24-hour score edit, Home empty state roundel (6, 7, 14, 27)
   - #132 polish: Welcome centred, invite and pairings in Manage, settings cog, level 5.0, new app icon (26, 28 to 31)
   - #134 richer demo data and the "Seed staging data" workflow, run Nov 7
   John now reviews on TestFlight against the staging API (merges to main build or update it automatically).

**Wave 1 is closed (Nov 7).** Carried into Wave 2: finding 4 (appearance, Session H; **Nov 7: the app follows the iPhone's Light or Dark Mode** instead of a toggle on a Light default), finding 16 (does a stranger picked in Quick match get the recording notice or accept first, Session G), the spec decision log entries for findings 7, 17 and 20, and the Wave 2 notes below.

## Wave 2

Native owner: **Session G**. Run by a Wave 2 coordinator session (prompt: `claude/wave-2-coordinator-prompt.md` in the Project), which writes these prompts after the flow review with John.

**Flow review (Nov 7):** John's decisions are logged in `claude/wave-2-flow-review.md` in the Project (F1 to F14 for Discover, G1 so far for Session G). Each session's full brief lives in `claude/wave-2-briefs/` on the reference branch `docs/wave-2-briefs` (never merged) and in the Project.

| Session | Brief | State |
|---|---|---|
| F | `claude/wave-2-briefs/session-f.md` | Approved by John Nov 7; session started |
| G | | Flow review next |
| H | | Flow review to come |
| I | | Flow review to come |

The Ball Boi iOS canvas now has three pages (Nov 7): **On TestFlight** (what's built), **Wave 2 designs** (what Wave 2 builds from) and **Graveyard** (old, ignore). A fourth, **Title options**, holds the Nov 7 serif title comparison.

| Session | Scope |
|---|---|
| F. Discover | Players near you (radius 5 / 10 / 15 / 30 and Custom, level range, Monday to Sunday availability grid, "Free when I'm free"), player card with Report, hidden profile, Open leagues with join requests and waitlist, court directory and home court, setting up a match in chat (match cards, day-before check, 2-hour reminder, "Did it happen?", no-shows with a 48-hour dispute), reliability on cards, Open matches with Need 1 / Need 2 and group chat. **No travel mode** (dropped Nov 7). Brief: `claude/wave-2-briefs/session-f.md` |
| G. Push, Live Activity and voice coach (native owner) | APNs with provisional authorization, contextual prompt and Settings banner; message push with preview hiding; opponent "Ball Boi is recording your match" push; Live Activity on both phones with push-to-start and App Intents; on-device court detection and voice positioning coach with captions; court-line corner fix on a still frame, alongside court detection (moved from Wave 1, Nov 4); Match day reminders, on by default but still behind iOS's permission prompt, which shows when a player joins a league or sends a match request (Nov 4); Apple's age range check before the birthday screen (moved from Wave 1, Nov 4; can ride with Wave 1's native sign-in PR if John wants it sooner); DeviceCheck device bans |
| H. Replay, profile, player card, league chat and appearance | Simulated replay rebuild (replaces #78's placeholder; no video, ever), close-call labels, scrubber markers, filters, trends with text summaries and data tables; Profile tab rebuild (Wave 1 only fixes what Profile shows, Nov 4), player card as one VoiceOver element, career stats, head-to-head, recap, Edit your level (rating is a level players set, Oct 29), Settings > Privacy training toggle (Wave 1's PR 6 adds the switch now, spec decision 64); player screen with report and block; league chat with pins on Session B's interface; milestone animations with Reduce Motion fades; **the app follows the iPhone's Light or Dark Mode** (John, Nov 7; replaces Light by default and the planned toggle; needs `userInterfaceStyle: automatic` in app.json and a new build, coordinated with the native owner; details in `claude/backlog/appearance-toggle.md`) |
| ~~I. Ball Boi Pro~~ | Parked Nov 7 (spec decision 82): no paywall, subscription or IAP at launch, and Ball Boi analysis, replay, trends and career stats are free for everyone. The original scope is saved in `docs/backlog/ball-boi-pro.md`. Playing stays free; the Organizer plan waits until after launch |

**From the Wave 1 close (Nov 7), for every Wave 2 session:**
- The open Wave 2 drafts (#113, #114, #115, #117, #118, #119) predate the restyle (#127), the palette (#125), player search (#124) and Match detail (#133). Each merges main and resolves before review; expect conflicts in League detail, Profile, Messages, Create league and Discover.
- Block lives inside Report only (finding 20): one "Also block [name]" checkbox, no Block action or Blocked players screen, Unblock in a blocked chat. Session H's player screen and #117 follow this. There are no Message Requests (finding 17).
- Every bottom sheet uses `components/Sheet.tsx` (hugs its content, no Cancel, a `heading-m` title in Cormorant at 50% ink since Nov 7, confirm before discarding; Nov 12: every sheet now has a Close X, decision 198). Avoid a horizontal ScrollView directly inside a hugging sheet; see `ScoreGrid.tsx`.
- When #117 merges: set `RESPECT_HIDDEN_PROFILE = true` (api-server `lib/playerSearch.ts`) and `MESSAGE_BY_USER_ID = true` (mobile `lib/playerSearch.ts`).
- Light is forced today in app.json (`userInterfaceStyle: light`) and `lib/appearance.ts`. **Nov 7: Session H switches the app to follow the iPhone** (`userInterfaceStyle: automatic`, which needs a new build, and the system appearance instead of `setAppAppearance("light")`). Shipped Nov 8 (decision 144).
- John reviews on TestFlight (staging). Native changes trigger a TestFlight build. The Expo account is on the Starter plan since Nov 7 ($19/month plus usage) so builds and TestFlight uploads run automatically; still batch native work.

**Also Wave 2 (Nov 4):** doubles pairing for leagues (fixed and rotating partners), after a partner flow review with John. Doubles stays hidden in Start a league until it ships. The Wave 2 flow review assigns the session.

### Wave 2 close (Fri Nov 13)

**Status: closed.** Flow reviews with John Nov 7 to 9 (F, G, H, doubles D1 to D10), the walkthrough Nov 11 to 12 (`claude/walkthroughs/wave-2.md`, findings 1 to 56), and every Bug finding fixed and merged by Nov 12 (#239 to #271). The full log is `claude/wave-2-flow-review.md` in the Project (H1 to H47).

**What shipped:**
- **Discover (F):** players near you up to 50 miles, filters and "Free when I'm free", player cards with full match history (Results first), Report with Also block, hidden profile, court directory and home court, setting up a match in chat with reminders and "Did it happen?", open matches with group chats in Messages.
- **Push, Live Activity and voice coach (G):** provisional push and the one-time prompt, message push with previews, the opponent notice and "Was that you?", match day reminders, court detection and the "Oliver" voice coach, Record waits for the court, Live Activity on both phones updated in place, Apple's age range check, DeviceCheck device bans.
- **Profile, Home and league chat (H):** Home as upcoming matches, Profile as your player card, Free times, Career, league chats in Messages with admin pins, Match detail for every match, late matches, Light and Dark Mode following the iPhone. Milestone badges are built but hidden until after all waves (decision 179); sharing results outside the app was removed (decision 177).
- **Doubles:** fixed and rotating partners, teaming up, doubles standings, walkovers and Double default (decisions 160 to 172).
- **Beta recording:** the first-run carousel, the labeling tool, beta footage download, the recording metadata sidecar (T5).
- **Walkthrough fixes:** one button height, one time format, grabber and Close (X) on every sheet, menus in bottom sheets, empty states, card padding, one bottom inset, offline notice, quiet danger text, two link tones (decisions 176 to 201).

**Moved out (H27):** Replay and Trends. Designs and decisions stay (spec decisions 157 to 159); they're built once the beta has footage.

**Carried into the close day:** the two-phone steps (walkthrough 6.2, 6.4, 6.6 join, 6.7, 7.4, 7b.1, 7b.2), the section 8 court test (Record waits for the court, low light, Live Activity on two phones) and 3.12 (pairings post in the chat). Results go into the walkthrough's findings log; a Bug from them is fixed like any other.

**Not part of the wave:** #225 and #227 (beta audio held 30 days, T2 and T6) stay open until the Version 2 Beta Footage Release is live and has been through John's legal consult. Prompt 2 of the shot test data work (ml-server) lands after.

## Wave 3

**Features (from the Wave 2 walkthrough and backlog; each gets a feature review with John first):**

| Feature | Notes |
|---|---|
| Doubles playoffs | Fixed-partner doubles gets playoffs like singles, teams seeded from team standings; rotating stays without (finding 20, decision 167). Built early in the wave. `claude/backlog/doubles-playoffs.md` |
| Add players by name on Invite players | A search bar and Ball Boi players with multi-select below the code, also opened from Manage; an invite they accept (finding 21). `claude/backlog/league-add-players-by-name.md` |
| Career-first Profile | Profile leads with Career, details below; badges their own module. Which milestones to show is talked through after all waves (findings 6, 11, 12). `claude/backlog/profile-career-first.md` |
| Open leagues ("Who can join") | New league gets "Who can join" so Discover's Open leagues tab has leagues in it (finding 42). `claude/backlog/open-leagues.md` |
| Courts from OpenStreetMap | Import public courts, with OpenStreetMap attribution, alongside player-added courts. `claude/backlog/courts-from-openstreetmap.md` |
| UTR and USTA linking | "Link UTR instead" stays hidden until both can be linked (finding 53). `claude/backlog/link-utr-usta.md` |
| Doubles replacement partner | A one-time permanent replacement partner in the first three weeks of a season (decision 172). `claude/backlog/doubles-replacement-partner.md` |
| Tournaments | An idea: needs a flow review with John before anything is scoped. `claude/backlog/tournaments.md` |
| Marketing join page polish | The ballboi.tennis/join page shows the league name, who invited you and the code, in the app's Cormorant and DM Sans (finding 23) |

**Launch sessions (planned before Wave 2):**

| Session | Scope |
|---|---|
| J. Accessibility audit | Every screen at the largest accessibility text size, VoiceOver pass, Reduce Motion, contrast, tap targets, non-color signals; fixes land as small PRs per screen |
| K. Reviewer demo account | Password sign-in for that account only; seeded league with standings, two Ball Boi matches with replay and stats, a message thread, a Message Request, an open match, a linked-rating example |
| L. App Store Connect setup | App record, privacy labels, age rating (18+), review notes, screenshots and description; in-app links to Privacy, Terms and support |

## Wave 4 onward

Built from whatever is still not Merged in the Feature Tracker, or ❌ or 🟡 in the checklist, until both show every launch-blocking item done. Each wave's prompts are written here when the previous wave closes, after a flow review with John, and each wave ends with a walkthrough.
