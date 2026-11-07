# Wave 2, Session G: Push, Live Activity and voice coach

Paste this whole brief into a new session titled **"Wave 2, Session G"**.

```
Project: Ball Boi (github.com/johnrapiel/ballboi). Before writing code, read claude/ball-boi-flows-and-feature-spec.md, claude/app-store-checklist.md, the Ball Boi Feature Tracker (https://claude.ai/artifact/RAcKukk587nMW46iaDg9ZD) and docs/design-system. The spec is the source of truth. Every screen must meet WCAG 2.2 AA and the Apple guidelines in the checklist: 44pt targets, Dynamic Type through the shared Text component, VoiceOver labels and grouped elements, never color alone, Reduce Motion respected.

Rules:
- Branch from the latest main and touch only the files your scope owns. Don't edit claude/feature-status.md, claude/app-store-checklist.md or shared components in components/ui.tsx unless your scope says so. List any needed changes in the PR description instead.
- New DB migrations get their own new file. Never edit an existing migration and never run db:push.
- Open one small PR per feature, with checks passing. Don't merge: the coordinator session does that.
- End each PR description with phone test steps I can follow, and say whether it needs a new development build.
- Tell me the cost before any service signup and prefer free tiers. Never ask me to paste secrets in chat; tell me where to put them.
- Only ask when a decision is truly mine: one question at a time, with your recommendation first.
```

## What you're building

Everything that makes the phone talk, buzz and show up on the Lock Screen: the voice coach and court detection on the mounted phone, push notifications, the Live Activity on both phones, and the last two native safety checks. **You are the native owner this wave:** you're the only session that adds native packages or touches `app.json`, `eas.json`, the privacy manifest or a widget extension.

Ship in this order (John, G4), one stacked PR per numbered item:

**Step 1: the beta build** (one native build; the small beta starts once it merges, spec decision 84)
1. **Court detection and the court-line fix** (rebuild from draft #114)
2. **Voice coach** with John's recorded voice
3. **Recording screen fixes** (app gaps 1, 3 and 5 below)

**Step 2: notifications** (no new native build if step 1 already added the entitlements)
4. **Notification permission and message push** (provisional, the contextual prompt, preview switch)
5. **Opponent notice and "Was that you?"**
6. **Match day reminders** (rebuild from draft #113)

**Step 3: Live Activity**
7. **Live Activity on both phones**, with push-to-start and Start / Stop buttons

**Step 4: the final native build**
8. **Apple's age range check** before the birthday screen
9. **DeviceCheck device bans**

Read `claude/wave-2-flow-review.md` in the Project (Session G section, G1 to G10, and fixes X1 and X2) before you start, and `claude/design-decisions/voice-coach.md` for the 21 lines and their captions. Everything below comes from them.

## Where to start

Session D's beta recording stack (#150 to #155) and "Record 7: Remove hold to stop" all change `app/record/[matchId].tsx`. If they haven't merged when you start, branch step 1 from the top of that stack (`claude/wave2-d7-remove-hold-to-stop`) and base your first PR on it; the coordinator merges stacks with merge commits. Don't rewrite anything D built: the first-run carousel, the release checkbox, "[Name] agreed to be filmed.", the "Uploaded" card, the "Something not working?" form and the mic-denied message are D's. Build on top of them.

**Hold to stop is gone (X2).** The Stop button, with its "Stop recording?" confirm, is the one way to stop on the mounted phone. Nothing you add (lines, captions, hints, Live Activity text) may mention holding the screen.

## Design source

The **"Wave 2 designs"** page of the "Ball Boi iOS" canvas: https://claude.ai/artifact/LCm9Q9eKeRypqioMcTqDBU. Build from the `W2_` artboards for court setup and live recording. The "On TestFlight" page shows what's already built: match its patterns, components and tokens. Ignore the "Graveyard" page. Where the canvas and this brief disagree, this brief wins. There are no canvas screens for the Live Activity, the notification reason screen or the age check: follow Apple's standard layouts in the design system's tokens, and John reviews them in the PR.

## Scope and owned files

You own:
- Mobile: `app/record/**` (with the D caveat above), `components/record/**`, `lib/court/**`, `lib/recording/{voice,captions,countdown,chrome,safety,start}.ts`, `lib/coachLines.ts` (new), `assets/audio/coach/**` (new), `lib/notifications.ts`, `lib/notificationAccess.ts`, `hooks/useNotificationAccess.ts`, `app/notifications.tsx`, `components/NotificationsOffBanner.tsx`, the Live Activity target and its shared module (new), `lib/ageCheck.ts`, the age check step in `app/onboarding/**`, `app.json`, `eas.json`, the privacy manifest.
- Shared UI fix for app gap 1: `components/Choice.tsx` (drop the check icon from selected chips; this also fixes Weekly match time).
- API: `routes/notifications.ts`, `routes/liveActivity.ts` (new), `routes/ballBoi.ts` (court calibration only), `lib/matchReminders.ts`, `lib/phoneCourtCalibration.ts`, `services/scheduler.ts` (reminder jobs only), `services/push/**` (new), `services/deviceBans/**` (new).
- DB: `lib/db/src/schema/{notifications,liveActivities,deviceBans}.ts` and new `scripts/migrations/2026MMDD_g_*.sql` files.
- Shared, append-only (per the "Rules for every wave" in claude/waves.md): `openapi.yaml`, `routes/index.ts`, `schema/index.ts`, `accountDeletion.ts`.
- Small, named edits outside that list: the Settings › Notifications rows in `app/settings.tsx`, the Home line for denied notifications in `app/(tabs)/index.tsx`, and the trigger points for the permission prompt (joining a league, accepting a match card, posting or joining an open match, turning on open match alerts). Keep each edit minimal and list it in the PR.

**Start from the old drafts; don't merge them as they are.** #114 (court lines) and #113 (match day reminders) predate the Wave 1 restyle, palette and Session D's recording changes. Reuse their detection code, API, data and tests where they still fit; rebuild every screen. #113's reason sheet and triggers change (G3), and its reminder rule changes (G5). Close both PRs with a comment pointing to yours once yours are open. Their migrations never ran on staging or production; replace them with your own files.

**Native packages:** `expo-audio` and `expo-notifications` are already installed. Keep every Expo package on SDK 58 versions and check with `pnpm --filter @workspace/mobile exec expo install --check`. #114 adds `expo-image-manipulator` and `jpeg-js`: keep them only if detection still needs them. Every `package.json` change commits the regenerated `pnpm-lock.yaml`. Say in each PR whether it needs a new development build.

**Costs and keys:** APNs, DeviceCheck and the Declared Age Range API are free with the Apple Developer account John already has. Live Activity push-to-start and DeviceCheck need an Apple key (.p8). Tell John exactly where to create it in App Store Connect and to store it as a Cloudflare secret (and in his local `.env`). Never in chat. If Expo's push service can't send Live Activity pushes, send those straight to APNs from the API.

## John's decisions (Nov 7)

- **G1** No live stats while recording. The recording screen shows the "Rec" pill, elapsed time, whether the court is in frame, and low battery or storage warnings. Stats show up only in Replay afterwards. Only court detection and the voice coach run on the phone.
- **G2** Quick match with a stranger: they get "John recorded a match with you. Was that you?" with Yes and Not me. Until Yes, the match isn't linked to their profile and none of their stats or replay show. "Not me" removes them; no answer leaves it unlinked. League mates and accepted Discover matches keep the plain "Ball Boi is recording your match" notice. Beta testers don't need the opponent notice (spec decision 85).
- **G3** Quiet (provisional) notifications from sign-in. The full iOS prompt, with a reason screen first, shows once, at the first of: joining a league, a match being added in chat, posting or joining an open match, or turning on open match alerts. If declined: one Home line linking to iOS Settings, never asked again.
- **G4** The build order above. RevenueCat is out (Ball Boi Pro is parked, spec decision 82).
- **G5** One reminder rule everywhere: any match with a set date and time (league or Discover) gets a day-before reminder at 8 AM on the match's clock, at most once, plus one 2 hours before. League matches with no set time keep the Sunday "your match this week" nudge. The old Wednesday "set your availability" reminder is removed. All of it sits behind the Match day reminders switch, on by default.
- **G6** Message pushes show sender and text ("Sam Whitfield: Still on for 6?"). Settings › Notifications has "Show message previews", on by default; off, pushes read "New message from Sam Whitfield". iOS's own Show Previews setting still applies on top.
- **G7** The Live Activity starts on its own on the opponent's phone for league mates and accepted Discover matches. A Quick match stranger gets it only after they answer Yes.
- **G8** A voice coach correction repeats no sooner than every 7 seconds while the phone hasn't moved, and stops after 3 times in a row.
- **G9** Captions show only where someone can see them: on the mounted phone during setup (the player is at the phone moving it), and on the Live Activity and Apple Watch during the match. No captions on the mounted screen once recording starts.
- **G10** Auto-stop on low storage or at 4 hours plays the chime and shows a caption, with no voice line. Low battery keeps its recorded line (21).
- **X2** No hold to stop (see above).
- Also standing: the app speaks only from the mounted phone during a recording (spec decision 81). Voice coach is one script for every session, with no shorter mode. Partner phone stays optional.

## Voice coach files

The clips are already in the repo on branch `assets/voice-coach-clips` (commit `6f6b389`, from main `80acbe4`): 22 m4a files in `artifacts/mobile/assets/audio/coach/` (`01-setup` to `21-auto-stop`, plus `22-chime`) and 22 wav masters in `docs/voice-coach/masters/`. They are final and byte-for-byte what John delivered. Merge that branch into your voice coach branch (don't copy, re-encode or rename the files); they reach main with your PR. Don't delete the branch: the coordinator does that after your PR merges.

Your voice coach PR adds:
- The 22 clips and 22 masters from `assets/voice-coach-clips`. Play the clips as they are: no runtime pitch, speed or effects. The masters stay outside the app bundle.
- One manifest, `artifacts/mobile/lib/coachLines.ts`, mapping each cue id to its file and caption, with captions copied word for word from the table in `claude/design-decisions/voice-coach.md`. Captions are never retyped anywhere else: the mounted screen, partner phone, Live Activity and Watch all read this manifest. Add captions for the two silent auto-stops (G10) to the same manifest: "Your phone is running out of space, so I've saved the match." and "We've hit four hours, so I've saved the match."
- Replace `expo-speech` in `lib/recording/voice.ts` with the recorded clips. No text-to-speech anywhere.

The preview at https://claude.ai/artifact/FXRMj66GY2NpESRH1NVrHJ is how it should sound in sequence, chime included.

## App gaps you own (found by the canvas rebuild)

1. Selected chips still show a check (Quick match Singles / Doubles, camera "Start in", and Weekly match time through `Choice.tsx`). Selected is the filled `ink` background with `on-ink` text, `accessibilityState={{ selected: true }}` and "selected" read by VoiceOver. No icon.
3. Uppercase section labels on the Ball Boi tab and Quick match: use sentence case and the design system's outline pills.
4. The 18+ age check screen uses a serif title: use the brush title (`brushL`) like other big screen titles.
5. The recording indicator is a coral dot: use the design system's "Rec" pill.

## Acceptance criteria

Each line is a check John can do on his phone. Use the walkthrough accounts (A, B, C) from the staging seed. A is the recorder with the mounted phone; B is a league mate with the app; C has never played A.

### 1. Court detection and the court-line fix

1. **Do:** start a recording from a league match card and mount the phone behind the baseline. **Expect:** the court overlay finds the lines live, and the screen shows whether the court is in frame, with text as well as color.
2. **Do:** point the phone at a court in poor light or partly blocked. **Expect:** after about 20 seconds, Record anyway appears. After recording, when detection confidence was low, the court-line fix shows four handles on a still frame captured before upload. Dragging and saving them sends the corrected corners with the upload.
3. **Do:** move a handle with VoiceOver on. **Expect:** each handle is labelled ("Near left corner") and has adjustable actions as a non-drag alternative.
4. **Expect:** nothing from detection leaves the phone except the four corners and a confidence score. Match video is never played back in the app.

### 2. Voice coach

5. **Do:** start setup. **Expect:** line 01 plays. Corrections 02 to 08 play from court detection one at a time, never overlapping. 09 plays once the frame is nearly right and steady. 10 plays the moment the court locks, then the chime.
6. **Do:** leave the phone aimed wrong without moving it. **Expect:** the same correction repeats no sooner than every 7 seconds and stops after 3 times in a row. Its caption stays on the mounted screen.
7. **Do:** aim away from any court. **Expect:** 11 plays. After about 20 seconds, 12 plays and Record anyway appears.
8. **Do:** Start in 5, 10 and 15 min. **Expect:** 14, 15 or 16, then 17 at one minute left, 18 at ten seconds, and 19 timed so capture starts as it ends. Start Now plays 19 only. Bump the phone during the countdown. **Expect:** 13 plays and the lock check runs again.
9. **Do:** tap Stop and confirm. **Expect:** 20 plays after capture ends. Let the battery run low (or use the dev control). **Expect:** 21. Low storage and the 4-hour cap play the chime with no voice, and their captions show on the Live Activity and in the stop message.
10. **Mic bleed:** no coach audio plays while the camera is capturing. 19 ends before capture begins; 20 and 21 start after it ends.
11. **Do:** flip the silent switch on. **Expect:** the coach still plays, from the mounted phone only. The mute toggle silences the voice, and captions keep showing.
12. **Captions (G9):** during setup, every line shows its manifest caption on the mounted screen, for at least 2 seconds or as long as the line needs. Once recording starts, the mounted screen shows no captions; they show on the Live Activity and Apple Watch instead. VoiceOver users hear each caption once, never doubled with the audio from the same phone.
13. **Missing files fail safe:** if a clip can't load, its caption still shows and setup carries on.
14. **Expect:** no line, caption or hint mentions holding the screen.

### 3. Recording screen fixes

15. **Do:** open Quick match and the camera's "Start in" options. **Expect:** selected chips are filled with no check icon, and VoiceOver reads "selected". Weekly match time in Create league looks the same.
16. **Do:** open the Ball Boi tab and Quick match. **Expect:** sentence-case section labels, no uppercase.
17. **Do:** start recording. **Expect:** the "Rec" pill with elapsed time, no coral dot, no live stats (G1). Low battery and low storage warnings show in text.

### 4. Notification permission and message push

18. **Do:** sign in as a new account. **Expect:** no permission prompt. Notifications arrive quietly in Notification Center with Keep and Turn Off.
19. **Do:** join a league (or accept a match card, post or join an open match, or turn on open match alerts, whichever comes first). **Expect:** a reason screen first, then the iOS prompt, once. Doing another of these later never asks again.
20. **Do:** decline. **Expect:** one line on Home that links to iOS Settings. Never another prompt.
21. **Do:** as B, message A while A's app is closed. **Expect:** "Sam Whitfield: Still on for 6?". Turn off Settings › Notifications › Show message previews. **Expect:** "New message from Sam Whitfield". Tapping either opens that chat.
22. **Do:** block B, then have B message A. **Expect:** no push.

### 5. Opponent notice and "Was that you?"

23. **Do:** A records a league match against B. **Expect:** B gets "Ball Boi is recording your match".
24. **Do:** A starts a Quick match with C. **Expect:** C gets "John recorded a match with you. Was that you?" with Yes and Not me. Before C answers, C's profile shows nothing from the match.
25. **Do:** C taps Yes. **Expect:** the match links to C's profile with stats and replay when ready. **Do:** another time, C taps Not me. **Expect:** C is removed from the match. No answer leaves it unlinked.
26. **Do:** record against a placeholder (not on Ball Boi). **Expect:** no in-app notice. Beta tester opponents get no opponent notice.

### 6. Match day reminders

27. **Do:** set a league match for tomorrow at 6 PM and use the dev time controls. **Expect:** one reminder at 8 AM on the day before (on the match's clock), then one 2 hours before. Never twice, even if the job runs again.
28. **Do:** the same with a Discover match from a chat card. **Expect:** the same two reminders.
29. **Do:** a league match with no set time. **Expect:** only the Sunday "your match this week" nudge. There's no Wednesday "set your availability" reminder anywhere.
30. **Do:** turn off Match day reminders in Settings. **Expect:** none of the above arrive.

### 7. Live Activity

31. **Do:** A starts setup for a league match against B. **Expect:** a Live Activity on both phones, showing court lock status, recording time, the mounted phone's battery, and Start match / Stop. On B's phone it appears on its own (G7).
32. **Do:** start and stop from B's Lock Screen. **Expect:** the mounted phone starts and stops, and a stop from the Lock Screen asks to confirm on that phone first. Either player has full controls.
33. **Do:** a Quick match with C. **Expect:** C gets the Live Activity only after tapping Yes.
34. **Do:** watch the Live Activity during setup and the match. **Expect:** coach captions mirror there, and on Apple Watch where available.
35. **Accessibility:** Start and Stop are labelled for VoiceOver, status uses text as well as color, and it reads well at the largest text size.

### 8. Age check

36. **Do:** sign up on a device where Apple's age range is shared. **Expect:** an adult goes straight past the birthday step. Under 18 sees "Ball Boi is 18+ for now" and no account is made. Only a pass/fail flag is stored.
37. **Do:** sign up where it isn't shared. **Expect:** the birthday step exactly as the spec describes (wheels in a bottom sheet, "What's your birthday?", empty until confirmed, Done off until a wheel moves, a quiet Sign out). Its title uses the brush style.

### 9. DeviceCheck bans

38. **Do:** as a moderator, ban an account. **Expect:** that phone can't make a new account, even after reinstalling. Other phones aren't affected. The ban shows in the admin queue with an undo.
39. **Expect:** the privacy policy notes, the privacy manifest and the checklist row are listed as changes needed in the PR description.

### Across all nine

40. Every screen has a way back, and every error has a recovery. Nothing dead-ends.
41. Account deletion removes push tokens, Live Activity tokens, reminder logs and age flags (each in its own helper). Device bans stay.
42. `pnpm typecheck` and `pnpm test` pass, with tests for the repeat rule (G8), caption placement (G9), the reminder rule (G5, at most once), the prompt triggers (G3) and the "Was that you?" link states (G2).

## PR rules

- Before commenting "ready", load /impeccable and run `critique`, `audit` and `harden` on every screen you built. Fix what they find, and put the results in the PR.
- Quote the acceptance criteria each PR covers, give each one the phone test step that proves it, and flag any you couldn't meet, with the reason.
- Show each flow screen by screen, including empty, error and loading states, at the largest text size and in Dark Mode, next to its canvas screen where one exists. If you can't capture screens, say so and give John exact steps to see each state on his phone.
- Say clearly whether each PR needs a new development build. Steps 1, 3 and 4 will.
- For the voice coach PR, the coordinator listens to the build on John's phone with him before merging: the full setup, a no-lock, each countdown length and a stop. It should sound like the preview.
- Comment "ready" on the PR when done, and don't push again after that comment.
- End commit messages and PR bodies with the attribution lines your session gives you.
