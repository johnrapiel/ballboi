<!-- Snapshot of the live spec: https://claude.ai/code/artifact/ff76f66f-d4ec-49cb-b49a-7b9ad76fb102 (synced 2026-11-02 with rev 74). Updated in the repo on 2026-11-04 with the Wave 1 review decisions (48 to 78), on 2026-11-06 with decision 79, and on 2026-11-07 with decisions 80 and 81, then 82 and 83 (Ball Boi Pro parked), then 84 to 99 (beta recording and footage release, B1 to B16). The live doc was resynced on 2026-11-07 through decision 99. The live doc wins if they differ. Refresh this file when the live doc changes. Updated in the repo on 2026-11-08 with decision 143 (appearance follows the iPhone). -->

# Ball Boi: Flows and Feature Spec

2026-11-04 · @John

## Overview

Ball Boi launches in the US as one app for finding local players, running leagues, and recording matches with shot analysis. SwingVision covers recording and Find Your Court covers courts; neither ties discovery, league play, and match analysis into one level and one profile.

**v1 launch scope**

- **Discover:** local-only discovery of players and Open leagues, nationwide availability
- **Leagues:** Flex and Round robin formats, singles and doubles, one league chat with pins
- **Ball Boi:** recording, core shot stats, simulated replay, and trends (singles analysis only)
- **Self-rated level:** one NTRP-scale level the player sets, used everywhere for matching. "Ball Boi Rating" stays out of the app until a USTA or NTRP sync
- **Messaging:** direct messages (no Message Requests, decision 101), a direct chat with your league opponent, matches set up in chat (decision 110), moderation ladder
- **Profile:** baseball-card player card, career stats, head-to-head
- **Extras:** court directory, head-to-head records, shareable match recaps
- **Pricing:** everything is free at launch, including Ball Boi analysis, replay, trends, and career stats. Ball Boi Pro is parked until there's traction (decision 82)
- **Audience:** adults only (18+)

**Out of v1:** Ball Boi Pro subscription (parked), coaching tips, Ladder format, doubles shot analysis, Organizer plan, Apple Watch, weather reschedule, calendar sync, junior (under 18) players, match video playback, close-call video clips.

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

- **Notifications:** provisional (quiet) notifications from sign-in, delivered to Notification Center with Keep and Turn Off buttons, no prompt. The full prompt, with a reason screen first, shows once, at the first of: joining a league, a match being added in chat, posting or joining an open match, or turning on open match alerts (decision 125). If denied, a one-line Home banner links to Settings; never a repeat nag. Match day reminders are on by default (Wave 2) and still reach a player only once iOS allows notifications
- **Location:** only for the zip shortcut (no travel mode, decision 113)
- **Camera and mic:** at first recording

## Navigation

Five tabs, with Ball Boi in the center. Messages opens from the button in the top corner of every tab.

| Tab | What lives there |
| --- | --- |
| Home | Upcoming matches, plus anything waiting on you (pairings to review, a match card to answer). No stats, results or standings (decision 137) |
| Leagues | Your leagues, each with chat, schedule, standings, and Manage for admins; Start a league |
| Ball Boi | Start a recording, past matches, replays, trends |
| Discover | Players near you, Open leagues, Open matches (including your own) |
| Profile | Your player card, This season, Ball Boi this season, Upcoming matches and Results (decision 138); Settings (including training data, Sign out and account deletion) from the top corner |

**Messages (top corner):** direct chats, including Message opponent from a league match and chats where Discover matches are set up, plus open match group chats (decision 136). There are no Message Requests (decision 101). A 44pt button in the top-right of every tab with an unread count VoiceOver reads ("Messages, 3 unread").

League chat lives inside each league, not in Messages, so busy leagues never bury direct conversations. Every tab has an icon plus a text label, and badge counts are read by VoiceOver.

## Self-rated level

One level on the NTRP scale (2.5 to 5.0, where 5.0 is "Expert", decision 106) drives all matching. Players set it themselves, so it avoids USTA's no-caching rule and works for players with no external rating. Until a USTA or NTRP sync lands, the app calls it "self-rated level", never "Ball Boi Rating".

- **Set by the player:** onboarding quiz with plain descriptions, changed anytime in Edit profile
- **Labels:** the level pill reads "Level 3.5" on player cards (decision 140); Edit profile's Level row reads "3.5 · Self-rated", so the player knows where it came from; Manage roster and requests "Level 3.5, self-rated". A placeholder player shows "Level 3.0" and a signed-up player with no level shows "Level not set"
- **Verified by UTR link:** OAuth via the UTR Engage API seeds the level and shows a "Verified" badge with icon and text
- **Results never move it (Oct 29, confirmed Nov 4):** no score, grace-period match or doubles result changes anyone's level. It changes only when the player edits it, or later through a USTA or NTRP sync
- **One source:** the profile holds each player's name, photo and level, and every league reads the current profile. Admins set a level only for placeholder players not on Ball Boi, and the player's own level replaces it when they claim the spot
- **Match range:** ±0.5 by default, widenable to ±1.0

## Discover

Discover is always local: results are bounded by distance, never a national feed. The app is available across the US, but each user only sees players and leagues near their home area.

**Location and privacy**

- **Home area anchor:** set by zip or neighborhood at onboarding
- **Radius:** 10 miles by default, 5 / 10 / 15 / 30 and Custom (1 to 30), with a count at each step, on each tab
- **Approximate distance only:** "~4 mi away," never an exact location
- **Optional home court:** picked from the court directory, shown on the player card as a natural meetup spot
- **No travel mode:** Discover always searches from your home zip, changed with Change (decision 113)
- **List, not map:** sorted by distance and level fit, no map of players
- **Hidden profile:** opt out of discovery while keeping leagues and Ball Boi
- **Availability:** an hour grid, Monday to Sunday, hourly 6 AM to 9 PM, tap or drag the hours you're free; no week picker. Set in Edit profile, not onboarding. Powers Discover only: player cards show a short summary, and Filters has "Free when I'm free" (decisions 115, 116, 119)

**What the page shows**

Three tabs at the top: Players, Open leagues, Open matches (decision 109).

- **Players near you:** filtered by level range, singles or doubles, and "Free when I'm free". List rows don't show free times (decision 122)
- **Open leagues:** distance, level range, format, start date, spots left
- **Open matches:** post date, time window, court, skill range, and format; nearby matching players get notified
- **Need 1 / Need 2:** a tag on doubles open matches; taking a spot works like joining any open match, and the group chat opens when the last spot fills (decision 114)
- **Empty state:** widen radius, post an open match, or invite a friend by link

**From found to playing**

Setting up a match happens in chat (decision 110):

1. "Set up a match" on a player card opens a chat with them and an "Add this match?" card: day, time, court, singles or practice hit
2. The other player taps "I'm in" or "Can't make it". To suggest a different time, either player sends a new card; only the latest can be accepted. "Match added" has a short Undo
3. The day before: "Still on for tomorrow?" (no answer means still on), plus the match day reminders (decision 127)
4. Three hours after the match with no score: "Did it happen?" with Enter the score, They didn't show, or We didn't play
5. A no-show report gives the other player 48 hours to answer. A disputed no-show goes on neither card (decision 120)
6. Reliability shows on player cards: "Played 12 · 1 no-show". Played counts every scored match against a real Ball Boi player; No-show counts only confirmed or unanswered Discover no-shows (decision 121)

**Joining an Open league:** request a spot before the season starts, admin approves. Once the season starts the league locks to new joins; full and locked leagues hold requests on a waitlist for next season.

## Messaging and moderation

Players can message before committing to a match, so safety is built into the inbox from day one. Every report is acted on within 24 hours to meet Guideline 1.2.

**Platform**

- **Stream Chat on the Maker plan** (free: up to 2,000 monthly active users, 100 concurrent connections, $100/month AI moderation credit), with the free Build plan as fallback
- **Used headless:** Ball Boi builds its own AA-compliant message UI
- **Behind Ball Boi's own messaging interface** in code, so moving to a self-built backend later is a contained swap, not a rewrite
- **Stream's flags and moderation events** feed the existing `/api/admin/reports` queue, so there's one review queue

**Inbox guardrails**

- **No Message Requests:** every message goes straight to the inbox (decision 101)
- **Filtered first messages:** a first message from someone outside your leagues can't contain links, a phone number, an email or slurs
- **New-account throttle:** max 5 new conversations per day for the first week
- **Report on every message and player:** long-press menu plus a VoiceOver custom action; reports snapshot the messages for moderators. One Report sheet everywhere, with these reasons: Harassment or threats; Inappropriate photo or words; Spam; False scores or cheating; Unsafe at a match; Something else (opens a text field) (decision 117)
- **Block lives inside Report:** an "Also block [name]" checkbox; no separate Block action or Blocked players screen, and a blocked chat shows a small Unblock link (decision 102). Blocking stops DMs both ways and hides both players from each other in search and pairings
- **Message previews:** pushes show sender and text; Settings > Notifications > Show message previews (on by default) turns them into "New message from [name]" (decision 128)

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
- **Either player can edit a score for 24 hours** from the pencil next to it on Match detail; the latest edit stands, standings recompute, and the other player sees "Score edited by [name]". After 24 hours only the admin's logged correction in Manage can change it (decision 100)
- **Tiebreaks:** a set entered as 6-6 opens tiebreak boxes; the points are required and the set saves as 7-6(x) (decision 104)
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
3. Players work out a time in a direct chat with their opponent (Message opponent). In a league with no set match time, either player saves the match's date and time inside its week
4. Either player enters the score and standings update; it can be edited for 24 hours (decision 100)
5. Unplayed matches get a 1-week grace period after the round's deadline; matches played in it update Ball Boi stats but not standings

**Reminders (decision 127):** any match with a set date and time, league or Discover, gets a reminder at 8 AM the day before (on the match's clock, at most once) and one 2 hours before. League matches with no set time get a Sunday "your match this week" nudge. There's no weekly "set your availability" reminder. All behind the Match day reminders switch, on by default

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
- **Voice positioning coach:** on-device court detection drives spoken guidance in John's recorded voice (21 lines and a chime, no text-to-speech), one step at a time ("Please tilt your phone up a little," "Move your phone towards the centre of the court"), ending with "Perfect. Court locked." and a chime. One script for every session. At least 10 seconds of quiet between any two pieces of setup guidance (corrections, their repeats, Hold, the no-court line and Record anyway); the same correction stops after 3 times in a row while the phone hasn't moved. Court locked, Phone moved, the countdown and the stop lines aren't held back (John, Nov 8). Plays on silent; mute toggle. Clips and captions live in `artifacts/mobile/assets/audio/coach/` and one manifest (decisions 123, 135)
- **The app only speaks while recording (Nov 7):** spoken cues (voice coach, countdown) play only from the mounted phone during a Ball Boi recording. Captions show where someone can see them: never on the mounted phone, whose screen faces the fence; on the Live Activity, partner phone and Apple Watch during setup and recording (John, Nov 8, updates decision 131). Everywhere else the app is silent. VoiceOver announcements speak only for players who turned VoiceOver on in iOS
- **Court won't lock:** a spoken tip, then after about 20 seconds of waiting the Record anyway line plays and the chosen countdown starts on its own; court lines get fixed later in the replay (decision 142)
- **Partner phone is optional:** solo players use the countdown, voice coach, and the Stop button. A second phone adds remote controls and a readable screen for captions
- **Start:** picked before mounting. With the phone in hand, choose "Start in Now / 5 / 10 / 15 min" and tap Record; it works as soon as the camera is ready, without waiting for a court lock. The phone then waits for the court while the voice coach guides aiming, with Cancel on screen. Once the court locks ("Perfect. Court locked." and the chime), the countdown runs by itself with its spoken cues. If the phone moves during the countdown, it pauses, "Your phone just moved" plays, and it carries on from where it stopped once the court locks again. No lock after about 20 seconds: the Record anyway line plays and the countdown starts anyway; the court lines get fixed after the match. The court-lock check keeps running during the countdown. The Live Activity Start button is a second way to start (decision 142)
- **Warmup:** recording can capture warmup; the match start point can be dragged in the replay
- **Match notification:** the opponent gets "Ball Boi is recording your match," only for league mates and accepted matches; it doubles as a recording notice. A Quick match opponent who's a stranger gets "[Name] recorded a match with you. Was that you?" with Yes and Not me; until Yes the match isn't linked to their profile (decision 124). Placeholder opponents get no in-app notice
- **Live Activity on both phones:** court lock status, recording time, mounted phone battery, and Start match / Stop; either player has full controls; voice cues mirror here as captions, and to Apple Watch where available. It starts on its own on the opponent's phone for league mates and accepted Discover matches; a Quick match stranger gets it only after Yes (decision 129). No live stats while recording (decision 123)
- **Stop:** from either player's phone or Live Activity, or the Stop button on the mounted phone, which asks "Stop recording?" first. No press-and-hold stop (decision 134)
- **Safety cap:** auto-stop and save at low battery, low storage, or 4 hours. Low battery plays its recorded line; low storage and the 4-hour cap play the chime and show a caption (decision 132)
- **Calls and interruptions:** a ringing call pauses recording. If it isn't picked up, recording carries on in the same match and only the ringing seconds are lost. An answered call, a manual lock or an app switch stops and saves, and coming back shows Resume recording, which adds to the same match. The screen stays awake while recording. A hint by Record reads "Put your phone on Do Not Disturb before you hit record so the video isn't interrupted."
- **Audio:** recorded for shot detection only; never played back, deleted after processing, excluded from training on non-users. The labeled test set decides whether audio stays for launch
- **Consent screen before a user's first recording:** covers recording other players, audio for analysis, and the training toggle (see Video and training data)

**After the match**

- **Score prompt at stop** posts to standings right away (only Ball Boi stats if the match is in its grace period); it can be edited for 24 hours (decision 100)
- **Replay processing card:** no video playback; the match shows upload and analysis status ("Waiting for Wi-Fi · Upload now on cellular," then "Analyzing"). Both players see it: the recorder, the opponent and a claimed placeholder. If analysis can't finish, the card says "Ball Boi couldn't analyze this match" with a short reason (like "We couldn't see the court") and Remove, with no Try again
- **Upload:** Wi-Fi by default with an "Upload on cellular" switch in Settings; background upload survives the app closing; video stays on the phone until the server confirms. Signing out with recordings that haven't uploaded warns first ("2 recordings haven't uploaded. Signing out deletes them.") with Cancel and Sign out anyway
- **Push** when the simulated replay and stats are ready
- **Court-line fix** appears only when detection confidence is low: drag four handles on a still frame captured on the phone before upload
- **Every match gets the full replay and stats,** free, with no paywall (see Pricing)

**Processing:** court detection runs on device; shot analysis runs on the server for v1 and moves on device later.

**Shot analysis build**

- **Built by John with Claude Code acting as the ML engineer,** starting from open-source tennis models (ball tracking, court keypoints, player pose), running as a server pipeline that reads video from R2
- **Labeled test set before launch:** 10 to 15 singles matches filmed with the app's own mount guidance across different courts, lighting, and skill levels (public courts, indoor bubbles, a night match under lights). Every shot labeled for type, in/out, and point ending in a labeling tool Claude Code builds
- **Automatic eval:** every model change is scored against the test set
- **Per-stat accuracy bar,** e.g. shot type ≥ 90%, in/out on close calls ≥ 85%, serve placement ≥ 85%, point endings 85% correct, rally length within 1 shot on 85% of points, first-serve % within 5 points, placement in the right zone 80% (decision 98). A stat that misses its bar is hidden at launch, not shown with a disclaimer
- **Beta:** 3 to 5 commissioned local players, invited by email as TestFlight external testers, record through builds pointed at a private (non-public) tenant. They agree to the Ball Boi Beta Footage Release (ballboi.tennis/beta-release) with a checkbox in the first-recording carousel, and confirm any opponent not on Ball Boi agreed to be filmed. The beta starts once the voice coach merges (decisions 84 to 99)

**Core stats (launch, each gated on its accuracy bar)**

- **Shot type:** forehand, backhand, serve, volley, overhead
- **In or out,** with uncertain calls labeled "Close call" instead of stated as fact
- **Placement heatmaps** for landing spots and hitting positions, using labels and patterns, not color alone
- **Serve:** first-serve % and placement by box. Estimated serve speed is out of launch until there's a way to measure it (decision 98)
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

The player card is a brag sheet, never a scouting report: it shows strengths and records, while error patterns and heatmaps stay private. Your own Profile tab is your player card exactly as others see it, with your matches below it (decisions 138, 139).

**The player card (design D, Portrait, chosen Nov 8):** a light tennis court drawing across the top with the photo overlapping it, the name in brush script, "Level 3.5" and "Singles" pills, the town, and along the bottom the home court and a grid icon that opens the player's free times as a read-only week grid. It holds only what the player entered. On your own card a pencil opens Edit profile. The same card is used everywhere, including Discover.

**Profile tab, top to bottom:** the player card; This season (Record, Played, Streak, No-shows); Ball Boi this season (aces, forehand winners, first serves in, with See all for this season's recordings); then Upcoming matches and Results tabs. There's no separate My matches screen: Home's See all opens these tabs. Edit profile holds name and photo, level, home area, plays, free times and home court; Sign out lives in Settings.

| Element | Visibility |
| --- | --- |
| Name, photo, level, plays, town, home court, free times | Public |
| This season: record, played, streak, no-shows (reliability) | Public |
| Ball Boi this season (aces, forehand winners, first serve %) | Public |
| Head-to-head record vs. the viewer | Visible to that viewer |
| Error patterns, heatmaps, trends | Private. Whether an opponent from the same match sees its full breakdown is pending (decision 83) |
| Match video | Never shown; raw video deleted after analysis unless kept for training |

- **No Ball Boi data yet:** Ball Boi this season shows a "No Ball Boi matches yet" prompt; it also stays empty until stats pass their accuracy bars
- **VoiceOver reads the card as one summary,** e.g. "Alex Kim, Level 3.5, singles, Fishkill, home court Beacon Courts"
- **Career stats:** full personal history, reached from Profile

**Shareable match recap:** auto-generated after each match's score is entered with score, aces, and winners, sized for Instagram Stories and texts, carrying the Ball Boi logo. Always in the Day look (ivory and white, navy ink), whatever the phone is set to (decision 143).

**Court directory:** a searchable list, nearest first ("Beacon Courts · ~3 mi"), with "Add a court" (name and address) when one is missing; no map. Opens from Settings > Discover > Home court and the court field in Post an open match, and feeds match cards in chat (decision 112).

**No handedness:** Ball Boi doesn't collect or show it (decision 118).

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

Everything is free at launch, Ball Boi included. Ball Boi Pro is parked until there's enough traction to charge (decision 82), so a small early group isn't put off by a price. The full Pro plan (price, free months, paywall, mixed matchups, lapsed state) is saved in `docs/backlog/ball-boi-pro.md` in the repo and `claude/backlog/ball-boi-pro.md` in the Project, to bring back later.

- **Free for everyone at launch:** leagues, Discover, match requests, scores, messaging, the player card, shot analysis, the simulated replay, trends, and full career stats
- **Every recorded singles match is analyzed,** whoever's phone recorded it. Shot data is stored for both players
- **No paywall, subscription, free-months clock, or In-App Purchase** in v1. No locked games or "Subscribe" prompts anywhere
- **Opponent breakdowns:** pending John (decision 83). Until decided, a player sees only their own breakdown
- **Club and enterprise plans:** being worked out (see League fees and decision 47)

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
| Home area | Location purpose string, While Using only, for the zip shortcut | 5.1.1 |
| UTR linking | Disclose shared data and unlink path in privacy policy and labels; no partner logos without approval | 5.1.1, 5.2.1 |
| User-to-user messaging | Re-answer age rating questionnaire; set 18+ | Age rating |
| Account deletion | Deletes messages, video, level, removes footage from future training; revokes UTR link and Apple token | 5.1.1(v) |
| Reviewer demo account | Password sign-in for that account only; seeded league, two Ball Boi matches, message thread with a match card, open match; 60-second on-court recording in review notes | 2.1 |
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
- **Voice cues:** captions on the Live Activity, partner phone and Apple Watch, never on the mounted phone and never audio-only; Start and Stop buttons labeled for VoiceOver (1.1.1, 1.3.3, 4.1.2)
- **Radius and level range controls:** 44×44pt targets, Dynamic Type safe (2.5.8, 1.4.4)
- **Availability grid:** each cell read as "Monday 6 PM, free" or "not free"; a whole-row toggle as the non-drag alternative (2.5.7, 4.1.2)
- **Header buttons:** plain icons inside iOS's own glass circle, 44×44pt, labeled for VoiceOver (decision 133) (2.5.8, 4.1.2)
- **Appearance:** the app follows the iPhone's Light or Dark Mode, no in-app override: Day (ivory and white, navy ink) in Light Mode, Night (warm charcoal, ivory ink) in Dark Mode, switching live with no restart. Shareable recaps use the Day look. Every text, border, chart and replay pair passes in both, with and without Increase Contrast; native pieces (date pickers, action sheets, alerts, keyboard, status bar) follow the same mode (decision 143) (1.4.3, 1.4.11)
- **Milestone animations:** a 200ms fade replaces motion under Reduce Motion; each moment's outcome is announced to VoiceOver in text (2.3.3, 4.1.3)

## Roadmap

_Phases are ordered, not dated. The live doc shows these as a chart._

- **Launch (v1):** Discover; Leagues (Flex, Round robin); Ball Boi stats and simulated replay, free for everyone; court directory; head-to-head and recaps
- **First update (v1.1):** close-call video clips; weather reschedule; calendar sync
- **Later:** Ball Boi Pro, once there's traction; club and enterprise plans; junior leagues (if there's demand); Ladder format; Organizer plan; doubles shot analysis; coaching tips; spin, swing path, footwork; Apple Watch scoring

Coaching tips return only once a coach-authored library exists, and doubles analysis waits on per-player shot attribution.

## Decision log (updated Nov 8, 2026)

| # | Decision |
| --- | --- |
| 1 | Whole app is 18+ for the MVP; junior leagues later if there's demand |
| 2 | Age enforced with Declared Age Range API, birth-date fallback, 18+ rating, pass/fail flag only |
| 3 | 3 months free from the first recording; soft paywall at the next use after; "Not now" records but analysis waits (replaces the free-first-match model, Oct 18) Parked by decision 82 |
| 4 | Shot analysis built with Claude Code as ML engineer from open-source models, server-side |
| 5 | Labeled 10 to 15 match test set, automatic eval, per-stat accuracy bars; TestFlight beta on a private tenant |
| 6 | Training on by default, both players must leave it on, no face blurring, "personal information is never shared or sold" copy |
| 7 | Simulated replay only; raw video deleted after analysis unless kept for training; "Close call" labels; close-call clips in v1.1 |
| 8 | Stream Chat on the Maker plan, headless, behind Ball Boi's own interface |
| 9 | Moderation: John primary, Claude agent after 6 hours with reversible actions only, bans human-only. Instant auto-restrict removed by decision 48 (Nov 4) |
| 10 | Reviewer: password demo account, seeded data, on-court screen recording. The live paywall is parked with decision 82 |
| 11 | Notifications: provisional from sign-in, full prompt at the contextual moment, Settings banner if denied |
| 12 | Every recording starts from a match; Quick match covers casual hits, with placeholder opponents and invite links for non-users |
| 13 | Ball Boi disabled on doubles with "Doubles is coming"; team-level doubles stats first after launch |
| 14 | Apple IAP via RevenueCat at launch; Stripe link revisited after the Supreme Court rules Parked by decision 82 |
| 15 | No in-app notice for non-users; their footage stays out of training until they join |
| 16 | Audio recorded for analysis only, never played back; the test set decides whether it stays |
| 17 | Partner phone optional; live preview in v1.1; voice start command and solo visual cues post-MVP |
| 18 | Find a Matchup is now Discover (Oct 21): a familiar, short tab label covering players, Open leagues, and open matches. Sections: Players near you, Open leagues, Open matches. "Open Match posts" are now "open matches" |
| 19 | Familiar over novel (Oct 21): standard iOS patterns, one name per thing everywhere, plain words over branded ones, same action in the same place. Tabs: Home, Leagues, Ball Boi (center), Discover, Messages |
| 20 | Profile is the fifth tab and Messages moves to the top corner of every tab, with an unread count (Oct 21). Tab order: Home, Leagues, Ball Boi (center), Discover, Profile |
| 21 | Birth-date fallback uses the native iOS date picker in wheels style, with a neutral prompt and starting date (Oct 21) |
| 22 | League seasons run 1 to 24 weeks, 8 by default, set with a number input and − / + buttons (replaces 6 to 12 weeks); seasons start on any day from a calendar picker; Create is the primary button at the bottom of the new league flow (Oct 29) |
| 23 | Standings rank on wins only (Oct 29). Ties are now broken by decision 79 |
| 24 | The first score entered stands; no confirm or dispute flow in Leagues or Discover (Oct 29) Changed by decision 100 (24-hour edit) and, for Discover, decision 120 (no-show disputes) |
| 25 | Every league gets a fixed 1-week grace period after a round's deadline; matches played in it update ratings and Ball Boi stats but not standings. Replaces the admin's forfeit or no-result rule (Oct 29). Results never move levels, so only Ball Boi stats update (decision 75) |
| 26 | Every league locks to new joins once the season starts; the waitlist holds requests for next season (Oct 29) |
| 27 | A player who drops out keeps their played matches; their remaining matches are voided and they're removed from standings (Oct 29) |
| 28 | Subtle animations at four moments (Oct 29): score entered, career milestone, player card reveal (first view only), Ball Boi analysis ready. League standings change dropped. Reanimated with a haptic; a fade under Reduce Motion |
| 29 | Flex pairings go out each week on the season's start weekday, not always Monday (Oct 29) |
| 30 | Waitlists are Open-only. A Private league's code entered after its season starts creates a join request for the admin; approved players enter the next round at zero wins (Oct 31) |
| 31 | League admins can end and delete their league. End freezes standings and keeps history; Delete removes it and notifies members. A league's only admin can't leave without promoting a co-admin (Oct 31). The leave rule is replaced by decision 53 |
| 32 | Playing stays free forever: leagues, Discover, match requests, scores, messaging, and the player card (Nov 2) |
| 33 | Pro at launch is shot analysis, replay, trends, and full career stats; travel mode, deeper head-to-head, and AI insights join Pro as they ship, at the same price (Nov 2) Parked by decision 82; travel mode dropped by decision 113 |
| 34 | Every account gets 3 free months of Pro, starting at the first use of any Pro feature with a "starts today" message. Replaces "from the first recording" in decision 3 (Nov 2) Parked by decision 82 |
| 35 | The paywall ships at launch; no free-until-X-users period and no founding member price (Nov 2) Parked by decision 82 |
| 36 | Pro costs $7.99/month or $59.99/year (replaces $5 / $40) (Nov 2) Parked by decision 82 |
| 37 | A match is analyzed if either player has Pro (paid or in free months), no matter whose phone recorded it (Nov 2) Parked by decision 82 |
| 38 | Free players get the full breakdown and replay for the first 4 games; the rest shows locked. Subscribing later unlocks every past analyzed match (Nov 2) Parked by decision 82 |
| 39 | Free players with unused free months see "Start your 3 free months to see the whole match"; nothing starts without their tap (Nov 2) Parked by decision 82 |
| 40 | Opponent breakdowns are mutual: a player sees an opponent's full breakdown for matches they played together only when both have Pro (Nov 2) Parked by decision 82 |
| 41 | Placeholder opponents who join later get the "recorded your match" notice and training toggle, then the 4-game teaser and free-months offer (Nov 2) Parked by decision 82 |
| 42 | When Pro lapses, players keep everything already unlocked, including past opponent breakdowns; new analysis and trends need Pro (Nov 2) Parked by decision 82 |
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
| 73 | The Match day reminders switch is hidden until Wave 2. In Wave 2 reminders are on by default, still behind iOS's permission: provisional from sign-in, the full prompt after joining a league or sending a match request (decision 11) (Nov 4) Prompt timing replaced by decision 125 |
| 74 | The app says "self-rated level", never "Ball Boi Rating", until a USTA or NTRP sync. Edit profile row "Self-rated level"; badge "Level 3.5, Self-rated"; Manage and requests "Level 3.5, self-rated"; VoiceOver "Level 3.5, self-rated". Once a sync lands, the source word replaces Self-rated (Nov 4) Pill label changed by decision 140 |
| 75 | A player's level changes only when they edit it, or later through a USTA or NTRP sync. Match results never move it (confirms the Oct 29 call). Leagues read the profile's level; admins set one only for placeholder players, and the player's own replaces it when they claim the spot (Nov 4) |
| 76 | Sign out warns first when recordings haven't uploaded, with the count, Cancel and Sign out anyway (Nov 4) |
| 77 | League opponents talk in a direct chat (Message opponent) for now; full match threads come with Discover (Oct 31, logged Nov 4) |
| 78 | The last onboarding step is an optional research question, "What do you want to do on Ball Boi?": pick any of four options or none, and everyone lands on Home. Replaces the four setup paths (Nov 2, logged Nov 4) |
| 79 | Standings break ties on wins by head to head between the tied players, then share of sets won, then share of games won; playoff seeding uses the same order (John, Nov 6) |
| 80 | The score-entered animation shows the win-loss record ticking to its new value, never a level change; VoiceOver reads "Win recorded. You're now 15 and 6." Levels stay static unless the player edits them (John, Nov 7) |
| 81 | The app only speaks while recording: the voice coach and countdown play from the mounted phone during a Ball Boi recording, with captions on the partner phone. No spoken cues anywhere else; VoiceOver announcements speak only when the player has VoiceOver on (John, Nov 7) |
| 82 | Ball Boi Pro is parked until there's traction: no paywall, subscription, free-months clock or In-App Purchase at launch. Shot analysis, replay, trends and career stats are free for everyone, and every recorded singles match is analyzed. The full plan (decisions 3, 14 and 33 to 42) is saved in `docs/backlog/ball-boi-pro.md`. Playing stays free (decision 32) (John, Nov 7) |
| 83 | Pending John: with no Pro, does a player see their opponent's full breakdown for matches they played together? Until decided, each player sees only their own (Nov 7) |
| 84 | A small beta of 3 to 5 commissioned players starts once Session G's voice coach merges. John's own test-set filming can start sooner (John, Nov 7, B1) |
| 85 | Beta testers use the same app as everyone: no beta flag. During the beta the app only exists on TestFlight, so a server setting on the private beta backend turns the release requirement on; it's off for the App Store launch. No opponent recording notice is needed for the beta (John, Nov 7, B2) |
| 86 | A "Something not working?" form: pick a likely problem or "Something else" with a free-text box, optional note, Send. Attaches app version, iPhone model, iOS version and the match. Saved server-side and emailed to support@ballboi.tennis. Lives in Settings plus a small link on the ready-to-record screen, the processing card and the replay placeholder. Also covers the checklist's in-app support contact (John, Nov 7, B3) |
| 87 | Beta testers are TestFlight external testers invited by email; every new build goes to them automatically (John, Nov 7, B4) |
| 88 | After upload, while no stat has passed its bar, the processing card reads "Uploaded / Thanks. Ball Boi's shot tracking is still learning, so stats and your replay come in a later update. Your match is saved." (John, Nov 7, B5) |
| 89 | Beta footage is kept until launch, the cheapest option, then normal retention rules apply; audio is still deleted after processing (John, Nov 7, B6) |
| 90 | A phone setup guide: a graphic of the ideal position (fence behind the baseline, centered, high, sideways, back camera to the court, screen to the fence, both baselines in view) and a checklist (that position, 10% battery or plugged in, 2 GB free, Do Not Disturb on). Shows before every recording with a "Don't show this again" checkbox; a "Setup tips" link on the ready screen always brings it back. In Ball Boi's navy and brush style, as the visual companion to the voice coach (John, Nov 7, B7) |
| 91 | The first recording opens a three-page carousel: 1) What Ball Boi records (filming others, audio for analysis only, video never shown); 2) Your choices (training toggle and the release checkbox; Next stays off until checked); 3) Set up your phone, ending in Open camera. Later recordings show page 3 alone. Swipe or Next and Back, no auto-advance, VoiceOver reads "Page 2 of 3", Reduce Motion fades. Replaces the single consent screen (John, Nov 7, B8) |
| 92 | The beta release is a checkbox inside the consent flow (page 2), not its own screen. Agreement is stored server-side with the release version and date; a new version shows the page again unchecked (John, Nov 7, B9) |
| 93 | Opponents outside the beta: the tester confirms they agreed. When the opponent is a placeholder (not on Ball Boi), the ready screen shows "[Name] agreed to be filmed." and Start stays off until it's checked. Chosen over requiring both players to be testers (John, Nov 7, B10) |
| 94 | A confirmed placeholder opponent's match can be used in the labeled test set and scoring, never training (keeps decision 15). Flagged for the legal consult (John, Nov 7, B11) |
| 95 | Withdrawing (email support or delete account) deletes all of that tester's video within 30 days, including test-set and training copies. Hand-made shot labels stay with the name removed; already-trained models aren't rebuilt (John, Nov 7, B12) |
| 96 | The Ball Boi Beta Footage Release is approved as written, hosted at ballboi.tennis/beta-release styled like /privacy, and sent to the planned legal consult (biometric data, audio recording) before testers sign (John, Nov 7, B13) Cleared by the consult (decision 141) |
| 97 | Labeling tool speed-ups, in order: jump to the next hit (detects the hit sound in John's local files, nothing leaves his Mac), then undo, resume at the last position, and a progress count, in the same fix (John, Nov 7, B14) |
| 98 | New accuracy bars: point endings 85% correct; rally length within 1 shot on 85% of points; first-serve % within 5 points of truth; placement in the right zone 80% of the time. Estimated serve speed is dropped from launch until there's a way to measure it (John, Nov 7, B15) |
| 99 | Pre-labeling uses only Ball Boi's own models, on John's Mac or Ball Boi's servers; no outside AI service sees footage, so the in-app copy and the release stay true (John, Nov 7, B16) |
| 100 | Either player can edit a score for 24 hours after it's entered, from a small pencil next to the score on Match detail. The latest edit stands, standings recompute, and the other player sees "Score edited by [name]". After 24 hours only the admin's logged correction in Manage can change it. Replaces "first score stands" and the 10-minute Undo (John, Nov 6, finding 7) |
| 101 | No Message Requests: every message goes straight to the inbox. A first message from someone outside your leagues still can't contain a phone number or email. Replaces the Message Requests inbox and its "can't send again until you reply" limit (John, Nov 6, finding 17) |
| 102 | Block lives inside Report: Report is the only action on a message or player, and its sheet has one "Also block [name]" checkbox. No separate Block action and no Blocked players screen; a blocked chat shows a small Unblock link. Blocking still stops messages both ways and removes the player from search and pairing (guideline 1.2) (John, Nov 6, finding 20) |
| 103 | Ball Boi opens in Light (Day) whatever the iPhone is set to; a Light/Dark toggle comes in Wave 2, Session H. Replaces the Nov 2 "Match iPhone" default (John, Nov 6) Replaced by decision 143 |
| 104 | A set entered as 6-6 opens tiebreak boxes; the tiebreak points are required, decide the set, and save as 7-6(x) (John, Nov 6) |
| 105 | Quick match opponents and New message can find any Ball Boi player who hasn't hidden their profile, never a blocked one. New message lists "In your leagues" first, then "All Ball Boi players" (John, Nov 6) |
| 106 | Levels run 2.5 to 5.0; 5.0 is "Expert" (John, Nov 6) |
| 107 | League admin tools sit behind a "Manage league" row on League detail; the invite (code, copy, share) lives at the top of Manage (John, Nov 6) |
| 108 | Every bottom sheet hugs its content, has no Cancel (drag down to close, confirm before discarding changes) and a left-aligned brush title (John, Nov 6) |
| 109 | Discover has three tabs at the top (Players, Open leagues, Open matches), your area with Change, and distance chips with counts on each tab, as drawn on the canvas (John, Nov 7, F1) |
| 110 | Setting up a match happens in chat: "Set up a match" opens a chat with an "Add this match?" card, Undo, "Still on for tomorrow?", "Can't make it", "Did it happen?" 3 hours after, and a no-show report with 48 hours to dispute. A new card replaces the old one. Replaces the structured request with accept, counter and decline (John, Nov 7, F2) |
| 111 | Where the Discover canvas predates Nov 6, the Nov 6 rules win: Report only on the player card (with "Also block"), no Blocked players row, and Filters follows the sheet rule (John, Nov 7, F3) |
| 112 | Court directory: a searchable list, nearest first, with "Add a court" (name and address); no map. Opens from Settings > Discover > Home court and from Post an open match (John, Nov 7, F4) |
| 113 | No travel mode, in any wave. Discover and open matches always search from your home zip, changed with Change; location permission is only for the zip shortcut. Replaces decision 33's travel mode (John, Nov 7, F5) |
| 114 | Need 1 / Need 2 is a tag on doubles open matches, not its own section. The group chat opens when the last spot fills (John, Nov 7, F6) |
| 115 | Availability is an hour grid: Monday to Sunday, hourly 6 AM to 9 PM, tap or drag; no week picker or "Copy last week". The "When I usually play" chips are gone everywhere (John, Nov 7, F7) |
| 116 | The grid powers Discover only: set in Edit profile, a short summary on player cards, and "Free when I'm free" in Filters. League pairing doesn't use it yet (John, Nov 7, F8) |
| 117 | Report reasons, one sheet everywhere: Harassment or threats; Inappropriate photo or words; Spam; False scores or cheating; Unsafe at a match; Something else (opens a required text field). "Pretending to be someone else" is removed (John, Nov 7, F9) |
| 118 | No handedness anywhere; Ball Boi doesn't collect it (John, Nov 7, F10) |
| 119 | Availability isn't part of onboarding. Until a player sets times, the Players tab shows "Add when you can play to find players free when you are. Set times", and "Free when I'm free" asks for times first (John, Nov 7, F11) |
| 120 | A disputed no-show goes on neither player card; both see "You two remember this differently, so we've left it off both cards." Each dispute is logged for moderators (John, Nov 7, F12) |
| 121 | Reliability: "Played" counts every scored match against a real Ball Boi player (league, Discover or Quick match). "No-show" counts only Discover no-shows confirmed or unanswered after 48 hours, never disputed ones; league "Not played" never counts (John, Nov 7, F13) |
| 122 | Players list rows don't show free times; only the player card does (John, Nov 7, F14) |
| 123 | No live stats while recording: the screen shows the "Rec" pill, elapsed time, whether the court is in frame, and low battery or storage warnings. Stats appear only in Replay (John, Nov 7, G1) |
| 124 | A Quick match stranger gets "[Name] recorded a match with you. Was that you?" with Yes and Not me. Until Yes the match isn't linked to their profile; Not me removes them. League mates keep the plain recording notice. Settles decision 105's open question (John, Nov 7, G2) |
| 125 | The full notification prompt (reason screen, then iOS) shows once, at the first of: joining a league, a match being added in chat, posting or joining an open match, or turning on open match alerts. Quiet notifications until then; declined means one Home line, never asked again (John, Nov 7, G3) |
| 126 | Session G ships in four steps: court detection, voice coach and recording fixes (one native build that starts the beta); notifications; Live Activity; age check and DeviceCheck bans (John, Nov 7, G4) |
| 127 | One reminder rule: any match with a set date and time gets a reminder at 8 AM the day before (at most once) and one 2 hours before; league matches with no set time get the Sunday nudge; the Wednesday "set your availability" reminder is removed. All behind the Match day reminders switch (John, Nov 7, G5) |
| 128 | Message pushes show sender and text; "Show message previews" in Settings > Notifications, on by default, hides the text. iOS's own setting still applies (John, Nov 7, G6) |
| 129 | The Live Activity starts on its own on the opponent's phone for league mates and accepted Discover matches; a Quick match stranger gets it only after Yes (John, Nov 7, G7) |
| 130 | A voice coach correction repeats no sooner than every 7 seconds while the phone hasn't moved, and stops after 3 times in a row (John, Nov 7, G8) |
| 131 | Voice coach captions show only where someone can see them: the mounted phone during setup, then the Live Activity and Apple Watch once recording starts. Every voice cue keeps a text version (WCAG 2.2 AA) (John, Nov 7, G9) |
| 132 | Auto-stop on low storage or at 4 hours plays the chime and a caption, with no voice line; low battery keeps its recorded line (John, Nov 7, G10) |
| 133 | Buttons in the native header are plain icons; on iOS 26 Apple's glass circle is the only circle. Round buttons inside page headers stay (John, Nov 7) |
| 134 | No press-and-hold stop: the Stop button, with its "Stop recording?" confirm, is the way to stop on the mounted phone; the other player's phone and the Live Activity still work (John, Nov 7) |
| 135 | The voice coach uses John's recorded voice: 21 lines plus a chime, no text-to-speech and no shorter mode, with captions from one manifest (John, Nov 7) |
| 136 | Open match group chats run through the same messaging service as Messages: listed in Messages and covered by the same first-message filter, Stream screening and message-level reports. Replaces the separate group chat #145 shipped (John, Nov 8, F15) |
| 137 | Home shows only upcoming matches ("Upcoming matches", replacing "This week") plus anything waiting on you, like pairings to review or a match card to answer. Completed matches, recent results, season stats and league standings leave Home; standings live on the league page. One place for each thing (John, Nov 8) |
| 138 | Profile becomes your player card with your matches below it: the card, This season, Ball Boi this season (See all opens this season's recordings), then Upcoming matches and Results tabs. My matches stops being its own screen; Home's See all opens these tabs. Player details move behind a pencil (Edit profile); Sign out moves to Settings. The tab keeps the name Profile (John, Nov 8) |
| 139 | The player card is design D (Portrait): court drawing across the top, photo overlapping it, name, Level and Plays pills, town, home court and a free-times grid icon that opens a read-only week grid. It holds only what the player entered; Record, Played, Streak and No-shows sit in This season under it. The same card everywhere, Discover included (John, Nov 8) |
| 140 | The level pill on player cards reads "Level 3.5" with no "Self-rated"; Edit profile's Level row keeps "Self-rated". Changes decision 74 (John, Nov 8) |
| 141 | The legal consult cleared the Ball Boi Beta Footage Release (decision 96). Testers can sign once /beta-release is live (John, Nov 8) |
| 142 | Start is picked before mounting: Record works before the court locks, and the countdown starts on its own once it locks, or after the Record anyway fallback. The Live Activity Start button stays as a second way to start (John, Nov 8) |
| 143 | The app follows the iPhone's Light or Dark Mode with no in-app override; shareable recaps always use the Day look (John, Nov 7 and 8). Replaces decision 103 |
