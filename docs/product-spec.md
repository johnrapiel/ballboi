<!-- Snapshot of the live spec: https://claude.ai/code/artifact/ff76f66f-d4ec-49cb-b49a-7b9ad76fb102 (exported 2026-10-18, rev 32). The live doc wins if they differ. Refresh this file when the live doc changes. -->

# Ball Boi: Flows and Feature Spec

2026-10-18 · @John

## Overview

Ball Boi launches in the US as one app for finding local players, running leagues, and recording matches with shot analysis. SwingVision covers recording and Find Your Court covers courts; neither ties discovery, league play, and match analysis into one rating and one profile.

**v1 launch scope**

- **Find a Matchup:** local-only discovery of players and Open leagues, nationwide availability
- **Leagues:** Flex and Round robin formats, singles and doubles, one league chat with pins
- **Ball Boi:** recording, core shot stats, simulated replay, and trends (singles analysis only)
- **Ball Boi Rating:** one NTRP-scale rating used everywhere for matching
- **Messaging:** direct messages with a Message Requests inbox, match threads, moderation ladder
- **Profile:** baseball-card player card, career stats, head-to-head
- **Extras:** court directory, head-to-head records, shareable match recaps
- **Pricing:** everything free except Ball Boi, which becomes Ball Boi Pro after 3 free months from the first recording
- **Audience:** adults only (18+)

**Out of v1:** coaching tips, Ladder format, doubles shot analysis, Organizer plan, Apple Watch, weather reschedule, calendar sync, junior (under 18) players, match video playback, close-call video clips.

## Roles and onboarding

Everyone has the same account type. Admin is a role on a specific league, so one person can run a Tuesday league and play in a Thursday one.

**Roles**

- **Anyone can start a league** from the Leagues tab at any time
- **Admin plays by default:** setup toggle "I'm playing in this league" lets organizers opt out of pairings
- **Co-admins:** an admin can promote any member
- **Admin tools appear in context only:** a Manage entry inside leagues you run
- **Later: Organizer plan** as an upgrade on the same account, unlocking a multi-league dashboard, entry-fee collection via Stripe, and a verified club badge

**Onboarding (target: under 60 seconds to first value)**

1. **Sign in:** Apple, Google, or email code
2. **Age check:** Apple's Declared Age Range API, with a self-attested birth date as the fallback. Under 18s see a friendly "Ball Boi is 18+ for now" screen and no account is created. Only a pass/fail flag is stored, never the birth date
3. **Name and photo:** name required, photo skippable with an initials avatar
4. **Home area:** zip code, with an optional "Use my location" shortcut
5. **Rating quiz:** 4 to 5 plain-language descriptions that set a starting Ball Boi Rating, or "Link UTR instead"
6. **What brings you here?** Run a league, Join a league, Find matches near me, Record my play

**Intent paths**

- **Run a league:** name, format, Private or Open, season dates, then a share link
- **Join a league:** paste an invite code, or browse Open leagues nearby
- **Find matches:** set weekly availability, then land on Find a Matchup
- **Record my play:** 30-second phone mounting guide, camera and mic permission asked here

**Permissions are asked only when needed**

- **Notifications:** provisional (quiet) notifications from sign-in, delivered to Notification Center with Keep and Turn Off buttons, no prompt. The full prompt, with a reason screen first, comes after joining a league or sending a first request. If denied, a one-line Home banner links to Settings; never a repeat nag
- **Location:** only for travel mode or the zip shortcut
- **Camera and mic:** at first recording

## Navigation

Five tabs, with Ball Boi in the center. Profile opens from your avatar in the top corner of every tab.

| Tab | What lives there |
| --- | --- |
| Home | Upcoming matches, pending requests, this week's pairings, recent results |
| Leagues | Your leagues, each with chat, schedule, standings, and Manage for admins; Start a league |
| Ball Boi | Start a recording, past matches, replays, trends |
| Find a Matchup | Players near you, Open leagues near you, your Open Match posts |
| Messages | Direct chats, Message Requests, match threads |

**Profile (avatar):** player card, career stats, linked UTR, subscription, settings (including training data), account deletion.

League chat lives inside each league, not in Messages, so busy leagues never bury direct conversations. Every tab has an icon plus a text label, and badge counts are read by VoiceOver.

## Ball Boi Rating

One in-app rating on the NTRP scale (2.5 to 5.0+) drives all matching. It avoids USTA's no-caching rule and works for players with no external rating.

- **Starts self-rated:** onboarding quiz with plain descriptions, labeled "Self-rated" with icon and text
- **Verified by UTR link:** OAuth via the UTR Engage API seeds the rating and shows a "Verified" badge with icon and text
- **Adjusts from results:** every confirmed score nudges both players' ratings; doubles results count at half weight
- **Match range:** ±0.5 by default, widenable to ±1.0
- **Rating history:** shown as a trend line on the profile

## Find a Matchup

Find a Matchup is always local: results are bounded by distance, never a national feed. The app is available across the US, but each user only sees players and leagues near their home area.

**Location and privacy**

- **Home area anchor:** set by zip or neighborhood at onboarding
- **Radius:** 10 miles by default, 5 / 10 / 15 / 30 options, 30 maximum, with a count at each step
- **Approximate distance only:** "~4 mi away," never an exact location
- **Optional home court:** picked from the court directory, shown on the player card as a natural meetup spot
- **Travel mode:** search from current location for up to 7 days, then revert to home
- **List, not map:** sorted by distance and rating fit, no map of players
- **Hidden profile:** opt out of discovery while keeping leagues and Ball Boi

**What the page shows**

- **Players near you:** filtered by rating range, singles or doubles, availability
- **Open leagues near you:** distance, rating range, format, start date, spots left
- **Open Match posts:** post date, time window, court, skill range, and format; nearby matching players get notified
- **Need 1 / Need 2:** fill a spot in an existing doubles game
- **Empty state:** widen radius, post an Open Match, or invite a friend by link

**From found to playing**

1. Message the player directly (lands in their Message Requests) or send a structured match request
2. Request holds date and time window, court, singles or practice hit, optional note
3. Recipient accepts, counters with a new time, or declines
4. Both players confirm the day before; reminder 2 hours out
5. Either player logs the score, the other confirms, and both ratings update
6. Reliability shows on player cards: "Played 12 · 1 no-show"

**Joining an Open league:** request a spot, admin approves; full leagues queue requests on a waitlist for next season.

## Messaging and moderation

Players can message before committing to a match, so safety is built into the inbox from day one. Every report is acted on within 24 hours to meet Guideline 1.2.

**Platform**

- **Stream Chat on the Maker plan** (free: up to 2,000 monthly active users, 100 concurrent connections, $100/month AI moderation credit), with the free Build plan as fallback
- **Used headless:** Ball Boi builds its own AA-compliant message UI
- **Behind Ball Boi's own messaging interface** in code, so moving to a self-built backend later is a contained swap, not a rewrite
- **Stream's flags and moderation events** feed the existing `/api/admin/reports` queue, so there's one review queue

**Inbox guardrails**

- **Message Requests inbox:** first messages from non-connections land separately; sender can't send again until the recipient replies
- **No read receipts on requests**
- **Filtered first messages:** links, phone numbers, and slurs blocked until accepted
- **New-account throttle:** max 5 new conversations per day for the first week
- **Report and block on every message:** long-press menu plus a VoiceOver custom action; reports snapshot the messages for moderators
- **Block stops DMs both ways** and hides both players from each other in search and pairings
- **Lock-screen privacy:** option to hide message previews in push

**Enforcement ladder**

1. **Auto-detect:** Stream AI moderation scores messages for spam and harassment, plus behavior signals (many unanswered first messages, repeated blocks, copy-paste openers)
2. **Auto-restrict:** accounts flagged by AI moderation or reported by 2 or more different people drop to zero new conversations and pending requests are hidden, instantly, until reviewed
3. **Review:** John gets a push alert on every report and is the primary moderator. If no action within 6 hours, a Claude agent reviews the report snapshot, reporter note, and account history, and can hide messages, restrict the account, or dismiss with a logged reason. The agent treats reported messages as untrusted data, has only hide / restrict / dismiss / escalate tools, and restricts and escalates when unsure
4. **Human confirms:** John confirms or undoes every agent decision; suspensions and bans are human-only
5. **Ban sticks:** blocks the Apple ID, email, and device
6. **One appeal:** by email

No end-to-end encryption at launch, since it would block message review on reports.

## Leagues

Leagues launch with Flex as the default format and Round robin as the alternative, so an admin spends minutes a week running one instead of hours.

**Setup (admin)**

- **Visibility:** Private (default, invite link or code) or Open (listed in Find a Matchup, request to join)
- **Eligibility:** rating range and roster cap for Open leagues
- **Format:** Flex or Round robin; Ladder comes later
- **Play type:** singles, fixed-partner doubles, or rotating-partner doubles
- **Season:** 6 to 12 weeks, optional playoff for top 4 or 8
- **Rules:** weekly deadline and forfeit or no-result for unplayed matches

**Weekly loop (Flex)**

1. App pairs players Monday morning by rating, availability, and who hasn't played whom
2. Admin can swap pairings, mark a bye, or lock a match before publishing
3. Players schedule inside the match thread using the same request flow as Find a Matchup
4. Scores logged and confirmed; standings update
5. Unplayed matches resolve by the admin's rule after Sunday night

**League chat**

- **One chat per league,** with up to 3 admin pins in a collapsible bar
- **Admin posts labeled** with icon and text, always pushed
- **Member posts push on mentions only** by default
- **System messages:** pairings, results, and standings changes post automatically
- **Admin moderation:** delete messages, mute or remove members, all feeding the main moderation queue

## Ball Boi

Ball Boi launches as stats, a simulated replay, and trends, with no coaching advice and no video playback. Accuracy on a tight stat set beats breadth.

**Recording**

The phone films with the rear camera, so its screen faces away from the court. Voice and the players' own phones are the interface; nobody touches the fence after mounting.

- **Every recording starts from a match:** on match day, "Record with Ball Boi" is the primary action on a singles match card; Enter score takes over once the match is played. The Ball Boi tab's "Record a match" lists today's matches, then Quick match
- **Quick match:** format first (singles by default), then any opponent. A non-user becomes a placeholder with an invite link; you get solo controls, and nothing counts toward standings until they join
- **Doubles:** Ball Boi shows disabled on doubles matches with "Ball Boi analyzes singles for now. Doubles is coming." Views are counted as a demand signal
- **Voice positioning coach:** on-device court detection drives spoken guidance, one step at a time, in court terms ("Tilt up," "Toward the center of the court"), ending with "Court locked" and a chime. Plays on silent; mute toggle; shorter mode after the first few sessions
- **Court won't lock:** a spoken tip, then Record anyway after about 20 seconds; court lines get fixed later in the replay
- **Partner phone is optional:** solo players use the countdown, voice coach, and press-and-hold stop. A second phone adds remote controls and a readable screen for captions
- **Start:** from either player's Live Activity, or "Start in Now / 5 / 10 / 15 min" with spoken countdown cues; the court-lock check keeps running during the countdown; no auto-start
- **Warmup:** recording can capture warmup; the match start point can be dragged in the replay
- **Match notification:** the opponent gets "Ball Boi is recording your match," only for league mates and accepted matches; it doubles as a recording notice. Placeholder opponents get no in-app notice
- **Live Activity on both phones:** court lock status, recording time, mounted phone battery, and Start match / Stop; either player has full controls; voice cues mirror here as captions, and to Apple Watch where available
- **Stop:** from either player's phone, or press and hold anywhere on the mounted phone for 2 seconds
- **Safety cap:** auto-stop and save at low battery, low storage, or 4 hours
- **Audio:** recorded for shot detection only; never played back, deleted after processing, excluded from training on non-users. The labeled test set decides whether audio stays for launch
- **Consent screen before a user's first recording:** covers recording other players, audio for analysis, and the training toggle (see Video and training data)

**After the match**

- **Score prompt at stop** posts to standings right away; the opponent confirms as usual
- **Replay processing card:** no video playback; the match shows upload and analysis status ("Waiting for Wi-Fi · Upload now on cellular," then "Analyzing")
- **Upload:** Wi-Fi by default with a cellular toggle in settings; background upload survives the app closing; video stays on the phone until the server confirms
- **Push** when the simulated replay and stats are ready
- **Court-line fix** appears only when detection confidence is low: drag four handles on a still frame captured on the phone before upload
- **Free for 3 months from the first recording:** full replay and stats, then Ball Boi Pro (see Pricing)

**Processing:** court detection runs on device; shot analysis runs on the server for v1 and moves on device later.

**Shot analysis build**

- **Built by John with Claude Code acting as the ML engineer,** starting from open-source tennis models (ball tracking, court keypoints, player pose), running as a server pipeline that reads video from R2
- **Labeled test set before launch:** 10 to 15 singles matches filmed with the app's own mount guidance across different courts, lighting, and skill levels (public courts, indoor bubbles, a night match under lights). Every shot labeled for type, in/out, and point ending in a labeling tool Claude Code builds
- **Automatic eval:** every model change is scored against the test set
- **Per-stat accuracy bar,** e.g. shot type ≥ 90%, in/out on close calls ≥ 85%, serve placement ≥ 85%. A stat that misses its bar is hidden at launch, not shown with a disclaimer
- **Beta:** commissioned local players record through a TestFlight build pointed at a private (non-public) production tenant; they sign a short footage release

**Core stats (launch****, each gated on its accuracy bar****)**

- **Shot type:** forehand, backhand, serve, volley, overhead
- **In or out,** with uncertain calls labeled "Close call" instead of stated as fact
- **Placement heatmaps** for landing spots and hitting positions, using labels and patterns, not color alone
- **Serve:** first-serve %, placement by box, estimated speed
- **Rally:** rally length and point endings (winner, forced error, unforced error)

**Replay:** a simulated court, never match video. Ball paths, shot-by-shot list, and winner and error markers on the scrubber. Jump to any point; filter by shot type or outcome ("every backhand error"). Modes: Shot by shot, Rallies, Heatmap, Timeline, Stats, Compare.

**Trends:** first serve % over the last 10 matches, unforced errors per set, winners vs errors by shot type, rally length over time. Each chart has a one-line text summary for VoiceOver and an accessible data table.

**Doubles:** shot analysis is singles-only at launch, and recording is disabled on doubles matches with "Ball Boi analyzes singles for now. Doubles is coming." Team-level doubles stats (rally length, serve and return points, team winners and errors, per-player serves) are the first post-launch Ball Boi feature; per-player doubles attribution waits for demand.

**Data foundation for later coaching:** every shot stored as structured data (type, landing spot, outcome, timestamp).

**Deferred:** coaching tips (until a sourced, coach-authored library exists), spin, swing path, footwork, racket speed, per-player doubles attribution, close-call video clips (v1.1), partner-phone live preview of the mounted camera over a local peer-to-peer link during mounting (v1.1), "Ball Boi, start recording" voice command (start only, post-MVP), visual setup cues for solo players who can't hear the coach (on request).

## Video and training data

Match video is an input to analysis, never a viewable product feature in v1.

- **Never shown in the app:** no video playback, no video share links
- **Raw video deleted after analysis,** unless the match is kept for training
- **Audio:** used only by shot detection, never played back, deleted after processing
- **Training toggle, on by default:** shown on the first-recording consent screen and in Settings > Privacy. A match enters the training set only if both players left it on
- **Non-users are never trained on:** a match against a placeholder opponent stays out of training until they join and their own toggle applies. On joining they see "<name> recorded your match on <date>" with their toggle before the match attaches
- **Copy:** "Help Ball Boi get smarter. We use match video to train our shot tracking. Your personal information is never shared or sold. Turn this off anytime in Settings."
- **Keeping the copy true:** training video never leaves Ball Boi's own systems. Cloud and GPU providers act only as processors. Sending footage to an outside labeling service or model vendor requires changing the copy first
- **No face blurring** in the MVP
- **Account deletion** removes that player's matches from future training
- **Privacy policy and nutrition labels** cover training use, audio, and video retention
- **Lawyer review before launch:** biometric-data rules (body tracking) and audio recording

## Profile and player card

The player card is a brag sheet, never a scouting report: it shows strengths and records, while error patterns and heatmaps stay private.

| Element | Visibility |
| --- | --- |
| Name, photo, Ball Boi Rating (Verified or Self-rated) | Public |
| Town, app win-loss record, reliability | Public |
| Ball Boi highlights (forehand winners, aces, first serve %, win streak) | Public, season or career toggle |
| Head-to-head record vs. the viewer | Visible to that viewer |
| Error patterns, heatmaps, trends | Private |
| Match video | Never shown; raw video deleted after analysis unless kept for training |

- **No Ball Boi data yet:** card shows rating and record with a "No Ball Boi matches yet" prompt
- **VoiceOver reads the card as one summary,** e.g. "Alex Kim, 3.5 Verified, 14 and 6, 22 aces this season"
- **Career stats:** full personal history, reached from Profile

**Shareable match recap:** auto-generated after each confirmed match with score, aces, and winners, sized for Instagram Stories and texts, carrying the Ball Boi logo.

**Court directory:** public and club courts with surface, lights, and court count; players can add missing courts. Feeds home court, match requests, and Open Match posts.

## Pricing

Only Ball Boi is paid: $5/month or $40/year after 3 free months that start at the first recording. Leagues, Find a Matchup, messaging, and player cards stay free so no non-payer can stall a league.

- **3 free months from the first recording:** full simulated replay and stats, no paywall and no trial sheet. Tracked server-side by account so reinstalling doesn't reset it
- **Paywall appears after the free period,** the next time the user sets up a recording or opens stats ("Your 3 free months are up"), during setup and never at the fence
- **"Not now" still records and uploads:** analysis waits until they subscribe ("Your match is saved. Subscribe to see your stats."); unanalyzed matches expire after 30 days
- **Sold through Apple In-App Purchase** as a plain auto-renewing subscription (no introductory offer, since the free period runs outside Apple), managed with RevenueCat's free tier. An external Stripe link is revisited after the Supreme Court rules on Apple's appeal in Epic v. Apple
- **Paywall discloses** price, renewal terms, and links to Terms and Privacy
- **After a lapse:** users keep stats history, trends, card highlights, and recaps; new analysis requires Pro
- **League entry fees (later, Organizer plan):** collected via Stripe, since they pay for in-person play

## App Store and WCAG AA implications

These decisions add launch-blocking items to the submission checklist. Strangers meeting and messaging make Guideline 1.2 the critical path.

| Decision | Requirement | Guideline |
| --- | --- | --- |
| Adults only | Declared Age Range API with birth-date fallback, 18+ age rating, block screen for under 18s | Age rating |
| Strangers can message and meet | Report, block, filtering, action within 24 hours (John, Claude agent after 6 hours, instant auto-restrict), EULA covering messages | 1.2 |
| Messaging and match alerts | APNs push with preview-hiding option; provisional notifications from sign-in | 4.5.4 |
| Home area and travel mode | Location purpose string, While Using only | 5.1.1 |
| Ball Boi Pro | IAP subscription after 3 free months, clear price and renewal terms | 3.1.1, 3.1.2 |
| UTR linking | Disclose shared data and unlink path in privacy policy and labels; no partner logos without approval | 5.1.1, 5.2.1 |
| User-to-user messaging | Re-answer age rating questionnaire; set 18+ | Age rating |
| Account deletion | Deletes messages, video, ratings, removes footage from future training; revokes UTR link and Apple token | 5.1.1(v) |
| Reviewer demo account | Password sign-in for that account only; seeded league, two Ball Boi matches, message thread, Message Request, Open Match post; free match already used so the paywall is live; 60-second on-court recording in review notes | 2.1 |
| Opponent recording notification and remote controls | APNs push-to-start Live Activities with interactive Start / Stop buttons; connections only | 4.5.4 |
| Filming other players and training on video | Opponent recording notification, first-recording consent screen with training toggle, both-players rule, no training on non-users until they join; microphone purpose string for analysis-only audio | 5.1.1, 5.1.2 |
| Third-party processors | Stream (messaging), Anthropic (moderation agent), Cloudflare (video storage) listed in privacy policy and SDK privacy manifests | 5.1.1, 5.1.2 |

**WCAG 2.2 AA additions**

- **Rating badges, admin labels, reliability:** icon plus text, never color alone (1.4.1)
- **Heatmaps and replay markers:** labels and patterns (1.4.1)
- **Simulated replay:** the court animation is decorative; each shot's type, player, outcome, and time is in the accessible shot list (1.1.1, 1.3.1)
- **"Close call" label:** icon plus text, never color alone (1.4.1)
- **Charts and player cards:** text summaries and single accessible elements (1.1.1, 1.3.1)
- **Message bubbles:** sender, text, and time in one swipe; new messages announced (1.3.1, 4.1.3)
- **Swipe actions:** long-press menu and VoiceOver custom actions as alternatives (2.5.7)
- **Voice cues:** captions mirror to the Live Activity, never audio-only; Start and Stop buttons labeled for VoiceOver (1.1.1, 1.3.3, 4.1.2)
- **Radius and rating range controls:** 44×44pt targets, Dynamic Type safe (2.5.8, 1.4.4)

## Roadmap

_(Embedded roadmap graphic: see the live doc.)_

Coaching tips return only once a coach-authored library exists, and doubles analysis waits on per-player shot attribution.

## Decision log (Oct 18, 2026)

| # | Decision |
| --- | --- |
| 1 | Whole app is 18+ for the MVP; junior leagues later if there's demand |
| 2 | Age enforced with Declared Age Range API, birth-date fallback, 18+ rating, pass/fail flag only |
| 3 | 3 months free from the first recording; soft paywall at the next use after; "Not now" records but analysis waits (replaces the free-first-match model, Oct 18) |
| 4 | Shot analysis built with Claude Code as ML engineer from open-source models, server-side |
| 5 | Labeled 10 to 15 match test set, automatic eval, per-stat accuracy bars; TestFlight beta on a private tenant |
| 6 | Training on by default, both players must leave it on, no face blurring, "personal information is never shared or sold" copy |
| 7 | Simulated replay only; raw video deleted after analysis unless kept for training; "Close call" labels; close-call clips in v1.1 |
| 8 | Stream Chat on the Maker plan, headless, behind Ball Boi's own interface |
| 9 | Moderation: John primary, Claude agent after 6 hours with reversible actions only, instant auto-restrict, bans human-only |
| 10 | Reviewer: password demo account, seeded data, live paywall, on-court screen recording |
| 11 | Notifications: provisional from sign-in, full prompt at the contextual moment, Settings banner if denied |
| 12 | Every recording starts from a match; Quick match covers casual hits, with placeholder opponents and invite links for non-users |
| 13 | Ball Boi disabled on doubles with "Doubles is coming"; team-level doubles stats first after launch |
| 14 | Apple IAP via RevenueCat at launch; Stripe link revisited after the Supreme Court rules |
| 15 | No in-app notice for non-users; their footage stays out of training until they join |
| 16 | Audio recorded for analysis only, never played back; the test set decides whether it stays |
| 17 | Partner phone optional; live preview in v1.1; voice start command and solo visual cues post-MVP |
