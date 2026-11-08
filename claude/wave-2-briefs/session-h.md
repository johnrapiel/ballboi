# Wave 2, Session H (part 1): Home, Profile and player cards

Paste this whole brief into a new session titled **"Wave 2, Session H"**.

## Who you are

You're a Wave 2 build session for Ball Boi (repo `johnrapiel/ballboi`, iOS tennis app, Expo SDK 58). Read `CLAUDE.md` first and follow it:
- plain-English PR descriptions, no em dashes
- one feature per PR
- never push to main
- run `pnpm typecheck` and `pnpm test` before calling a PR ready

Don't merge anything: the Wave 2 coordinator reviews and John merges. After opening each PR, subscribe to its activity. Beta testers get every merge to main as an over-the-air update, so each PR must be complete on its own: nothing half-built may show.

John is the owner and a product designer, not an engineer. Lead with outcomes.

## Scope: three stacked PRs, in this order

Session H's full scope in `claude/waves.md` also has Replay, trends, league chat, career stats, milestone animations and Light/Dark Mode. **Those are not in this brief.** They haven't had their flow review with John yet. This part covers only what John has decided (spec decisions 137 to 140, plus his Nov 8 match history call).

Open each PR against the previous one's branch (a stack; the coordinator merges stacks with merge commits).

### PR 1. Home shows only upcoming matches (spec decision 137)

Home answers one question: what's next for me.

**Keep:**
- The header: the roundel top left and the glass Messages button top right (button standard, #178).
- The Notifications off line (decision 125).
- Anything waiting on you: pairings to review, a match card to answer, the bye notice.
- Every upcoming match: league, playoff and Discover, in date order in one list under **"Upcoming matches"**, with **See all**. "This week", "Next match" and "Today's match" headings go.
- The first match is the D2 card (`NextMatchCard`): date line, big serif time, both faces, "You vs. [name]", court, league pill.
  - On match day, singles leads with **Record with Ball Boi**, then Message and Details. Any other day: Message and Details.
  - Doubles shows Record dimmed with the reason, as today.
- Later matches are plain rows: "Sat, Nov 14 · 9:00 AM" over "vs. Priya Shah · Discover", or "Play by Sun, Nov 15" when no time is set. Each row opens Match detail.
- Pull to refresh, and refresh on focus.

**Remove from Home:**
- Season stats (`SeasonStats`)
- Your leagues and league standings (`HomeLeagues`)
- Recent results
- Any completed match or "Score entered" card

Standings live on the league page and results on Profile. Remove components only if nothing else uses them.

**See all:** opens the existing My matches screen (Upcoming tab) in this PR. PR 2 repoints it to Profile.

**Empty state:** with no upcoming match and nothing waiting, keep today's large roundel empty state. Its message mustn't promise standings or results on Home.

**Design:** canvas "Wave 2 designs" page, row "Draft (Nov 8) · Home as Upcoming matches, Profile as your player card", artboard `W2_HomeUpcoming`.

### PR 2. Profile is your player card (spec decisions 138 to 140)

**Order, top to bottom:**

1. **Header:** the title "Profile" in the 50% ink serif title style. Glass Settings and Messages buttons top right (button standard).
2. **The card (design D, Portrait):**
   - a court drawing across the top and the photo (initials fallback) overlapping it
   - the name in **full ink** Cormorant (#181: names are never the faded title style)
   - a "Level 3.5" pill (no "Self-rated", decision 140) and a Plays pill ("Singles", "Doubles" or "Singles and doubles")
   - the town
   - a bottom row with the home court on the left and **Free times** on the right
   - a pencil (top right, 44pt) that opens Edit profile
   - VoiceOver reads the card as one element ("Your player card. John Rapiel, level 3.5, singles, Wappingers Falls. Home court Beacon Courts.") with the pencil and Free times as separate controls
   - the card holds only what the player entered
3. **This season:** Record, Played, Streak, No-shows in one row (one VoiceOver group). Played and No-shows follow F13.
4. **Ball Boi this season:** with See all opening this season's Ball Boi recordings (the Ball Boi tab's list, filtered to this season). Show a stat only when its source already ships and passes its accuracy bar (G1). Don't invent numbers. If no stat qualifies yet, show how many matches were recorded this season, and say so in the PR so John can check it. Hide the module if there are no recordings.
5. **Your matches:** light text tabs, **Upcoming matches** and **Results**, with no "My matches" heading.
   - Upcoming rows match Home's rows.
   - Results show W or L, as today, and open Match detail.

**Free times:** a new brush grid icon. Add it to `scripts/design/brush-icons.py` and regenerate; the canvas draws one inline. It opens a read-only sheet of the Monday to Sunday hour grid (`W2_FreeTimesSheet`), with Edit on your own card opening the grid editor. Sheet rules: left-aligned 50% serif title, drag down to close.

**Edit profile** (`W2_EditProfile`): one screen of rows behind the pencil: photo, name, level (row keeps "Self-rated"), home area, plays, free times, home court. Reuse `app/profile/edit/*` and the existing editors.

**Sign out moves to Settings.** Put it above Delete account, with a confirm.

**My matches stops being its own screen.**
- Home's See all opens Profile scrolled to the Upcoming matches tab.
- `/matches` (and any deep link or push to it) redirects to Profile on the right tab.
- Remove the old screen.

**Design:** artboards `W2_ProfileCard` (card D), `W2_ProfileResults`, `W2_EditProfile`, `W2_FreeTimesSheet`. Variations `W2_PlayerCardA` to `D` are reference only.

### PR 3. Other players' cards: card D plus their matches

**Discover's player card** (`app/discover/player/[userId].tsx`) becomes the same card D (decision 139: "the same card everywhere, Discover included").
- Distance next to the town.
- More (•••) with Report, as today.
- "Set up a match" pinned at the bottom.
- This season's Record, Played, Streak, No-shows below the card.
- No pencil, and Free times has no Edit.

**Their matches (John, Nov 8, option C):** below This season, the same **Upcoming matches** and **Results** tabs as your own Profile.
- Upcoming rows read like yours (date and time, opponent, league or Discover). A court shows only where your own list would show it.
- Results show both names with the **winner mark** (`WinnerNames`, #179) and the score only, from the winner's side, with RET or W/O tags.
- **Head-to-head:** when you've played them, show one line above the tabs, e.g. "You and Priya: 2-1", read in full by VoiceOver.

**Privacy rules:**
- A player who blocked you, or whom you blocked, never shows (blocking already hides the card).
- Hidden profiles stay hidden.
- A Quick match isn't on someone's card until they answered Yes to "Was that you?" (G2).
- Placeholder opponents (not on Ball Boi) show by name with no link.
- Cancelled matches never show.

**API:** add what's needed under `/api`, in the right domain router, in `lib/api-spec/openapi.yaml`. Run codegen. Add vitest coverage for every privacy rule above, using the mocking pattern in `CLAUDE.md`. Use no migration unless you must; if you do, it must be idempotent and date-prefixed.

**Spec:** add decision row 143 to `docs/product-spec.md`: "Other players' cards show their full match history: Upcoming matches and Results tabs like your own Profile, with the winner mark and head-to-head. Blocks, hidden profiles and unconfirmed Quick matches stay out (John, Nov 8)". Update the Profile and player card section and the privacy table to match, and `docs/app-store-checklist.md` if a row changes.

**Design:** no canvas screen for this one. Build from card D and the Profile tabs; John reviews it in the PR.

## Rules every PR follows

- **Tokens only** (`paper`, `linen`, `sand`, `ink`, `ink-muted`, `on-ink`, `court`, `danger`). Day and Night, Increase Contrast and Bold Text via `useColors` and `Text`. Use `Text` and `TextLink`, never raw React Native `Text`.
- **Titles:** page and sheet titles are Cormorant at 50% ink (`headingL` 30 / `headingM` 24). Player names are always full ink.
- **Button standard (#178):**
  - screen corners: glass circles (`CornerButton`)
  - icons inside the page: plain brush icons, 44pt tap area, ink dot when on
  - actions with words are Buttons
- **Brush icons only** (`<Icon name="..." />`). No SF Symbols or icon libraries, and no emojis.
- **Accessibility:**
  - 4.5:1 contrast (3:1 for 24px+ text and controls) in both themes
  - color never the only signal
  - 44 x 44pt targets
  - Dynamic Type on; check the largest size
  - Reduce Motion respected
  - an `accessibilityLabel` on every interactive element
- **Plain words, one name per thing:** Profile, Upcoming matches, Results, Edit profile, Free times, Settings, Sign out.
- **Tests:** mobile tests cover pure helpers only (vitest in Node, in `artifacts/mobile/lib/__tests__/`): row labels, date lines, head-to-head text, tab routing. API tests go in `artifacts/api-server/src/__tests__/`.

## Each PR description

- what changed, in plain English
- the spec decisions and canvas artboards it implements
- the checklist rows it touches
- how John tests it on his phone, step by step: Day and Night, the largest text size, and VoiceOver on the card

When all three PRs are open, report back with their numbers.
