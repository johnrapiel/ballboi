<!-- Snapshot of the Ball Boi design system: https://claude.ai/artifact/XRuxb1uAfy18AQ1irQCkrf (2026-10-18). The live design system wins if they differ. -->

# Ball Boi

Club tennis, on resort time.

Ball Boi is a tennis app with heritage manners and a long-weekend attitude. Think Wilson's navy-and-cream restraint, crossed with a cabana at a Riviera club at 5 pm. Everything is built from the logo: navy brush ink on warm watercolor paper.

## Principles

- **Paper, not glass.** Warm sand grounds with a faint grain. No gradients, no glassmorphism, no neon.
- **One ink.** Navy does almost everything: text, buttons, rules, the ring. Color is an event.
- **Hairlines over shadows.** Cards sit on a 1px `hairline` border. Only floating things (sheets, menus) get `shadow-lift`.
- **Serif for the moment, sans for the work.** Cormorant Garamond carries titles and scores. DM Sans carries everything you tap or read in a list.
- **Generous, never crowded.** Default to `space-6` between cards and `space-12` above heroes. A resort has room.
- **One flourish per screen.** The brush ring, the awning, or an italic line. Pick one.

## Voice

Confident, light, a little wry. Short sentences. Tennis words used correctly.

| Instead of | Write |
| --- | --- |
| Submit score | Record score |
| No matches found | Courts are quiet. *Book a hit?* |
| Match completed successfully | Game, set, match. |
| Error: invalid input | That score can't happen in tennis. Check the tiebreak. |

The italic display style (`title-italic`) is the vacation voice. Use it for empty states and celebrations, never for instructions.

## Color

| Token | Role |
| --- | --- |
| `paper` | Page ground, with grain |
| `linen` | Cards, nav, sheets |
| `sand` | Sunken wells, zebra rows, quiet chips (the logo's paper) |
| `ink` | Text, primary actions, the ring (the logo's brush) |
| `ink-muted` | Meta and secondary text |
| `pool` | Wins, links, confirmations |
| `clay` | Live, match point. Once per screen |
| `sun` | Ball dot and highlights. Never text |
| `danger` | Destructive and errors only |

Night session (dark) inverts to harbor navy with cream ink. Same rules apply. Every text pair clears 4.5:1 in both themes; `pool` and `clay` are text-safe on `paper` and `linen`.

## Type

- **Display:** Cormorant Garamond 500/600, italic 500. Titles, scores, rank numerals.
- **Text:** DM Sans 400/600. Body, buttons, labels.
- **Scores always use** `font-variant-numeric: lining-nums tabular-nums` so sets line up.
- **Labels** are 11px uppercase with 0.16em tracking: the heritage tag on a racquet throat.
- Never set the logo's brush script as a font. The brush lives in the logo and the ring.

## Signature motifs

1. **Brush ring.** The logo's hand-drawn circle, wrapped around the single thing that matters: the match winner, the current user's rank, the active tab underline. One per view.
2. **Cabana awning.** Navy and linen stripes with a scalloped hem, 18px tall. Under the nav or atop a hero. Never stacked, never as a background fill.
3. **Paper grain.** `.bb-grain` on the page ground only. Never on cards.

## Shape and space

- Radius: `radius-pill` (999px) for primary and secondary buttons, chips and avatars. `radius-md` (10px) for cards, `radius-lg` for sheets.
- Spacing steps: 4, 8, 12, 16, 24, 32, 48. Page gutter `space-4` on phones, `space-6` up.
- Touch targets: 44px minimum.

## Iconography

Thin 1.5px line icons, round caps, drawn in `ink`. Lucide at stroke-width 1.5 is a good match. No filled or duotone icons, no emoji in UI.

## Logo

The roundel is the mark. The master file is `artifacts/mobile/assets/images/roundel.png` (1024×1024, the original upload, also in the design system artifact under Logos). Show it on `paper` or `linen` only, at 40px minimum. In the nav, crop to the circle at 52px. Do not recolor, outline or place it on photos.

Always use it with its watercolor paper texture. Never cut the brush out onto a transparent or flat background, never redraw it, and never upscale a smaller copy. Where the texture meets a flat fill (the splash screen, a site background), use `#E2CEB0`, the paper's median color.

## Applying it to the app

1. Load the two Google families in `components/bundle.css`.
2. Swap the old Ink Navy / Court Cream / Teal Ace values for `ink`, `paper`/`linen`, `pool`. Playfair Display becomes Cormorant Garamond; DM Mono retires (scores move to the display serif).
3. Replace drop shadows on cards with the `hairline` border.
4. Add `.bb-grain` to the page body and the awning under the top nav.
5. Mark live matches with the `clay` chip and winners with the brush ring.
