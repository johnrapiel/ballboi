# Wave 2, Session E: Labeling tool speed and new accuracy bars

From the footage review (Nov 7). Assigned by the Wave 2 coordinator to a Session E follow-up (Session E owns `artifacts/ml-server/**`). No app changes, nothing native.

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

Read section 5 and decisions B14 to B16 of `claude/beta-recording-and-release.md` in the Project (logged in the spec as decisions 97 to 99). Work in `artifacts/ml-server/labeling` and `artifacts/ml-server/evaluation`. Everything runs locally on John's Mac; no footage goes to any outside service. The tool is desktop-only, so "phone test steps" become "Mac test steps".

Build:
1. Jump to the next hit: J seeks to the next detected ball-hit sound after the current time, Shift+J to the previous one. Detect hits from the video file's own audio, locally, once per match, cached next to the labels.
2. Undo and redo with Cmd+Z and Shift+Cmd+Z for add, edit, bounce, delete and calibration. Then remove the delete confirm dialog.
3. Resume: reopening a match restores the last selected shot and video position.
4. Progress in the header: shot count, current time of total, suggestions left to check.
5. Shift plus S/F/B/V/O changes the selected shot's type; 1 and 2 set serve number. Add both to the keyboard panel.
6. Warn (not block) when a point ending sits on a shot that isn't followed by a serve.
7. Banner live region: polite, not assertive.
8. Eval: add bars to evaluation/bars.json and scoring in gates.py for point endings (85% correct), rally length (within 1 shot on 85% of points), first-serve % (within 5 points of truth) and placement (right zone 80%). Remove serve speed from launch stats.

Acceptance criteria (Do / Expect):
1. Do: open a match and press J repeatedly. Expect: each press lands within a few frames of a contact; dead time is skipped.
2. Do: add a shot, press Cmd+Z, then Shift+Cmd+Z. Expect: it disappears and comes back, and autosave keeps up.
3. Do: delete a shot. Expect: no popup; Cmd+Z restores it.
4. Do: label for a minute, close the tab, reopen the match. Expect: the same shot selected and the video at the same spot.
5. Do: select a forehand and press Shift+B. Expect: it becomes a backhand; no new shot added.
6. Do: put W on a mid-rally shot. Expect: a visible warning naming the shot.
7. Do: run the eval on the example labels. Expect: results for all seven stats with bars; serve speed is gone.
8. Do: use the tool with the keyboard only (except clicking bounces and corners). Expect: every action reachable, focus always visible.

PR rules:
- Before commenting "ready", load /impeccable and run `audit` and `harden` on the tool (Operate mode, speed over polish). Fix what they find, and put the results in the PR.
- Quote the acceptance criteria the PR covers, each with the Mac test step that proves it; flag any you couldn't meet, with the reason.
- Run the ML tests (`cd artifacts/ml-server && .venv/bin/python -m pytest`) plus `pnpm typecheck` and `pnpm test`, and say what passed.
- Comment "ready" on the PR when done, and don't push again after that comment.
