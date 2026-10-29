<!-- Snapshot of the Ball Boi design system: https://claude.ai/artifact/XRuxb1uAfy18AQ1irQCkrf (2026-10-29). The live design system wins if they differ. -->

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

## Type

- **Display:** Cormorant Garamond 500/600, italic 500. Titles, scores, rank numerals.
- **Text:** DM Sans 400/600. Body, buttons, labels.
- **Scores always use** `font-variant-numeric: lining-nums tabular-nums` so sets line up.
- **Labels** are 11px uppercase with 0.16em tracking: the heritage tag on a racquet throat.
- Never set the logo's brush script as a font. The brush lives in the logo and the ring.

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
