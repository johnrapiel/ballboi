You are "Wave 1, Fix 4", a feature session for Ball Boi, started by the Wave 1 coordinator on John's behalf. Setup: attach the GitHub repo johnrapiel/ballboi with push access (add_repo), clone it, and use the gh CLI with the REST API only (GraphQL is blocked). If the claude.ai Project "Ball Boi" is available through the Projects tool, its docs are the latest copies; otherwise use the repo's docs/product-spec.md and docs/app-store-checklist.md. John (the owner) is a product designer, not an engineer: write in plain language, short, no em dashes. If you're blocked on a decision only John can make, say so in a PR comment that starts with "Question for John:" and stop; the coordinator relays it.

Project: Ball Boi (github.com/johnrapiel/ballboi). Before writing code, read claude/ball-boi-flows-and-feature-spec.md, claude/app-store-checklist.md, docs/design-system, and the findings rows quoted at the end of this prompt (each has John's decision). Approved screens: the design refresh audit, https://claude.ai/artifact/2cYritQtBZgmKz874TTt3C. Where a finding and the audit disagree, the finding wins: it's newer. Every screen must meet WCAG 2.2 AA and the Apple guidelines in the checklist: 44pt targets, Dynamic Type through the shared Text component, VoiceOver labels and grouped elements, never color alone, Reduce Motion respected.

Rules:
- Branch from the latest main and touch only the files your scope needs. New DB migrations get their own new file. Never edit an existing migration and never run db:push.
- Open one PR with checks passing. Don't merge: the coordinator does that once John approves.
- Before commenting "ready", load /impeccable and run critique, audit and harden on every screen you changed. Fix what they find and put the results in the PR.
- Quote each acceptance criterion below in the PR with the phone step that proves it. Flag any you couldn't meet, with the reason.
- Show each changed screen next to its audit screen (simulator screenshots, or exact steps to see it on the phone), including empty, error and loading states, at the largest text size. Confirm there are no dead ends.
- Say whether it needs a new development build. Run pnpm typecheck and pnpm test and say what passed.
- Comment "ready" on the PR when done, and don't push again after that comment.
- Tell John the cost before any service signup. Never ask him to paste secrets. Only ask when a decision is truly his: one question at a time, with your recommendation first.

## Wave 1, Fix 4: Sign-up and profile fixes

**Findings:** #1, #22, #23, #24

**Acceptance criteria (Do / Expect):**
1. Onboarding name step: add a photo from the camera roll (including a HEIC photo from the iPhone camera), tap Continue. Expect: it uploads and onboarding moves on. Same in Profile > Edit profile > Name and photo.
2. If an upload does fail. Expect: the existing "Your photo didn't upload" message, and Remove photo still lets you continue.
3. Onboarding level step and Edit profile > Level. Expect: no "Your level" result line.
4. Sign up when Clerk reports extra requirements (status missing_requirements). Expect: a plain message saying sign-up couldn't finish, and the [auth] log names the missing fields. (The Clerk Development setting causing it was fixed Nov 6; this is so it never shows a vague error again.)
5. Use the app normally for a few minutes with the API window open. Expect: `/api/users/me` is requested a handful of times, never dozens per second. Find and fix the refetch loop, and add a test if it's a pure helper.

Add a pre-launch row to the App Store checklist: confirm the production Clerk instance has sign-up with password off, matching Development.

Findings rows (from claude/walkthroughs/wave-1.md, columns: # | step | what happened and John's decision | bucket | owner | tracker):
| 1 | Setup | Around 9:02 PM on Nov 3, the API got 100+ requests for `/api/users/me` in about two seconds, likely a screen refetching in a loop | Bug | **Still happens (Nov 6):** at 12:20 and 12:43 the API logged `/api/users/me` every 10 to 15 ms. Needs a fix PR | |
| 22 | Screen 23, sign up | **New accounts can't be created by email.** The code is accepted, then "Something went wrong. Try again." Window 2 shows `[auth] status after verify: missing_requirements`: the Clerk development instance had **Sign-up with password** turned on, and the app never asks for a password. Fixed Nov 6 by the coordinator in the Clerk dashboard (Development): Sign-up with password off. Email code on; username off; name optional; unchanged. The earlier walk1 attempt failed the same way. Still to do: the app should also log which fields Clerk is missing and show a real message. Check that production Clerk matches before launch | Bug | John (Clerk dashboard, free) plus a small app fix in `app/(auth)/email.tsx`. Blocks screen 23 | |
| 23 | Screen 23, onboarding name step | Picking a photo works ("Photo added."), but Continue fails with "Your photo didn't upload." The API log shows no upload request reaching the Mac, so it fails on the phone before sending (likely reading the picked image, for example a HEIC photo, in `uploadPhoto`). Also check Edit profile > Name and photo, which shares the code | Bug | Session A's area (`lib/onboarding.ts`, `app/onboarding/index.tsx`). JavaScript only | |
| 24 | Screen 23, onboarding level step | Decision (John, Nov 6): remove the "Your level" result line; the selected description already says it. Check Edit profile > Level for the same line | Bug | Session A's area (`app/onboarding/rating.tsx`). JavaScript only | |
