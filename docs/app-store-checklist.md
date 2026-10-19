# Ball Boi: App Store Submission Checklist

Source of truth for getting Ball Boi onto the iOS App Store and passing WCAG 2.2 AA.
Update the status column in the same PR that changes it.

**Legend:** ✅ done · 🟡 in progress · ❌ not started · ⚠️ needs a decision

_Last updated: 2026-10-18. Synced with the launch-blocking items in `docs/product-spec.md` (decisions 1 to 17). Where this list and the spec disagree, the spec wins._

**Moderation:** every report is acted on within 24 hours. Reports list at `GET /api/admin/reports`. Message reports (including Stream moderation events), league chat reports, and auto-restrict flags land in the same queue. Coverage: John is primary and gets a push alert on every report; after 6 hours with no action, a Claude agent reviews and can hide, restrict, or dismiss with a logged reason. Suspensions and bans are human-only. Enforcement ladder: auto-detect, auto-restrict, review, human confirms, ban sticks, one appeal by email.

## 1. Native app

| Item | Guideline | Status | Notes |
|---|---|---|---|
| Native stack: Expo SDK 58 (`artifacts/ios-app`) | 4.2 Minimum Functionality | 🟡 | Scaffolded: auth, tabs, Ball Boi recorder |
| Built with Xcode 26 / iOS 26 SDK | Required since Apr 28, 2026 | 🟡 | `artifacts/mobile/eas.json` `production` profile uses the latest build image. Confirm on the first production build |
| Age gate at onboarding | Age rating, 1.2 | ❌ | Declared Age Range API, self-attested birth date fallback. Under 18s see "Ball Boi is 18+ for now" and no account is created. Store only a pass/fail flag |
| Native camera capture for Ball Boi | 4.2, 2.5 | 🟡 | expo-camera recorder, rear camera, no corner tapping. Background upload tracked below |
| Match-first recording and Quick match | 2.1, 4.2 | ❌ | Every recording starts from a match. "Record with Ball Boi" is the primary action on a singles match card on match day; Enter score takes over once played. Ball Boi tab's "Record a match" lists today's matches, then Quick match: format first (singles default), then any opponent. Non-users become placeholders with an invite link; solo controls; nothing counts toward standings until they join |
| Doubles disabled state | 2.1, HIG | ❌ | Ball Boi shows disabled on doubles matches with "Ball Boi analyzes singles for now. Doubles is coming." Message is visible text and read by VoiceOver, not just a dimmed button. Log views as a demand signal |
| APNs push (replace web push / VAPID) | 4.5.4 | ❌ | `expo_push_tokens` table already exists. Messaging, match alerts, the opponent recording notification, and Live Activity push-to-start make this launch-blocking. Provisional (quiet) authorization from sign-in; full prompt with a reason screen after joining a league or sending a first request; Home banner linking to Settings if denied. Never use push for marketing without opt-in |
| On-device court detection + voice positioning coach | 4.2, HIG | ❌ | One spoken step at a time in court terms, ending with "Court locked" and a chime. Audio session plays on silent; mute toggle; shorter mode after a few sessions. If no lock, spoken tip, then Record anyway after ~20s |
| Live Activity remote on both players' phones | 4.5.4, HIG | ❌ | Lock status, recording time, mounted phone battery, Start match / Stop via App Intents. Opponent's starts via push-to-start, league mates and accepted matches only. Either player has full controls. Partner phone optional; solo players use countdown, voice coach, and press-and-hold stop. Needs a native module in Expo |
| Delayed start, stop, and safety cap | HIG | ❌ | Start in Now / 5 / 10 / 15 min with spoken countdown cues; court-lock check keeps running during the countdown. Stop from either phone or a 2-second hold anywhere on the mounted phone. Auto-stop and save at low battery, low storage, or 4 hours |
| Background upload, Wi-Fi by default | 2.1 | ❌ | Survives app close and restart; video kept until the server confirms. Cellular toggle in settings; replay processing card shows "Waiting for Wi-Fi · Upload now on cellular," then "Analyzing"; push when replay is ready |
| Post-stop flow | 2.1 | ❌ | Score prompt that posts to standings, draggable match start, court-line fix on a still frame captured on the phone, only on low detection confidence. No raw video replay |
| Simulated replay (no video playback) | 2.1, 4.2 | ❌ | Animated court, shot-by-shot list, scrubber markers, filters. "Close call" label on uncertain in/out. Remove the "Full video" mode |
| Dynamic Type support | HIG / WCAG 1.4.4 | 🟡 | Font scaling on everywhere in the native app |
| VoiceOver labels on icon buttons, charts, heatmap, replay controls | HIG / WCAG 1.1.1, 4.1.2 | 🟡 | Done for built screens; replay/heatmap not built yet |
| 44×44pt minimum tap targets | HIG / WCAG 2.5.8 | 🟡 | `MIN_TAP` enforced in shared Button |
| Reduce Motion respected | HIG / WCAG 2.3.3 | 🟡 | Web: global CSS guard added. Also applies to the replay animation |
| Design system applied | HIG, WCAG 1.4.3 | 🟡 | Tokens generated from `docs/design-system/tokens.json` (`pnpm tokens`); app palette and fonts switched to Paper, Linen, Ink, Pool, Clay, DM Sans, and Cormorant Garamond; core components in `components/ui.tsx`. Screens restyle as each flow is rebuilt |

## 2. Backend readiness

| Item | Guideline | Status | Notes |
|---|---|---|---|
| Hosting on Cloudflare | 2.1 App Completeness | ⚠️ | Decided: stay in Cloudflare. Replit hosting and the old web app are retired. Choose where the API, Postgres, and ML server run before PR #4 merges |
| Move video storage to Cloudflare R2 | 2.1 App Completeness | 🟡 | R2 code + local MinIO in PR #4. Create bucket, set CORS. Video is analysis input only, never served for playback |
| Raw video retention | 5.1.1, 5.1.2 | ❌ | Delete raw video after analysis unless both players left training on |
| Shot analysis pipeline | 2.1, 2.3.1 | ❌ | Built with Claude Code from open-source models, server-side, reading from R2 |
| Labeled test set + accuracy gate | 2.3.1 | ❌ | 10 to 15 varied singles matches, labeling tool, automatic eval on every model change. Per-stat bars (e.g. shot type ≥ 90%, close-call in/out ≥ 85%, serve placement ≥ 85%); stats below the bar hidden at launch. Also decides whether audio stays for launch |
| TestFlight beta on private tenant | 2.1 | ❌ | Commissioned local players; signed footage release |
| Reviewer demo account with seeded data | 2.1 | 🟡 | Decided: password sign-in enabled for this account only. Seed a league with standings, two completed Ball Boi matches with replay and stats, a message thread, a Message Request, an Open Match post, and a linked-rating example. Free period already used so Record shows the paywall; sandbox subscription works end to end. Attach a 60-second on-court screen recording (mount, voice coach to "Court locked," Live Activity start and stop, replay) in review notes. Template in `docs/app-store-connect.md` |
| Real-time messaging transport | 2.1 | 🟡 | Decided: Stream Chat on the Maker plan (applied; free Build plan as fallback), headless, behind Ball Boi's own messaging interface. Route Stream moderation events into `/api/admin/reports` |

## 3. Compliance features

| Item | Guideline | Status | Notes |
|---|---|---|---|
| In-app account deletion (deletes user data, not just deactivates) | 5.1.1(v) | 🟡 | iOS + `DELETE /api/users/me`. Must delete messages (including in Stream), match video, ratings and rating history, and remove the player's matches from future training. Revoke UTR/USTA links and the Apple token (verify Clerk does this on delete) |
| Privacy policy page, linked in-app and in App Store Connect | 5.1.1(i) | 🟡 | Draft at `/privacy`; moves to the ballboi.tennis site when the web app is removed. Needs legal review + real support email. Add messaging retention, approximate location use, rating-provider data sharing, 18+ audience, video and audio retention, training use, and processors: Stream (messaging), Anthropic (moderation agent), Cloudflare (video storage). Lawyer review covers biometric-data rules (body tracking) and audio recording |
| Terms of use / EULA with zero-tolerance UGC language | 1.2 | 🟡 | Draft at `/terms`; moves to ballboi.tennis with the privacy policy. Needs legal review. Explicitly cover messages, league chat, Open Match posts, and the 18+ requirement |
| Report a player or content | 1.2 | 🟡 | `/api/reports` built. iOS player screen still needed |
| Report on all other UGC | 1.2 | ❌ | Profile photos, Open Match posts, court directory submissions |
| Block a player | 1.2 | 🟡 | Hides from player search + weekly auto-scheduling. Round-robin pairing and iOS UI still needed. Block must also stop DMs both ways |
| Published support contact | 1.2, 1.5 | 🟡 | `support@ballboi.app` placeholder in app + legal pages. Switch to a ballboi.tennis address |
| Sign in with Apple (Google is offered, so required) | 4.8 | 🟡 | Apple + Google + email code in native sign-in. Enable Apple in Clerk |
| Recording consent + training toggle | 5.1.1 / 5.1.2 | 🟡 | Covered in privacy policy + terms. Opponent's "Ball Boi is recording your match" push doubles as notice. First-recording consent screen covers recording other players, audio for analysis, and the training toggle (on by default, mirrored in Settings > Privacy); a match enters training only if both players left it on. Copy: "Help Ball Boi get smarter. We use match video to train our shot tracking. Your personal information is never shared or sold. Turn this off anytime in Settings." Video never leaves Ball Boi's systems for training |
| Analysis-only audio | 5.1.1, 5.1.2 | ❌ | Audio recorded for shot detection only: never played back, deleted after processing, excluded from training on non-users. Microphone purpose string must say this (see Section 4). Labeled test set decides whether audio ships at launch; if not, drop mic capture and the string |
| No training on placeholder opponents | 5.1.1, 5.1.2 | ❌ | Quick match against a non-user stays out of training until they join and their own toggle applies. Placeholders get no in-app notice. On joining they see "<name> recorded your match on <date>" with their training toggle before the match attaches |

### 3a. Messaging

| Item | Guideline | Status | Notes |
|---|---|---|---|
| Message Requests inbox for non-connections | 1.2 | ❌ | Decided: league mates and accepted match requests message freely. First messages from anyone else land in Requests; sender can't send again until the recipient replies. No read receipts on requests |
| Report a message (long-press + accessible menu action) | 1.2 | ❌ | Report stores a server-side snapshot of the reported messages so moderators can act |
| Objectionable content filter on send | 1.2 | ❌ | Links, phone numbers, and slurs blocked in first messages until the request is accepted |
| New-account throttle | 1.2 | ❌ | Max 5 new conversations per day for the first week |
| Auto-restrict flagged accounts | 1.2 | ❌ | Stream AI moderation flags, 2+ reports from different people, or behavior signals (unanswered first messages, repeated blocks, copy-paste openers) drop the account to zero new conversations and hide pending requests instantly, until reviewed |
| 24-hour review, staffed | 1.2 | 🟡 | Decided: John primary with push alert on every report. Claude agent after 6 hours: reads snapshot, reporter note, account history; can hide, restrict, dismiss with logged reason, or escalate. Treats reported text as untrusted; restricts and escalates when unsure. John confirms or undoes every agent decision |
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
| USTA Connect partnership for NTRP + WTN | Partner terms | ⚠️ | Docs say partners must not store or cache rating data. Spec sidesteps this: matching runs on Ball Boi Rating, never stored USTA data. Confirm during partner onboarding |
| WTN sourced through USTA, not ITF directly | n/a | ⚠️ | ITF accepts data only from national associations. US players get WTN via USTA |
| Self-reported rating fallback | 2.3.1 accuracy | ❌ | Onboarding quiz sets a Ball Boi Rating labeled "Self-rated" everywhere; "Verified" only for linked accounts |
| Never claim USTA/UTR/ITF endorsement without written approval | 5.2.1 IP | ❌ | Use partner brand guidelines; no logos in App Store screenshots until cleared |
| Rating provider data in privacy policy + labels | 5.1.1, 5.1.2 | ❌ | Disclose what each provider shares and how to unlink from Profile |

### 3c. Ball Boi Pro (subscription)

| Item | Guideline | Status | Notes |
|---|---|---|---|
| Plain IAP subscription after 3 free months, RevenueCat | 3.1.1, 3.1.2 | ❌ | Decided: $5/month or $40/year, one subscription group, plain auto-renewing subscription with no introductory offer (the free period runs outside Apple). Managed with RevenueCat's free tier. External Stripe link revisited after the Supreme Court rules on Apple's appeal in Epic v. Apple. Leagues, Find a Matchup, messaging, player cards stay free |
| 3 free months from first recording, then paywall | 3.1.1, 3.1.2 | ❌ | Free period starts at the first recording, tracked server-side by account. No paywall and no trial sheet during it. After it ends, paywall shows the next time the user sets up a recording or opens stats ("Your 3 free months are up"), during setup, never at the fence. "Not now" still records and uploads; analysis waits until they subscribe; unanalyzed matches expire after 30 days |
| Paywall disclosure | 3.1.2 | ❌ | Price, renewal price and period, how to cancel, links to Terms and Privacy, all near the subscribe button |
| Restore Purchases | 3.1.1 | ❌ | Not in the spec but required. On the paywall and in Profile > Subscription |
| Lapsed state | 3.1.2 | ❌ | Keep stats history, trends, card highlights, recaps. Gate only new analysis |
| League entry fees via Stripe (later, Organizer plan) | 3.1.3(e) | n/a v1 | Allowed outside IAP because fees pay for in-person play |

## 4. App Store Connect

| Item | Guideline | Status | Notes |
|---|---|---|---|
| Privacy nutrition labels | 5.1.1 | 🟡 | Answers drafted in `docs/app-store-connect.md`. Add Messages (user content), coarse location, linked account IDs, Purchases, audio data (app functionality only), and video used for product improvement (training) |
| Privacy manifest (incl. third-party SDKs) | Required since May 2024 | 🟡 | App manifest in `app.config.ts`; verify SDK manifests at build, including Stream's and RevenueCat's |
| Camera, microphone, photo library purpose strings | 5.1.1 | ✅ | In `app.config.ts` |
| Microphone purpose string for analysis-only audio | 5.1.1 | ❌ | Rewrite the existing string to say audio is used only to detect shots, never played back, and deleted after processing. Drop it if the test set cuts audio |
| Location purpose string | 5.1.1 | ❌ | Required for v1 (home area shortcut, travel mode). While Using only, never Always. Zip entry must work without granting location |
| Age rating questionnaire | Required since Jan 31, 2026 | 🟡 | Decided: 18+ for the MVP, so Screen Time blocks the download for minors. Re-answer for user-to-user messaging and real-world meetups |
| Subscription metadata | 3.1.2 | ❌ | Terms of Use (EULA) and privacy policy links in the App Store description or custom EULA field. Subscription products submitted with the build |
| App Review notes | 2.1 | ❌ | Demo account credentials, 60-second on-court recording, note that the free period is used so the paywall is reachable |
| Screenshots, description, keywords, support URL | 2.3 | 🟡 | Shot list + subtitle drafted. Show the simulated replay, not video. No partner logos until cleared |
| EU trader status (if distributing in the EU) | DSA | ❌ | US-only launch; needed before any EU expansion |

## 5. WCAG 2.2 AA (native app)

The web-app rows below were completed in PR #2 before the web app was retired. Their rules carry into the native app.

| Item | Criterion | Status | Notes |
|---|---|---|---|
| Text contrast ≥ 4.5:1, borders and focus ≥ 3:1 | 1.4.3, 1.4.11 | ✅ | `scripts/check-contrast.mjs` checks 40 token pairs in Day and Night on every `pnpm test`. Day `hairline-strong` raised to 0.52 opacity to reach 3:1 |
| Primary button contrast | 1.4.3 | 🟡 | Native primary is `ink` on `paper` with `on-ink` text |
| Status colors (warning/success/info/error) | 1.4.3 | 🟡 | Design system uses `pool`, `clay`, `danger`; `sun` is never text |
| Focus indicator contrast ≥ 3:1 | 1.4.11 | 🟡 | `focus` token = `pool`, 2px ring |
| Pinch zoom allowed | 1.4.4 | ✅ | Web, PR #2 |
| No text under 11px | HIG / 1.4.4 | 🟡 | Design system `label` style is the 11px floor |
| Color is never the only signal (charts, heatmaps, shot markers) | 1.4.1 | ❌ | Labels and patterns on heatmaps and replay markers |
| Simulated replay is accessible | 1.1.1, 1.3.1 | ❌ | Court animation decorative; shot list carries type, player, outcome, time. "Close call" uses icon plus text |
| Rating badges, admin post labels, reliability not color-only | 1.4.1 | ❌ | Icon + text for Verified vs Self-rated, admin posts in league chat, and "Played 12 · 1 no-show" |
| Charts have text alternatives | 1.1.1, 1.3.1 | ❌ | One-line text summary for VoiceOver plus an accessible data table on every trend chart |
| Player card reads as one element | 1.3.1, 4.1.2 | ❌ | e.g. "Alex Kim, 3.5 Verified, 14 and 6, 22 aces this season" |
| Tab bar labels and badge counts | 1.4.1, 4.1.2 | ❌ | Icon + text label on all five tabs; badge counts read by VoiceOver |
| Radius and rating range controls | 2.5.8, 1.4.4 | ❌ | 44×44pt targets, Dynamic Type safe, step count announced |
| New messages announced to screen readers | 4.1.3 | ❌ | `AccessibilityInfo.announceForAccessibility` on iOS |
| Message bubbles read sender, text, time in one swipe | 1.3.1, 4.1.2 | ❌ | Group each bubble as one accessible element |
| Swipe-to-reply/delete has a non-gesture alternative | 2.5.7 | ❌ | Long-press menu + VoiceOver custom actions |
| Failed sends identified in text, not just a red icon | 3.3.1, 1.4.1 | ❌ | "Not sent. Tap to retry" |
| Bubble contrast (both sides, both themes) | 1.4.3 | ❌ | Check sent bubble text against 4.5:1 |
| Voice cues have a text alternative | 1.1.1, 1.3.3 | ❌ | Positioning coach and countdown captions mirror to the Live Activity; haptics on the mounted phone |
| Live Activity controls accessible | 4.1.2, 2.5.8 | ❌ | Start match and Stop labeled for VoiceOver, 44×44pt targets |

## 6. Deferred (not launch-blocking)

| Item | Target | Notes |
|---|---|---|
| Partner-phone live preview of the mounted camera | v1.1 | Local peer-to-peer link during mounting. Needs a local network purpose string and Bonjour service declaration when built |
| "Ball Boi, start recording" voice command | Post-MVP | Start only. Speech recognition purpose string and on-device recognition when built |
