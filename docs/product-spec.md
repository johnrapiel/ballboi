<!-- Snapshot of the live spec: https://claude.ai/code/artifact/ff76f66f-d4ec-49cb-b49a-7b9ad76fb102 (synced 2026-11-02 with rev 74). Updated in the repo on 2026-11-04 with the Wave 1 review decisions (48 to 78), on 2026-11-06 with decision 79, and on 2026-11-07 with decision 80. The live doc has the Nov 7 rating and animation fixes but still needs decisions 48 to 80. The live doc wins if they differ. Refresh this file when the live doc changes. -->

# Ball Boi: Flows and Feature Spec

2026-11-04 · @John

## Overview

Ball Boi launches in the US as one app for finding local players, running leagues, and recording matches with shot analysis. SwingVision covers recording and Find Your Court covers courts; neither ties discovery, league play, and match analysis into one level and one profile.

**v1 launch scope**

- **Discover:** local-only discovery of players and Open leagues, nationwide availability
- **Leagues:** Flex and Round robin formats, singles and doubles, one league chat with pins
- **Ball Boi:** recording, core shot stats, simulated replay, and trends (singles analysis only)
- **Self-rated level:** one NTRP-scale level the player sets, used everywhere for matching. "Ball Boi Rating" stays out of the app until a USTA or NTRP sync
- **Messaging:** direct messages with a Message Requests inbox, a direct chat with your league opponent (full match threads come with Discover), moderation ladder
- **Profile:** baseball-card player card, career stats, head-to-head
- **Extras:** court directory, head-to-head records, shareable match recaps
- **Pricing:** playing is free; Ball Boi Pro (analysis, replay, trends, career stats) is $7.99/month or $59.99/year after 3 free months
- **Audience:** adults only (18+)

**Out of v1:** coaching tips, Ladder format, doubles shot analysis, Organizer plan, Apple Watch, weather reschedule, calendar sync, junior (under 18) players, match video playback, close-call video clips.

## Roles and onboarding

Everyone has the same account type. Admin is a role on a specific league, so one person can run a Tuesday league and play in a Thursday one.

**Roles**

- **Anyone can start a league** from the Leagues tab at any time
- **Admin plays by default:** setup toggle "I'm playing in this league" lets organizers opt out of pairings
- **Co-admins:** an admin can promote any member
- **Admin tools appear in context only:** a Manage entry inside leagues you run
- **Later: Organizer plan** as an upgrade on the same account, unlocking a multi-league dashboard, in-app league fee collection for clubs, and a verified club badge

**Onboarding (target: under 60 seconds to first value)**

1. **Sign in:** Apple, Google, or email code
2. **Age check:** Apple's Declared Age Range API, with a self-attested birth date as the fallback. Under 18s see a friendly "Ball Boi is 18+ for now" screen and no account is created. Only a pass/fail flag is stored, never the birth date. The birth date uses the native iOS date picker in wheels style, in a bottom sheet with a Done button: no calendar grid, no typed fields. The prompt reads "What's your birthday?" with no mention of 18+, the field stays empty until confirmed, the wheel starts on January 1, 30 years back (never exactly 18 years ago), Done stays off until a wheel moves, and the latest selectable date is today. A quiet Sign out text button sits on this step
3. **Name and photo:** name required, photo skippable with an initials avatar. A quiet Sign out text button sits on this step too
4. **Home area:** zip code, with an optional "Use my location" shortcut
5. **Level quiz:** 4 to 5 plain-language descriptions that set the player's self-rated level, with "This is your self-rated level. We use it to match you with players near your level. You can change it anytime in Edit profile." "Link UTR instead" shows disabled until the UTR integration
6. **What do you want to do on Ball Boi?** An optional research question (Nov 2): "Pick all that apply" from Run a league, Join a league, Find matches near me and Record my play, or none. Skip and Continue both finish onboarding and land everyone on Home. The answer never changes where you go; it's saved for the team and never shown back to the player

**Permissions are asked only when needed**

- **Notifications:** provisional (quiet) notifications from sign-in, delivered to Notification Center with Keep and Turn Off buttons, no prompt. The full prompt, with a reason screen first, comes after joining a league or sending a first request. If denied, a one-line Home banner links to Settings; never a repeat nag. Match day reminders are on by default (Wave 2) and still reach a player only once iOS allows notifications
- **Location:** only for travel mode or the zip shortcut
- **Camera and mic:** at first recording

## Navigation

Five tabs, with Ball Boi in the center. Messages opens from the button in the top corner of every tab.

| Tab | What lives there |
| --- | --- |
| Home | Upcoming matches, pending requests, this week's pairings, recent results |
| Leagues | Your leagues, each with chat, schedule, standings, and Manage for admins; Start a league |
| Ball Boi | Start a recording, past matches, replays, trends |
| Discover | Players near you, Open leagues, Open matches (including your own) |
| Profile | Player card, career stats, linked UTR, subscription, settings (including training data), account deletion |

**Messages (top corner):** direct chats, including Message opponent from a league match, and Message Requests. Full match threads come with Discover. A 44pt button in the top-right of every tab with an unread count VoiceOver reads ("Messages, 3 unread").

League chat lives inside each league, not in Messages, so busy leagues never bury direct conversations. Every tab has an icon plus a text label, and badge counts are read by VoiceOver.

## Self-rated level

One level on the NTRP scale (2.5 to 5.0+) drives all matching. Players set it themselves, so it avoids USTA's no-caching rule and works for players with no external rating. Until a USTA or NTRP sync lands, the app calls it "self-rated level", never "Ball Boi Rating".

- **Set by the player:** onboarding quiz with plain descriptions, changed anytime in Edit profile
- **Labels:** Edit profile row "Self-rated level"; badge "Level 3.5, Self-rated" with icon and text, read by VoiceOver as "Level 3.5, self-rated"; Manage roster and requests "Level 3.5, self-rated". A placeholder player shows "Level 3.0" and a signed-up player with no level shows "Level not set"
- **Verified by UTR link:** OAuth via the UTR Engage API seeds the level and shows a "Verified" badge with icon and text
- **Results never move it (Oct 29, confirmed Nov 4):** no score, grace-period match or doubles result changes anyone's level. It changes only when the player edits it, or later through a USTA or NTRP sync
- **One source:** the profile holds each player's name, photo and level, and every league reads the current profile. Admins set a level only for placeholder players not on Ball Boi, and the player's own level replaces it when they claim the spot
- **Match range:** ±0.5 by default, widenable to ±1.0

## Discover

Discover is always local: results are bounded by distance, never a national feed. The app is available across the US, but each user only sees players and leagues near their home area.

**Location and privacy**

- **Home area anchor:** set by zip or neighborhood at onboarding
- **Radius:** 10 miles by default, 5 / 10 / 15 / 30 options, 30 maximum, with a count at each step
- **Approximate distance only:** "~4 mi away," never an exact location
- **Optional home court:** picked from the court directory, shown on the player card as a natural meetup spot
- **Travel mode:** search from current location for up to 7 days, then revert to home
- **List, not map:** sorted by distance and level fit, no map of players
- **Hidden profile:** opt out of discovery while keeping leagues and Ball Boi

**What the page shows**

- **Players near you:** filtered by level range, singles or doubles, availability
- **Open leagues:** distance, level range, format, start date, spots left
- **Open matches:** post date, time window, court, skill range, and format; nearby matching players get notified
- **Need 1 / Need 2:** fill a spot in an existing doubles game
- **Empty state:** widen radius, post an open match, or invite a friend by link

**From found to playing**

1. Message the player directly (lands in their Message Requests) or send a structured match request
2. Request holds date and time window, court, singles or practice hit, optional note
3. Recipient accepts, counters with a new time, or declines
4. Both players confirm the day before; reminder 2 hours out
5. Either player enters the score; the first score entered stands
6. Reliability shows on player cards: "Played 12 · 1 no-show"

**Joining an Open league:** request a spot before the season starts, admin approves. Once the season starts the league locks to new joins; full and locked leagues hold requests on a waitlist for next season.

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

1. **Auto-detect:** Stream AI moderation scores messages for spam and harassment; flagged messages land in the review queue with a snapshot
2. **No automatic restriction (Nov 4):** reports and flags go to the review queue and nothing happens to the account until John or the Claude agent acts
3. **Review:** John gets a push alert on every report and is the primary moderator. If no action within 6 hours, a Claude agent reviews the report snapshot, reporter note, and account history, and can hide messages, restrict the account, or dismiss with a logged reason. The agent treats reported messages as untrusted data, has only hide / restrict / dismiss / escalate tools, and restricts and escalates when unsure
4. **Human confirms:** John confirms or undoes every agent decision; suspensions and bans are human-only
5. **Ban sticks:** blocks the Apple ID, email, and device
6. **One appeal:** by email, decided by John; the agent never reviews appeals

No end-to-end encryption at launch, since it would block message review on reports.

## Leagues

Leagues launch with Flex as the default format and Round robin as the alternative, so an admin spends minutes a week running one instead of hours.

**Setup (admin)**

- **Visibility:** Private (default, invite link or code) or Open (listed in Discover, request to join)
- **Eligibility:** level range and roster cap for Open leagues
- **Format:** Flex or Round robin ("Pairs you with someone new each week"); Ladder comes later
- **Play type:** singles, fixed-partner doubles, or rotating-partner doubles. Doubles stays hidden in Start a league until doubles pairing is built (Nov 4)
- **Season start:** any day from tomorrow on, chosen with a calendar picker
- **Match day and time (optional):** a club league can set a weekly match day and time, and every match in a new round gets it. Without one, either player sets their match's date and time inside its week
- **Time zone:** the league runs on its creator's time zone, taken from their phone at creation. Deadlines name the zone when it isn't the viewer's
- **Season length:** a number input with − and + buttons, 8 weeks by default, 1 to 24 weeks; optional playoff for top 4 or 8
- **Deadline:** weekly deadline for each round, then a fixed 1-week grace period for every league (not an admin setting)
- **League fee (optional):** a fee and payment instructions, collected outside the app (see Pricing > League fees)
- **Create** is the primary button at the bottom of the new league flow

**Scores and standings**

- **Standings rank on wins**, then head to head between players level on wins, then share of sets won, then share of games won; players share a rank only when all four are level (decision 79). Playoff seeding uses the same order
- **The first score entered stands:** either player enters it; there's no confirm or dispute step
- **Grace period:** a match played in the week after its round's deadline updates Ball Boi stats, but not standings
- **Opponent retired:** enter the score so far; it counts as a win and shows RET
- **Playoffs:** each round gets two weeks, a play week plus a grace week, then the admin enters the result or a walkover
- **Corrections lock when a league ends:** Correct a score is hidden and final standings never change

**Joining and leaving**

- **Every league locks to new joins once the season starts,** Private and Open alike. The waitlist holds requests for next season
- **Dropouts:** when a player leaves mid-season, their played matches stay, their remaining matches are voided, and they're removed from standings. A bracket player who leaves gives their opponent a walkover, shown as W/O
- **Admins who leave stay admin:** they stop playing but still manage the league. A league's only admin who deletes their account picks the new admin first; Skip hands it to the longest-standing member, so deletion is never blocked
- **Ended leagues:** an ended league's invite code shows "This league has ended" and sends no request

**Weekly loop (Flex)**

1. App pairs players each week on the morning of the season's start weekday (a season starting on a Thursday pairs every Thursday), by level, availability, and who hasn't played whom
2. Admin can swap pairings, mark a bye, or lock a match before publishing
3. Players work out a time in a direct chat with their opponent (Message opponent). In a league with no set match time, either player saves the match's date and time inside its week. Full match threads with the Discover request flow come with Discover (Oct 31)
4. Either player enters the score; the first score entered stands and standings update
5. Unplayed matches get a 1-week grace period after the round's deadline; matches played in it update Ball Boi stats but not standings

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

- **Every recording starts from a match:** any unplayed league match in its round's week, grace week included, can be recorded. "Record with Ball Boi" is the primary action on a singles match card, with Enter score under it; once a score is in, the card shows the result instead. The Ball Boi tab's "Record a match" lists this week's matches, with today's set times first, then Quick match
- **Quick match:** format first (singles by default), then any opponent. A non-user becomes a placeholder with an invite link; you get solo controls, and nothing counts toward standings until they join. Leaving the invite screen or the camera before recording removes the Quick match and its placeholder
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
- **Calls and interruptions:** a ringing call pauses recording. If it isn't picked up, recording carries on in the same match and only the ringing seconds are lost. An answered call, a manual lock or an app switch stops and saves, and coming back shows Resume recording, which adds to the same match. The screen stays awake while recording. A hint by Record reads "Put your phone on Do Not Disturb before you hit record so the video isn't interrupted."
- **Audio:** recorded for shot detection only; never played back, deleted after processing, excluded from training on non-users. The labeled test set decides whether audio stays for launch
- **Consent screen before a user's first recording:** covers recording other players, audio for analysis, and the training toggle (see Video and training data)

**After the match**

- **Score prompt at stop** posts to standings right away (only Ball Boi stats if the match is in its grace period); the first score entered stands
- **Replay processing card:** no video playback; the match shows upload and analysis status ("Waiting for Wi-Fi · Upload now on cellular," then "Analyzing"). Both players see it: the recorder, the opponent and a claimed placeholder. If analysis can't finish, the card says "Ball Boi couldn't analyze this match" with a short reason (like "We couldn't see the court") and Remove, with no Try again
- **Upload:** Wi-Fi by default with an "Upload on cellular" switch in Settings; background upload survives the app closing; video stays on the phone until the server confirms. Signing out with recordings that haven't uploaded warns first ("2 recordings haven't uploaded. Signing out deletes them.") with Cancel and Sign out anyway
- **Push** when the simulated replay and stats are ready
- **Court-line fix** appears only when detection confidence is low: drag four handles on a still frame captured on the phone before upload
- **3 free months of Pro, from the first use of any Pro feature:** full replay and stats, then Ball Boi Pro (see Pricing). A match is analyzed if either player has Pro

**Processing:** court detection runs on device; shot analysis runs on the server for v1 and moves on device later.

**Shot analysis build**

- **Built by John with Claude Code acting as the ML engineer,** starting from open-source tennis models (ball tracking, court keypoints, player pose), running as a server pipeline that reads video from R2
- **Labeled test set before launch:** 10 to 15 singles matches filmed with the app's own mount guidance across different courts, lighting, and skill levels (public courts, indoor bubbles, a night match under lights). Every shot labeled for type, in/out, and point ending in a labeling tool Claude Code builds
- **Automatic eval:** every model change is scored against the test set
- **Per-stat accuracy bar,** e.g. shot type ≥ 90%, in/out on close calls ≥ 85%, serve placement ≥ 85%. A stat that misses its bar is hidden at launch, not shown with a disclaimer
- **Beta:** commissioned local players record through a TestFlight build pointed at a private (non-public) production tenant; they sign a short footage release

**Core stats (launch, each gated on its accuracy bar)**

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
| Name, photo, level (Self-rated or Verified) | Public |
| Town, app win-loss record, reliability | Public |
| Ball Boi highlights (forehand winners, aces, first serve %, win streak) | Public, season or career toggle |
| Head-to-head record vs. the viewer | Visible to that viewer |
| Error patterns, heatmaps, trends | Private, except an opponent from the same match sees its full breakdown when both players have Pro |
| Match video | Never shown; raw video deleted after analysis unless kept for training |

- **No Ball Boi data yet:** card shows level and record with a "No Ball Boi matches yet" prompt
- **VoiceOver reads the card as one summary,** e.g. "Alex Kim, Level 3.5, Verified, 14 and 6, 22 aces this season"
- **Career stats:** full personal history, reached from Profile

**Shareable match recap:** auto-generated after each match's score is entered with score, aces, and winners, sized for Instagram Stories and texts, carrying the Ball Boi logo.

**Court directory:** public and club courts with surface, lights, and court count; players can add missing courts. Feeds home court, match requests, and open matches.

## Milestone moments

Four moments get a short animation and a haptic. Everything else uses standard iOS transitions.

| Moment | Animation | Haptic |
| --- | --- | --- |
| Score entered | Score settles in, then the win-loss record ticks to its new value. Levels never change from results | Success |
| New career milestone | Badge scales in as a ring draws around it, then the title fades up. Launch set: first win, first Ball Boi match, 5- and 10-match win streaks | Success |
| Player card reveal | Card flips from the Ball Boi back to the front, on the first view of each player only | Light |
| Ball Boi analysis ready | Shot markers drop onto the court one by one, then "Your replay is ready" | Light ticks |

- **Short and once:** each runs under 1 second, plays once, and never blocks input
- **Built with Reanimated**
- **Reduce Motion:** every moment becomes a 200ms fade with the final state shown at once; haptics still fire
- **VoiceOver:** each outcome is announced in text, e.g. "Win recorded. You're now 15 and 6." or "Milestone: First win"

## Pricing

Playing is free forever. Ball Boi Pro is $7.99/month or $59.99/year after 3 free months that start the first time a player uses any Pro feature. Leagues, Discover, match requests, scores, messaging, and player cards stay free so no non-payer can stall a league.

- **What Pro includes at launch:** shot analysis, the simulated replay, trends, and full career stats. Travel mode, deeper head-to-head, and AI insights join Pro as each ships, at the same price
- **3 free months for everyone:** the clock starts at the first use of any Pro feature (recording, trends, or career stats), and the screen that starts it says "Your 3 free months of Pro start today." No paywall and no trial sheet during it. Tracked server-side by account so reinstalling doesn't reset it
- **Paywall ships at launch:** no free-until-X-users period and no founding member price. After the free months it appears the next time the user sets up a recording or opens a Pro feature ("Your 3 free months are up"), during setup and never at the fence
- **"Not now" still records and uploads:** analysis waits until they subscribe, unless the opponent has Pro (see Who sees what in a match); unanalyzed matches expire after 30 days
- **Sold through Apple In-App Purchase** as a plain auto-renewing subscription (no introductory offer, since the free period runs outside Apple), managed with RevenueCat's free tier. An external Stripe link is revisited after the Supreme Court rules on Apple's appeal in Epic v. Apple
- **Paywall discloses** price, renewal terms, and links to Terms and Privacy
- **After a lapse:** users keep everything they already unlocked: past breakdowns and replays, past opponent breakdowns, career stats, card highlights, and recaps. New analysis and trends require Pro

**Who sees what in a match**

- **A match is analyzed if either player has Pro** (paid or in their free months), whoever's phone recorded it. Shot data is stored for both players
- **A free player sees the first 4 games:** full breakdown and replay for games 1 to 4; the rest shows locked ("Games 5 to 12 are ready. Subscribe to see them."). Subscribing later unlocks every past analyzed match
- **Unused free months:** a free player who hasn't started theirs sees "Start your 3 free months to see the whole match." Nothing starts without their tap
- **Opponent breakdowns are mutual:** a player sees an opponent's full breakdown for matches they played together only when both have Pro. The free player sees "Alex has Pro and can see your breakdown. Subscribe to see theirs."
- **Placeholder opponents who join later** see "<name> recorded your match on <date>" with their training toggle, then the same 4-game teaser and free-months offer

**League fees**

- **Casual leagues collect fees outside the app** (Venmo or anything else). Ball Boi takes no cut
- **Optional fee note:** organizers can add a fee and payment instructions ("$40 for the season, Venmo @dave-tennis"), shown to everyone in Discover, on the league page, and on the join screen, and reportable like other league content. A paid checklist in Manage tracks who's paid. Ships before launch
- **In-app fee collection (later, club enterprise offer):** part of the Organizer plan after all waves, collected via Stripe since fees pay for in-person play. Pricing decided then

## App Store and WCAG AA implications

These decisions add launch-blocking items to the submission checklist. Strangers meeting and messaging make Guideline 1.2 the critical path.

| Decision | Requirement | Guideline |
| --- | --- | --- |
| Adults only | Declared Age Range API with birth-date fallback (native wheels picker, neutral prompt), 18+ age rating, block screen for under 18s | Age rating |
| Strangers can message and meet | Report, block, filtering, action within 24 hours (John, Claude agent after 6 hours), EULA covering messages | 1.2 |
| Messaging and match alerts | APNs push with preview-hiding option; provisional notifications from sign-in | 4.5.4 |
| Home area and travel mode | Location purpose string, While Using only | 5.1.1 |
| Ball Boi Pro | IAP subscription after 3 free months, clear price and renewal terms | 3.1.1, 3.1.2 |
| UTR linking | Disclose shared data and unlink path in privacy policy and labels; no partner logos without approval | 5.1.1, 5.2.1 |
| User-to-user messaging | Re-answer age rating questionnaire; set 18+ | Age rating |
| Account deletion | Deletes messages, video, level, removes footage from future training; revokes UTR link and Apple token | 5.1.1(v) |
| Reviewer demo account | Password sign-in for that account only; seeded league, two Ball Boi matches, message thread, Message Request, open match; 3 free months marked expired server-side so the paywall is live; 60-second on-court recording in review notes | 2.1 |
| Opponent recording notification and remote controls | APNs push-to-start Live Activities with interactive Start / Stop buttons; connections only | 4.5.4 |
| Filming other players and training on video | Opponent recording notification, first-recording consent screen with training toggle, both-players rule, no training on non-users until they join; microphone purpose string for analysis-only audio | 5.1.1, 5.1.2 |
| Third-party processors | Stream (messaging), Anthropic (moderation agent), Cloudflare (video storage) listed in privacy policy and SDK privacy manifests | 5.1.1, 5.1.2 |

**WCAG 2.2 AA additions**

- **Birthday picker:** visible and accessible "Birthday" label, VoiceOver announces each wheel change, Done button at 44×44pt, label and button scale at the largest Dynamic Type sizes. Test the year wheel with VoiceOver before locking the starting date (1.3.1, 4.1.2, 2.5.8, 1.4.4)
- **Level badges, admin labels, reliability:** icon plus text, never color alone (1.4.1)
- **Heatmaps and replay markers:** labels and patterns (1.4.1)
- **Simulated replay:** the court animation is decorative; each shot's type, player, outcome, and time is in the accessible shot list (1.1.1, 1.3.1)
- **"Close call" label:** icon plus text, never color alone (1.4.1)
- **Charts and player cards:** text summaries and single accessible elements (1.1.1, 1.3.1)
- **Message bubbles:** sender, text, and time in one swipe; new messages announced (1.3.1, 4.1.3)
- **Swipe actions:** long-press menu and VoiceOver custom actions as alternatives (2.5.7)
- **Voice cues:** captions mirror to the Live Activity, never audio-only; Start and Stop buttons labeled for VoiceOver (1.1.1, 1.3.3, 4.1.2)
- **Radius and level range controls:** 44×44pt targets, Dynamic Type safe (2.5.8, 1.4.4)
- **Milestone animations:** a 200ms fade replaces motion under Reduce Motion; each moment's outcome is announced to VoiceOver in text (2.3.3, 4.1.3)

## Roadmap

_Phases are ordered, not dated. The live doc shows these as a chart._

- **Launch (v1):** Discover; Leagues (Flex, Round robin); Ball Boi stats and simulated replay; Ball Boi Pro; court directory; head-to-head and recaps
- **First update (v1.1):** close-call video clips; weather reschedule; calendar sync
- **Later:** junior leagues (if there's demand); Ladder format; Organizer plan; doubles shot analysis; coaching tips; spin, swing path, footwork; Apple Watch scoring

Coaching tips return only once a coach-authored library exists, and doubles analysis waits on per-player shot attribution.

## Decision log (updated Nov 4, 2026)

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
| 9 | Moderation: John primary, Claude agent after 6 hours with reversible actions only, bans human-only. Instant auto-restrict removed by decision 48 (Nov 4) |
| 10 | Reviewer: password demo account, seeded data, live paywall, on-court screen recording |
| 11 | Notifications: provisional from sign-in, full prompt at the contextual moment, Settings banner if denied |
| 12 | Every recording starts from a match; Quick match covers casual hits, with placeholder opponents and invite links for non-users |
| 13 | Ball Boi disabled on doubles with "Doubles is coming"; team-level doubles stats first after launch |
| 14 | Apple IAP via RevenueCat at launch; Stripe link revisited after the Supreme Court rules |
| 15 | No in-app notice for non-users; their footage stays out of training until they join |
| 16 | Audio recorded for analysis only, never played back; the test set decides whether it stays |
| 17 | Partner phone optional; live preview in v1.1; voice start command and solo visual cues post-MVP |
| 18 | Find a Matchup is now Discover (Oct 21): a familiar, short tab label covering players, Open leagues, and open matches. Sections: Players near you, Open leagues, Open matches. "Open Match posts" are now "open matches" |
| 19 | Familiar over novel (Oct 21): standard iOS patterns, one name per thing everywhere, plain words over branded ones, same action in the same place. Tabs: Home, Leagues, Ball Boi (center), Discover, Messages |
| 20 | Profile is the fifth tab and Messages moves to the top corner of every tab, with an unread count (Oct 21). Tab order: Home, Leagues, Ball Boi (center), Discover, Profile |
| 21 | Birth-date fallback uses the native iOS date picker in wheels style, with a neutral prompt and starting date (Oct 21) |
| 22 | League seasons run 1 to 24 weeks, 8 by default, set with a number input and − / + buttons (replaces 6 to 12 weeks); seasons start on any day from a calendar picker; Create is the primary button at the bottom of the new league flow (Oct 29) |
| 23 | Standings rank on wins only (Oct 29). Ties are now broken by decision 79 |
| 24 | The first score entered stands; no confirm or dispute flow in Leagues or Discover (Oct 29) |
| 25 | Every league gets a fixed 1-week grace period after a round's deadline; matches played in it update ratings and Ball Boi stats but not standings. Replaces the admin's forfeit or no-result rule (Oct 29). Results never move levels, so only Ball Boi stats update (decision 75) |
| 26 | Every league locks to new joins once the season starts; the waitlist holds requests for next season (Oct 29) |
| 27 | A player who drops out keeps their played matches; their remaining matches are voided and they're removed from standings (Oct 29) |
| 28 | Subtle animations at four moments (Oct 29): score entered, career milestone, player card reveal (first view only), Ball Boi analysis ready. League standings change dropped. Reanimated with a haptic; a fade under Reduce Motion |
| 29 | Flex pairings go out each week on the season's start weekday, not always Monday (Oct 29) |
| 30 | Waitlists are Open-only. A Private league's code entered after its season starts creates a join request for the admin; approved players enter the next round at zero wins (Oct 31) |
| 31 | League admins can end and delete their league. End freezes standings and keeps history; Delete removes it and notifies members. A league's only admin can't leave without promoting a co-admin (Oct 31). The leave rule is replaced by decision 53 |
| 32 | Playing stays free forever: leagues, Discover, match requests, scores, messaging, and the player card (Nov 2) |
| 33 | Pro at launch is shot analysis, replay, trends, and full career stats; travel mode, deeper head-to-head, and AI insights join Pro as they ship, at the same price (Nov 2) |
| 34 | Every account gets 3 free months of Pro, starting at the first use of any Pro feature with a "starts today" message. Replaces "from the first recording" in decision 3 (Nov 2) |
| 35 | The paywall ships at launch; no free-until-X-users period and no founding member price (Nov 2) |
| 36 | Pro costs $7.99/month or $59.99/year (replaces $5 / $40) (Nov 2) |
| 37 | A match is analyzed if either player has Pro (paid or in free months), no matter whose phone recorded it (Nov 2) |
| 38 | Free players get the full breakdown and replay for the first 4 games; the rest shows locked. Subscribing later unlocks every past analyzed match (Nov 2) |
| 39 | Free players with unused free months see "Start your 3 free months to see the whole match"; nothing starts without their tap (Nov 2) |
| 40 | Opponent breakdowns are mutual: a player sees an opponent's full breakdown for matches they played together only when both have Pro (Nov 2) |
| 41 | Placeholder opponents who join later get the "recorded your match" notice and training toggle, then the 4-game teaser and free-months offer (Nov 2) |
| 42 | When Pro lapses, players keep everything already unlocked, including past opponent breakdowns; new analysis and trends need Pro (Nov 2) |
| 43 | The Organizer plan comes after launch, once real leagues are running (Nov 2) |
| 44 | Casual leagues collect fees outside the app (Venmo or anything else); Ball Boi takes no cut (Nov 2) |
| 45 | Organizers can add an optional fee and payment instructions, visible to everyone in Discover, on the league page, and on the join screen, plus a paid checklist in Manage (Nov 2) |
| 46 | The fee note and paid checklist ship before launch, in Wave 4 (Nov 2) |
| 47 | In-app league fee collection is a club enterprise offer after all waves, folded into the Organizer plan; pricing decided then (Nov 2) |
| 48 | Moderation stays at the minimum Apple requires: Report, Block, and the Moderation queue. No account is restricted automatically, by reports (2 or more people), Stream flags or behavior signals. Reports go to John, then the Claude agent after 6 hours, and nothing happens to the account until one of them acts. The agent never reviews appeals (Nov 4) |
| 49 | Leagues can have a set match time: an admin can set a weekly match day and time (clubs). When none is set, either player sets a date and time for their match inside its week (rec leagues) (Nov 4) |
| 50 | Any unplayed match this week, grace week included, can be recorded. A set time only moves the match to the top of Home and the Ball Boi tab on that day (Nov 4) |
| 51 | Doubles is hidden in Start a league until a later wave builds doubles pairing, after a partner flow review (Nov 4) |
| 52 | Calls mid-recording: a ringing call pauses recording; if it isn't picked up, recording carries on in the same match. An answered call stops and saves, then Resume recording adds to the same match. A manual lock or app switch acts like an answered call. No Focus setup; a hint by Record suggests Do Not Disturb (Nov 4) |
| 53 | An admin who leaves stops playing but stays admin, and the only-admin block on leaving is gone. Replaces the leave rule in decision 31 (Nov 4) |
| 54 | A league's only admin who deletes their account picks the new admin first. Skip hands it to the longest-standing member, so deletion is never blocked (Apple 5.1.1(v)) (Nov 4) |
| 55 | When a bracket player leaves, their opponent advances on a walkover, shown as W/O (Nov 4) |
| 56 | Each playoff round gets two weeks, a play week plus a grace week. After that the admin enters the result or a walkover (Nov 4) |
| 57 | Score entry has Opponent retired: enter the score so far, it counts as a win, and the result shows RET (Nov 4) |
| 58 | The earliest league start date is tomorrow (Nov 4) |
| 59 | An ended league's invite code shows "This league has ended" and sends no request (Nov 4) |
| 60 | Score corrections lock when a league ends, and Correct a score is hidden (Nov 4) |
| 61 | Round robin's description reads "Pairs you with someone new each week" (Nov 4) |
| 62 | A league runs on its creator's time zone, taken from the admin's phone when the league is made (Nov 4) |
| 63 | No report email alerts and no new moderation tools for now. Lift and unhide buttons, reporter notes, snapshot retention, appeal timing and the appeal email subject stay as built (Nov 4) |
| 64 | Settings gets "Help Ball Boi get smarter" (the training opt-out) and "Upload on cellular" now, and changes stick after closing the app (Nov 4) |
| 65 | Both players in a match (the recorder, the opponent and a claimed placeholder) see its uploading, analyzing and ready card (Nov 4) |
| 66 | Failed analysis says "Ball Boi couldn't analyze this match" with a short reason, like "We couldn't see the court", and a Remove button. No Try again (Nov 4) |
| 67 | The court-line corner fix moves to Wave 2, built alongside on-device court detection (Nov 4) |
| 68 | A Quick match and its placeholder are removed automatically when you leave the invite screen or the camera before recording (Nov 4) |
| 69 | The birthday wheel keeps its neutral start (January 1, 30 years back), and Done stays off until a wheel moves (Nov 4) |
| 70 | The age check and onboarding step 1 get a quiet Sign out text button (Nov 4) |
| 71 | Rosters, pairings and Manage always show a player's current profile name and level (Nov 4) |
| 72 | Welcome switches from the browser sheet to Apple's and Google's native sign-in buttons (Nov 4) |
| 73 | The Match day reminders switch is hidden until Wave 2. In Wave 2 reminders are on by default, still behind iOS's permission: provisional from sign-in, the full prompt after joining a league or sending a match request (decision 11) (Nov 4) |
| 74 | The app says "self-rated level", never "Ball Boi Rating", until a USTA or NTRP sync. Edit profile row "Self-rated level"; badge "Level 3.5, Self-rated"; Manage and requests "Level 3.5, self-rated"; VoiceOver "Level 3.5, self-rated". Once a sync lands, the source word replaces Self-rated (Nov 4) |
| 75 | A player's level changes only when they edit it, or later through a USTA or NTRP sync. Match results never move it (confirms the Oct 29 call). Leagues read the profile's level; admins set one only for placeholder players, and the player's own replaces it when they claim the spot (Nov 4) |
| 76 | Sign out warns first when recordings haven't uploaded, with the count, Cancel and Sign out anyway (Nov 4) |
| 77 | League opponents talk in a direct chat (Message opponent) for now; full match threads come with Discover (Oct 31, logged Nov 4) |
| 78 | The last onboarding step is an optional research question, "What do you want to do on Ball Boi?": pick any of four options or none, and everyone lands on Home. Replaces the four setup paths (Nov 2, logged Nov 4) |
| 79 | Standings break ties on wins by head to head between the tied players, then share of sets won, then share of games won; playoff seeding uses the same order (John, Nov 6) |
| 80 | The score-entered animation shows the win-loss record ticking to its new value, never a level change; VoiceOver reads "Win recorded. You're now 15 and 6." Levels stay static unless the player edits them (John, Nov 7) |
