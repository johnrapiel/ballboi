You are "Wave 1, Fix 7", a feature session for Ball Boi, started by the Wave 1 coordinator on John's behalf. Setup: attach the GitHub repo johnrapiel/ballboi with push access (add_repo), clone it, and use the gh CLI with the REST API only (GraphQL is blocked). If the claude.ai Project "Ball Boi" is available through the Projects tool, its docs are the latest copies; otherwise use the repo's docs/product-spec.md and docs/app-store-checklist.md. John (the owner) is a product designer, not an engineer: write in plain language, short, no em dashes. If you're blocked on a decision only John can make, say so in a PR comment that starts with "Question for John:" and stop; the coordinator relays it.

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

## Wave 1, Fix 7: Review polish

**Findings:** #26, #28, #29, #30, #31. Build on the latest main (Fix 1 #127, the palette #125 and the splash #122 have merged). Fix 2 runs at the same time and owns Home, My matches and Match detail: don't touch app/(tabs)/index.tsx or app/match/**.

**Acceptance criteria (Do / Expect):**
1. Sign out and look at Welcome (#28). Expect: the roundel, headline and subline are centred vertically in the space between the status bar and the Continue with Apple button. At the largest text size it still fits and scrolls.
2. As an admin, open League detail (#29). Expect: Manage league row, then the "Round N pairings are ready to review" card right under it, then your match card, then standings. No invite card on League detail. Players see neither.
3. Open Manage league (#29). Expect: the new invite card (code, copy, share) at the top. No legacy Invite players card. No Review pairings entry.
4. Profile (#30). Expect: a settings cog in the header beside the Messages icon (44pt target, VoiceOver "Settings") opens Settings. No Settings row; Account keeps Sign out.
5. Onboarding level step and Profile > Edit profile > Level (#31). Expect: a sixth card, "5.0 · Expert: I've played college or open-level tournaments, and I can hit any shot with pace and control under pressure." The API accepts 5.0 (update its allowed levels and tests).
6. App icon (#26). Expect: app.json uses the light and dark iOS icon variants: `icon-light.png` (white tile, navy ball) as the main icon and `icon-dark.png` (today's navy icon) as the dark variant. Both files are on branch docs/wave-1-fix-briefs under claude/wave-1-fix-briefs/app-icon/ (git show them out, copy into artifacts/mobile/assets/images/, don't commit that folder). Say in the PR that this needs a new development build. Don't add packages.

Note in the PR which findings need the design system updated (Welcome layout, roundel, app icon) so the coordinator can sync it.


Findings rows (from claude/walkthroughs/wave-1.md):
| 26 | iPhone home screen app icon | Decision (John, Nov 6): the app icon becomes a white tile with the hand-painted ball in navy, to match the new palette. Today's navy icon becomes the iOS Dark Mode icon (`ios.icon` light and dark variants). Files ready: `claude/wave-1-fix-briefs/app-icon/icon-light.png` and `icon-dark.png` on branch docs/wave-1-fix-briefs. Also update the design system's app icon | Bug | Native (app.json and assets), so it rides in the next development build (with Fix 2 or early Wave 2) | |
| 28 | Fix review, Welcome | The roundel, headline and subline sit high, leaving a large gap above the buttons. Decision (John, Nov 6): center that group vertically in the space between the top of the screen (below the status bar) and the Continue with Apple button. It must still fit and scroll at the largest text size | Bug | Small follow-up with Fix 2. JavaScript only | |
| 29 | Fix review 2, League detail | Decision (John, Nov 6): the invite card (code, copy, share) moves off League detail and into Manage league, replacing #12's "invite at the top until the season starts". The admin "Round N pairings are ready to review" card sits directly under the Manage league row, above your match card. Players still see neither. In Manage (John, Nov 6, fix review 3): the new invite card goes at the top; remove the legacy Invite players card; remove the Review pairings entry from Manage, since it's on League detail | Bug | Follow-up after #127 merges (League detail and Manage). JavaScript only | |
| 30 | Fix review 6, Profile | Decision (John, Nov 6): replace the Settings row on Profile with a settings cog icon in the Profile header, beside the Messages icon (44pt target, VoiceOver label "Settings"). Account keeps Sign out | Bug | Follow-up after #127 merges (Profile). JavaScript only | |
| 31 | Fix review 11, level step | The level quiz has five levels, 2.5 to 4.5 (always has). Decision (John, Nov 6): add 5.0. Draft copy: "5.0 · Expert: I've played college or open-level tournaments, and I can hit any shot with pace and control under pressure." Add it to onboarding and Edit profile, and let the API accept 5.0 | Bug | Polish follow-up with #27 to #30. JavaScript and API | |
