# App Store Connect Prep

Answers to paste into App Store Connect, based on what the code actually does today.
Re-check this file whenever data collection changes.

## App information

| Field | Value |
|---|---|
| Name | Ball Boi |
| Subtitle (30 chars) | Tennis leagues + shot tracking |
| Bundle ID | `app.ballboi.ios` |
| Primary category | Sports |
| Secondary category | Health & Fitness |
| Privacy Policy URL | https://ballboi.app/privacy (deploy `/privacy` first) |
| Support URL | https://ballboi.app/terms or a dedicated support page |
| Encryption | Uses only standard HTTPS. `usesNonExemptEncryption: false` is already set |

## App Privacy (nutrition label)

**Tracking:** No. No ad SDKs, no cross-app tracking.

| Data type | Collected | Linked to user | Used for |
|---|---|---|---|
| Name | Yes | Yes | App Functionality |
| Email Address | Yes | Yes | App Functionality |
| Phone Number | Yes (optional) | Yes | App Functionality |
| Photos or Videos | Yes (match recordings) | Yes | App Functionality |
| Gameplay Content (scores, stats, shot data) | Yes | Yes | App Functionality |
| User ID | Yes (Clerk ID) | Yes | App Functionality |
| Other User Content (bio, reports) | Yes | Yes | App Functionality |
| Device ID (push token) | Yes | Yes | App Functionality |
| Location | No (until "players near you" ships) | | |
| Crash data / Analytics | No (add if you add Sentry, PostHog, etc.) | | |

## Age rating questionnaire (Jan 2026 system)

| Question | Answer | Why |
|---|---|---|
| User-generated content | Yes | Profiles, bios, match video |
| Messaging and chat | No | No chat today (comments router is unmounted) |
| Content controls (report/block) | Yes | Shipped in PR #5 |
| Age assurance | No | |
| Violence, sexual content, profanity, gambling, drugs | None | |
| Medical or wellness topics | No | |
| Web access (unrestricted) | No | |

Expect a 13+ rating, driven by user-generated content.

## App Review notes (template)

```
Ball Boi is a tennis league app with video shot analysis.

Demo account:
  Email: review@ballboi.app
  Password: <set in Clerk>

The account belongs to "Review League" with a scheduled match and a completed
match that has a Ball Boi replay. To test recording: Ball Boi tab → Record this
match. Recording needs a real device camera.

Account deletion: Profile → Delete account.
Report/block: open any player profile → … menu.
Moderation: reports reach our team immediately and are reviewed within 24 hours.
```

**To set up:** seed "Review League" with 3–4 players, one scheduled match, and one completed match with a processed replay.

**Open decision:** the reviewer can't receive your email codes, and Apple won't use their own Apple ID or Google account for you. Two ways to solve it:
- Enable password as a secondary sign-in strategy in Clerk and add a small "Use a password" link on the sign-in screen (common and Apple-friendly).
- Or route `review@ballboi.app` to a shared inbox and add a note that codes arrive there (slower; reviewers often reject this).

## Screenshots

Required: 6.9" iPhone (1320 × 2868). Suggested five:
1. Ball Boi replay with shot markers ("Replay every shot")
2. Recording screen ("Just film. No court taps.")
3. League standings ("Run your league")
4. Home with next match ("Never miss a match")
5. Player stats and head-to-head ("Know your game")
