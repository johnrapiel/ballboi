# Ball Boi: App Store Submission Checklist

Source of truth for getting Ball Boi onto the iOS App Store and passing WCAG 2.2 AA.
Update the status column in the same PR that changes it.

**Legend:** ✅ done · 🟡 in progress · ❌ not started · ⚠️ needs a decision · ➖ no longer needed

_Last updated: 2026-11-07 (beta recording and footage release, spec decisions 84 to 99: beta, consent, support, test set, retention and legal rows updated, phone setup guide added). Earlier on 2026-11-07 (Ball Boi Pro parked until there's traction, spec decisions 82 and 83: subscription rows set to ➖, everything free at launch). Previously 2026-11-06 (Wave 1 fixes: design refresh part 2 with block inside Report, no Message Requests, Delete account in Settings, findings 17, 20 and 21; new Day and Night palette; Fix 4 production Clerk sign-up check). Previously 2026-11-06 (design refresh: W and L result letters, brush tab icons, standings tiebreak, decision 79). Previously 2026-11-04 (Wave 1 review: no automatic restriction, results never move a player's level, self-rated level labels, Declared Age Range and match day reminders moved to Wave 2; spec decisions 48 to 78). Previously 2026-11-02 (pricing review: Pro at $7.99/$59.99, 3 free months from first use of any Pro feature, mixed matchup rules, league fee note; spec decisions 32 to 47). Previously 2026-10-31 (R2 staging bucket created) and 2026-10-29 against `main` at `298969c` (merge queue landed: #16, #17, #19, #20, #22 via #29, #23, #24, #25, #27, #32, #33, #34, #37). Includes milestone animations (decision 28) and the design system accessibility pass (PR #31, open). Synced with the launch-blocking items in `docs/product-spec.md` (decisions 1 to 99). Where this list and the spec disagree, the spec wins._

**Moderation:** every report is acted on within 24 hours. Reports list at `GET /api/admin/reports`. Message reports (including Stream moderation events) and league chat reports land in the same queue, oldest first. Coverage: John is primary and gets a push alert on every report; after 6 hours with no action, a Claude agent reviews and can hide, restrict, or dismiss with a logged reason. Suspensions and bans are human-only. Enforcement ladder: auto-detect, review, human confirms, ban sticks, one appeal by email. Nothing restricts an account automatically (decision 48).

## 1. Native app

| Item | Guideline | Status | Notes |
|---|---|---|---|
| Native stack: Expo SDK 58 (`artifacts/mobile`) | 4.2 Minimum Functionality | 🟡 | On `main`: sign-in, age check with the wheels picker, five-tab shell (Home, Leagues, Ball Boi, Discover, Profile), Messages from the top corner, Leagues tab with standings and join by code, Start a league, Delete account. Ball Boi and Discover are empty states. Camera recorder still on the stale `feat/ios-expo-app` branch and needs porting |
| Built with Xcode 26 / iOS 26 SDK | Required since Apr 28, 2026 | 🟡 | EAS `production` profile uses latest image |
| Age gate at onboarding | Age rating, 1.2 | 🟡 | Birth-date check merged (PR #8, `app/age-check.tsx`); Declared Age Range API first moves to Wave 2 (needs a native build; it can ride with the native sign-in PR if John wants it sooner). Self-attested birth date fallback. Under 18s see "Ball Boi is 18+ for now" and no account is created. Store only a pass/fail flag |
| Birthday picker (birth-date fallback) | Age rating, HIG | 🟡 | Merged (PR #16) with `@react-native-community/datetimepicker` installed. Still to do: a new development build and a phone test. Native iOS date picker in wheels style (`display="spinner"`) in a bottom sheet with Done. No calendar grid, no typed fields. Prompt reads "What's your birthday?" with no 18+ mention. Field empty until confirmed; wheel never starts at exactly 18 years ago, and Done stays off until a wheel moves (Wave 1 review S2); `maximumDate` is today. The sheet fades instead of sliding with Reduce Motion on. Date discarded after the check |
| Native camera capture for Ball Boi | 4.2, 2.5 | 🟡 | expo-camera recorder, rear camera, no corner tapping. Background upload tracked below |
| Phone setup guide | HIG, 2.1 | ❌ | A graphic of the ideal phone position and a checklist (position, 10% battery or plugged in, 2 GB free, Do Not Disturb on) before every recording, with "Don't show this again" and a "Setup tips" link on the ready screen. Page 3 of the first-run carousel. Spec decision 90 (B7), Session D |
| Match-first recording and Quick match | 2.1, 4.2 | ❌ | Every recording starts from a match. Any unplayed league match in its round's week, grace week included, can be recorded (#106). "Record with Ball Boi" is the primary action on a singles match card, with Enter score under it; the result takes over once a score is in. Ball Boi tab's "Record a match" lists this week's matches, today's set times first, then Quick match: format first (singles default), then any opponent. Non-users become placeholders with an invite link; solo controls; nothing counts toward standings until they join |
| Doubles disabled state | 2.1, HIG | ❌ | Ball Boi shows disabled on doubles matches with "Ball Boi analyzes singles for now. Doubles is coming." Message is visible text and read by VoiceOver, not just a dimmed button. Log views as a demand signal |
| APNs push (replace web push / VAPID) | 4.5.4 | ❌ | `expo_push_tokens` table already exists. Messaging, match alerts, the opponent recording notification, and Live Activity push-to-start make this launch-blocking. Provisional (quiet) authorization from sign-in; full prompt with a reason screen after joining a league or sending a first request; Home banner linking to Settings if denied. Wave 1 asks for nothing and hides the Match day reminders switch; in Wave 2 reminders are on by default behind this prompt. Never use push for marketing without opt-in |
| On-device court detection + voice positioning coach | 4.2, HIG | ❌ | One spoken step at a time in court terms, ending with "Court locked" and a chime. Audio session plays on silent; mute toggle; shorter mode after a few sessions. If no lock, spoken tip, then Record anyway after ~20s |
| Live Activity remote on both players' phones | 4.5.4, HIG | ❌ | Lock status, recording time, mounted phone battery, Start match / Stop via App Intents. Opponent's starts via push-to-start, league mates and accepted matches only. Either player has full controls. Partner phone optional; solo players use countdown, voice coach, and press-and-hold stop. Needs a native module in Expo |
| Delayed start, stop, and safety cap | HIG | ❌ | Start in Now / 5 / 10 / 15 min with spoken countdown cues; court-lock check keeps running during the countdown. Stop from either phone or a 2-second hold anywhere on the mounted phone. Auto-stop and save at low battery, low storage, or 4 hours |
| Background upload, Wi-Fi by default | 2.1 | 🟡 | Survives app close and restart; video kept until the server confirms. Cellular toggle in settings; replay processing card shows "Waiting for Wi-Fi · Upload now on cellular," then "Analyzing"; push when replay is ready. PR 6 (Wave 1 fixes): uploads go in 64 MB parts (multipart, background URL session per part), so matches over 5 GB upload and a dropped upload resumes from the missing parts; a match split by a call uploads as pieces joined on the server; Profile > Settings has "Upload on cellular" and "Help Ball Boi get smarter". Until APNs ships, the analyzing card says "Check back here for your replay." Still to do: push when the replay is ready |
| Post-stop flow | 2.1 | ❌ | Score prompt that posts to standings (no opponent confirm; either player can edit the score for 24 hours from Match detail, then it locks and only the league admin can correct it, finding 7, Fix 2; a match in its grace period updates Ball Boi stats only, and no result moves a level), draggable match start, court-line fix on a still frame captured on the phone, only on low detection confidence (moved to Wave 2 with on-device court detection, decision 67). No raw video replay |
| Simulated replay (no video playback) | 2.1, 4.2 | ❌ | Animated court, shot-by-shot list, scrubber markers, filters. "Close call" label on uncertain in/out. Remove the "Full video" mode |
| Milestone animations | HIG | ❌ | Four moments only: score entered (score settles in), career milestone (badge and ring; launch set: first win, first Ball Boi match, 5- and 10-match win streaks), player card reveal (flip, first view of each player only), Ball Boi analysis ready (shot markers drop onto the court). Reanimated, under 1 second, plays once, never blocks input, a haptic on each. Accessibility tracked in Section 5 |
| Dynamic Type support | HIG / WCAG 1.4.4 | 🟡 | In PR #31: shared `Text` scales every text style fully; display styles and scores stop at 1.5x so they never clip. Body is 17pt, the iOS size. Bold Text and Increase Contrast are respected through `Text` and `useColors`. Still to do: merge #31, then test every rebuilt screen at the largest accessibility size |
| VoiceOver labels on icon buttons, charts, heatmap, replay controls | HIG / WCAG 1.1.1, 4.1.2 | 🟡 | Done for built screens, including the new league form's weeks stepper; replay/heatmap not built yet |
| 44×44pt minimum tap targets | HIG / WCAG 2.5.8 | 🟡 | `MIN_TAP` enforced in shared Button; weeks stepper − and + are 44pt |
| Reduce Motion respected | HIG / WCAG 2.3.3 | 🟡 | Web: global CSS guard added. Also applies to the replay animation and the milestone animations |

## 2. Backend readiness

| Item | Guideline | Status | Notes |
|---|---|---|---|
| Move video upload off Replit storage to R2 | 2.1 App Completeness | 🟡 | R2 code + local storage on `main`. Staging bucket `ballboi-staging` created Oct 31, 2026 (Standard class, free tier). No CORS policy, on purpose: the iOS app uploads through presigned URLs (native apps aren't subject to CORS), the labeling tool reads local files, and the web app is retired, so no browser touches R2. Add a narrow policy only if a browser tool ever needs it. Still to do (John, at the Mac): create an R2 API token scoped to `ballboi-staging` (Object Read & Write) and put its keys in the staging API's secrets (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET=ballboi-staging`, `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`, `S3_REGION=auto`), never in chat. Production bucket comes later, separate from staging. No Replit data migration: the old script only runs inside the retired Replit workspace. Video is analysis input only, never served for playback |
| API type safety | 2.1 | ✅ | All 98 carried-over API type errors fixed (PR #34); CI fails on any new one |
| Raw video retention | 5.1.1, 5.1.2 | ❌ | Delete raw video after analysis unless both players left training on. Beta footage is kept until launch (decision 89); withdrawal deletes a tester's video within 30 days, test-set and training copies included (decision 95) |
| Shot analysis pipeline | 2.1, 2.3.1 | ❌ | Built with Claude Code from open-source models, server-side, reading from R2. Runs on every recorded singles match, free for everyone (Pro parked, decision 82); stores shot data for both players |
| Labeled test set + accuracy gate | 2.3.1 | 🟡 | Label format and eval harness with launch bars in PR #35; labeling tool in PR #36. Still to do: film and label 10 to 15 varied singles matches. Per-stat bars (e.g. shot type ≥ 90%, close-call in/out ≥ 85%, serve placement ≥ 85%); stats below the bar hidden at launch. Also decides whether audio stays for launch. Bars added for point endings (85%), rally length (within 1 shot on 85% of points), first-serve % (within 5 points) and placement (right zone 80%) (decision 98, Session E). Estimated serve speed is out of launch. Confirmed non-user opponents are allowed in the test set, never training (decision 94) |
| TestFlight beta on private tenant | 2.1 | ❌ | Commissioned local players; signed footage release. Beta plan (spec decisions 84 to 99, footage review Nov 7): testers are TestFlight external testers invited by email, and every build goes to the "Beta players" group automatically (Session T). The signed release becomes an in-app checkbox (decision 92) linking to ballboi.tennis/beta-release (Session M). The beta starts once Session G's voice coach merges (decision 84) |
| Reviewer demo account with seeded data | 2.1 | 🟡 | Decided: password sign-in enabled for this account only. Seed a league with standings, two completed Ball Boi matches with replay and stats, a message thread, an open match, and a linked-rating example. Attach a 60-second on-court screen recording (mount, voice coach to "Court locked," Live Activity start and stop, replay) in review notes. Template in `docs/app-store-connect.md` |
| Production Clerk matches Development: sign-up with password off | 2.1 | ❌ | Pre-launch check (John, Clerk dashboard, free). Wave 1 finding #22: with "Sign-up with password" on, new email accounts stop at `missing_requirements` because the app never asks for a password. Fixed in Development on Nov 6 (password sign-up off; email code on; username off; name optional). Before launch, open the production instance and confirm the same settings. The reviewer demo account's password sign-in is separate and stays. Since Wave 1 Fix 4 the app says "We couldn't finish creating your account" and logs the missing fields if this ever happens again |
| Real-time messaging transport | 2.1 | 🟡 | Decided: Stream Chat on the Maker plan (applied; free Build plan as fallback), headless, behind Ball Boi's own messaging interface. Route Stream moderation events into `/api/admin/reports` |

## 3. Compliance features

| Item | Guideline | Status | Notes |
|---|---|---|---|
| In-app account deletion (deletes user data, not just deactivates) | 5.1.1(v) | 🟡 | Merged (PR #19). Now Profile > Settings > Delete account, at the bottom in red, with its confirm (finding 21) and `DELETE /api/users/me`. The screen lists messages, your level, and leagues you run; a league whose only admin deletes their account goes to the member they pick, or the longest-standing member (never blocks deletion); recordings still waiting to upload are removed from the phone. Grows with each feature: must also delete messages (including in Stream), the player's level, and remove the player's matches from future training. Revoke UTR/USTA links and the Apple token (verify Clerk does this on delete) |
| Privacy policy page, linked in-app and in App Store Connect | 5.1.1(i) | 🟡 | Published at ballboi.tennis/privacy, rewritten to current decisions (18+, no video playback, training toggle, analysis-only audio, approximate location, processors). Still to do: link in-app and in App Store Connect; targeted legal consult. Add messaging retention, approximate location use, rating-provider data sharing, 18+ audience, video and audio retention, training use, opponent breakdown visibility (decision 83), and processors: Stream (messaging), Anthropic (moderation agent), Cloudflare (video storage). Lawyer review covers biometric-data rules (body tracking) and audio recording. Add to the legal consult: the Beta Footage Release, non-user opponents in the test set, and withdrawal terms (decisions 94 to 96) |
| Terms of use / EULA with zero-tolerance UGC language | 1.2 | 🟡 | Published at ballboi.tennis/terms. Still to do: link in-app; targeted legal consult. Explicitly cover messages, league chat, open matches, league fee notes, and the 18+ requirement |
| Report a player or content | 1.2 | 🟡 | Report is the only safety action (John, Nov 6, finding 20). It opens the Report sheet: a reason, and an "Also block [name]" checkbox. On every message (long press and a VoiceOver action) and the conversation's More button. `POST /api/reports` and `POST /api/messages/:id/report`. Still to do: attach it to the iOS player screen once that's built |
| Report on all other UGC | 1.2 | ❌ | Profile photos, open matches, court directory submissions, league fee notes |
| Block a player | 1.2 | 🟡 | Block lives inside Report (John, Nov 6, finding 20): the "Also block [name]" checkbox in the Report sheet. No separate Block action and no Blocked players screen. A blocked chat stays for the blocker, read only, with an Unblock link; the blocked player no longer sees it. Stops DMs both ways and hides players from search and weekly auto-scheduling. Round-robin pairing and the iOS player screen still needed |
| Published support contact | 1.2, 1.5 | 🟡 | `support@ballboi.tennis` is live (Cloudflare Email Routing) and on the marketing site and legal pages. Still to add in the app. In-app "Something not working?" form plus the support email (decision 86, Session D); turns ✅ when merged |
| Sign in with Apple (Google is offered, so required) | 4.8 | 🟡 | Apple + Google + email code in native sign-in. Enable Apple in Clerk |
| Recording consent + training toggle | 5.1.1 / 5.1.2 | 🟡 | Covered in privacy policy + terms. Opponent's "Ball Boi is recording your match" push doubles as notice. First-recording consent screen covers recording other players, audio for analysis, the training toggle (on by default, mirrored in Settings > Privacy); a match enters training only if both players left it on. Copy: "Help Ball Boi get smarter. We use match video to train our shot tracking. Your personal information is never shared or sold. Turn this off anytime in Settings." Video never leaves Ball Boi's systems for training. Footage review (Nov 7): the first run becomes a three-page carousel, what Ball Boi records, your choices (training toggle and beta release checkbox) and set up your phone (decision 91). The release agreement is stored with its version and date (decision 92). Session D |
| Analysis-only audio | 5.1.1, 5.1.2 | ❌ | Audio recorded for shot detection only: never played back, deleted after processing, excluded from training on non-users. Labeled test set decides whether audio ships at launch; if not, drop mic capture and the purpose string |
| No training on placeholder opponents | 5.1.1, 5.1.2 | ❌ | Quick match against a non-user stays out of training until they join and their own toggle applies. Placeholders get no in-app notice. On joining they see "<name> recorded your match on <date>" with their training toggle before the match attaches |

### 3a. Messaging

| Item | Guideline | Status | Notes |
|---|---|---|---|
| Message Requests inbox for non-connections | 1.2 | ➖ | Removed (John, Nov 6, finding 17): every message goes straight to the inbox and either person can keep sending. The first-message filter and Report with block cover unwanted messages. No read receipts |
| Report a message (long-press + accessible menu action) | 1.2 | 🟡 | Long press or the VoiceOver "Report message" action opens the Report sheet. Report stores a server-side snapshot of the reported messages so moderators can act |
| Objectionable content filter on send | 1.2 | 🟡 | Links, email addresses, phone numbers and slurs are blocked in a first message from someone outside your leagues (finding 17). Slur list loads at runtime; Stream screens every message in production |
| New-account throttle | 1.2 | ❌ | Max 5 new conversations per day for the first week |
| Flagged accounts wait for review (no auto-restrict) | 1.2 | ✅ | Decided Nov 4 (decision 48): no automatic restriction. Stream flags and player reports go to the queue; the account is untouched until John, or the Claude agent after 6 hours, acts. The agent never reviews appeals |
| 24-hour review, staffed | 1.2 | 🟡 | Decided: John primary with push alert on every report. Claude agent after 6 hours: reads snapshot, reporter note, account history; can hide, restrict, dismiss with logged reason, or escalate. Treats reported text as untrusted; restricts and escalates when unsure. John confirms or undoes every agent decision. Admin queue API merged (`GET /api/admin/reports`) |
| Moderator can remove messages and suspend senders | 1.2 | ❌ | Extend admin reports view; add agent decision log with confirm / undo |
| Bans stick | 1.2, 5.1.2 | ❌ | Human-only. Ban the Sign in with Apple user ID and email. Use DeviceCheck for device bans; Apple bans fingerprinting |
| One appeal by email | 1.2 | ❌ | Route to support address, log outcome in the reports view |
| League chat moderation | 1.2 | ❌ | Admins delete messages, mute or remove members. Same report/block menu as DMs; all actions feed the main queue |
| Encryption export compliance | Export rules | ⚠️ | HTTPS/TLS only = exempt, set `ITSAppUsesNonExemptEncryption` false. Decided: no E2E at launch, since it blocks message review on reports |
| Message push notifications with privacy toggle | 4.5.4 | ❌ | Option to hide message previews on the lock screen |

### 3b. Rating integrations (UTR, USTA NTRP, ITF WTN)

| Item | Guideline | Status | Notes |
|---|---|---|---|
| UTR account linking via Engage API (OAuth2) | Partner terms, 5.1.1 | ❌ | Apply for client ID/secret. Link from profile, not as a sign-in method. Respect UTR display rules (integer ratings for other players' unless entitled) |
| USTA Connect partnership for NTRP + WTN | Partner terms | ⚠️ | Docs say partners must not store or cache rating data. Spec sidesteps this: matching runs on the player's self-rated level, never stored USTA data. Confirm during partner onboarding |
| WTN sourced through USTA, not ITF directly | n/a | ⚠️ | ITF accepts data only from national associations. US players get WTN via USTA |
| Self-rated level | 2.3.1 accuracy | 🟡 | Onboarding quiz sets the player's self-rated level, labeled "Self-rated" everywhere ("Level 3.5, Self-rated" on the badge, #107); "Verified" only for linked accounts, still to do. Match results never move a level (Oct 29, decision 75): only the player changes it, in Edit profile |
| Never claim USTA/UTR/ITF endorsement without written approval | 5.2.1 IP | ❌ | Use partner brand guidelines; no logos in App Store screenshots until cleared |
| Rating provider data in privacy policy + labels | 5.1.1, 5.1.2 | ❌ | Disclose what each provider shares and how to unlink from Profile |

### 3c. Ball Boi Pro (parked) and league fees

Ball Boi Pro is parked as of Nov 7 (spec decision 82): no subscription, paywall or IAP at launch, so the Pro rows below are ➖. The full plan lives in `docs/backlog/ball-boi-pro.md`; restore these rows from there when Pro comes back.

| Item | Guideline | Status | Notes |
|---|---|---|---|
| Plain IAP subscription after 3 free months, RevenueCat | 3.1.1, 3.1.2 | ➖ | Parked Nov 7 (decision 82); see docs/backlog/ball-boi-pro.md |
| What Pro unlocks | 3.1.1 | ➖ | Parked Nov 7 (decision 82); see docs/backlog/ball-boi-pro.md |
| 3 free months from first use of any Pro feature, then paywall | 3.1.1, 3.1.2 | ➖ | Parked Nov 7 (decision 82); see docs/backlog/ball-boi-pro.md |
| Mixed matchups (one player has Pro) | 3.1.1 | ➖ | Parked Nov 7 (decision 82); see docs/backlog/ball-boi-pro.md |
| Paywall disclosure | 3.1.2 | ➖ | Parked Nov 7 (decision 82); see docs/backlog/ball-boi-pro.md |
| Restore Purchases | 3.1.1 | ➖ | Parked Nov 7 (decision 82); see docs/backlog/ball-boi-pro.md |
| Lapsed state | 3.1.2 | ➖ | Parked Nov 7 (decision 82); see docs/backlog/ball-boi-pro.md |
| Opponent breakdowns with no Pro | 5.1.1 | ⚠️ | Decision 83 pending John: does each player see the opponent's full breakdown for matches they played together? Until decided, only their own |
| League fee note and paid checklist | 3.1.3(e), 1.2 | ❌ | Decided Nov 2, Wave 4: optional fee and payment instructions (e.g. a Venmo handle) shown to everyone in Discover, on the league page, and on the join screen; paid checklist in Manage. No money passes through Ball Boi. Allowed because fees pay for in-person play. Fee note is reportable UGC |
| In-app league fee collection via Stripe (club enterprise offer) | 3.1.3(e) | n/a v1 | After all waves, part of the Organizer plan. Allowed outside IAP because fees pay for in-person play |

## 4. App Store Connect

| Item | Guideline | Status | Notes |
|---|---|---|---|
| Apple Developer Program enrollment | Program License Agreement | ✅ | Individual. Purchased Oct 18, 2026 (order W1668668737), $99/year, auto-renewal on; John's legal name shows as seller. Activated Oct 19, 2026 (welcome email + App Store Connect access received). Next: App Store Connect app record, bundle ID, APNs key, Sign in with Apple, EAS Submit. Can migrate to an Organization (LLC, D-U-N-S) later |
| Privacy nutrition labels | 5.1.1 | 🟡 | Answers drafted in `docs/app-store-connect.md` (PR #24, merged). Add Messages (user content), coarse location, linked account IDs, audio data (app functionality only), and video used for product improvement (training) |
| Privacy manifest (incl. third-party SDKs) | Required since May 2024 | ✅ | On `main` in `artifacts/mobile/app.json` (`ios.privacyManifests`, PR #23). Verify SDK manifests at build, and add Stream's when that SDK lands (and RevenueCat's if Ball Boi Pro returns) |
| Camera, microphone, photo library purpose strings | 5.1.1 | ✅ | On `main` in `artifacts/mobile/app.json` (`ios.infoPlist`, PR #23) |
| Microphone purpose string for analysis-only audio | 5.1.1 | ✅ | PR #23: says audio is used only to detect shots, never played back, and deleted after processing. Drop it if the test set cuts audio |
| Location purpose string | 5.1.1 | ✅ | PR #23: While Using only, never Always (home area shortcut, travel mode). Zip entry must work without granting location |
| Age rating questionnaire | Required since Jan 31, 2026 | 🟡 | Decided: 18+ for the MVP, so Screen Time blocks the download for minors. Re-answer for user-to-user messaging and real-world meetups |
| Subscription metadata | 3.1.2 | ➖ | Parked Nov 7 (decision 82); see docs/backlog/ball-boi-pro.md |
| App Review notes | 2.1 | ❌ | Demo account credentials, 60-second on-court recording |
| Screenshots, description, keywords, support URL | 2.3 | 🟡 | Shot list + subtitle drafted. Show the simulated replay, not video. No partner logos until cleared |
| EU trader status (if distributing in the EU) | DSA | ❌ | US-only launch; needed before any EU expansion |

## 5. WCAG 2.2 AA (native app)

| Item | Criterion | Status | Notes |
|---|---|---|---|
| Text contrast ≥ 4.5:1, borders and focus ≥ 3:1 | 1.4.3, 1.4.11 | ✅ | `scripts/check-contrast.mjs` checks token pairs in Day and Night on every `pnpm test`. PR #31 expands it to 62 pairs, including Increase Contrast values and heatmap labels. Wave 1 Fix 6 (Nov 6 ivory and charcoal palette): 64 pairs, all passing |
| Primary button contrast | 1.4.3 | ✅ | Day: white (`on-ink`) on navy (`ink`), 15.5:1 (PR #31). Night: charcoal on ivory, 15.1:1 (Wave 1 Fix 6). Teal retired in the Oct 29 palette refresh |
| Status colors (success/live/error) | 1.4.3, 1.4.1 | 🟡 | In PR #31: `court` (wins, live, links) and `danger` (errors) only; `pool`, `clay` and `sun` retired. Each job has a shape cue: underlined links, live dot, win check, error cross. The contrast check fails if a cue goes missing |
| Focus indicator contrast ≥ 3:1 | 1.4.11 | ✅ | `focus` = `ink`, 2px ring, 13.2:1 or better in both themes (Wave 1 Fix 6) |
| Pinch zoom allowed | 1.4.4 | ✅ | Web only (retired web app, PR #2) |
| No text under 11px | HIG / 1.4.4 | ✅ | `label` (11px) is for eyebrows and table headers only; chips use `chip` (12px). Body 17, small 15, button 16 |
| Night session muted text | 1.4.3 | ✅ | `ink-muted` `#B5B2A9` on warm charcoal: 7.9:1 on paper, 5.6:1 on sand (Wave 1 Fix 6) |
| Birthday picker accessible | 1.3.1, 4.1.2, 2.5.8, 1.4.4 | 🟡 | Merged in PR #16; VoiceOver and largest-text test still to do on a development build. Visible and accessible "Birthday" label; VoiceOver announces each wheel change; Done button 44×44pt; label and button scale at the largest Dynamic Type sizes. VoiceOver moves the year wheel one year per swipe, so test it before locking the starting date |
| New league form accessible | 1.3.1, 2.5.8, 4.1.2 | 🟡 | Merged (PRs #20, #32): weeks field labeled "Weeks" with a "1 to 24 weeks" hint; − and + buttons 44pt and labeled "Fewer weeks" / "More weeks". Wave 1 PR 5: the season length follows the field as you type, and an out-of-range value snaps to 1 or 24 with a note VoiceOver reads (live region). Still to do: VoiceOver test of the calendar date picker on a phone |
| Color is never the only signal (charts, heatmaps, shot markers) | 1.4.1 | 🟡 | Rules in the design system's Charts and replay section: players by shape, winners a check, errors a cross, close calls a dashed ring plus text, heatmaps one ink in five labeled steps (`heat-1` to `heat-5`). Results in condensed lists show the letter W or L, never color alone, and the tab bar marks the selected tab with a filled icon as well as the system's selected state (design refresh, Nov 6). Apply to the replay when it is rebuilt |
| Simulated replay is accessible | 1.1.1, 1.3.1 | ❌ | Court animation decorative; shot list carries type, player, outcome, time. "Close call" uses icon plus text |
| Locked games and paywall teaser accessible | 1.1.1, 1.4.1, 4.1.2 | ➖ | Parked Nov 7 (decision 82); see docs/backlog/ball-boi-pro.md |
| Milestone animations accessible | 2.3.3, 4.1.3 | ❌ | Reduce Motion swaps every moment for a 200ms fade with the final state shown at once; haptics still fire. VoiceOver announces each outcome in text ("Milestone: First win"). Analysis-ready markers use shape, not color alone |
| Level badges, admin post labels, reliability not color-only | 1.4.1 | ❌ | Icon + text for Verified vs Self-rated, admin posts in league chat, and "Played 12 · 1 no-show" |
| Charts have text alternatives | 1.1.1, 1.3.1 | ❌ | One-line text summary for VoiceOver plus an accessible data table on every trend chart |
| Player card reads as one element | 1.3.1, 4.1.2 | ❌ | e.g. "Alex Kim, 3.5 Verified, 14 and 6, 22 aces this season" |
| Tab bar labels and badge counts | 1.4.1, 4.1.2 | ✅ | Icon + text label on all five tabs (Home, Leagues, Ball Boi, Discover, Profile). Messages button in the top corner is 44pt and VoiceOver reads its unread count ("Messages, 3 unread"). PR #13 |
| Radius and level range controls | 2.5.8, 1.4.4 | ❌ | 44×44pt targets, Dynamic Type safe, step count announced |
| New messages announced to screen readers | 4.1.3 | ❌ | Live region on web; `AccessibilityInfo.announceForAccessibility` on iOS |
| Message bubbles read sender, text, time in one swipe | 1.3.1, 4.1.2 | ❌ | Group each bubble as one accessible element |
| Swipe-to-reply/delete has a non-gesture alternative | 2.5.7 | ❌ | Long-press menu + VoiceOver custom actions |
| Failed sends identified in text, not just a red icon | 3.3.1, 1.4.1 | ❌ | "Not sent. Tap to retry" |
| Bubble contrast (both sides, both themes) | 1.4.3 | ❌ | Check sent bubble text against 4.5:1 once bubble colors are chosen from the refreshed palette |
| Voice cues have a text alternative | 1.1.1, 1.3.3 | ❌ | Positioning coach and countdown captions mirror to the Live Activity; haptics on the mounted phone |
| Live Activity controls accessible | 4.1.2, 2.5.8 | ❌ | Start match and Stop labeled for VoiceOver, 44×44pt targets |

## 6. Deferred (not launch-blocking)

| Item | Target | Notes |
|---|---|---|
| Partner-phone live preview of the mounted camera | v1.1 | Local peer-to-peer link during mounting. Needs a local network purpose string and Bonjour service declaration when built |
| "Ball Boi, start recording" voice command | Post-MVP | Start only. Speech recognition purpose string and on-device recognition when built |
| In-app league fee collection (club enterprise offer) | After all waves | Part of the Organizer plan; Stripe; pricing decided then |
