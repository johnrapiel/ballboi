# Ball Boi: Waves

Owned by the coordinator session ("Train Conductor"), which also merges PRs and keeps the Feature Tracker current. Feature sessions read this file; only the coordinator edits it.

**Current wave: Wave 1**

_Created 2026-10-29 against `main` at `59fbb10`. Updated 2026-10-31._

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

**From Wave 2 on, three more:**

4. Every acceptance criterion in the wave's session prompts is met.
5. John approved each PR's design and flow review before it merged.
6. John has run the wave's end-to-end walkthrough on his phone, and every finding logged as **Bug** is fixed and merged.

## Reviews: before, during and after each wave (Wave 2 on)

The goal: users can actually do what each feature sets out to do, with no dead ends, and nothing reaches `main` that John hasn't seen.

**1. Before the wave is built: flow review with John.**
- The coordinator walks John through each feature's flows one question at a time, with a recommendation first: entry points, every step, empty and error states, edge cases, and how the user leaves the flow.
- Each step is checked against the spec and the screen designs. Gaps get decided, not guessed.
- The output goes into the session prompts: numbered **acceptance criteria** per feature, the canvas screens each flow uses, and decisions John made. Sessions don't start until John has approved their prompt.

**2. Before each PR merges: design and flow review.**
- The PR description quotes the acceptance criteria it covers. Each one gets the phone test step that proves it. Anything the PR couldn't meet is flagged with a reason.
- It shows the flow screen by screen, start to finish, including empty, error and loading states, at the largest text size and in Dark Mode. Each screen sits next to its canvas screen, with any differences called out.
- It confirms there are no dead ends: every screen has a way forward and a way back, and every error has a recovery path.
- The coordinator checks all of this first and sends back anything incomplete. Then it shows John the review, and **John approves the design and flow** along with the go-ahead to merge.

**3. After the wave: end-to-end walkthrough on the phone.**
- When every PR is merged, the coordinator writes `claude/walkthroughs/wave-N.md` in the Project. It's organized by what a player does, with one "Do / Expect" table per flow, an accessibility pass on every new screen, and a findings log.
- John runs it on a fresh development build. Each finding is bucketed:
  - **Bug:** fix before the wave closes. The owning session gets one small PR.
  - **Spec gap:** a decision for John that feeds the next wave's flow review.
  - **Polish:** a tracker row for later.
- The wave closes after the Bugs are merged.

**Wave 1** shipped without these. It gets the same treatment **after Waves 2 and 3 are complete**: update `claude/walkthroughs/wave-1.md` for what changed, then do a flow review of every Wave 1 feature for dead ends and missing cases, and an end-to-end walkthrough on the phone. Its Bugs and gaps go into the Wave 4 prompts.

**Session names:** title each feature session "Wave N, Session X" (for example, "Wave 2, Session F") so John can find it.

## How merging works

- Sessions open stacked PRs and comment on the bottom PR when the whole stack is green and merges cleanly with `main`.
- The coordinator checks every PR in the stack, then merges it bottom-up with merge commits, retargeting each PR to `main` as the one below it lands.
- If a PR conflicts with `main`, the coordinator stops there and leaves a note on the stack for its session.

## Merge status (2026-10-30)

| Session | State |
|---|---|
| A | **Done.** #43 (rating) and #49 (onboarding) merged |
| B | Stack #46, #52, #56, #62, #60 conflicts with `main`. Note on #46 |
| C | Stack #41, #47, #53, #58, #61, #63, #64, #65, #66 conflicts with `main`. Note on #41 |
| D | #42 merged (needs one new development build). #45 to #59 conflict with `main`. Note on #59 |
| E | #35 and #36 merged. #51 (pipeline) was closed without merging, so #67 is stuck on its branch. Note on #67 |

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
- Messages screen: direct chats, Message Requests, match threads; bubbles read sender, text and time in one swipe; new messages announced; failed sends say "Not sent. Tap to retry"
- Guardrails: request inbox (sender can't send twice until a reply), no read receipts on requests, first-message filter (links, phone numbers, slurs), 5 new conversations a day for the first week, block stops DMs both ways
- Report a message (long-press plus VoiceOver custom action, server snapshot); Stream moderation events into `/api/admin/reports`
- Auto-restrict; moderator remove and suspend; agent decision log with confirm and undo; Claude moderation agent (6-hour fallback, hide / restrict / dismiss / escalate only); bans on Apple user ID and email; appeal logged
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

**John decides:** dropping the `leagues.unplayed_rule` column is destructive. Recommended: stop reading and writing it now, drop it in a later wave.

### D. Ball Boi recording (native owner)

**Scope**
- Port the camera recorder from `feat/ios-expo-app` (`record.tsx`) into `artifacts/mobile`: rear camera, no corner tapping
- Match-first entry and Quick match (format first, singles default; placeholder opponents with an invite link; solo controls; nothing counts toward standings until they join)
- Doubles disabled state with visible, VoiceOver-read text; log views
- Start in Now / 5 / 10 / 15 min with spoken countdown and captions; press-and-hold stop (2 seconds); auto-stop at low battery, low storage or 4 hours
- Background upload, Wi-Fi by default, survives app close, video kept until the server confirms
- First-recording consent screen and the training toggle setting (stored server-side; both-players rule; placeholders never trained on)
- Analysis-only audio capture
- Post-stop flow: score prompt (posts through Session C's score endpoint), processing card, court-line fix on a still frame only on low confidence
- Ball Boi tab: "Record a match" lists today's matches, then Quick match

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

## Wave 2

Native owner: **Session G**. Run by a Wave 2 coordinator session (prompt: `claude/wave-2-coordinator-prompt.md` in the Project), which writes these prompts after the flow review with John.

| Session | Scope |
|---|---|
| F. Discover | Players near you (radius 5 / 10 / 15 / 30, rating range, availability), Open leagues list and join requests, Open matches, Need 1 / Need 2, match requests (accept, counter, decline, day-before confirm, 2-hour reminder), reliability on cards, travel mode, hidden profile, court directory |
| G. Push, Live Activity and voice coach (native owner) | APNs with provisional authorization, contextual prompt and Settings banner; message push with preview hiding; opponent "Ball Boi is recording your match" push; Live Activity on both phones with push-to-start and App Intents; on-device court detection and voice positioning coach with captions; DeviceCheck device bans; installs RevenueCat's native SDK for Session I |
| H. Replay, profile, player card and league chat | Simulated replay rebuild (replaces #78's placeholder; no video, ever), close-call labels, scrubber markers, filters, trends with text summaries and data tables; Profile rebuild, player card as one VoiceOver element, career stats, head-to-head, recap, Edit your level (rating is a level players set, Oct 29), Settings > Privacy training toggle; player screen with report and block; league chat with pins on Session B's interface; milestone animations with Reduce Motion fades |
| I. Ball Boi Pro | RevenueCat (free tier) and IAP ($5/month, $40/year, one group, no intro offer), 3 free months from first recording tracked server-side, paywall at setup with disclosures, Restore Purchases, "Not now" records with 30-day expiry, lapsed state |

## Wave 3

| Session | Scope |
|---|---|
| J. Accessibility audit | Every screen at the largest accessibility text size, VoiceOver pass, Reduce Motion, contrast, tap targets, non-color signals; fixes land as small PRs per screen |
| K. Reviewer demo account | Password sign-in for that account only; seeded league with standings, two Ball Boi matches with replay and stats, a message thread, a Message Request, an open match, a linked-rating example; free period marked expired so the paywall is live |
| L. App Store Connect setup | App record, privacy labels, age rating (18+), subscription metadata, review notes, screenshots and description; in-app links to Privacy, Terms and support |

## Wave 4 onward

Starts with the deferred **Wave 1 review**: update `claude/walkthroughs/wave-1.md` for what Waves 2 and 3 changed, do a flow review of every Wave 1 feature for dead ends and missing cases, then John runs the end-to-end walkthrough. Its Bugs and gaps become Wave 4 sessions. Then built from whatever is still not Merged in the Feature Tracker, or ❌ or 🟡 in the checklist, until both show every launch-blocking item done. Each wave's prompts are written here when the previous wave closes, after a flow review with John, and each wave ends with a walkthrough.
