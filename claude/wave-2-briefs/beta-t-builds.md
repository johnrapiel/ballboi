# Wave 2, Session T: Send every new build to beta testers

From the footage review (Nov 7), decision B4 (spec decision 87). Assigned by the Wave 2 coordinator to a small pipeline session (T for TestFlight).

**Where the pipeline lives:** `artifacts/mobile/.eas/workflows/testflight-staging.yml` on `main` (added in #121, pointed at the App Store record in #128, newest-merge-only in #131), with notes in `docs/testflight-builds.md`. You own those two files only. Session G is this wave's native owner: don't touch `app.json`, `eas.json` or native packages. If the step truly needs an `eas.json` change, stop and list it in the PR instead.

```
Project: Ball Boi (github.com/johnrapiel/ballboi). Before writing code, read docs/testflight-builds.md, docs/app-store-connect.md, claude/beta-recording-and-release.md (in the Project) and claude/run-ball-boi-locally.md (in the Project).

Rules:
- Branch from the latest main and touch only the files your scope owns. Don't merge: the coordinator session does that.
- Tell me the cost before any service signup and prefer free tiers. Never ask me to paste secrets in chat; tell me where to put them.
- Only ask when a decision is truly mine: one question at a time, with your recommendation first.
```

Decision B4: testers are TestFlight external testers invited by email, and every new staging build goes to their group automatically. Add a step to the existing pipeline that adds each new build to an external TestFlight group named "Beta players". Use an App Store Connect API key stored in the pipeline's secrets (EAS secrets or the existing credential, whichever the workflow already uses); give John exact click-by-click steps to create it and where to paste it, never in chat. Tell him the cost first (expected free). Write the steps for inviting a tester by email and for Apple's one-time beta review, and add them to `docs/testflight-builds.md`.

Note: builds also go out as over-the-air updates for JavaScript-only merges. Say plainly whether external testers get those updates too, and how.

Acceptance criteria (Do / Expect):
1. Do: merge a small change to main. Expect: the new build appears in the "Beta players" group without John clicking anything.
2. Do: John invites a test email. Expect: an Apple invite email arrives; installing TestFlight then Ball Boi works.
3. Do: check the build's backend. Expect: it points at the private staging API, not production.
4. Do: a pipeline step fails. Expect: John is told plainly and testers keep the last good build.

PR rules:
- Quote the acceptance criteria the PR covers, each with the step that proves it; flag any you couldn't meet, with the reason.
- Run `pnpm typecheck` and `pnpm test` and say what passed.
- Say whether it needs a new development build (it shouldn't) and whether it uses one of the 15 monthly iOS builds to test.
- Comment "ready" on the PR when done, and don't push again after that comment.
