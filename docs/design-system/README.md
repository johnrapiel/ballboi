# Ball Boi

Rec leagues, done properly.

Ball Boi is a tennis app with heritage manners. Think Wilson's navy restraint, with the hand of a painter: brush ink and a hand-drawn ring. Everything is built from the roundel's navy brush ink, set on a clean ivory ground by day and warm charcoal at night.

## Principles

- **One ink.** Navy does almost everything: text, buttons, rules, the ring, every shape. If a screen looks good in navy and ivory alone, it's done.
- **Color is rare.** `court` green appears only when something good or live needs saying. Most screens use none. `danger` appears only for destructive actions and errors.
- **Leaving is quiet.** Destructive actions are red and confirmed. Leave league, Cancel match and Drop out are not filled or outlined buttons: each is a `danger` text action with a brush icon (`door.leave` to leave, `xmark.circle` to cancel) at the bottom of the page content, not pinned, like Cancel account on many sites, 44pt to tap, confirmed by an alert. In the app this is `DangerLink` (`LeaveAction` wraps it with the door) (decision 184, John, Nov 12).
- **Clean ground, not glass.** An ivory page with white cards by day, warm charcoal at night, no grain (John, Nov 6). No gradients, no glassmorphism, no neon. The one glass is Apple's own Liquid Glass on the tab bar and the screen-corner buttons (see Buttons and icons).
- **Hand-made, not decorated.** The brush headers, the ring, the painted ball and the roundel carry the brushwork. Never more than one motif per screen.
- **Hairlines over shadows, one rule for every card.** Every card and module, the Next match card included, is a white `linen` fill on a 1px `hairline` border with a 16px corner (`radius-card`). No borderless cards and no card shadows (John, Nov 7). `hairline` is light on purpose (10% ink by day, 10% ivory at night), so a border reads without feeling heavy. The Next match card keeps more padding and centres everything. Only floating things (sheets, menus) and the selected segment of a segmented control get a shadow.
- **Serif for the page and the moment, sans for the work.** Page and sheet titles are Cormorant Garamond in ink at 50%, quiet like a watermark (John, Nov 7; replaces the Nanum Brush Script titles). Cormorant at full ink carries scores, ranks, records, section headings and card titles. DM Sans carries everything you tap or read in a list. The roundel keeps its own brush lettering.
- **Generous, never crowded.** Default to `space-6` between cards and `space-12` above heroes.

## Voice

Plain, confident, warm. Short sentences. Tennis words used correctly. No jokes in instructions.

| Instead of | Write |
| --- | --- |
| Submit score | Record score |
| No matches found | No matches yet. *Find a hit nearby.* |
| Match completed successfully | Game, set, match. |
| Error: invalid input | That score can't happen in tennis. Check the tiebreak. |

The italic display style (`title-italic`) is the quiet flourish. Use it for one line in an empty state or a celebration, never for instructions.

## Color

| Token | Role |
| --- | --- |
| `ink` | Text, primary actions, the ring, the painted ball (the logo's brush) |
| `ink-muted` | Meta and secondary text |
| `paper` | Page ground: ivory by day, warm charcoal at night. No grain |
| `linen` | Cards, sheets, the tab bar: white by day, lifted charcoal at night |
| `sand` | Light stone: sunken wells, zebra rows, your own row, avatars, the segmented control's track. Never a pill or chip fill |
| `on-ink` | White on navy: button labels, the app icon's ball |
| `court` | The one accent. Wins, confirmations, live, and links that change a match. Sparingly |
| `danger` | Destructive and errors only |

Night session (dark) is warm charcoal with ivory ink, the dark match for the ivory Day (John, Nov 6; replaces harbor navy). Navy stays the brand ink in Day. Same rules apply. Every text pair clears 4.5:1 in both themes. `court` and `danger` are text-safe on `paper`, `linen` and `sand`.

Retired in this refresh: `pool` (teal), `clay` (terracotta) and `sun` (yellow). Live matches move to `court`, links and wins to `court`, the focus ring to `ink`. Two exceptions John approved (Nov 5) and kept as rules (Nov 6): Ball Boi Replay and Replay stats keep the original camera court, with the teal court from above, winners in `pool` or `court`, the ball in yellow and errors in `clay`, each with its own shape; and the Rec pill on the recording screen stays clay. Nowhere else uses them.

### Every color job has a shape

`court` is only 2.0:1 against `ink` text, and `court` and `danger` share a lightness (a red-green pair). So color never carries a meaning alone:

| Job | Cue besides color |
| --- | --- |
| Link in a sentence | Underlined (`TextLink`), in both tones: an ink link is the same color as the words around it, and a green one is only 2:1 against them. Standalone links on rows and buttons need no underline |
| Live | The filled `court` chip with its dot |
| Win or confirmation | The word or letter. In condensed lists (Player detail, My matches, Home results) a `W` in `court` in an outline pill, with no icon. Elsewhere a check and the word ("Won") |
| Error or loss | The word or letter. In condensed lists an `L` in `danger` in an outline pill, with no icon. Elsewhere a cross and the word ("Not sent") |

Never put `court` and `danger` side by side as the only difference between two things.

### Links

Two kinds of text link, one look each (decision 201, John, Nov 12, Wave 2 finding 56). `TextLink` has a `tone` for each, so no screen picks a link color itself:

- **Navigation and settings** (the default, `tone="link"`): `ink`, underlined. See all, See match, Change in Settings, the Discover area link, Invite a friend, Post an open match (as a link), a player's name on a league line, Add home court, Unblock, links in messages.
- **Actions on a match** (`tone="action"`): `court` green, underlined. Links that change something on a match: Set a match time and Change time (`MatchTimeLink`), Match didn't finish?, Enter score and Enter result on a round or bracket. `court` clears 4.5:1 on `paper`, `linen` and `sand` in Day and Night (`scripts/check-contrast.mjs`).

A hand-built underlined label that can't be a `TextLink` (it sits in a `Pressable` with its own 44pt target) takes its color from `textLinkColor(tone)`, so it stays one of the two. Each link's 44pt target comes from hitSlop (decision 192).

### Increase Contrast

When iOS Increase Contrast is on, `ink-muted`, `hairline` and `hairline-strong` switch to their `-hc` tokens. Every screen gets this through `useColors`; nothing to do per screen.

## Type

- **Headings:** Cormorant Garamond 500 in ink at 50% (John, Nov 7). `heading-l` (30px) for tab headers and big screen titles: onboarding step titles, milestone titles. `heading-m` (24px) for sheet titles like Enter score and the title on a pushed detail screen (a league, a player, Messages, Invite players), under its back button. At 50% they measure 3.2:1 by day, which passes AA only because they're large: never set them below 24px, and never use the 50% ink for anything smaller. With Increase Contrast they show at full ink. They go one weight heavier at night, like all Cormorant. Never for buttons, body, scores, or the small title in a top bar (that stays DM Sans 600). **Never for a player's name** (John, Nov 8): a name is always full ink, even when it's the screen's title (the player card, "You vs. Sam Patel"); use `title` (Cormorant 600, 26px, full ink) instead, so a person never looks faded or disabled.
- **Display:** Cormorant Garamond 500/600, italic 500. Upright `title` (26px) for section headings and card titles, `score` (44px) for hero scores, `score-row` (30px) for set scores in cards and grids and big stat values. Rank numerals and records in tables sit at 22px. Italic only for the quiet flourish, seeds in the bracket and Champion. Never below 20px: its hairline strokes vanish at small sizes.
- **Text:** DM Sans 400/600. Body, buttons, labels.
- **Body is 17px**, the iOS body size. Small is 15px, buttons 16px.
- **Scores always use** `font-variant-numeric: lining-nums tabular-nums` so sets line up.
- **Section labels** over a list or a group (Next match, Past leagues, Your rank) are `section`: 13px DM Sans 600, sentence case, `ink-muted`. They replace the uppercase eyebrows on the approved screens. So does every heading over a field or control (decision 200, Wave 2 finding 52): a text field's label (Name, Email, Code, ZIP code, Miles, Their name, Area, Address; `Field` uses `section` by default), and the headings over chips, toggles and pickers (Discover filters' Distance, Level and Plays; Photo; Birthday; I play).
- **Labels** are 11px uppercase with 0.16em tracking: the heritage tag on a racquet throat. 11px is the iOS floor, so they're for the rare eyebrow, table header and badge only, never over a field or control.
- **Pills and chips.** Plain pills (level, hand, format, status words like Active and Done) are `pill`: 13px DM Sans 500, sentence case, outline only in `hairline-strong`, never filled. A level is the plain number, "3.5", with no Self-rated label until a verified source exists. Only You, Live and Rec stay filled, in the uppercase 12px `chip` style.
- **Segmented controls** use the iOS native size: a `sand` track with 2px padding and a 9px corner, 32pt segments in `segment` (13px DM Sans 600), the selected one on `linen` with a soft shadow. Each segment keeps a 44pt hit area, so the 44pt touch rule still holds (John, Nov 6).
- The roundel itself is never retyped in the brush font. Its lettering is hand-painted and lives only in the image.

### Dynamic Type and display settings

- **Text styles scale fully** with the user's text size. Layouts reflow; nothing truncates.
- **Display and brush styles stop at 1.5x**, so headers, heroes and scores never clip.
- **Bold Text:** every style goes one weight heavier (DM Sans 400 to 600, 600 to 700; Cormorant 500 to 600, 600 to 700).
- **Night session:** Cormorant goes one weight heavier, because light hairlines thin out on a dark ground.
- **The brush font has one weight,** so Bold Text and Night session leave it as is. Its strokes are already heavy enough for both.

## Charts and replay

The replay and stats stay inside the one-ink palette. No literal grass green, no rainbows.

- **Court surface:** `sand`, with `ink` lines at 1.5px, for heatmaps and small diagrams. Ball Boi Replay and Replay stats use the original court colours (see Color).
- **Players:** you are a solid `ink` circle, your opponent a hollow `ink` ring. Shape tells them apart, never color.
- **Shot outcomes:** winners get a check in `court`, errors a cross in `danger`. Rally shots are small `ink-muted` dots.
- **Close call:** a dashed `ink` ring plus the words "Close call". Never a color on its own.
- **Heatmaps:** `heat-1` to `heat-5`, one ink in five steps on `sand`. Every bin shows its count or percent as text: `ink` on `heat-1` and `heat-2`, `on-ink` from `heat-3` up.
- **Trend lines:** `ink` at 2px. A second series is a dashed `ink-muted` line with its label at the line's end.
- **Every chart** has a one-line text summary for VoiceOver and an accessible table behind it.

## Signature motifs

Pick one per screen. Brush headers are type, not a motif, so a screen with a brush header can still use one of these.

1. **Brush ring.** The logo's hand-drawn circle, wrapped around the single thing that matters: your rank in standings, Champion in the bracket. (Match winners now get the brush underline instead; see The winner mark.) Milestone badges (decisions 149 and 150) are the brush ring around the milestone's own brush icon (`milestone.firstwin`, `milestone.ballboi`, `milestone.streak5`, `milestone.streak10`), in `ink`: 32pt on the player card, 44pt on Career, 112pt in the milestone moment, where the ring draws itself around the icon (`MilestoneBadge`). Pending John's review in the Milestones PR; no canvas design yet.
2. **Painted ball.** The app icon's hand-painted ball, in `ink` on paper or `on-ink` on an ink field. One, large, in a hero, the splash or a celebration. Never as a repeating pattern. Its paint fills the selected tab's brush icon (John, Nov 5, kept as a rule Nov 6); that's the only place it appears in color, and the tab bar doesn't count toward a screen's one motif.
3. **Roundel.** The logo itself, cropped to its circle, in the places listed under Logo. Decorative to VoiceOver.

The paper grain is retired (John, Nov 6): on ivory and charcoal it reads as dirt, not paper. `.bb-grain` stays in the stylesheet as a plain `paper` ground so older screens don't break.

### The winner mark

One rule wherever a finished match shows both players (John, Nov 8): the league Matches list, the playoff bracket, Match detail and Correct a score.

- The winner's name is bold, in `ink`, with a hand-drawn brush underline: one tapered stroke a little below the text, firm at the start and lifting off thin at the end, stretched to the name's width. It's never a straight text underline, so it never reads as a link. The stroke is drawn in `scripts/design/brush-icons.py` (`winner.underline`, on a 100 × 8 grid) and lives in the app as `BRUSH_MARKS`; the source is `icons/ui/winner.underline.svg`. In the app: `WinnerNames` and `MarkedName` (`components/WinnerNames.tsx`).
- The loser's name is regular weight in `ink-muted`.
- The line under the names is only the score, from the winner's side, with tags for a retirement and a walkover: "6-3, 2-1 · RET", "W/O". No "X won" on screen.
- A match that wasn't played: both names regular in `ink-muted`, and "Not played". A cancelled match is the same, with "Cancelled". A match still to play: both names regular in `ink`.
- VoiceOver reads "[A] versus [B]. [Winner] won [score]" ("Brianna Scott won by walkover", "Diego Alvarez won 6-3, 2-1, Jamal Wright retired"). Bold weight and the underline carry the winner together, so it's never color alone.
- Your own Results (My matches) keep their W and L letters.

## Shape and space

- Radius: `radius-pill` (999px) for buttons, chips, pills and avatars. `radius-card` (16px) for every card. `radius-md` (10px) for wells, inputs and small panels, `radius-lg` for sheets.
- Spacing steps: 4, 8, 12, 16, 24, 32, 48. Page gutter `space-4` on phones, `space-6` up.
- **Card padding: one token, equal on all sides** (decision 192, John, Nov 12). Cards, banners and notices use `space-4` on every side, so the space above the first line matches the space below the last. The hero cards in Home's match slot (Next match, bye week, pairings to review) keep `space-6`, also equal on every side. Cards whose rows run edge to edge (lists, settings groups) set padding to 0 and let each row pad itself. No last child adds bottom margin inside a card.
- **Bottom of every screen: one gap, clear of whatever covers it** (decision 194, John, Nov 12, Wave 2 finding 39). The last content scrolls a full `space-6` (the space between cards) above whatever sits over the bottom of the screen, so nothing is ever hidden at the end of a scroll:
  - On a tab: above the tab bar, using its real height (it grows with larger text before iOS 26; the iOS 26 Liquid Glass bar's height comes from the tab's safe area). The scroll bar stops at the tab bar too.
  - Above a pinned button bar (Set up a match, Create league, Send Round N to players, Join league): above the bar, measured, so it holds at any text size. The bar itself clears the home indicator.
  - Anywhere else: above the home indicator.
  - In the app, every `ScrollView`, `FlatList` and `SectionList` takes its `paddingBottom` and `scrollIndicatorInsets` from `useScreenBottomInset` (`hooks/useScreenBottomInset.ts`; the math is in `lib/screenBottomInset.ts`). A pinned bar that floats over the list reports its height with `usePinnedBarHeight`. Never add a bottom spacer or a fixed number. The tabs turn off iOS's automatic insets (`disableAutomaticContentInsets`) so the hook is the one source. `ScrollScreen` and `SheetBody` use it too.
- **Touch targets grow with hitSlop, not layout.** A text link or text button (Change in Settings, Set a match time, Enter score, Clear) keeps its 44pt target through `hitSlop` (`textTapSlop` in `lib/tapTarget.ts`), never `minHeight` or padding, so it doesn't add visible space in a card. Filled buttons and chips show their full target and keep their size; anything smaller than 44pt that you can tap (a pill, an icon) gets the rest from hitSlop too.
- Touch targets: 44px minimum.
- Buttons in the native header are plain brush icons; iOS draws their background.

## Buttons and icons

One standard, three kinds, one look each (John, Nov 8):

1. **Screen corners: a glass circle.** 44pt, brush icon in ink. Back is always top left. On a tab, Messages is always top right, with the tab's own action just left of it (Settings on Profile, Start a league on Leagues). On a league page, chat is top right and admins get a gear (Manage league) just left of it, with a small ink dot while pairings wait for review; the label says so too (decision 185). Full-screen flows put Close (`xmark`) top left. On pushed screens the native header draws the circle (`HeaderIconButton`, a plain brush icon; iOS 26 adds the Liquid Glass). On tabs the header is ours, so `CornerButton` draws the same Liquid Glass as the tab bar (`expo-glass-effect`); where Liquid Glass isn't available (before iOS 26) it's a `sand` circle with a `hairline` border.
2. **Icons inside the page: a plain brush icon.** Ink, no circle, no border, no fill, still a 44pt tap area (`PlainIconButton`). A small ink dot marks something that's on, like active filters, and the label says so too. Used for Filters, the card's pencil and free-times grid, the chat's Add a match (calendar) and Send, and the invite code's Copy and Share.
3. **Actions with words: a `Button`.** Anything that does the screen's job gets words: Record with Ball Boi, Enter score, Set up a match, Send report. Primary is ink filled, secondary is outlined. Never an icon alone.

**Button hierarchy** (decision 189, John, Nov 12). An empty state, card or screen has at most one primary and at most one secondary (outline) Button. Never stack secondaries. Any further action is a tertiary text link (`TextLinkButton`: a centered, underlined `TextLink` padded to a 44pt tap area) below the buttons.

**Empty states** (decisions 188 to 190). The roundel at 50% or a brush symbol, a title, one line, then the ways forward under the button hierarchy above. Discover > Players: Widen to N mi (primary, when a wider distance exists), Post an open match (secondary), Invite a friend (link). When filters emptied the list, say so: "No players match your filters", a line naming them in plain words ("Nobody nearby is free when you are."), then Clear filters (primary), Widen (secondary, if any) and Post an open match (link). Never blame the area ("Ball Boi is new near you") when filters caused it. The Filters icon shows its dot whenever a filter is on, and VoiceOver says how many ("Filters, 1 on").

Steppers (− and +) and chips are controls, not icon buttons, and keep their outlines.

Copy buttons confirm by turning into a check for about 2 seconds, with no separate "Copied" text (John, Nov 11, finding 22). In the app this is `CopyButton`.

**One button height** (John, Nov 10). Every Button is one height: 48pt at default text size, growing only with Dynamic Type; labels never wrap; side-by-side buttons match; at the largest sizes rows stack. The 48pt is the `button` type style's 22pt line height plus 13pt above and below, so every button grows by the same amount at each text size. Primary, secondary, destructive and destructive outline all share it, and so does the camera's `ChromeButton`. Put buttons side by side in a `ButtonRow`: they share the row equally, and when any label wouldn't fit on one line the row stacks them full width. Keep labels short enough to sit side by side ("Message", with VoiceOver saying "Message Marcus Hall"). Chips, time pills, segmented controls, steppers, icon buttons, text buttons and Apple's and Google's own sign-in buttons are not Buttons and keep their own sizes.

## Bottom sheets

One rule for every bottom sheet (John, Nov 6), like the approved Enter score sheet:

- The sheet hugs its content and grows with larger text. It only scrolls when the content is taller than the screen.
- It has one position, its content's height: no taller position to drag to. The primary action sits one `space-4` gap above the home indicator; iOS adds the home indicator strip below a hugging sheet's content, so the content never pads for it again (Wave 2 finding 46).
- **A Close button at the top left** (decision 198, John, Nov 12, Wave 2 finding 50; replaces the old "no Cancel" rule, #214). A brush X (`xmark`) in the 44pt corner circle, the same Liquid Glass as the tab corners (sand circle with a hairline where glass isn't available), on the same row as the title, under the grabber. VoiceOver reads it as "Close". It's the non-gesture way to do what swipe down does, so both still work. A sheet with a native navigation bar (Quick match, Post an open match) has it in the bar's left slot instead.
- Closing goes one way, whether it's the X, a drag down or the VoiceOver escape gesture (two-finger Z): if something would be lost (a form with changes, a Quick match not yet recorded), it asks first ("Discard changes?" with Keep editing and a red Discard); if nothing would be lost, it closes at once. Nothing recorded is ever discarded silently.
- The one exception: the notifications pre-prompt has no X, because App Review wants a screen before a permission prompt to lead only to it. Drag down still closes it.
- A left-aligned `heading-m` title (Cormorant at 50% ink) sits beside the X, read by VoiceOver as the header.
- The primary action is the last thing in the sheet, full width.
- Sheets sit on `linen` with the `radius-lg` corner and the system grabber.
- **Every sheet you can swipe down shows the grabber bar at the top**, full-height page sheets and swipe-down modals included, so people know they can swipe it away (decision 181, John, Nov 11). iOS draws it on the hugging sheets. Page sheets (New league, Join league, Quick match, Post an open match, a recorded match's invite) get `Grabber` from `components/Sheet.tsx`, drawn to match: 36 by 5pt, fully round, 5pt from the top, centred, in `hairline-strong` (3:1 or better on `paper` and `linen` in Day and Night, `-hc` with Increase Contrast). It's decorative, so VoiceOver skips it; each of these screens has the Close (X). A modal that can't be swiped down (Invite players after creating a league, the recording camera) has no grabber; Invite players still has the X at the top left, and the camera keeps its own close in its controls.

In the app, `components/Sheet.tsx` (`SheetBody`) does all of this, the X included (`SheetClose`; `SheetCloseBar` for a modal whose title sits lower, like Join league's invite card); sheet routes use the `sheet` options in `app/_layout.tsx`.

### Menus and pickers

Menus and pickers open in a bottom sheet, never the native action sheet (decision 193, John, Nov 12). Native alerts are only for confirming destructive actions (delete, remove, leave, ban, discard) and for errors.

- Same sheet rules as above: `linen`, `radius-lg` top corners, the grabber, hugs its content and scrolls only when it's taller than the screen. The Close (X) at the top left beside the title (decision 198); swipe down or a tap on the dimmed backdrop closes it too, and there's no Cancel row. A menu loses nothing by closing, so it never asks. The VoiceOver escape gesture closes it (or goes back a step).
- Optional header: a `heading-m` title (or `title` at full ink when it holds a name), the people it's about with their photo or initials (a match shows both players, "vs." between), and a short muted message.
- Rows are at least 52pt tall: a brush icon (or a player's photo), the label in DM Sans 600, an optional muted second line. A row that opens a second step ends in a chevron.
- Destructive rows are `danger` text and icon, and confirm with a native alert after the sheet closes.
- A second step (Swap Maya Chen with: a player list) opens inside the same sheet, with Back in the X's place at the top left, the way a pushed page in an iOS sheet swaps Close for Back.
- Reduce Motion: it fades instead of sliding.

In the app, `components/ActionSheet.tsx` (`useActionSheet`) does all of this.

## Iconography

The tab bar uses the custom brush icon set John approved (Nov 5): hand-drawn Home, Leagues, Discover and Profile in `ink-muted`, with the selected tab filled with the painted ball's paint under an `ink` outline. Ball Boi keeps the logo ball and follows the same rule (Nov 6): its strokes in `ink-muted` with no fill when unselected, filled with its paint under `ink` strokes only when selected. Sources are in `docs/design-system/icons`, and `scripts/design/tab-icons.py` draws the app's Day and Night PNGs from them. **Every icon is hand-drawn (John, Nov 7).** Outside the tab bar, every icon in the app comes from the same brush set: tapered, rounded strokes with a little wobble, and circles left with a small open gap, like the tab icons. They're drawn in one color (`ink` by default, `ink-muted` for chevrons and quiet meta icons, `danger` for destructive rows). Never use SF Symbols, Lucide or any other icon set, and never a thin line icon. In the app, use `<Icon name="..." />` (`components/Icon.tsx`); names follow SF Symbols so meanings stay familiar (`chevron.right`, `calendar.badge.plus`). A new icon is drawn in `scripts/design/brush-icons.py` (one function per icon, centre-line strokes on a 24 grid) and the script writes the app's paths and the sources in `docs/design-system/icons/ui`. A check (`scripts/check-brush-icons.mjs`, part of `pnpm test`) fails if any screen imports SF Symbols or an icon library. The native iOS back chevron and system sheets, alerts and share sheet stay as iOS draws them. No duotone icons, no emoji in UI.

**Filters** (John, Nov 7; restyled Nov 8) is the `slider.horizontal.2` icon alone (two sliders, each with a knob), plain in ink with no circle (an in-page icon, see Buttons and icons), beside a list's count line. VoiceOver reads "Filters" and what's set; a small ink dot marks filters that are on.

**Pinning in league chats** (finding 24, John, Nov 11). Pinning has a visible pin control on the admin's own league posts: a plain brush pin beside the message, outline (`pin`) when not pinned and filled (`pin.fill`) when pinned, with a 44pt tap area, "Pin post" or "Unpin post" for VoiceOver, and selected when pinned. Every pinned post shows the filled pin to everyone, and VoiceOver says "Pinned", so pinned is never color alone. Long-press (and VoiceOver's More actions) stays for other actions: pinning members' posts, Report, Delete, Mute and Remove. With 3 posts pinned, tapping an outline pin says only 3 posts can be pinned and to unpin one first.

## Logo

The roundel is the wordmark. `assets/Logos/ball-boi-roundel.png` is the painted original on paper, for print and marketing. In the app use the transparent traces: `ball-boi-roundel-ink.svg` by day, `ball-boi-roundel-white.svg` at night. Show it at 40px minimum. Do not recolor, outline or place it on photos.

Where it appears:
- Splash, Welcome, the marketing site and App Store screenshots
- At 52px in place of the Home tab header's title, left aligned on the row with Messages, with no date or greeting, once Home has something to show. The brushstroke in ink by day; at night the brushstroke alone in white, with no paper fill (John, Nov 6)
- Player-facing empty states on the main tabs (Home, Leagues, Discover), at 120px in place of the symbol. On Home it appears here only while there's nothing to show yet, and the header then has no roundel, so it's never on screen twice (John, Nov 6, finding 27). In every empty, error or "nothing yet" state it shows at 50% opacity (`<Roundel emptyState />`, `EMPTY_STATE_ROUNDEL_OPACITY`; decision 188, John, Nov 12): the ink trace measures 3.16:1 on Day `paper` and the white trace 5.09:1 on the Night ground. It stays decorative (hidden from VoiceOver). Headers, Settings and Welcome keep it at full strength
- Behind the badge in milestone moments (first win, first Ball Boi match, 5- and 10-match win streaks)
- Stamped on every shareable match recap
- An About footer at the bottom of Profile

Inside the app it's decorative: the screen's title or text carries the meaning, so VoiceOver skips it. In Night session it drops its paper fill: just the brushstroke, in white.

The app icon (`assets/Logos/ball-boi-app-icon.png`) is the symbol: the hand-painted ball in `ink` on a white tile, to match the ivory Day palette (John, Nov 6). It stays white in iOS Dark Mode too, with no dark variant (John, Nov 7). No wordmark in the icon; iOS prints the name beneath it.

## Loading and error states

What a screen shows when its data is loading, can't load, or can't refresh (decision 195, John, Nov 12, Wave 2 finding 41):

- **Loading, nothing yet:** sand skeleton rows that hold still (Discover) or a single ink spinner. No shimmer, so there's nothing for Reduce Motion to stop.
- **Can't load, nothing to show:** the screen's full error card: a sand circle with the brush wifi-off icon, "Can't load [thing]" (Can't load players, Can't load your leagues, Can't load this match), one line ("Check your connection and try again.") and a secondary Try again button. VoiceOver hears the title and line once. Never raw error text. In the app: `ProblemCard` in `components/discover/States.tsx`.
- **A refresh failed, but there's something on screen:** keep it, and add a quiet notice at the top of the content: a sand panel (`radius-md`), `space-4` on every side (decision 192), a 20pt brush icon in `ink`, and `small` text in `ink`.
  - Offline: `wifi.slash` and "You're offline. Showing what was here earlier."
  - Any other failure (a server error): `exclamationmark.circle` and "Couldn't refresh. Showing what was here earlier." with Try again as an underlined text link (its 44pt target is hitSlop).
  - An icon and words, never color alone. VoiceOver hears it once when it appears.
  - It goes away by itself once a refresh works: another pull, Try again, coming back to the app (turning off Airplane Mode in Control Center does this), or a quiet check every 15 seconds while it shows.
  - In the app: every screen with pull to refresh gets `notice` from `usePullToRefresh` and adds `<OfflineNotice pull={pull} />` at the top of its content. The hook decides; the screen adds one line. A pull's work returns its `query.refetch()` results so the hook can tell a failure with data on screen from one with nothing to show.
- Offline requests fail at once instead of retrying, so the spinner stops and the notice shows without a wait. Other failures still retry three times.

## Applying it to the app

1. Load the two Google families in `components/bundle.css`.
2. Replace `pool` with `court`, `clay` with `court` (live) and drop every use of `sun`. The focus ring becomes `ink`.
3. Replace drop shadows on cards with the `hairline` border.
4. Set the page body on `paper` with no grain texture. The cabana awning is retired; delete it.
5. Mark live matches with the filled `court` chip and its dot, and winners with the brush underline (The winner mark).
6. Standings rank on wins, then head to head between players level on wins, then share of sets won, then share of games won. Tables show rank, player and W–L, with no Pts column.
