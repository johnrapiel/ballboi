# App Store Connect prep

Answers to paste into App Store Connect. Keep them matched to what the shipped build actually does, and re-check this file whenever data collection changes. Where this file and `docs/product-spec.md` disagree, the spec wins.

_Ported from `feat/compliance` (#5) on Oct 21, 2026 and updated for the current spec: 18+, `tennis.ballboi`, ballboi.tennis, messaging, training on match video. The privacy policy and terms live on ballboi.tennis; the nutrition label below must match them._

## App information

| Field | Value |
| --- | --- |
| Name | Ball Boi |
| Subtitle (30 chars max) | Find players, leagues, replays |
| Bundle ID | `tennis.ballboi` |
| Primary category | Sports |
| Secondary category | Health & Fitness |
| Privacy Policy URL | https://ballboi.tennis/privacy (live, last updated Oct 18, 2026) |
| Terms of Use (EULA) | https://ballboi.tennis/terms (live). Also link it in the description, since subscriptions need it |
| Support URL | A ballboi.tennis page with support@ballboi.tennis (the address the live policy and terms use) |
| Encryption | Standard HTTPS only. `ios.config.usesNonExemptEncryption: false` is set in `artifacts/mobile/app.json` |

## App Privacy (nutrition label)

**Tracking:** No. No ad SDKs, no cross-app tracking.

Answer for what the submitted build collects. Rows marked _at launch_ come with features the spec puts in v1; add them in the same release as the feature.

| Data type | Collected | Linked | Used for |
| --- | --- | --- | --- |
| Name | Yes | Yes | App Functionality |
| Email Address | Yes | Yes | App Functionality |
| Photos or Videos (profile photo, match video) | Yes | Yes | App Functionality; Other Purposes (model training, on by default; matches the privacy manifest) |
| Audio Data (shot detection only, deleted after processing) | _At launch_, if the test set keeps audio | Yes | App Functionality |
| Gameplay Content (scores, stats, shot data, ratings) | Yes | Yes | App Functionality |
| Other User Content (bio, reports, messages) | Yes (messages _at launch_) | Yes | App Functionality |
| User ID (Clerk ID, linked UTR ID) | Yes | Yes | App Functionality |
| Device ID (push token) | Yes | Yes | App Functionality |
| Coarse Location (home area, travel mode) | _At launch_ | Yes | App Functionality |
| Purchases (Ball Boi Pro) | _At launch_ | Yes | App Functionality |
| Crash data, analytics | No (add if Sentry, PostHog or similar is added) | | |

## Age rating questionnaire

Decided: **18+** for the MVP (spec decision 1), so Screen Time blocks the download for minors.

| Question | Answer | Why |
| --- | --- | --- |
| User-generated content | Yes | Profiles, photos, bios, match video |
| Messaging and chat | Yes (_at launch_) | Direct messages, Message Requests, league chat |
| Real-world meetups with strangers | Yes | Discover and open matches |
| Content controls (report, block) | Yes | Report and block API and iOS menu |
| Age assurance | Yes | Declared Age Range API with birth-date fallback; under 18s are blocked |
| Violence, sexual content, profanity, gambling, drugs | None | |
| Medical or wellness topics | No | |
| Unrestricted web access | No | |

## App Review notes (template)

```
Ball Boi is an 18+ tennis app: local players, leagues, and Ball Boi, which
records a match and builds a simulated replay with shot stats.

Demo account (password sign-in is enabled for this account only):
  Email: review@ballboi.tennis (create this account)
  Password: <set in Clerk>

Seeded data: a league with a scheduled and a completed match, two Ball Boi
replays, a message thread, a Message Request, and an open match. The 3 free
months are already used, so the Ball Boi Pro paywall is live.

Recording needs a real device on a court. A 60-second screen recording of a
recording session is attached.

Account deletion: Profile > Delete account.
Report and block: on a player, tap More (...) > Report or Block.
Moderation: every report is reviewed within 24 hours.
```

**To set up** (spec decision 10, checklist "Reviewer demo account"): enable password sign-in for the review account only, seed the data above, and record the on-court clip.

## Screenshots

Required: 6.9" iPhone (1320 × 2868). Show the simulated replay, never match video, and no partner logos until cleared.

1. Replay with shot markers: "Replay every shot"
2. Recording, phone on the fence: "Just film. No court taps."
3. League standings: "Run your league"
4. Discover, players near you: "Find your next match"
5. Player card and trends: "Know your game"
