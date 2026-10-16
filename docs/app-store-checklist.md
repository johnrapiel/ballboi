# Ball Boi: App Store Submission Checklist

Source of truth for getting Ball Boi onto the iOS App Store and passing WCAG 2.2 AA.
Update the status column in the same PR that changes it.

**Legend:** ✅ done · 🟡 in progress · ❌ not started · ⚠️ needs a decision

_Last updated: 2026-10-16_

## 1. Native app

| Item | Guideline | Status | Notes |
|---|---|---|---|
| Native stack: Expo SDK 58 (`artifacts/ios-app`) | 4.2 Minimum Functionality | 🟡 | Scaffolded: auth, tabs, Ball Boi recorder |
| Built with Xcode 26 / iOS 26 SDK | Required since Apr 28, 2026 | 🟡 | EAS `production` profile uses latest image |
| Native camera capture for Ball Boi | 4.2, 2.5 | 🟡 | expo-camera recorder, no corner tapping. Background upload still TODO |
| APNs push (replace web push / VAPID) | 4.5.4 | ❌ | `expo_push_tokens` table already exists |
| Dynamic Type support | HIG / WCAG 1.4.4 | 🟡 | Font scaling on everywhere in the native app |
| VoiceOver labels on icon buttons, charts, heatmap, replay controls | HIG / WCAG 1.1.1, 4.1.2 | 🟡 | Done for built screens; replay/heatmap not built yet |
| 44×44pt minimum tap targets | HIG / WCAG 2.5.8 | 🟡 | `MIN_TAP` enforced in shared Button |
| Reduce Motion respected | HIG / WCAG 2.3.3 | 🟡 | Web: global CSS guard added |

## 2. Backend readiness

| Item | Guideline | Status | Notes |
|---|---|---|---|
| Move video upload/replay off Replit storage to S3 or R2 | 2.1 App Completeness | ❌ | Replays break outside Replit today |
| Reviewer demo account with seeded league, matches, sample replay | 2.1 | ❌ | Goes in App Review notes |

## 3. Compliance features

| Item | Guideline | Status | Notes |
|---|---|---|---|
| In-app account deletion (deletes user data, not just deactivates) | 5.1.1(v) | ❌ | Must also revoke Sign in with Apple token |
| Privacy policy page, linked in-app and in App Store Connect | 5.1.1(i) | ❌ | |
| Terms of use / EULA with zero-tolerance UGC language | 1.2 | ❌ | |
| Report a player or content | 1.2 | ❌ | |
| Block a player | 1.2 | ❌ | |
| Published support contact | 1.2, 1.5 | ❌ | |
| Sign in with Apple (Google is offered, so required) | 4.8 | 🟡 | Apple + Google + email code in native sign-in. Enable Apple in Clerk |
| Consent notice for recording other players on video | 5.1.1 / 5.1.2 | ❌ | |
| Paid Ball Boi features use In-App Purchase | 3.1.1 | ⚠️ | Decide pricing model first |

## 4. App Store Connect

| Item | Guideline | Status | Notes |
|---|---|---|---|
| Privacy nutrition labels | 5.1.1 | ❌ | Clerk, analytics, video, location |
| Privacy manifest (incl. third-party SDKs) | Required since May 2024 | 🟡 | App manifest in `app.config.ts`; verify SDK manifests at build |
| Camera, microphone, photo library purpose strings | 5.1.1 | ✅ | In `app.config.ts` |
| Location purpose string (if "players near you" ships) | 5.1.1 | ❌ | |
| New age rating questionnaire | Required since Jan 31, 2026 | ❌ | |
| Screenshots, description, keywords, support URL | 2.3 | ❌ | |
| EU trader status (if distributing in the EU) | DSA | ❌ | |

## 5. WCAG 2.2 AA (web app, carries into native)

| Item | Criterion | Status | Notes |
|---|---|---|---|
| Light-mode text contrast ≥ 4.5:1 | 1.4.3 | 🟡 | PR `a11y/aa-contrast` |
| Primary button contrast (white on teal) | 1.4.3 | 🟡 | Teal → `#00766A` (5.53:1) |
| Status colors (warning/success/info/error) | 1.4.3 | 🟡 | New semantic tokens replace raw Tailwind colors |
| Focus indicator contrast ≥ 3:1 | 1.4.11 | 🟡 | Input focus uses ring token |
| Pinch zoom allowed | 1.4.4 | 🟡 | Removed `maximum-scale=1` |
| No text under 11px | HIG / 1.4.4 | 🟡 | 9–10px raised to 11px |
| Dark-mode muted text on raised surfaces | 1.4.3 | 🟡 | `#8A99B5` (5.1:1 on subtle) |
| Color is never the only signal (charts, shot markers) | 1.4.1 | ❌ | Add labels/patterns to replay markers |
