# Wave 2, Session F: Discover

Paste this whole brief into a new session titled **"Wave 2, Session F"**.

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

## What you're building

Discover: the tab where a player finds people and games near their zip, and turns that into a match. Five features, one stacked PR each, in this order:

1. **Players near you**, with the availability grid, Filters, player card, hidden profile and Report
2. **Open leagues**, with requests to join and the waitlist
3. **Court directory** and home court
4. **Set up a match in chat**: match cards, reminders, "Did it happen?", no-shows and reliability
5. **Open matches**, including Need 1 / Need 2, group chat and alerts

Read `claude/wave-2-flow-review.md` in the Project (decisions F1 to F14) before you start. Everything below comes from it.

## Design source

The **"Wave 2 designs"** page of the "Ball Boi iOS" canvas: https://claude.ai/artifact/LCm9Q9eKeRypqioMcTqDBU. Build from the `W2_` artboards. The "On TestFlight" page shows what's already built (match its patterns, components and tokens). Ignore the "Graveyard" page: it's out of date. Where a canvas screen and this brief disagree, this brief wins.

Canvas rows you build from: Players tab (with Night, largest text, loading, can't load, empty, hidden and invite states), Area, distance and filters (including "Filters · Times not set yet" and "When you can play"), Player card and reports (including both Report sheets), Set up a match in chat, Open matches, Open leagues, Settings and Edit profile.

## Scope and owned files

You own:
- Mobile: `app/(tabs)/discover.tsx`, `app/discover/**`, `app/courts/**`, `app/availability.tsx` (new), `components/discover/**`, `components/chat/MatchCard*` (new, the chat match cards), `hooks/useDiscover*.ts`, `hooks/useAvailability.ts`, `hooks/useCourts.ts`, `lib/discover.ts`, and the Report sheet `app/report/[playerId].tsx` with `hooks/useReportBlock.ts` (F9 changes the reasons for everyone).
- API: `routes/{discover,courts,openMatches,matchPlans}.ts`, `lib/{discover*,court*,openMatch*,matchPlan*,reliability}.ts`, `services/discover/**`.
- DB: `lib/db/src/schema/{courtDirectory,discover,openMatches,matchPlans,weeklyAvailability}.ts` and new `scripts/migrations/2026MMDD_f_*.sql` files.
- Shared, append-only (per the "Rules for every wave" in claude/waves.md): `openapi.yaml`, `routes/index.ts`, `schema/index.ts`, `accountDeletion.ts`.
- Small, named edits outside that list: the Settings › Discover entry in `app/settings.tsx`, the "When you can play" row in Edit profile, the match-card rendering hook in `app/conversation/[id].tsx`, and the Leagues tab's empty-state link to Open leagues. Keep each edit minimal and list it in the PR.

**Native owner this wave is Session G.** You add no native packages and don't touch app.json, eas.json or the privacy manifest. Push already works through `sendPushToUsers` in `routes/notifications.ts`: use it for alerts and reminders. Session G improves delivery (provisional auth, preview hiding); nothing you build waits on G.

**Start from the old drafts, don't merge them as they are.** #117, #118 and #119 (branches `claude/wave2-discover-h2xk7f*`) predate the Wave 1 restyle, palette, player search and Report changes. Reuse their API, data and tests where they still fit; rebuild every screen from the canvas. Close those three PRs, with a comment pointing to your new ones, once yours are open. Their migrations never ran on staging or production; replace them with new files of your own.

The old per-league, per-week availability (`playerAvailabilityTable`, `routes/availability.ts`) is from the Replit build. Leave it alone; don't drop it. The new grid is a separate, per-player weekly table.

## John's decisions (Nov 7)

- **F1** Three tabs at the top: Players, Open leagues, Open matches. Your area ("Near 12590, Wappingers Falls", Change) and distance chips with counts (5 / 10 / 15 / 30 mi, Custom) on each tab.
- **F2** Setting up a match happens in chat, as the canvas draws it. This replaces the spec's request with accept / counter / decline. To suggest a different time, a player sends a new card.
- **F3** The player card's More menu has **Report only**, with the "Also block [name]" checkbox. There's no Block action, no Block confirm and no Blocked players row. Filters is a bottom sheet by the sheet rule: no Cancel, left-aligned brush title, drag down to close, confirm before discarding changes.
- **F4** Court directory: a searchable list, nearest first ("Beacon Courts · ~3 mi"), with "Add a court" (name and address) when one is missing. No map. It opens from Settings › Discover › Home court and from the court field in Post an open match.
- **F5** **No travel mode.** Discover always searches from your zip. Location permission is used only for the zip shortcut.
- **F6** Need 1 / Need 2 is a tag on doubles open matches, not a section.
- **F7** Availability is an hour grid: Monday to Sunday, hourly from 6 AM to 9 PM, tap or drag to mark hours free. There's no week picker and no "Copy last week". The "When I usually play" chips are gone everywhere.
- **F8** The grid powers Discover only. You set it in Edit profile. Player cards show a short summary ("Free weekday evenings, weekend mornings"). Filters gets a "Free when I'm free" switch. League pairing doesn't use it.
- **F9** Report reasons, everywhere, in this order: Harassment or threats; Inappropriate photo or words; Spam; False scores or cheating; Unsafe at a match; Something else (opens a required text field). "Pretending to be someone else" is removed. There's no optional note on the other reasons.
- **F10** No handedness anywhere.
- **F11** No availability step in onboarding. Until a player sets times, the Players tab shows "Add when you can play to find players free when you are." with a "Set times" link. With no times set, the "Free when I'm free" switch is off and disabled, with "Set your times first." and a link.
- **F12** A disputed no-show ("That's not right") goes on neither card. Both players see "You two remember this differently, so we've left it off both cards." Each dispute is logged for moderators, so a pattern from one player shows up in the admin queue.
- **F13** "Played" counts every scored match against a real Ball Boi player (league, Discover or Quick match). "No-show" counts only Discover no-shows that were confirmed or went unanswered for 48 hours, never disputed ones. League "Not played" never counts as a no-show.
- **F14** Players list rows don't show free times.
- Also standing: level filter "Close to mine" is ±0.5 and "Wider" is ±1.0. Distances are always approximate ("~4 mi"), never an exact location. Blocked players never appear in either direction. Discover, match set-up and player cards are free, never Pro.

## From Wave 1, to build on

- When your Players PR merges, set `RESPECT_HIDDEN_PROFILE = true` (api-server `lib/playerSearch.ts`) and `MESSAGE_BY_USER_ID = true` (mobile `lib/playerSearch.ts`). Hidden players must also drop out of Quick match and New message search.
- Block lives inside Report (finding 20). Unblock is a small link in a blocked chat. There are no Message Requests (finding 17). A first message from someone outside your leagues still can't contain a phone number or email.
- Every bottom sheet uses `components/Sheet.tsx`. Don't put a horizontal ScrollView directly inside a hugging sheet (see `ScoreGrid.tsx`).
- Selected chips have **no check icon**: a filled `ink` background with `on-ink` text, `accessibilityState={{ selected: true }}`, and "selected" read by VoiceOver.
- Light is forced in app.json. Build and check both Day and Night anyway: Night arrives with Session H's Appearance setting.
- Staging resets messages when the API sleeps. Use the "Seed staging data" workflow only when the coordinator says so.

## Design review findings to address

From the coordinator's critique of the canvas and the shipped app:
1. Unselected chips, empty grid cells and the off switch must show a visible outline (`hairline-strong`, 3:1 against the ground). The canvas once lost these to a style reset; don't repeat it in code.
2. Long right-aligned values in list rows ("Free · Weekday evenings, weekend mornings") wrap under their label without overlapping it, at every text size.
3. The segmented tabs (Players / Open leagues / Open matches) use the iOS segmented control or match it exactly, scale with Dynamic Type, and stack or scroll rather than truncate at the largest sizes.
4. The grid's evening rows sit below the fold. Save stays pinned. VoiceOver reads each cell as "Monday 6 PM, free" or "not free", and each row has a whole-row toggle as a non-drag alternative.
5. Count chips ("10 mi · 14") read as "10 miles, 14 players, selected".
6. The "Free when I'm free" switch with no times set is disabled and says why in text. VoiceOver reads "Free when I'm free, dimmed. Set your times first."

## Acceptance criteria

Each line is a check John can do on his phone. Use the walkthrough accounts (A, B, C, D) from the staging seed, all in the same zip unless a step says otherwise.

### 1. Players near you

1. **Do:** open the Discover tab. **Expect:** the brush title "Discover", Messages at top right, "Near [zip], [town]" with Change, three tabs with Players selected, and distance chips 5 / 10 / 15 / 30 / Custom with a count on each and 10 mi selected.
2. **Do:** read the list. **Expect:** nearest first, then closest level. Each row shows photo or initials, name, level pill, "~N mi", Singles / Doubles / Both, and "Played N · N no-show(s)" or "New to Ball Boi". No exact location anywhere.
3. **Do:** tap 30 mi, then Custom. **Expect:** the list and counts update. Custom opens a sheet with a slider (1 to 30 mi) and a typed value as a non-drag alternative.
4. **Do:** tap Change and enter a new zip. **Expect:** the list reloads for that area, and your home area saves. **Do:** enter "00000". **Expect:** "We couldn't find that ZIP. Check it and try again." Nothing changes.
5. **Do:** open Filters. **Expect:** a sheet by the sheet rule with Level (Close to mine / Wider / Any, the range spelled out), Plays (Singles / Doubles / Either), "Free when I'm free", Reset, and "Show N players" with a live count. Close it with changes made. **Expect:** "Discard changes?"
6. **Do:** with no times set, open the Players tab and Filters. **Expect:** the "Set times" card on the tab, and in Filters the switch disabled with "Set your times first." and a link to the grid.
7. **Do:** Set times, mark Mon to Fri 6 to 9 PM by dragging and Saturday 8 AM by tapping, then Save. **Expect:** "N hours free" updates as you go, the card disappears, and the summary shows in Edit profile and on your player card. Reopen the grid. **Expect:** your hours are kept. There's no week picker.
8. **Do:** turn on "Free when I'm free". **Expect:** only players whose hours overlap yours.
9. **Do:** tap a player. **Expect:** the player card: brush name, level, "Fishkill · ~4 mi away", Record / Played / No-shows, Plays, Free (if set), Home court (if set), and "Set up a match" at the bottom. Back returns to the list where you left it.
10. **Do:** More (•••) on the card. **Expect:** an action sheet with "Report [name]" and Cancel only.
11. **Do:** Report, pick "Something else". **Expect:** "Tell us what happened" appears, and Send report stays off until it has text. **Do:** tick "Also block", then send. **Expect:** "Send report and block" (red), then confirmation. The player vanishes from Discover, search and pairing for both of you, and messages stop both ways.
12. **Do:** check the reasons in the Report sheet from a chat message, a league player and Discover. **Expect:** the same six reasons in F9's order everywhere.
13. **Do:** Settings › Discover, turn off "Show me in Discover". **Expect:** account B no longer finds you in Discover, Quick match or New message search. Your Players tab shows the "You're hidden" state with a way to turn it back on. Leagues and Ball Boi work as before.
14. **Empty:** with nobody within 5 mi. **Expect:** "No players within 5 mi", plus Widen to 15 mi, Post an open match, and Invite a friend (iOS share sheet with your invite link).
15. **Loading and error:** **Expect:** the drawn skeleton rows while loading. With airplane mode on: "Can't load players" and Try again, which works once you're back online.
16. **Accessibility:** at the largest text size, rows wrap without clipping and the tabs stay usable. VoiceOver reads each row as one element ("Sam Whitfield, level 3.5, about 4 miles away, singles, played 14, 1 no-show"). Every control is 44pt or larger. Night mode passes contrast.

### 2. Open leagues

17. **Do:** Open leagues tab. **Expect:** cards nearest first with name, distance, format, level range, start date and spots left, plus the fee line when there is one. Tags with icon and text for "Outside your level", "Full" and "Season started".
18. **Do:** open a league with spots, tap "Request a spot", add an optional note, and send. **Expect:** "Request sent" on the card and the league. The admin (account B) sees it in Manage and can approve or decline. Approved, you land in the league. Declined, you see it plainly with a way back to Discover.
19. **Do:** open a full or started league. **Expect:** "Join the waitlist for next season". Joining shows "On the waitlist" with a Leave waitlist option.
20. **Do:** open a league outside your level. **Expect:** the "Outside your level" note, and requesting still allowed.
21. **Do:** Leagues tab with no leagues. **Expect:** "Find an Open league", which opens this tab.
22. **Empty, loading, error and accessibility:** same standard as items 14 to 16.

### 3. Court directory

23. **Do:** Settings › Discover › Home court. **Expect:** a searchable list, nearest first ("Beacon Courts · ~3 mi"). Picking one saves it and it shows on your player card.
24. **Do:** search a court that isn't listed, then "Add a court" with a name and address. **Expect:** it's added, picked and findable by others. A bad address shows a plain error you can fix.
25. **Do:** Post an open match › Court. **Expect:** the same list, and "Court not set" allowed.
26. **Accessibility:** search field labelled, rows 44pt, largest text wraps.

### 4. Set up a match in chat

27. **Do:** on B's player card, tap "Set up a match". **Expect:** a chat with B. Add a match card with day, time, court and Singles or Practice hit, then send. **Expect:** B sees "Add this match?" with "I'm in" and "Can't make it". You see your card waiting.
28. **Do:** as B, tap "I'm in". **Expect:** both see "Match added" with the details, and it appears in both players' Home and My matches. You get Undo for a short while.
29. **Do:** send a second card with a different time. **Expect:** the first card shows as replaced. Only the latest one can be accepted.
30. **Do:** the day before (use the dev time controls). **Expect:** "Still on for tomorrow at 6 PM?" in the chat with "I'm in" and "Can't make it". No answer means still on. A reminder arrives 2 hours before.
31. **Do:** "Can't make it", then confirm. **Expect:** the match comes off both schedules and the other player gets a message. It never counts as a no-show.
32. **Do:** 3 hours after the match with no score. **Expect:** "Did it happen?" with Enter the score, They didn't show, and We didn't play. Entering a score works like any match: the first score stands, with the 24-hour edit.
33. **Do:** "They didn't show", then confirm. **Expect:** B sees "John says you didn't show" with a 48-hour deadline and three answers. Unanswered after 48 hours, the no-show goes on B's card.
34. **Do:** as B, "That's not right". **Expect:** both see "You two remember this differently, so we've left it off both cards." Neither card changes, and the dispute is logged for moderators.
35. **Do:** check reliability on both cards after each case. **Expect:** it follows F13 exactly.
36. **Blocked or hidden:** if B blocks you mid-thread, cards stop and the chat follows the blocked-chat rules.
37. **Accessibility:** each card is one VoiceOver element with its actions as buttons, and every system message is read in order.

### 5. Open matches

38. **Do:** Open matches tab. **Expect:** "Post an open match", then cards with date and time window, format, level range, court, distance, poster and a Need tag for doubles. Your own posts are marked "Your post".
39. **Do:** Post an open match with a date, time window, court, format (Singles or Doubles with 1 to 3 spots), level range and an optional note. **Expect:** it appears in the list. A time already passed shows "That time has passed. Pick a later time." and stays on the form.
40. **Do:** as B, open your post and Join. **Expect:** "You're in, waiting to fill" while spots remain. When the last spot fills, everyone moves into a group chat that opens automatically, and the match appears on Home for all of them.
41. **Do:** as C, join a match that just filled. **Expect:** "This spot just filled" with a way back to the list.
42. **Do:** as a joiner, Drop out. **Expect:** a confirm, then the spot reopens and the poster is told.
43. **Do:** as the poster, remove a player (from Players in the group chat). **Expect:** a confirm, and the removed player sees "This match filled up", never "removed".
44. **Do:** as the poster, Cancel the match. **Expect:** a red confirm, then everyone is told and it leaves the list.
45. **Do:** "Get alerts for new posts" and turn alerts on. **Expect:** new posts near you that fit your level arrive as notifications, at most 2 a day. With notifications denied, a one-line note links to iOS Settings.
46. **Empty, loading, error and accessibility:** the "None nearby" state offers Post an open match and Widen. Otherwise the same standard as items 14 to 16.

### Across all five

47. Every screen has a way back. Every error has a recovery. Nothing dead-ends.
48. Account deletion removes your availability, posts, joins, match cards, court additions and reports you filed (keeping moderator snapshots), each in its own helper.
49. `pnpm typecheck` and `pnpm test` pass, with tests for distance bounds, level ranges, overlap matching, F13 counting, the 48-hour no-show and dispute rules, and the 2-a-day alert cap.

## PR rules

- Before commenting "ready", load /impeccable and run `critique`, `audit` and `harden` on every screen you built. Fix what they find, and put the results in the PR.
- Quote the acceptance criteria the PR covers. Give each one the phone test step that proves it, and flag any you couldn't meet, with the reason.
- Show the flow screen by screen, start to finish, including empty, error and loading states, at the largest text size and in Dark Mode. Put each screen next to its canvas screen and call out differences. Use simulator screenshots or a short screen recording. If you can't capture screens in your environment, say so and give John exact steps to see each state on his phone.
- Confirm there are no dead ends: every screen has a way forward and back, and every error has a recovery path.
- Say whether it needs a new development build. (It shouldn't: Session F adds nothing native.)
- Comment "ready" on the PR when done, and don't push again after that comment.
- End commit messages and PR bodies with the attribution lines your session gives you.
