# Wave 2, Session D: Beta recording first run, release and tester fixes

From the footage review (Nov 7). Assigned by the Wave 2 coordinator to a Session D follow-up, because it works in Session D's record flow files. JavaScript and API only: no new native packages (Session G is this wave's native owner). Say so in the PR if that changes.

```
Project: Ball Boi (github.com/johnrapiel/ballboi). Before writing code, read claude/ball-boi-flows-and-feature-spec.md, claude/app-store-checklist.md, the Ball Boi Feature Tracker (https://claude.ai/artifact/RAcKukk587nMW46iaDg9ZD; claude/feature-status.md is retired) and docs/design-system. The spec is the source of truth. Every screen must meet WCAG 2.2 AA and the Apple guidelines in the checklist: 44pt targets, Dynamic Type through the shared Text component, VoiceOver labels and grouped elements, never color alone, Reduce Motion respected.

Rules:
- Branch from the latest main and touch only the files your scope owns. Don't edit claude/feature-status.md, claude/app-store-checklist.md, artifacts/mobile/app.json or shared components in components/ui.tsx unless your scope says so. List any needed changes in the PR description instead.
- New DB migrations get their own new file. Never edit an existing migration and never run db:push.
- Open one small PR per feature, with checks passing. Don't merge: the coordinator session does that.
- End each PR description with phone test steps I can follow, and say whether it needs a new development build.
- Tell me the cost before any service signup and prefer free tiers. Never ask me to paste secrets in chat; tell me where to put them.
- Only ask when a decision is truly mine: one question at a time, with your recommendation first.
```

Read `claude/beta-recording-and-release.md` in the Project (decisions B2, B3, B5 to B12, section 3 copy, section 4 release) before writing code. Those decisions are logged in the spec as decisions 84 to 99 (B1 = 84, B16 = 99). Work in Session D's files: `app/record/**`, `components/record/**`, `routes/{recording,trainingConsent}.ts`, `lib/db/src/schema/recordingConsent.ts`, plus a new `routes/feedback.ts` and `lib/db/src/schema/feedback.ts`. New migrations get new date-prefixed files.

Also running this wave: Session F (Discover) touches Settings and the Report sheet; Session G will later add court detection and the voice coach to the record flow on top of your work. Keep your record-flow changes self-contained so G can build on them.

Wave 2 rules that apply: selected chips have no check icon (filled `ink`, "selected" read by VoiceOver); every bottom sheet uses `components/Sheet.tsx`; the app only speaks while recording (decision 81); everything is free at launch (decision 82), so no paywall or Pro wording anywhere.

Build:
1. First-run carousel replacing ConsentScreen: page 1 "What Ball Boi records" (the three existing points), page 2 "Your choices" (training toggle with the exact TRAINING_COPY, plus the release checkbox when required), page 3 "Set up your phone" (graphic and checklist, ending in Open camera). Later recordings show page 3 alone unless "Don't show this again" was checked; a "Setup tips" link on the ready screen always opens it.
2. Release agreement: server settings BETA_RELEASE_REQUIRED and BETA_RELEASE_VERSION (on for the beta backend, off by default). Store release_version and agreed_at per account. When required and the stored version is older or missing, page 2 shows again with the box unchecked.
3. Opponent confirmation: on the ready screen for a match against a placeholder opponent, "[Name] agreed to be filmed." Start stays off until checked. Store the confirmation time on the recording session. Such matches may enter the labeled test set, never training.
4. Processing card: while no stat has passed its accuracy bar (statGates), show "Uploaded / Thanks. Ball Boi's shot tracking is still learning, so stats and your replay come in a later update. Your match is saved." instead of "Analyzing".
5. "Something not working?" form: options Recording stopped on its own; Upload is stuck; Camera or mic won't turn on; My match isn't there to record; Score didn't save; App froze or closed; Something else (opens a required text box). Optional note. Attaches app version, iPhone model, iOS version and the match when opened from a match screen. Saved server-side and sent to support@ballboi.tennis. Entry points: Settings, the ready-to-record screen, the processing card, the replay placeholder. Tell me the cost before using any email-sending service; prefer free.
6. Mic denied while camera is allowed: say so in text with an Open Settings button.
7. Retention while BETA_RELEASE_REQUIRED is on: keep beta footage until launch. Withdrawal (account deletion) deletes the tester's video within 30 days and emails support@ballboi.tennis the list of matches whose test-set copies John must delete locally.

Acceptance criteria (Do / Expect):
1. Do: first recording on a fresh beta account. Expect: three pages, "Page 1 of 3" read by VoiceOver, Next and Back plus swipe, no auto-advance.
2. Do: on page 2, try Next without checking the box. Expect: Next is off and "Check the box above to continue." shows as text.
3. Do: tap the release title. Expect: ballboi.tennis/beta-release opens; tapping the checkbox label doesn't open the link (separate 44pt targets).
4. Do: check the box and finish. Expect: the API stores version and date; the next recording skips pages 1 and 2.
5. Do: bump BETA_RELEASE_VERSION on the server. Expect: the next recording shows page 2 again, unchecked.
6. Do: check "Don't show this again" on page 3, record again. Expect: no setup page; "Setup tips" still opens it.
7. Do: start a Quick match against someone not on Ball Boi. Expect: the opponent checkbox shows and Start stays off until it's checked. A league mate's match shows no checkbox.
8. Do: upload a match on staging. Expect: the card reads "Uploaded" with the copy above, never "Analyzing".
9. Do: open the form from the processing card, pick "Something else" with an empty box, Send. Expect: an inline error; with text, a success message, a stored report with device details and the match, and an email to support.
10. Do: deny the mic only. Expect: a text message and Open Settings, not a silent failure.
11. Do: delete a tester account with recordings. Expect: its videos are queued for deletion within 30 days and support gets the test-set list.

Accessibility: every checkbox has a visible label VoiceOver reads with its state; checkbox and link are separate 44pt targets; disabled buttons explain why in text; nothing relies on color; carousel position announced; Reduce Motion swaps the slide for a fade; Dynamic Type at the largest size doesn't clip; the setup graphic has a text alternative and the checklist is real text.

PR rules:
- Before commenting "ready", load /impeccable and run `critique`, `audit` and `harden` on every screen you built. Fix what they find, and put the results in the PR.
- Quote the acceptance criteria the PR covers. Give each one the phone test step that proves it, and flag any you couldn't meet, with the reason.
- Show the flow screen by screen, including empty, error and loading states, at the largest text size and in Dark Mode. If you can't capture screens in your environment, say so and give John exact steps to see each state on his phone.
- Confirm there are no dead ends: every screen has a way forward and back, and every error has a recovery path.
- Say whether it needs a new development build.
- Comment "ready" on the PR when done, and don't push again after that comment.
