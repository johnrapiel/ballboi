<!-- Snapshot of the Ball Boi design system: https://claude.ai/artifact/XRuxb1uAfy18AQ1irQCkrf (2026-10-29, accessibility pass). The live design system wins if they differ. -->

# Ball Boi

Club tennis, done properly.

Ball Boi is a tennis app with heritage manners. Think Wilson's navy-and-cream restraint, with the hand of a painter: brush ink, a hand-drawn ring, warm paper. Everything is built from the roundel: navy brush ink on warm paper.

## Principles

- **One ink.** Navy does almost everything: text, buttons, rules, the ring, every shape. If a screen looks good in navy and cream alone, it's done.
- **Color is rare.** `court` green appears only when something good or live needs saying. Most screens use none. `danger` appears only for destructive actions and errors.
- **Paper, not glass.** Warm cream grounds with a faint grain. No gradients, no glassmorphism, no neon.
- **Hand-made, not decorated.** The brush ring and the painted ball carry the brushwork. Never more than one per screen.
- **Hairlines over shadows.** Cards sit on a 1px `hairline` border. Only floating things (sheets, menus) get `shadow-lift`.
- **Serif for the moment, sans for the work.** Cormorant Garamond carries titles and scores. DM Sans carries everything you tap or read in a list.
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
| `paper` | Page ground, with grain |
| `linen` | Cards, sheets, the tab bar |
| `sand` | Sunken wells, zebra rows, quiet chips (the logo's paper) |
| `on-ink` | White on navy: button labels, the app icon's ball |
| `court` | The one accent. Wins, confirmations, live, links. Sparingly |
| `danger` | Destructive and errors only |

Night session (dark) inverts to harbor navy with cream ink. Same rules apply. Every text pair clears 4.5:1 in both themes. `court` and `danger` are text-safe on `paper`, `linen` and `sand`.

Retired in this refresh: `pool` (teal), `clay` (terracotta) and `sun` (yellow). Live matches move to `court`, links and wins to `court`, the focus ring to `ink`.

### Every color job has a shape

`court` is only 2.0:1 against `ink` text, and `court` and `danger` share a lightness (a red-green pair). So color never carries a meaning alone:

| Job | Cue besides color |
| --- | --- |
| Link in a sentence | Underlined (`TextLink`). Standalone links on rows and buttons need no underline |
| Live | The filled `court` chip with its dot |
| Win or confirmation | A check, and the word ("Won", "W") |
| Error or loss | A cross, and the word ("Not sent", "L") |

Never put `court` and `danger` side by side as the only difference between two things.

### Increase Contrast

When iOS Increase Contrast is on, `ink-muted`, `hairline` and `hairline-strong` switch to their `-hc` tokens. Every screen gets this through `useColors`; nothing to do per screen.

## Type

- **Display:** Cormorant Garamond 500/600, italic 500. Titles, scores, rank numerals. Never below 20px: its hairline strokes vanish at small sizes.
- **Text:** DM Sans 400/600. Body, buttons, labels.
- **Body is 17px**, the iOS body size. Small is 15px, buttons 16px.
- **Scores always use** `font-variant-numeric: lining-nums tabular-nums` so sets line up.
- **Labels** are 11px uppercase with 0.16em tracking: the heritage tag on a racquet throat. 11px is the iOS floor, so it's for eyebrows and table headers only. Chips use `chip`, 12px.
- Never set the logo's brush script as a font. The brush lives in the logo and the ring.

### Dynamic Type and display settings

- **Text styles scale fully** with the user's text size. Layouts reflow; nothing truncates.
- **Display styles stop at 1.5x**, so heroes and scores never clip.
- **Bold Text:** every style goes one weight heavier (DM Sans 400 to 600, 600 to 700; Cormorant 500 to 600, 600 to 700).
- **Night session:** Cormorant goes one weight heavier, because light hairlines thin out on navy.

## Charts and replay

The replay and stats stay inside the one-ink palette. No literal grass green, no rainbows.

- **Court surface:** `sand`, with `ink` lines at 1.5px.
- **Players:** you are a solid `ink` circle, your opponent a hollow `ink` ring. Shape tells them apart, never color.
- **Shot outcomes:** winners get a check in `court`, errors a cross in `danger`. Rally shots are small `ink-muted` dots.
- **Close call:** a dashed `ink` ring plus the words "Close call". Never a color on its own.
- **Heatmaps:** `heat-1` to `heat-5`, one ink in five steps on `sand`. Every bin shows its count or percent as text: `ink` on `heat-1` and `heat-2`, `on-ink` from `heat-3` up.
- **Trend lines:** `ink` at 2px. A second series is a dashed `ink-muted` line with its label at the line's end.
- **Every chart** has a one-line text summary for VoiceOver and an accessible table behind it.

## Signature motifs

Pick one per screen.

1. **Brush ring.** The logo's hand-drawn circle, wrapped around the single thing that matters: the match winner, the current user's rank, the active tab underline.
2. **Painted ball.** The app icon's hand-painted ball, in `ink` on paper or `on-ink` on an ink field. One, large, in a hero, the splash or a celebration. Never as a repeating pattern, never in color.
3. **Paper grain.** `.bb-grain` on the page ground only. Never on cards.

## Shape and space

- Radius: `radius-pill` (999px) for primary and secondary buttons, chips and avatars. `radius-md` (10px) for cards, `radius-lg` for sheets.
- Spacing steps: 4, 8, 12, 16, 24, 32, 48. Page gutter `space-4` on phones, `space-6` up.
- Touch targets: 44px minimum.

## Iconography

Thin 1.5px line icons, round caps, drawn in `ink`. Lucide at stroke-width 1.5 is a good match. No filled or duotone icons, no emoji in UI.

## Logo

The roundel (`assets/Logos/ball-boi-roundel.png`) is the wordmark. Show it on `paper` or `linen` only, at 40px minimum: the splash, Welcome, the marketing site, App Store screenshots. Do not recolor, outline or place it on photos.

The app icon (`assets/Logos/ball-boi-app-icon.png`) is the symbol: the hand-painted ball in white (`on-ink`) on an `ink` tile with a faint paper grain. No wordmark in the icon; iOS prints the name beneath it.

## Applying it to the app

1. Load the two Google families in `components/bundle.css`.
2. Replace `pool` with `court`, `clay` with `court` (live) and drop every use of `sun`. The focus ring becomes `ink`.
3. Replace drop shadows on cards with the `hairline` border.
4. Add `.bb-grain` to the page body. The cabana awning is retired; delete it.
5. Mark live matches with the filled `court` chip and its dot, and winners with the brush ring.
